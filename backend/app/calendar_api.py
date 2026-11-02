"""APIs for the calendar's date dots, plant cards, repeat rules and care records."""
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select

from app import calendar_schemas as s, models as m
from app.api import Limit, Offset, commit, owned_plant, owned_room
from app.calendar_service import TASK_TITLES, build_calendar, matches_schedule
from app.schemas import KST, PlantOut
from app.security import CurrentUser, Db


router = APIRouter(prefix='/api/v1', tags=['Calendar'])


def owned_schedule(db, user, schedule_id):
    schedule = db.scalar(select(m.CareSchedule).join(m.Plant).where(
        m.CareSchedule.id == schedule_id, m.Plant.user_id == user.id))
    if schedule is None:
        raise HTTPException(404, 'Care schedule not found')
    return schedule


@router.get('/calendar', response_model=s.CalendarOut,
            summary='Calendar date counts and events for a day, week or month')
def calendar(start_date: date, end_date: date, db: Db, user: CurrentUser,
             plant_id: int | None = Query(default=None, gt=0),
             room_id: int | None = Query(default=None, gt=0),
             task_type: s.TaskType | None = None, status: s.EventStatus | None = None):
    if plant_id is not None:
        owned_plant(db, user, plant_id)
    if room_id is not None:
        owned_room(db, user, room_id)
    return build_calendar(db, user, start_date, end_date, plant_id=plant_id,
                          room_id=room_id, task_type=task_type, status=status)


@router.put('/plants/{plant_id}/watering-schedule', response_model=PlantOut,
            summary='Change watering interval without replacing plant position or other fields')
def update_watering_schedule(plant_id: int, body: s.WateringScheduleInput, db: Db, user: CurrentUser):
    plant = owned_plant(db, user, plant_id)
    plant.watering_interval_days = body.watering_interval_days
    commit(db)
    return plant


@router.get('/plants/{plant_id}/waterings', response_model=list[s.WateringRecordOut])
def watering_history(plant_id: int, db: Db, user: CurrentUser,
                     start_date: date | None = None, end_date: date | None = None,
                     limit: Limit = 50, offset: Offset = 0):
    owned_plant(db, user, plant_id)
    if start_date is not None and end_date is not None and end_date < start_date:
        raise HTTPException(422, 'end_date must be on or after start_date')
    query = select(m.WateringRecord).where(m.WateringRecord.plant_id == plant_id)
    if start_date is not None:
        query = query.where(m.WateringRecord.watered_at >= start_date)
    if end_date is not None:
        query = query.where(m.WateringRecord.watered_at <= end_date)
    return db.scalars(query.order_by(m.WateringRecord.watered_at.desc()).limit(limit).offset(offset)).all()


def schedule_values(body):
    values = body.model_dump()
    values['title'] = body.title or TASK_TITLES[body.task_type]
    return values


@router.post('/plants/{plant_id}/care-schedules', response_model=s.CareScheduleOut, status_code=201)
def create_schedule(plant_id: int, body: s.CareScheduleInput, db: Db, user: CurrentUser):
    plant = owned_plant(db, user, plant_id)
    schedule = m.CareSchedule(plant_id=plant.id, **schedule_values(body))
    db.add(schedule)
    commit(db)
    return schedule


@router.get('/plants/{plant_id}/care-schedules', response_model=list[s.CareScheduleOut])
def care_schedules(plant_id: int, db: Db, user: CurrentUser, limit: Limit = 50, offset: Offset = 0):
    owned_plant(db, user, plant_id)
    return db.scalars(select(m.CareSchedule).where(m.CareSchedule.plant_id == plant_id)
                      .order_by(m.CareSchedule.id).limit(limit).offset(offset)).all()


@router.get('/care-schedules/{schedule_id}', response_model=s.CareScheduleOut)
def get_schedule(schedule_id: int, db: Db, user: CurrentUser):
    return owned_schedule(db, user, schedule_id)


@router.put('/care-schedules/{schedule_id}', response_model=s.CareScheduleOut)
def update_schedule(schedule_id: int, body: s.CareScheduleInput, db: Db, user: CurrentUser):
    schedule = owned_schedule(db, user, schedule_id)
    for field, value in schedule_values(body).items():
        setattr(schedule, field, value)
    commit(db)
    return schedule


@router.delete('/care-schedules/{schedule_id}', status_code=204)
def delete_schedule(schedule_id: int, db: Db, user: CurrentUser):
    db.delete(owned_schedule(db, user, schedule_id))
    commit(db)
    return Response(status_code=204)


@router.put('/care-schedules/{schedule_id}/occurrences/{scheduled_date}', response_model=s.OccurrenceOut,
            summary='Complete or skip one occurrence; repeat requests update the same record')
def save_occurrence(schedule_id: int, scheduled_date: date, body: s.OccurrenceInput,
                    db: Db, user: CurrentUser):
    schedule = owned_schedule(db, user, schedule_id)
    occurrence = db.scalar(select(m.CareOccurrence).where(
        m.CareOccurrence.schedule_id == schedule_id, m.CareOccurrence.scheduled_date == scheduled_date))
    values = body.model_dump()
    if body.status == 'COMPLETED' and body.completed_on is None:
        # Retrying a completion tomorrow must preserve its original actual date.
        values['completed_on'] = (occurrence.completed_on
            if occurrence is not None and occurrence.status == 'COMPLETED'
            else datetime.now(KST).date())
    if occurrence is None:
        if not schedule.active or not matches_schedule(schedule, scheduled_date):
            raise HTTPException(422, 'Date is not an active occurrence of this care schedule')
        occurrence = m.CareOccurrence(schedule_id=schedule_id, scheduled_date=scheduled_date,
                                      task_type=schedule.task_type, title=schedule.title)
        db.add(occurrence)
    for field, value in values.items():
        setattr(occurrence, field, value)
    commit(db)
    return occurrence


@router.delete('/care-schedules/{schedule_id}/occurrences/{scheduled_date}', status_code=204,
               summary='Undo completion/skip; the current repeat rule determines whether it is pending again')
def undo_occurrence(schedule_id: int, scheduled_date: date, db: Db, user: CurrentUser):
    owned_schedule(db, user, schedule_id)
    occurrence = db.scalar(select(m.CareOccurrence).where(
        m.CareOccurrence.schedule_id == schedule_id, m.CareOccurrence.scheduled_date == scheduled_date))
    if occurrence is not None:
        db.delete(occurrence)
        commit(db)
    return Response(status_code=204)
