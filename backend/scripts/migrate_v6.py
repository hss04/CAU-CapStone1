"""Stop the server, back up SQLite and add v6 tables without replacing existing data."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy.engine import make_url
from app.config import get_settings
from app import integration_models  # Register all additive v6 tables.
from migrate_v4 import migrate


if __name__ == '__main__':
    url = make_url(get_settings().database_url)
    if url.get_backend_name() != 'sqlite' or not url.database or url.database == ':memory:':
        raise SystemExit('This backup/migration command supports file-based SQLite only.')
    migrate(url.database)
