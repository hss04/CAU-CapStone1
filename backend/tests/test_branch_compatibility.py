"""Ensure the v4 upload preserves features already present on backend."""
import json
from pathlib import Path
from sqlalchemy import select, func
from app.models import Room


def test_ar_retry_still_creates_one_room(context, headers):
    client, factory = context
    payload = json.loads(Path('examples/ar-room-v3.json').read_text())
    auth = {**headers, 'Idempotency-Key': 'v4-preserved-retry'}
    first = client.post('/api/v1/rooms/import-ar', headers=auth, json=payload)
    second = client.post('/api/v1/rooms/import-ar', headers=auth, json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert 'location_name' in second.json()
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Room)) == 1
    changed = client.post('/api/v1/rooms/import-ar?name=Changed', headers=auth, json=payload)
    assert changed.status_code == 409


def test_readiness_keeps_database_check(client, monkeypatch):
    from app import main
    class BrokenEngine:
        def connect(self):
            raise RuntimeError('unavailable')
    monkeypatch.setattr(main, 'engine', BrokenEngine())
    result = client.get('/ready')
    assert result.status_code == 503
    assert result.json()['checks']['database'] == 'error'


def test_readiness_keeps_algorithm_check(client, monkeypatch, tmp_path):
    from app import main
    assert client.get('/ready').status_code == 200
    monkeypatch.setattr(main, 'ALGORITHM_DIR', tmp_path / 'absent')
    result = client.get('/ready')
    assert result.status_code == 503
    assert result.json()['checks']['algorithm_directory'] == 'missing'
