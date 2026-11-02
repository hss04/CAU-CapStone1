"""Persist care records and expand repeat rules only for the requested calendar range."""
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from app import models as m
from app.calendar_schemas import CalendarDay, CalendarEvent, CalendarOut
from app.schemas import KST


TASK_TITLES = {
    'WATERING': '물주기', 'FERTILIZING': '비료 주기', 'REPOTTING': '분갈이',
    'PRUNING': '가지치기', 'MISTING': '분무', 'OTHER': '기타 관리',
}
MAX_CALENDAR_DAYS = 366
MAX_CALENDAR_EVENTS = 10000


def validate_range(start_date, end_date):
    if end_date < start_date:
        raise HTTPException(422, 'end_date must be on or after start_date')
    if (end_date - start_date).days >= MAX_CALENDAR_DAYS:
        raise HTTPException(422, 'Request at most 366 calendar days at a time')


def remember_watering(db, plant, watered_at):
    """Insert a known watering date once; do not change the current schedule anchor."""
    if db.get_bind().dialect.name == 'sqlite':
        from sqlalchemy.dialects.sqlite import insert
        # A real DML statement also starts SQLite's outer transaction. A bare
        # SAVEPOINT in legacy transaction mode could otherwise commit independently.
        db.execute(insert(m.WateringRecord).values(plant_id=plant.id, watered_at=watered_at)
                   .on_conflict_do_nothing(index_elements=['plant_id', 'watered_at']))
        return
    existing = db.scalar(select(m.WateringRecord).where(
        m.WateringRecord.plant_id == plant.id, m.WateringRecord.watered_at == watered_at))
    if existing is None:
        try:
            with db.begin_nested():
                db.add(m.WateringRecord(plant_id=plant.id, watered_at=watered_at))
                db.flush()
        except IntegrityError:
            # A simultaneous retry may have inserted the same plant/day first.
            if db.scalar(select(m.WateringRecord.id).where(
                    m.WateringRecord.plant_id == plant.id,
                    m.WateringRecord.watered_at == watered_at)) is None:
                raise


def record_watering(db, plant, watered_at):
    """One record per plant/day, with the existing monotonic last-watered update."""
    if plant.last_watered_at is not None:
        remember_watering(db, plant, plant.last_watered_at)
    remember_watering(db, plant, watered_at)
    db.execute(update(m.Plant).where(m.Plant.id == plant.id,
        or_(m.Plant.last_watered_at.is_(None), m.Plant.last_watered_at < watered_at))
        .values(last_watered_at=watered_at))


def backfill_waterings(db):
    """Preserve the one known date in pre-calendar databases; never invent earlier logs."""
    recorded = select(m.WateringRecord.id).where(
        m.WateringRecord.plant_id == m.Plant.id,
        m.WateringRecord.watered_at == m.Plant.last_watered_at).exists()
    for plant in db.scalars(select(m.Plant).where(m.Plant.last_watered_at.is_not(None), ~recorded)):
        remember_watering(db, plant, plant.last_watered_at)


