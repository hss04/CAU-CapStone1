from sqlalchemy import ForeignKey, JSON, String, DateTime, Integer, Float
from datetime import datetime, timezone
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class IntegrationJob(Base):
    __tablename__ = 'integration_jobs'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    room_id: Mapped[int] = mapped_column(ForeignKey('rooms.id', ondelete='CASCADE'), index=True)
    window_id: Mapped[int | None] = mapped_column(ForeignKey('windows.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    kind: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default='PENDING')
    payload: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(500))


class DliDailyCache(Base):
    __tablename__ = 'dli_daily_cache'
    cache_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey('rooms.id', ondelete='CASCADE'), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class JobRuntime(Base):
    """Additive job metadata; existing integration_jobs rows stay intact."""
    __tablename__ = 'job_runtime'
    job_id: Mapped[str] = mapped_column(ForeignKey('integration_jobs.id', ondelete='CASCADE'), primary_key=True)
    dedup_key: Mapped[str] = mapped_column(String(64), index=True)
    stage: Mapped[str] = mapped_column(String(40), default='QUEUED')
    completed_steps: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=1)
    error_code: Mapped[str | None] = mapped_column(String(50))


class JobRequestKey(Base):
    __tablename__ = 'job_request_keys'
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    job_id: Mapped[str] = mapped_column(ForeignKey('integration_jobs.id', ondelete='CASCADE'))


class PlacementRules(Base):
    __tablename__ = 'placement_rules'
    room_id: Mapped[int] = mapped_column(ForeignKey('rooms.id', ondelete='CASCADE'), primary_key=True)
    geometry_version: Mapped[int] = mapped_column(Integer)
    cell_size_m: Mapped[float] = mapped_column(Float)
    blocked_cells: Mapped[list] = mapped_column(JSON)


class PlacementPlan(Base):
    __tablename__ = 'placement_plans'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    room_id: Mapped[int] = mapped_column(ForeignKey('rooms.id', ondelete='CASCADE'), index=True)
    dli_job_id: Mapped[str] = mapped_column(ForeignKey('integration_jobs.id', ondelete='CASCADE'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    input_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    applied_result: Mapped[dict | None] = mapped_column(JSON)
