"""Saved-data comparisons, species matching and device notification schedules."""
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, model_validator
from sqlalchemy import select, func

from app import models as m, schemas as s, dli_cache
from app.api import owned_room
from app.calendar_service import build_calendar
from app.integration import DliRequest, make_payload, status
from app.integration_models import IntegrationJob
from app.job_control import digest
from app.placement_api import latest_job, reusable_job
from app.placement_service import cell_for_position, effective_blocked
from app.security import CurrentUser, Db
from app.species_evidence import evidence_for_species


router = APIRouter(prefix='/api/v1', tags=['Plant insights'])


def light_status(value, species):
    return 'LOW' if value < species.min_dli else 'HIGH' if value > species.max_dli else 'OK'


def score(value, minimum, maximum):
    middle, half = (minimum+maximum)/2, (maximum-minimum)/2
    return (1.0 if value == middle else 0.0) if half <= 0 else max(0.0, round(1-abs(value-middle)/half, 2))


class ComparisonPeriod(s.Input):
    label: str = Field(min_length=1, max_length=50)
    start_date: date
    end_date: date

    @model_validator(mode='after')
    def valid_range(self):
        if not 0 <= (self.end_date-self.start_date).days <= 92:
            raise ValueError('Each comparison period must contain 1 to 93 days')
        return self


class ComparisonInput(s.Input):
    periods: list[ComparisonPeriod] = Field(min_length=2, max_length=4)
    cell_size_m: float = Field(default=.2, ge=.05, le=5, allow_inf_nan=False)
    sample_height_m: float = Field(default=0, ge=0, le=10, allow_inf_nan=False)
    mock_sky: bool = False
    temporary_x_axis_azimuth_deg: float | None = Field(default=None, ge=0, lt=360, allow_inf_nan=False)


@router.post('/rooms/{room_id}/dli-comparison')
def compare_periods(room_id: int, body: ComparisonInput, db: Db, user: CurrentUser):
    room = owned_room(db, user, room_id)
    periods = []
    for period in body.periods:
        request = DliRequest(start_date=period.start_date, end_date=period.end_date,
            **body.model_dump(exclude={'periods'}))
        payload = make_payload(room, request, db, for_lookup=True)
        available, missing = [], []
        day = period.start_date
        while day <= period.end_date:
            item = dli_cache.lookup(db, payload, day)
            if item is None:
                missing.append(day.isoformat())
            else:
                available.append(item)
            day += timedelta(days=1)
        entry = {**period.model_dump(mode='json'), 'complete': not missing,
                 'missing_dates': missing, 'mean_total_dli': None, 'plants': []}
        if not missing:
            spec = payload['grid']
            mean = [[sum(d['total_dli'][r][c] for d in available)/len(available) if inside else None
                     for c, inside in enumerate(row)] for r, row in enumerate(spec['inside_mask'])]
            entry['mean_total_dli'] = mean
            for plant in room.plants:
                cell = cell_for_position({'x': plant.x, 'z': plant.z}, spec, room)
                if cell is None or abs(plant.y-spec['sample_height_m']) > .001:
                    entry['plants'].append({'plant_id': plant.id, 'status': 'UNAVAILABLE', 'mean_dli': None})
                    continue
                value = mean[cell[0]][cell[1]]
                species = db.get(m.PlantSpecies, plant.species_id)
                entry['plants'].append({'plant_id': plant.id, 'mean_dli': value,
                                        'status': light_status(value, species)})
        periods.append(entry)
    return {'room_id': room_id, 'geometry_version': room.geometry_version, 'grid': payload['grid'],
            'source': 'SAVED_DLI', 'unit': 'mol/m2/day', 'aggregation': 'DAILY_MEAN',
            'mock_sky': body.mock_sky, 'temporary_direction': body.temporary_x_axis_azimuth_deg is not None,
            'periods': periods}


