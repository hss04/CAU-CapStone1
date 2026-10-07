"""Add measurement metadata to an existing SQLite database without changing coordinates."""
import sys
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy.engine import make_url
from app.config import get_settings


def migrate(path):
    path = Path(path)
    if not path.exists():
        print('No existing DB; new tables will be created on startup.')
        return
    with sqlite3.connect(path) as connection:
        tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        changes = []
        for table, column, declaration in [('rooms','saved_at','VARCHAR(50)'),('windows','measurement','JSON')]:
            if table in tables:
                columns = {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}
                if column not in columns:
                    changes.append((table,column,declaration))
        if not changes:
            print('DB already has the v3 metadata columns.')
            return
        backup_path = path.with_name(path.name+'.before-v3-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')+'.bak')
        with sqlite3.connect(backup_path) as backup:
            connection.backup(backup)
        with connection:
            for table,column,declaration in changes:
                connection.execute(f'ALTER TABLE {table} ADD COLUMN {column} {declaration}')
        print(f'Metadata columns added. Backup: {backup_path}')
        print('Existing coordinate frames are preserved. Reimport Android v3 JSON into a new room for the new grid.')


if __name__ == '__main__':
    url = make_url(get_settings().database_url)
    if url.get_backend_name() != 'sqlite' or not url.database or url.database == ':memory:':
        raise SystemExit('This script supports file-based SQLite only.')
    migrate(url.database)
