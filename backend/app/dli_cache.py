"""Persistent daily results keyed by all light inputs, independent of request period."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from app.config import get_algorithm_settings
from sqlalchemy import select
from app.integration_models import DliDailyCache
from app.models import Plant
from app.schemas import DliMap, KST
from app.weather import utc


def fingerprint(payload):
    request = payload['request']
    inputs = {k: payload[k] for k in ('room_id', 'geometry_version', 'room', 'grid', 'windows', 'callable')}
    inputs.update(mock_sky=request['mock_sky'], temporary_direction=request['temporary_x_axis_azimuth_deg'] is not None,
                  algorithm_revision=get_algorithm_settings().dli_cache_version)
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def cache_key(payload, day):
    return f'{fingerprint(payload)}:{day.isoformat()}'


def fresh(item, day, now=None):
    now = now or datetime.now(timezone.utc)
    # Only results calculated from weather fetched AFTER the day ended are permanent.
    # A forecast made yesterday for today must not become an immortal historical value.
    historical = day < now.astimezone(KST).date() and utc(item.fetched_at).astimezone(KST).date() > day
    return historical or utc(item.expires_at) > now


def lookup(db, payload, day):
    item = db.get(DliDailyCache, cache_key(payload, day))
    return item.payload if item and fresh(item, day) else None


def save(db, payload, day, result, weather):
    fetched = utc(datetime.fromisoformat(weather['fetched_at']))
    expires = min(utc(datetime.fromisoformat(weather['expires_at'])), fetched + timedelta(hours=1))
    item = DliDailyCache(cache_key=cache_key(payload, day), room_id=payload['room_id'],
                        payload=result, fetched_at=fetched, expires_at=expires)
    # Separate keys per input snapshot: no obsolete job can overwrite current inputs.
    db.merge(item)
    db.flush()


def daily_result(p, day, raw, dataset):
    arrays = {}
    for key in ('direct_dli', 'diffuse_dli'):
        arrays[key] = [[raw[key][r][c] if inside else None for c, inside in enumerate(row)]
                       for r, row in enumerate(p['grid']['inside_mask'])]
    arrays['total_dli'] = [[None if v is None else v + arrays['diffuse_dli'][r][c]
                           for c, v in enumerate(row)] for r, row in enumerate(arrays['direct_dli'])]
    validated = DliMap(room_id=p['room_id'], geometry_version=p['geometry_version'], date=day,
                       timezone='Asia/Seoul', grid=p['grid'], **arrays)
    if dataset not in ('ERA5', 'BEST_MATCH_FORECAST'):
        raise ValueError('Unsupported weather dataset')
    return {'date': day.isoformat(), 'dataset': dataset,
            **{key: getattr(validated, key) for key in arrays}}


def series_result(p, days, missing, db):
    spec = p['grid']
    request = p['request']
    warnings = [] if p['callable'] else ['PROVISIONAL: upstream 08:00-18:00 only; hourly mean interpolation unresolved']
    plants = []
    for plant in db.scalars(select(Plant).where(Plant.room_id == p['room_id']).order_by(Plant.id)):
        # Arrays are for a single height: never silently assign them to other heights.
        if plant.x is None or plant.z is None or abs(plant.y-spec['sample_height_m']) > 0.001:
            warnings.append(f'PLANT_{plant.id}_HEIGHT_MISMATCH_OR_UNPLACED')
            continue
        col = math.floor((plant.x-spec['origin']['x'])/spec['cell_size_m'])
        row = math.floor((plant.z-spec['origin']['z'])/spec['cell_size_m'])
        # A plant on the far room boundary belongs to the last cell.
        max_x = max(c['x'] for c in p['room']['corners'])
        max_z = max(c['z'] for c in p['room']['corners'])
        if abs(plant.x-max_x)<1e-8: col=min(col,spec['cols']-1)
        if abs(plant.z-max_z)<1e-8: row=min(row,spec['rows']-1)
        if not (0 <= row < spec['rows'] and 0 <= col < spec['cols'] and spec['inside_mask'][row][col]):
            warnings.append(f'PLANT_{plant.id}_OUTSIDE_GRID')
            continue
        plants.append({'plant_id':plant.id,'row':row,'col':col,
                       'daily':[{'date':d['date'],'total_dli':d['total_dli'][row][col]} for d in days]})
    return {'room_id':p['room_id'],'geometry_version':p['geometry_version'],'grid':spec,
            'timezone':'Asia/Seoul','unit':'mol/m2/day','mock_sky':request['mock_sky'],
            'temporary_direction':request['temporary_x_axis_azimuth_deg'] is not None,
            'warnings':warnings,'days':days,'missing_dates':missing,'plants':plants}
