"""Stop server first. Idempotent SQLite upgrade with a full database backup."""
import sys
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from app.database import Base, build_engine
from app import models
from app.integration_models import IntegrationJob, DliDailyCache
from app.species_seed import seed_species

ADDITIONS = [('rooms','saved_at','VARCHAR(50)'), ('windows','measurement','JSON'),
             ('rooms','location_name','VARCHAR(100)'),
             ('plants','watering_interval_days','INTEGER NOT NULL DEFAULT 7 CHECK(watering_interval_days > 0)'),
             ('plants','last_watered_at','DATE')]


def migrate(path):
    path=Path(path).resolve()
    if path.exists():
        with sqlite3.connect(path) as conn:
            backup_path=path.with_name(path.name+'.before-v4-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')+'.bak')
            with sqlite3.connect(backup_path) as backup: conn.backup(backup)
            tables={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            with conn:
                for table,column,declaration in ADDITIONS:
                    if table in tables and column not in {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}:
                        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {declaration}')
            print(f'Backup: {backup_path}')
    engine=build_engine('sqlite:///'+str(path))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed_species(db)
        db.commit()
    engine.dispose()
    print('v4 ready. Existing rooms, scans, plants and IDs preserved; six species seeded.')


if __name__=='__main__':
    from app.config import get_settings
    url=make_url(get_settings().database_url)
    if url.get_backend_name()!='sqlite' or not url.database or url.database==':memory:':
        raise SystemExit('This migration supports file-based SQLite only.')
    migrate(url.database)
