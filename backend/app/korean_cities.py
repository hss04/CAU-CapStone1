"""Offline Korean city lookup using an attributed GeoNames snapshot.

IDs identify city administrative records, not districts, stations or homes.
The data file records the source, license, retrieval date and coordinate basis.
"""

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Literal
import unicodedata

from pydantic import BaseModel, ConfigDict, Field


class KoreanCity(BaseModel):
    model_config = ConfigDict(frozen=True, extra='forbid')

    id: int = Field(gt=0, description='Stable GeoNames city administrative-record ID')
    name: str
    display_name: str
    country: Literal['대한민국'] = '대한민국'
    country_code: Literal['KR'] = 'KR'
    admin1: str
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    timezone: Literal['Asia/Seoul'] = 'Asia/Seoul'
    coordinate_basis: Literal['CITY_REPRESENTATIVE'] = 'CITY_REPRESENTATIVE'
    source: Literal['GEONAMES'] = 'GEONAMES'


class KoreanCitiesOut(BaseModel):
    results: list[KoreanCity]


def _normalize(value: str) -> str:
    # Accept pasted/decomposed Korean, spacing and romanized -si names.
    return re.sub(r'[\s,_-]+', '', unicodedata.normalize('NFC', value).casefold())


@dataclass(frozen=True)
class _Entry:
    city: KoreanCity
    aliases: frozenset[str]
    admin1_aliases: frozenset[str]


def _load_catalogue() -> tuple[_Entry, ...]:
    path = Path(__file__).parent / 'catalogues' / 'korean_cities.json'
    records = json.loads(path.read_text(encoding='utf-8'))['cities']
    entries = []
    for row in records:
        display_name = row['name'] if row['name'] == row['admin1'] else f"{row['admin1']} {row['name']}"
        city = KoreanCity(**{key: row[key] for key in ('id', 'name', 'admin1', 'latitude', 'longitude', 'timezone')},
                          display_name=display_name)
        entries.append(_Entry(city, frozenset(_normalize(s) for s in row['aliases']),
                              frozenset(_normalize(s) for s in row['admin1_aliases'])))
    return tuple(entries)


_CITIES = _load_catalogue()
_BY_ID = {entry.city.id: entry.city for entry in _CITIES}


def city_by_id(city_id: int) -> KoreanCity | None:
    return _BY_ID.get(city_id)


def search_cities(q: str | None = None, admin1: str | None = None) -> list[KoreanCity]:
    """Return all exact matches (including homonyms), or prefix matches.

    An unqualified 광주/광주시 returns both Gwangju city areas. No candidate is
    silently selected. A province-qualified name or city ID disambiguates it.
    """
    candidates = _CITIES
    if admin1 is not None:
        province = _normalize(admin1)
        if not province:
            return []
        candidates = tuple(entry for entry in candidates if province in entry.admin1_aliases)
    if q is None:
        return [entry.city for entry in candidates]
    term = _normalize(q)
    if not term:
        return []
    exact = [entry.city for entry in candidates if term in entry.aliases]
    if exact:
        return exact
    return [entry.city for entry in candidates if any(alias.startswith(term) for alias in entry.aliases)]
