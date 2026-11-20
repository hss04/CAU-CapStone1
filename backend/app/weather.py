"""B retrieves and caches hourly data; C owns interpolation and light calculations."""
from datetime import date, datetime, timedelta, timezone
import math
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.exc import IntegrityError

from app.models import WeatherCache
from app.security import CurrentUser, Db
from app.api import owned_room

KST = ZoneInfo("Asia/Seoul")
router = APIRouter(prefix="/api/v1", tags=["Weather"])
VARIABLES = "direct_normal_irradiance,diffuse_radiation"


class IrradiancePoint(BaseModel):
    time: datetime
    dni: float
    dhi: float


class IrradianceOut(BaseModel):
    latitude: float
    longitude: float
    date: date
    timezone: str
    source: str
    dataset: str
    unit: str
    interval_minutes: int
    time_basis: str
    fetched_at: datetime
    expires_at: datetime
    cache_hit: bool
    values: list[IrradiancePoint]

    @field_validator('fetched_at','expires_at')
    @classmethod
    def kst_timestamps(cls, value):
        return utc(value).astimezone(KST)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def request_spec(day, today):
    if day < date(1940, 1, 1) or day > today + timedelta(days=14):
        raise HTTPException(422, "Date must be from 1940-01-01 through today + 14 days (KST)")
    if day <= today - timedelta(days=7):
        return "https://archive-api.open-meteo.com/v1/archive", "ERA5", {"models": "era5"}, timedelta(days=30)
    return "https://api.open-meteo.com/v1/forecast", "BEST_MATCH_FORECAST", {}, timedelta(hours=1)


def fetch_raw(url, params):
    for attempt in range(3):
        try:
            with httpx.Client(timeout=httpx.Timeout(15, connect=5)) as client:
                response = client.get(url, params=params)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < 2:
                    continue
            response.raise_for_status()
            return response.json()
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt == 2:
                raise HTTPException(503, "Open-Meteo unavailable; retry later") from exc
        except (httpx.HTTPStatusError, ValueError) as exc:
            raise HTTPException(502, "Open-Meteo request failed") from exc
    raise HTTPException(503, "Open-Meteo unavailable; retry later")


def _index_hourly(raw):
    try:
        hourly = raw["hourly"]
        units = raw["hourly_units"]
        if any(units[k] != "W/m²" for k in VARIABLES.split(",")):
            raise ValueError("Unexpected unit")
        times, dni, dhi = (hourly[k] for k in ("time", *VARIABLES.split(",")))
        if len(times) != len(dni) or len(times) != len(dhi):
            raise ValueError("Length mismatch")
        indexed = {}
        for t, n, h in zip(times, dni, dhi):
            stamp = datetime.fromisoformat(t)
            stamp = stamp.replace(tzinfo=KST) if stamp.tzinfo is None else stamp.astimezone(KST)
            if stamp in indexed:
                raise ValueError("Duplicate timestamp")
            indexed[stamp] = (n, h)
        return indexed
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise HTTPException(502, "Open-Meteo returned incomplete or invalid hourly data") from exc


def _day_values(indexed, day):
    try:
        start = datetime.combine(day, datetime.min.time(), KST)
        values = []
        # Include next midnight so C can cover the final hour of the target day.
        for i in range(25):
            stamp = start + timedelta(hours=i)
            n, h = indexed[stamp]
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in (n, h)):
                raise ValueError("Missing or invalid irradiation")
            values.append({"time": stamp.isoformat(), "dni": n, "dhi": h})
        return values
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise HTTPException(502, "Open-Meteo returned incomplete or invalid hourly data") from exc


def normalize(raw, day):
    return _day_values(_index_hourly(raw), day)