@router.get('/rooms/{room_id}/suitable-species')
def suitable_species(room_id: int, db: Db, user: CurrentUser, dli_job_id: str | None = None,
                     limit: int = Query(default=10, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    room = owned_room(db, user, room_id)
    if dli_job_id is not None:
        status(dli_job_id, db, user)
        job = db.get(IntegrationJob, dli_job_id)
        if job.room_id != room.id or not reusable_job(db, room, job):
            raise HTTPException(409, 'A current DLI map for this room is required')
    else:
        job = latest_job(db, room, mock_sky=False)
        if job is None:
            raise HTTPException(404, 'Calculate a current DLI map first')
    spec = job.result['grid']
    blocked = effective_blocked(db, room, spec, [])
    occupied = {cell_for_position({'x': p.x, 'z': p.z}, spec, room) for p in room.plants}
    cells = [(r, c, job.result['total_dli'][r][c]) for r, row in enumerate(spec['inside_mask'])
             for c, inside in enumerate(row) if inside and (r, c) not in blocked | occupied]
    results = []
    for species in db.scalars(select(m.PlantSpecies).order_by(m.PlantSpecies.id)):
        matching = [(r, c, value) for r, c, value in cells if species.min_dli <= value <= species.max_dli]
        if not matching:
            continue
        r, c, value = max(matching, key=lambda item: score(item[2], species.min_dli, species.max_dli))
        results.append({'species_id': species.id, 'name': species.name, 'scientific_name': species.scientific_name,
            'required_dli': {'min': species.min_dli, 'max': species.max_dli},
            'suitable_cells': len(matching), 'available_cells': len(cells),
            'suitable_fraction': len(matching)/len(cells),
            'best_cell': {'row': r, 'col': c, 'total_dli': value, 'score': score(value, species.min_dli, species.max_dli)},
            'evidence': evidence_for_species(species)})
    results.sort(key=lambda item: (-item['suitable_fraction'], -item['best_cell']['score'], item['species_id']))
    return {'room_id': room_id, 'dli_job_id': job.id, 'mock_sky': job.result['mock_sky'],
            'reason_code': 'NO_FREE_CELL' if not cells else 'NO_SUITABLE_SPECIES' if not results else 'MATCHES_FOUND',
            'total': len(results), 'results': results[offset:offset+limit]}


@router.get('/dashboard')
def dashboard(db: Db, user: CurrentUser, on_date: date | None = None,
              overdue_window_days: int = Query(default=30, ge=0, le=90)):
    day = on_date or datetime.now(s.KST).date()
    start = date.fromordinal(max(1, day.toordinal()-overdue_window_days))
    calendar = build_calendar(db, user, start, day)
    plants = db.scalars(select(m.Plant).where(m.Plant.user_id == user.id).order_by(m.Plant.id)).all()
    photos = dict(db.execute(select(m.GrowthPhoto.plant_id, func.max(m.GrowthPhoto.taken_at))
        .join(m.Plant).where(m.Plant.user_id == user.id).group_by(m.GrowthPhoto.plant_id)).all())
    rooms = db.scalars(select(m.Room).where(m.Room.user_id == user.id)).all()
    maps = {room.id: latest_job(db, room, mock_sky=False) for room in rooms}
    room_by_id = {room.id: room for room in rooms}
    summaries = []
    for plant in plants:
        current = None
        job = maps.get(plant.room_id)
        if job is not None:
            spec = job.result['grid']
            cell = cell_for_position({'x': plant.x, 'z': plant.z}, spec, room_by_id[plant.room_id])
            if cell is not None and abs(plant.y-spec['sample_height_m']) <= .001:
                value = job.result['total_dli'][cell[0]][cell[1]]
                current = {'total_dli': value, 'status': light_status(value, db.get(m.PlantSpecies, plant.species_id)),
                           'dli_job_id': job.id}
        photo = photos.get(plant.id)
        if photo is not None:
            from app.weather import utc
            photo = utc(photo).astimezone(s.KST).isoformat()
        summaries.append({'plant_id': plant.id, 'nickname': plant.nickname, 'room_id': plant.room_id,
                          'last_watered_at': plant.last_watered_at, 'latest_photo_at': photo, 'light': current})
    return {'date': day, 'timezone': 'Asia/Seoul', 'plant_count': len(plants), 'room_count': len(rooms),
            'overdue_window_start': start,
            'today_tasks': [e for e in calendar.events if e.date == day and e.status == 'PENDING'],
            'overdue_tasks': [e for e in calendar.events if e.date < day and e.status == 'PENDING'],
            'plants': summaries}


@router.get('/notifications/schedule')
def notification_schedule(start_date: date, end_date: date, db: Db, user: CurrentUser,
                          hour: int = Query(default=9, ge=0, le=23), minute: int = Query(default=0, ge=0, le=59)):
    calendar = build_calendar(db, user, start_date, end_date, status='PENDING')
    items = [{'notification_id': f'user:{user.id}:{event.event_id}', 'event_id': event.event_id,
              'plant_id': event.plant_id, 'title': f'{event.plant_nickname}: {event.title}',
              'scheduled_at': datetime.combine(event.date, time(hour, minute), s.KST).isoformat(),
              'task_type': event.task_type} for event in calendar.events]
    return {'timezone': 'Asia/Seoul', 'delivery': 'DEVICE_LOCAL', 'push_configured': False,
            'schedule_version': digest(items), 'notifications': items}
