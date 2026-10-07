from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def build_engine(url: str):
    parsed = make_url(url)
    options = {}
    if parsed.get_backend_name() == 'sqlite':
        options['connect_args'] = {'check_same_thread': False}
        if parsed.database and parsed.database != ':memory:':
            Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, **options)
    if parsed.get_backend_name() == 'sqlite':
        @event.listens_for(engine, 'connect')
        def enable_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute('PRAGMA foreign_keys=ON')
            cursor.close()
    return engine


engine = build_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session
