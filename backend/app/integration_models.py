from sqlalchemy import ForeignKey, JSON, String, DateTime
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
