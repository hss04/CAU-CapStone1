from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
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


class WeatherCache(Base):
    __tablename__ = 'weather_cache'
    cache_key: Mapped[str] = mapped_column(String(180), primary_key=True)
    raw_response: Mapped[dict] = mapped_column(JSON)
    payload: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
