"""Optional 10-minute PPFD output: request limits and algorithm-result validation."""
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import Field

from app.schemas import Input


CellIndex = Annotated[int, Field(ge=0, strict=True)]
Cell = tuple[CellIndex, CellIndex]
PpfdValue = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
MAX_PPFD_VALUES = 500_000


class PpfdBase(Input):
    times: list[datetime] = Field(max_length=144)
    interval_minutes: Literal[10]
    ppfd_unit: Literal['umol/m2/s']


class PpfdGridSeries(PpfdBase):
    direct_ppfd: list[list[list[PpfdValue | None]]]
    diffuse_ppfd: list[list[list[PpfdValue | None]]]


class PpfdCell(Input):
    row: CellIndex
    col: CellIndex
    direct_ppfd: list[PpfdValue]
    diffuse_ppfd: list[PpfdValue]


class PpfdCellSeries(PpfdBase):
    cell_series: list[PpfdCell]


PpfdSeries = PpfdGridSeries | PpfdCellSeries


def validate_request(body, spec):
    if not getattr(body, 'timeseries', False):
        return
    cells = body.cells
    if cells is not None and any(
        not (r < spec['rows'] and c < spec['cols'] and spec['inside_mask'][r][c])
        for r, c in cells
    ):
        raise HTTPException(422, 'PPFD cells must be inside the room grid')
    count = len(cells) if cells is not None else spec['rows'] * spec['cols']
    days = (body.end_date - body.start_date).days + 1
    if count * 144 * 2 * days > MAX_PPFD_VALUES:
        raise HTTPException(422,
            'PPFD response is too large (maximum 500000 values); select cells, fewer days or a coarser grid')


def validated_result(payload, day, raw):
    """Reject missing, misaligned or inconsistent PPFD before publishing/caching it."""
    requested = payload['request'].get('cells')
    model = PpfdGridSeries if requested is None else PpfdCellSeries
    fields = ('times', 'interval_minutes', 'ppfd_unit') + (
        ('direct_ppfd', 'diffuse_ppfd') if requested is None else ('cell_series',))
    series = model.model_validate({key: raw[key] for key in fields})
    for n, time in enumerate(series.times):
        if (time.utcoffset() != timedelta(hours=9) or time.date() != day or
                time.minute % 10 != 5 or time.second or time.microsecond or
                (n and time - series.times[n-1] != timedelta(minutes=10))):
            raise ValueError('PPFD times must be consecutive 10-minute midpoints on the requested KST date')

    def check_dli(values, component, row, col):
        if len(values) != len(series.times):
            raise ValueError('PPFD values must align with times')
        # PPFD is rounded to 0.1, daily DLI to 0.01 in the upstream algorithm.
        tolerance = 0.0051 + len(values) * 0.05 * 600 / 1_000_000
        if abs(sum(values) * 600 / 1_000_000 - raw[component + '_dli'][row][col]) > tolerance:
            raise ValueError('Integrated PPFD does not match daily DLI')

    spec = payload['grid']
    if requested is None:
        for component in ('direct', 'diffuse'):
            arrays = getattr(series, component + '_ppfd')
            if len(arrays) != len(series.times):
                raise ValueError('PPFD time dimension mismatch')
            for frame in arrays:
                if len(frame) != spec['rows'] or any(len(row) != spec['cols'] for row in frame):
                    raise ValueError('PPFD grid dimensions mismatch')
                for r, mask_row in enumerate(spec['inside_mask']):
                    for c, inside in enumerate(mask_row):
                        if (frame[r][c] is not None) != inside:
                            raise ValueError('PPFD inside cells need values; outside cells must be null')
            for r, mask_row in enumerate(spec['inside_mask']):
                for c, inside in enumerate(mask_row):
                    if inside:
                        check_dli([frame[r][c] for frame in arrays], component, r, c)
    else:
        if [[cell.row, cell.col] for cell in series.cell_series] != [list(cell) for cell in requested]:
            raise ValueError('PPFD cells do not match the requested cells')
        for cell in series.cell_series:
            for component in ('direct', 'diffuse'):
                check_dli(getattr(cell, component + '_ppfd'), component, cell.row, cell.col)
    return series.model_dump(mode='json')