def occurrence_dates(first_ordinal, interval_days, start_date, end_date):
    """Use ordinals so dates near year 9999 do not overflow on the final step."""
    ordinal = first_ordinal
    if interval_days is None:
        if start_date.toordinal() <= ordinal <= end_date.toordinal():
            yield date.fromordinal(ordinal)
        return
    if ordinal < start_date.toordinal():
        ordinal += ((start_date.toordinal() - ordinal + interval_days - 1) // interval_days) * interval_days
    while ordinal <= end_date.toordinal():
        yield date.fromordinal(ordinal)
        ordinal += interval_days


def matches_schedule(schedule, scheduled_date):
    if scheduled_date < schedule.start_date:
        return False
    if schedule.end_date is not None and scheduled_date > schedule.end_date:
        return False
    delta = (scheduled_date - schedule.start_date).days
    return delta == 0 if schedule.interval_days is None else delta % schedule.interval_days == 0


def plant_registration_date(plant):
    value = plant.created_at
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(KST).date()


def build_calendar(db, user, start_date, end_date, *, plant_id=None, room_id=None,
                   task_type=None, status=None):
    validate_range(start_date, end_date)
    today = datetime.now(KST).date()
    query = select(m.Plant, m.PlantSpecies).join(m.PlantSpecies).where(m.Plant.user_id == user.id)
    if plant_id is not None:
        query = query.where(m.Plant.id == plant_id)
    if room_id is not None:
        query = query.where(m.Plant.room_id == room_id)
    pairs = db.execute(query.order_by(m.Plant.id)).all()
    plants = {plant.id: (plant, species) for plant, species in pairs}
    events = []

    def add_event(plant, species, day, kind, title, event_status, *, schedule_id=None,
                  completed_on=None, interval_days=None, note=None):
        if task_type is not None and kind != task_type:
            return
        if status is not None and event_status != status:
            return
        if len(events) >= MAX_CALENDAR_EVENTS:
            raise HTTPException(422, 'Too many calendar events; narrow the dates or filter by plant/room')
        event_id = f'watering:{plant.id}:{day}' if schedule_id is None else f'care:{schedule_id}:{day}'
        events.append(CalendarEvent(
            event_id=event_id, date=day, plant_id=plant.id, plant_nickname=plant.nickname,
            species_id=species.id, species_name=species.name, scientific_name=species.scientific_name,
            room_id=plant.room_id, schedule_id=schedule_id, task_type=kind, title=title,
            status=event_status, is_overdue=event_status == 'PENDING' and day < today,
            completed_on=completed_on, interval_days=interval_days, note=note))

    if plants and task_type in (None, 'WATERING'):
        records = db.scalars(select(m.WateringRecord).where(
            m.WateringRecord.plant_id.in_(plants),
            m.WateringRecord.watered_at.between(start_date, end_date))).all()
        recorded = {(row.plant_id, row.watered_at) for row in records}
        for row in records:
            plant, species = plants[row.plant_id]
            add_event(plant, species, row.watered_at, 'WATERING', TASK_TITLES['WATERING'],
                      'COMPLETED', completed_on=row.watered_at, interval_days=plant.watering_interval_days)
        for plant, species in pairs:
            # An old DB has only its last watering date. Expose that known fact without
            # inventing earlier completions or requiring a destructive data migration.
            if (plant.last_watered_at is not None and start_date <= plant.last_watered_at <= end_date
                    and (plant.id, plant.last_watered_at) not in recorded):
                add_event(plant, species, plant.last_watered_at, 'WATERING', TASK_TITLES['WATERING'],
                          'COMPLETED', completed_on=plant.last_watered_at,
                          interval_days=plant.watering_interval_days)
            if status not in (None, 'PENDING'):
                continue
            anchor = plant.last_watered_at or plant_registration_date(plant)
            for day in occurrence_dates(anchor.toordinal() + plant.watering_interval_days,
                                         plant.watering_interval_days, start_date, end_date):
                if (plant.id, day) not in recorded:
                    add_event(plant, species, day, 'WATERING', TASK_TITLES['WATERING'], 'PENDING',
                              interval_days=plant.watering_interval_days)

    if plants and task_type != 'WATERING':
        schedules = db.scalars(select(m.CareSchedule).where(m.CareSchedule.plant_id.in_(plants))).all()
        schedule_by_id = {schedule.id: schedule for schedule in schedules}
        records = db.scalars(select(m.CareOccurrence).where(
            m.CareOccurrence.schedule_id.in_(schedule_by_id),
            m.CareOccurrence.scheduled_date.between(start_date, end_date))).all() if schedules else []
        recorded = {(row.schedule_id, row.scheduled_date) for row in records}
        for row in records:
            schedule = schedule_by_id[row.schedule_id]
            plant, species = plants[schedule.plant_id]
            add_event(plant, species, row.scheduled_date, row.task_type, row.title, row.status,
                      schedule_id=schedule.id, completed_on=row.completed_on, note=row.note)
        if status in (None, 'PENDING'):
            for schedule in schedules:
                if not schedule.active or (task_type is not None and task_type != schedule.task_type):
                    continue
                plant, species = plants[schedule.plant_id]
                until = min(end_date, schedule.end_date) if schedule.end_date else end_date
                for day in occurrence_dates(schedule.start_date.toordinal(), schedule.interval_days,
                                             start_date, until):
                    if (schedule.id, day) not in recorded:
                        add_event(plant, species, day, schedule.task_type, schedule.title, 'PENDING',
                                  schedule_id=schedule.id, interval_days=schedule.interval_days,
                                  note=schedule.note)

    events.sort(key=lambda event: (event.date, event.task_type, event.plant_id, event.event_id))
    days = {ordinal: CalendarDay(date=date.fromordinal(ordinal))
            for ordinal in range(start_date.toordinal(), end_date.toordinal() + 1)}
    for event in events:
        day = days[event.date.toordinal()]
        day.total_count += 1
        field = event.status.lower() + '_count'
        setattr(day, field, getattr(day, field) + 1)
        day.overdue_count += int(event.is_overdue)
        if event.task_type not in day.task_types:
            day.task_types.append(event.task_type)
    return CalendarOut(today=today, start_date=start_date, end_date=end_date,
                       days=list(days.values()), events=events)
