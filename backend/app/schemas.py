from datetime import date, datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, field_validator, model_validator

from app.geometry import floor_area, perimeter, validate_room, validate_measurement


Finite = Annotated[float, Field(allow_inf_nan=False)]
Coordinate = Annotated[float, Field(ge=-10000, le=10000, allow_inf_nan=False)]
COORDINATE_SYSTEM = 'FIRST_CORNER_ORIGIN_AR_HORIZONTAL'
KST = timezone(timedelta(hours=9))


def round_m(value):
    return float(Decimal(str(value)).quantize(Decimal('0.001'), rounding=ROUND_HALF_UP))


Name = Annotated[str, Field(min_length=1, max_length=100)]


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Register(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=1, max_length=50)

    @field_validator('nickname')
    @classmethod
    def normalize_nickname(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('nickname must not be blank')
        return value


class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class Token(Output):
    access_token: str
    token_type: str = 'bearer'
    expires_in: int


class UserOut(Output):
    id: int
    email: str
    nickname: str
    created_at: datetime

    @field_validator('created_at')
    @classmethod
    def utc_timestamp(cls, value):
        return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value).astimezone(KST)


class Corner(Input):
    model_config = ConfigDict(extra='forbid', from_attributes=True)
    x: Coordinate
    y: Coordinate
    z: Coordinate
    order_index: int = Field(ge=0, le=255)

    @field_validator('x','y','z')
    @classmethod
    def millimeters(cls,value):
        return round_m(value)


class RoomInput(Input):
    name: Name
    coordinate_system: Literal['FIRST_CORNER_ORIGIN_AR_HORIZONTAL'] = COORDINATE_SYSTEM
    x_axis_azimuth_deg: Annotated[float, Field(ge=0, lt=360, allow_inf_nan=False)] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)] | None = None
    timezone: Literal['Asia/Seoul'] = 'Asia/Seoul'
    corners: list[Corner] = Field(min_length=4, max_length=256)

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError('Use an IANA timezone, e.g. Asia/Seoul') from exc
        return value

    @model_validator(mode='after')
    def valid_geometry(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError('latitude and longitude must be provided together')
        self.corners = validate_room(self.corners)
        if any(c.y != 0 for c in self.corners):
            raise ValueError('Room floor corners must have y=0')
        if self.corners[0].x != 0 or self.corners[0].z != 0:
            raise ValueError('First room corner must be the origin (0,0,0)')
        for c in self.corners:
            c.x, c.z = round_m(c.x), round_m(c.z)
        validate_room(self.corners)
        return self


class RoomOut(Output):
    id: int
    user_id: int
    name: str
    coordinate_frame: str
    saved_at: str | None
    x_axis_azimuth_deg: float | None
    latitude: float | None
    longitude: float | None
    timezone: str
    geometry_version: int
    corners: list[Corner]

    @computed_field
    @property
    def floor_area_m2(self) -> float:
        return round_m(floor_area(self.corners))

    @computed_field
    @property
    def coordinate_system(self) -> str:
        return self.coordinate_frame

    @computed_field
    @property
    def unit(self) -> str:
        return 'm'

    @computed_field
    @property
    def area_square_meters(self) -> float:
        return self.floor_area_m2

    @computed_field
    @property
    def perimeter_meters(self) -> float:
        return round_m(perimeter(self.corners))


class WindowInput(Input):
    name: Name
    corners: list[Corner] = Field(min_length=4, max_length=4)


class WindowOut(Output):
    id: int
    room_id: int
    name: str
    corners: list[Corner]
    measurement: dict | None


class SpeciesInput(Input):
    name: Name
    scientific_name: str | None = Field(default=None, max_length=150)
    min_dli: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    max_dli: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    source_note: str = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def valid_dli(self):
        if self.max_dli < self.min_dli:
            raise ValueError('max_dli must be >= min_dli')
        return self


class SpeciesOut(Output):
    id: int
    name: str
    scientific_name: str | None
    min_dli: float
    max_dli: float
    source_note: str | None


class Position(Input):
    x: Coordinate
    y: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 0
    z: Coordinate

    @field_validator('x','y','z')
    @classmethod
    def millimeters(cls,value):
        return round_m(value)


class PlantInput(Input):
    species_id: int = Field(gt=0)
    nickname: Name
    room_id: int | None = Field(default=None, gt=0)
    position: Position | None = None

    @model_validator(mode='after')
    def placement(self):
        if (self.room_id is None) != (self.position is None):
            raise ValueError('room_id and position must be supplied together, or both null')
        return self


class PlantOut(Output):
    id: int
    user_id: int
    room_id: int | None
    species_id: int
    nickname: str
    x: float | None
    y: float | None
    z: float | None

    @computed_field
    @property
    def position(self) -> Position | None:
        if self.x is None:
            return None
        return Position(x=self.x, y=self.y, z=self.z)


class GridSpec(Input):
    schema_version: Literal['grid_v2'] = 'grid_v2'
    room_id: int = Field(gt=0)
    geometry_version: int = Field(gt=0)
    coordinate_system: Literal['FIRST_CORNER_ORIGIN_AR_HORIZONTAL'] = COORDINATE_SYSTEM
    unit: Literal['m'] = 'm'
    origin: Position
    cell_size_m: Annotated[float, Field(ge=0.05, le=5, allow_inf_nan=False)]
    sample_height_m: Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)] = 0
    rows: int = Field(ge=1, le=40000)
    cols: int = Field(ge=1, le=40000)
    array_order: Literal['[row_z][col_x]'] = '[row_z][col_x]'
    inside_mask: list[list[bool]]

    @model_validator(mode='after')
    def valid_shape(self):
        if self.rows*self.cols > 40000:
            raise ValueError('Maximum 40,000 cells')
        if len(self.inside_mask) != self.rows or any(len(r) != self.cols for r in self.inside_mask):
            raise ValueError('inside_mask dimensions must equal rows and cols')
        return self


