from datetime import date, datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Integer, JSON, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    nickname: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Room(Base):
    __tablename__ = 'rooms'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    name: Mapped[str] = mapped_column(String(100))
    coordinate_frame: Mapped[str] = mapped_column(String(64), default='FIRST_CORNER_ORIGIN_AR_HORIZONTAL')
    x_axis_azimuth_deg: Mapped[float | None] = mapped_column(Float)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location_name: Mapped[str | None] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(64), default='Asia/Seoul')
    geometry_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    saved_at: Mapped[str | None] = mapped_column(String(50))
    corners: Mapped[list['RoomCorner']] = relationship(cascade='all, delete-orphan', order_by='RoomCorner.order_index')
    windows: Mapped[list['Window']] = relationship(cascade='all, delete-orphan')
    plants: Mapped[list['Plant']] = relationship(back_populates='room')


class RoomCorner(Base):
    __tablename__ = 'room_corners'
    __table_args__ = (UniqueConstraint('room_id', 'order_index'), CheckConstraint('order_index >= 0'))
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey('rooms.id'), index=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    order_index: Mapped[int] = mapped_column(Integer)


class Window(Base):
    __tablename__ = 'windows'
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey('rooms.id'), index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    measurement: Mapped[dict | None] = mapped_column(JSON)
    corners: Mapped[list['WindowCorner']] = relationship(cascade='all, delete-orphan', order_by='WindowCorner.order_index')


class WindowCorner(Base):
    __tablename__ = 'window_corners'
    __table_args__ = (UniqueConstraint('window_id', 'order_index'), CheckConstraint('order_index BETWEEN 0 AND 3'))
    id: Mapped[int] = mapped_column(primary_key=True)
    window_id: Mapped[int] = mapped_column(ForeignKey('windows.id'), index=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    order_index: Mapped[int] = mapped_column(Integer)


class PlantSpecies(Base):
    __tablename__ = 'plant_species'
    __table_args__ = (CheckConstraint('min_dli >= 0 AND max_dli >= min_dli'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    scientific_name: Mapped[str | None] = mapped_column(String(150))
    min_dli: Mapped[float] = mapped_column(Float)
    max_dli: Mapped[float] = mapped_column(Float)
    source_note: Mapped[str | None] = mapped_column(String(500))


class Plant(Base):
    __tablename__ = 'plants'
    __table_args__ = (CheckConstraint('watering_interval_days > 0'),)
    watering_interval_days: Mapped[int] = mapped_column(Integer, default=7, server_default='7')
    last_watered_at: Mapped[date | None] = mapped_column(Date)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    room_id: Mapped[int | None] = mapped_column(ForeignKey('rooms.id', ondelete='SET NULL'), index=True)
    species_id: Mapped[int] = mapped_column(ForeignKey('plant_species.id'), index=True)
    nickname: Mapped[str] = mapped_column(String(100))
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    z: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    room: Mapped[Room | None] = relationship(back_populates='plants')
    waterings: Mapped[list['WateringRecord']] = relationship(cascade='all, delete-orphan')
    care_schedules: Mapped[list['CareSchedule']] = relationship(cascade='all, delete-orphan')
    growth_photos: Mapped[list['GrowthPhoto']] = relationship(cascade='all, delete-orphan')


class GrowthPhoto(Base):
    __tablename__ = 'growth_photos'
    __table_args__ = (
        UniqueConstraint('plant_id', 'upload_key'),
        Index('ix_growth_photos_plant_taken', 'plant_id', 'taken_at', 'id'),
        CheckConstraint('width > 0 AND height > 0 AND byte_size > 0'),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey('plants.id', ondelete='CASCADE'), index=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    taken_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(2000))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    byte_size: Mapped[int] = mapped_column(Integer)
    # Timeline/list queries do not load image bytes. Keeping the bytes in the DB
    # makes uploads, deletion and the existing SQLite backup atomic in this MVP.
    image_data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    thumbnail_data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    upload_key: Mapped[str | None] = mapped_column(String(128))
    request_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WateringRecord(Base):
    __tablename__ = 'watering_records'
    __table_args__ = (UniqueConstraint('plant_id', 'watered_at'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey('plants.id', ondelete='CASCADE'), index=True)
    watered_at: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CareSchedule(Base):
    __tablename__ = 'care_schedules'
    __table_args__ = (
        CheckConstraint("task_type IN ('FERTILIZING','REPOTTING','PRUNING','MISTING','OTHER')"),
        CheckConstraint('interval_days IS NULL OR interval_days BETWEEN 1 AND 3650'),
        CheckConstraint('end_date IS NULL OR end_date >= start_date'),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey('plants.id', ondelete='CASCADE'), index=True)
    task_type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(100))
    start_date: Mapped[date] = mapped_column(Date)
    interval_days: Mapped[int | None] = mapped_column(Integer)
    end_date: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(String(1000))
    occurrences: Mapped[list['CareOccurrence']] = relationship(cascade='all, delete-orphan')


class CareOccurrence(Base):
    __tablename__ = 'care_occurrences'
    __table_args__ = (
        UniqueConstraint('schedule_id', 'scheduled_date'),
        CheckConstraint("status IN ('COMPLETED','SKIPPED')"),
        CheckConstraint("(status = 'COMPLETED' AND completed_on IS NOT NULL) OR "
                        "(status = 'SKIPPED' AND completed_on IS NULL)"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey('care_schedules.id', ondelete='CASCADE'), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16))
    completed_on: Mapped[date | None] = mapped_column(Date)
    # Keep the meaning of past records when the repeat rule or title is edited.
    task_type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(100))
    note: Mapped[str | None] = mapped_column(String(1000))


class IdempotencyRecord(Base):
    __tablename__ = 'idempotency_records'
    __table_args__ = (UniqueConstraint('user_id', 'key'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    response_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WeatherCache(Base):
    __tablename__ = 'weather_cache'
    cache_key: Mapped[str] = mapped_column(String(180), primary_key=True)
    raw_response: Mapped[dict] = mapped_column(JSON)
    payload: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