def get_irradiance_many(db, latitude, longitude, days):
    """Fetch missing contiguous dates per provider, retaining the daily cache contract.

    The final requested day includes the following midnight (hourly means).
    Validate an entire response before writing any of its days to the cache.
    """
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(422, "Invalid geographic coordinates")
    now = datetime.now(timezone.utc)
    # Validate every date before an HTTP request or cache write.
    specifications = [(day, request_spec(day, now.astimezone(KST).date())) for day in sorted(set(days))]
    result, groups = {}, []
    for day, spec in specifications:
        key = f"v1|{latitude!r}|{longitude!r}|{day}|{spec[1]}|Asia/Seoul"
        cached = db.get(WeatherCache, key)
        if cached and utc(cached.expires_at) > now:
            result[day] = {**cached.payload, 'cache_hit': True}
            continue
        if not groups or groups[-1][-1][0] + timedelta(days=1) != day or groups[-1][-1][2][1] != spec[1]:
            groups.append([])
        groups[-1].append((day, key, spec))
    for group in groups:
        url, dataset, extra, ttl = group[0][2]
        raw = fetch_raw(url, {'latitude': latitude, 'longitude': longitude,
            'start_date': group[0][0].isoformat(),
            'end_date': (group[-1][0] + timedelta(days=1)).isoformat(),
            'timezone': 'Asia/Seoul', 'hourly': VARIABLES, **extra})
        indexed = _index_hourly(raw)
        payloads = {}
        for day, key, _ in group:
            payloads[day] = {'latitude': latitude, 'longitude': longitude, 'date': day.isoformat(),
                'timezone': 'Asia/Seoul', 'source': 'OPEN_METEO', 'dataset': dataset,
                'unit': 'W/m²', 'interval_minutes': 60, 'time_basis': 'PRECEDING_HOUR_MEAN',
                'fetched_at': now.isoformat(), 'expires_at': (now + ttl).isoformat(),
                'cache_hit': False, 'values': _day_values(indexed, day)}
        for day, key, _ in group:
            payload = payloads[day]
            # Do not duplicate a 90-day raw response in each of 90 cache rows.
            values = payload['values']
            daily_raw = raw if len(group) == 1 else {
                'hourly_units': raw['hourly_units'], 'hourly': {
                    'time': [v['time'] for v in values],
                    'direct_normal_irradiance': [v['dni'] for v in values],
                    'diffuse_radiation': [v['dhi'] for v in values]}}
            cached = db.get(WeatherCache, key)
            if cached is None:
                cached = WeatherCache(cache_key=key)
                db.add(cached)
            cached.raw_response, cached.payload = daily_raw, payload
            cached.fetched_at, cached.expires_at = now, now + ttl
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            for day, key, _ in group:
                winner = db.get(WeatherCache, key)
                if winner is None or utc(winner.expires_at) <= now:
                    raise HTTPException(409, 'Concurrent cache update; retry')
                payloads[day] = {**winner.payload, 'cache_hit': True}
        result.update(payloads)
    return result


def get_irradiance(db, latitude, longitude, day):
    return get_irradiance_many(db, latitude, longitude, [day])[day]


@router.get("/weather/irradiance", response_model=IrradianceOut)
def irradiance(db: Db, user: CurrentUser, date: date,
               latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    return get_irradiance(db, latitude, longitude, date)


@router.get("/rooms/{room_id}/irradiance", response_model=IrradianceOut)
def room_irradiance(room_id: int, date: date, db: Db, user: CurrentUser):
    room = owned_room(db, user, room_id)
    if room.latitude is None or room.longitude is None:
        raise HTTPException(422, "Save room latitude and longitude first")
    return get_irradiance(db, room.latitude, room.longitude, date)


@router.get('/rooms/{room_id}/weather')
def room_weather(room_id:int,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    if room.latitude is None or room.longitude is None:
        raise HTTPException(422,'Save room location first')
    now=datetime.now(timezone.utc)
    key=f'weather-v1|{room.latitude!r}|{room.longitude!r}|Asia/Seoul'
    cached=db.get(WeatherCache,key)
    hit=bool(cached and utc(cached.expires_at)>now)
    if not hit:
        raw=fetch_raw('https://api.open-meteo.com/v1/forecast',{
            'latitude':room.latitude,'longitude':room.longitude,'timezone':'Asia/Seoul',
            'current':'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
            'daily':'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
            'forecast_days':7})
        try:
            current=dict(raw['current']); daily=dict(raw['daily'])
            if not current or not daily['time'] or current['temperature_2m'] is None:
                raise ValueError()
            def stamp(value):
                d=datetime.fromisoformat(value)
                return (d.replace(tzinfo=KST) if d.tzinfo is None else d.astimezone(KST)).isoformat()
            current['time']=stamp(current['time'])
            for field in ('sunrise','sunset'):
                if field in daily: daily[field]=[stamp(v) if v else None for v in daily[field]]
        except (KeyError,TypeError,ValueError) as exc:
            raise HTTPException(502,'Open-Meteo returned incomplete weather data') from exc
        payload={'source':'OPEN_METEO','timezone':'Asia/Seoul','current':current,'daily':daily,
                 'current_units':raw.get('current_units',{}),'daily_units':raw.get('daily_units',{})}
        cached=cached or WeatherCache(cache_key=key)
        cached.raw_response=raw; cached.payload=payload
        cached.fetched_at=now; cached.expires_at=now+timedelta(hours=1)
        db.add(cached)
        try: db.commit()
        except IntegrityError:
            db.rollback()
            cached=db.get(WeatherCache,key)
            if cached is None or utc(cached.expires_at)<=now:
                raise HTTPException(409,'Concurrent weather cache update; retry')
            hit=True
    return {**cached.payload,'room_id':room.id,'location_name':room.location_name,
            'latitude':room.latitude,'longitude':room.longitude,'cache_hit':hit,
            'fetched_at':utc(cached.fetched_at).astimezone(KST).isoformat(),
            'expires_at':utc(cached.expires_at).astimezone(KST).isoformat()}