DliValue = Annotated[float, Field(ge=0, allow_inf_nan=False)] | None


class DliMap(Input):
    schema_version: Literal['dli_map_v2'] = 'dli_map_v2'
    room_id: int = Field(gt=0)
    geometry_version: int = Field(gt=0)
    date: date
    timezone: str
    unit: Literal['mol/m2/day'] = 'mol/m2/day'
    grid: GridSpec
    direct_dli: list[list[DliValue]]
    diffuse_dli: list[list[DliValue]]
    total_dli: list[list[DliValue]]

    @model_validator(mode='after')
    def check_arrays(self):
        if self.room_id != self.grid.room_id or self.geometry_version != self.grid.geometry_version:
            raise ValueError('room_id and geometry_version must match grid')
        for values in [self.direct_dli,self.diffuse_dli,self.total_dli]:
            if len(values) != self.grid.rows or any(len(r) != self.grid.cols for r in values):
                raise ValueError('DLI array dimensions must equal grid rows and cols')
        for r in range(self.grid.rows):
            for c in range(self.grid.cols):
                values=[self.direct_dli[r][c],self.diffuse_dli[r][c],self.total_dli[r][c]]
                if not self.grid.inside_mask[r][c]:
                    if any(v is not None for v in values):
                        raise ValueError('Outside cells must be null in all DLI arrays')
                elif any(v is None for v in values):
                    raise ValueError('Inside cells must contain non-negative finite numbers')
                elif abs(values[0]+values[1]-values[2]) > 1e-5:
                    raise ValueError('total_dli must equal direct_dli + diffuse_dli')
        return self


class MeasurementPoint(Input):
    x: Coordinate
    y: Coordinate
    z: Coordinate


    @field_validator('x','y','z')
    @classmethod
    def millimeters(cls,value):
        return round_m(value)


class WindowMeasurement(Input):
    window_id: str = Field(min_length=1, max_length=100)
    wall_index: int = Field(ge=0, le=255)
    status: Literal['COMPLETE']
    floor_reference: MeasurementPoint
    sill_height_m: Finite
    width_m: Finite
    height_m: Finite
    top_height_m: Finite
    area_square_meters: Finite
    corners: list[Corner] = Field(min_length=4, max_length=4)
    measured_corners: list[MeasurementPoint] = Field(min_length=4, max_length=4)
    floor_measurement_method: Literal['ARCORE_SURFACE_HIT']
    window_measurement_method: Literal['MEASURED_WALL_RAY_INTERSECTION']
    max_plane_residual_m: Annotated[float, Field(ge=0, le=0.352, allow_inf_nan=False)]
    saved_at: datetime

    @field_validator('saved_at')
    @classmethod
    def require_kst(cls, value):
        if value.utcoffset() != timedelta(hours=9):
            raise ValueError('saved_at must have +09:00 offset')
        return value


class ARMeasurement(Input):
    schema_version: Literal[3]
    unit: Literal['m']
    coordinate_system: Literal['FIRST_CORNER_ORIGIN_AR_HORIZONTAL']
    saved_at: datetime
    corners: list[Corner] = Field(min_length=4, max_length=256)
    area_square_meters: Finite
    perimeter_meters: Finite
    windows: list[WindowMeasurement] = Field(max_length=256)

    @field_validator('saved_at')
    @classmethod
    def require_kst(cls, value):
        return WindowMeasurement.require_kst(value)

    @model_validator(mode='after')
    def validate_ar(self):
        RoomInput(name='AR measurement', corners=self.corners)
        validate_measurement(self)
        return self
