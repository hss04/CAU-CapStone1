"""Calendar contracts. All calendar dates use Asia/Seoul, including unplaced plants."""
from datetime import date, datetime
from typing import Literal

from pydantic import Field, model_validator

from app.schemas import Input, KST, Name, Output


CareType = Literal['FERTILIZING', 'REPOTTING', 'PRUNING', 'MISTING', 'OTHER']
TaskType = Literal['WATERING', 'FERTILIZING', 'REPOTTING', 'PRUNING', 'MISTING', 'OTHER']
EventStatus = Literal['PENDING', 'COMPLETED', 'SKIPPED']


class WateringScheduleInput(Input):
    watering_interval_days: int = Field(ge=1, le=3650, strict=True)


class WateringRecordOut(Output):
    id: int
    plant_id: int
    watered_at: date


class CareScheduleInput(Input):
    task_type: CareType
    title: Name | None = None
    start_date: date
    interval_days: int | None = Field(default=None, ge=1, le=3650, strict=True)
    end_date: date | None = None
    active: bool = Field(default=True, strict=True)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode='after')
    def valid_period(self):
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError('end_date must be on or after start_date')
        return self


class CareScheduleOut(Output):
    id: int
    plant_id: int
    task_type: CareType
    title: str
    start_date: date
    interval_days: int | None
    end_date: date | None
    active: bool
    note: str | None


class OccurrenceInput(Input):
    status: Literal['COMPLETED', 'SKIPPED']
    completed_on: date | None = None
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode='after')
    def completion_date(self):
        today = datetime.now(KST).date()
        if self.status == 'COMPLETED':
            if self.completed_on is not None and self.completed_on > today:
                raise ValueError('completed_on cannot be in the future (KST)')
        elif self.completed_on is not None:
            raise ValueError('SKIPPED must not include completed_on')
        return self


class OccurrenceOut(Output):
    id: int
    schedule_id: int
    scheduled_date: date
    status: Literal['COMPLETED', 'SKIPPED']
    completed_on: date | None
    task_type: CareType
    title: str
    note: str | None


class CalendarEvent(Output):
    event_id: str
    date: date
    plant_id: int
    plant_nickname: str
    species_id: int
    species_name: str
    scientific_name: str | None
    room_id: int | None
    schedule_id: int | None
    task_type: TaskType
    title: str
    status: EventStatus
    is_overdue: bool
    completed_on: date | None
    interval_days: int | None
    note: str | None


class CalendarDay(Output):
    date: date
    total_count: int = 0
    pending_count: int = 0
    completed_count: int = 0
    skipped_count: int = 0
    overdue_count: int = 0
    task_types: list[TaskType] = Field(default_factory=list)


class CalendarOut(Output):
    timezone: Literal['Asia/Seoul'] = 'Asia/Seoul'
    today: date
    start_date: date
    end_date: date
    days: list[CalendarDay]
    events: list[CalendarEvent]
