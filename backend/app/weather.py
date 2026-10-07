"""B retrieves and caches hourly data; C owns interpolation and light calculations."""
from datetime import date, datetime, timedelta, timezone
import math
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
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


def normalize(raw, day):
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


def get_irradiance(db, latitude, longitude, day):
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(422, "Invalid geographic coordinates")
    now = datetime.now(timezone.utc)
    url, dataset, extra, ttl = request_spec(day, now.astimezone(KST).date())
    # Exact coordinates: do not silently merge different room locations.
    key = f"v1|{latitude!r}|{longitude!r}|{day}|{dataset}|Asia/Seoul"
    cached = db.get(WeatherCache, key)
    if cached and utc(cached.expires_at) > now:
        return {**cached.payload, "cache_hit": True}
    raw = fetch_raw(url, {"latitude": latitude, "longitude": longitude,
        "start_date": day.isoformat(), "end_date": (day + timedelta(days=1)).isoformat(),
        "timezone": "Asia/Seoul", "hourly": VARIABLES, **extra})
    payload = {"latitude": latitude, "longitude": longitude, "date": day.isoformat(),
        "timezone": "Asia/Seoul", "source": "OPEN_METEO", "dataset": dataset,
        "unit": "W/m²", "interval_minutes": 60, "time_basis": "PRECEDING_HOUR_MEAN",
        "fetched_at": now.isoformat(), "expires_at": (now + ttl).isoformat(),
        "cache_hit": False, "values": normalize(raw, day)}
    if cached is None:
        cached = WeatherCache(cache_key=key)
        db.add(cached)
    cached.raw_response, cached.payload = raw, payload
    cached.fetched_at, cached.expires_at = now, now + ttl
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = db.get(WeatherCache, key)
        if winner and utc(winner.expires_at) > now:
            return {**winner.payload, "cache_hit": True}
        raise HTTPException(409, "Concurrent cache update; retry")
    return payload


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
