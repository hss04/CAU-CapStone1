"""Period network batching, process/model reuse and recovery regressions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
import pytest
from sqlalchemy import func, select

from app import algorithm_bridge as bridge, weather
from app.models import WeatherCache
from test_integration import make_room


def period_raw(start, end):
    first = datetime.combine(start, datetime.min.time())
    count = (end - start).days * 24 + 24
    return {'hourly_units': {k: 'W/m²' for k in weather.VARIABLES.split(',')},
            'hourly': {'time': [(first + timedelta(hours=n)).isoformat() for n in range(count)],
                       'direct_normal_irradiance': [float(n % 24) for n in range(count)],
                       'diffuse_radiation': [10.] * count}}


def fake_network(monkeypatch):
    calls = []
    def fetch(url, params):
        calls.append((url, dict(params)))
        return period_raw(date.fromisoformat(params['start_date']), date.fromisoformat(params['end_date']))
    monkeypatch.setattr(weather, 'fetch_raw', fetch)
    return calls


@pytest.fixture
def worker_module(tmp_path, monkeypatch):
    bridge.shutdown_worker()
    monkeypatch.setenv('ALGORITHM_DIR', str(tmp_path))
    (tmp_path / 'probe.py').write_text('''
import os
import time
calls = 0
def run(payload):
    global calls
    calls += 1
    print('a library log must not corrupt the JSON protocol')
    if payload.get('crash'): os._exit(9)
    if payload.get('fail'): raise RuntimeError('private traceback marker')
    if payload.get('sleep'): time.sleep(payload['sleep'])
    return {'pid': os.getpid(), 'calls': calls, 'value': payload.get('value')}
def compute(payload):
    global calls
    calls += 1
    g = payload['grid']
    n = int(payload['date'][-2:])
    return {'direct_dli': [[n] * g['cols'] for _ in range(g['rows'])],
            'diffuse_dli': [[1] * g['cols'] for _ in range(g['rows'])]}
def stats(payload):
    return {'pid': os.getpid(), 'calls': calls}
''')
    yield tmp_path
    bridge.shutdown_worker()


def call(**kwargs):
    return bridge.invoke('custom', {'_callable': 'probe:run', **kwargs})


def test_process_is_reused_and_requests_do_not_mutate_callers(worker_module):
    payload = {'_callable': 'probe:run', 'value': 3}
    first = bridge.invoke('custom', payload)
    second = bridge.invoke('custom', payload)
    assert first['pid'] == second['pid']
    assert [first['calls'], second['calls']] == [1, 2]
    assert payload == {'_callable': 'probe:run', 'value': 3}


def test_concurrent_requests_are_serialized(worker_module):
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda n: call(value=n), range(8)))
    assert len({r['pid'] for r in results}) == 1
    assert sorted(r['calls'] for r in results) == list(range(1, 9))
    assert [r['value'] for r in results] == list(range(8))


@pytest.mark.parametrize('fault', [{'crash': True}, {'fail': True}])
def test_failed_worker_is_replaced_without_replaying_the_request(worker_module, fault):
    first = call()
    with pytest.raises(HTTPException) as exc:
        call(**fault)
    assert exc.value.status_code == 503
    assert 'private traceback' not in exc.value.detail
    recovered = call()
    assert recovered['pid'] != first['pid'] and recovered['calls'] == 1


def test_timeout_kills_child_and_next_request_recovers(worker_module, monkeypatch):
    call()
    monkeypatch.setenv('ALGORITHM_TIMEOUT_SECONDS', '.1')
    with pytest.raises(HTTPException) as exc:
        call(sleep=5)
    assert exc.value.status_code == 504
    assert bridge.worker_status()['pid'] is None
    monkeypatch.setenv('ALGORITHM_TIMEOUT_SECONDS', '5')
    assert call()['calls'] == 1


def test_algorithm_directory_change_replaces_imported_modules(worker_module, tmp_path, monkeypatch):
    first = call()
    alternate = tmp_path / 'alternate'
    alternate.mkdir()
    (alternate / 'probe.py').write_text("def run(payload): return {'different': True}\n")
    monkeypatch.setenv('ALGORITHM_DIR', str(alternate))
    assert call() == {'different': True}
    assert bridge.worker_status()['pid'] != first['pid']


def test_warmup_model_stays_in_the_process_used_for_later_requests(worker_module, monkeypatch):
    (worker_module / 'c_sky.py').write_text('''
loads = 0
inferences = 0
def classify_sky_mask_segformer(image):
    global loads, inferences
    if loads == 0: loads += 1
    inferences += 1
    return image[:, :, 0] > 0
def stats(payload): return {'loads': loads, 'inferences': inferences}
''')
    monkeypatch.setenv('SKY_MODEL_PRELOAD', 'true')
    bridge.start_worker_warmup()
    bridge._warmup_thread.join(timeout=5)
    assert bridge.worker_status()['sky_model'] == 'ready'
    pid = bridge.worker_status()['pid']
    assert bridge.invoke('custom', {'_callable': 'c_sky:stats'}) == {'loads': 1, 'inferences': 1}
    bridge.invoke('warmup', {})
    assert bridge.invoke('custom', {'_callable': 'c_sky:stats'}) == {'loads': 1, 'inferences': 2}
    assert bridge.worker_status()['pid'] == pid
    with pytest.raises(HTTPException):
        call(crash=True)
    assert bridge.invoke('custom', {'_callable': 'c_sky:stats'}) == {'loads': 1, 'inferences': 1}
    assert bridge.worker_status()['sky_model'] == 'ready'


def test_one_shot_opt_out_still_works(worker_module, monkeypatch):
    monkeypatch.setenv('ALGORITHM_PERSISTENT', 'false')
    first, second = call(), call()
    assert first['pid'] != second['pid']
    assert first['calls'] == second['calls'] == 1


def test_shutdown_cancels_a_queued_warmup(worker_module, monkeypatch):
    # Hold the request slot to reproduce shutdown before warmup can spawn a child.
    monkeypatch.setenv('SKY_MODEL_PRELOAD', 'true')
    with bridge._algorithm_slot:
        bridge.start_worker_warmup()
        bridge.shutdown_worker()
    bridge._warmup_thread.join(timeout=5)
    assert not bridge._warmup_thread.is_alive()
    assert bridge.worker_status()['pid'] is None


def test_90_days_one_weather_request_and_daily_cache(context, monkeypatch):
    _, factory = context
    calls = fake_network(monkeypatch)
    days = [date(2026, 1, 1) + timedelta(days=n) for n in range(90)]
    with factory() as db:
        result = weather.get_irradiance_many(db, 37.5, 127., days)
        assert len(result) == 90 and len(calls) == 1
        assert calls[0][1]['end_date'] == (days[-1] + timedelta(days=1)).isoformat()
        assert all(len(v['values']) == 25 for v in result.values())
        assert result[days[0]]['values'][-1]['time'] == '2026-01-02T00:00:00+09:00'
        rows = db.scalars(select(WeatherCache)).all()
        assert len(rows) == 90
        assert all(len(r.raw_response['hourly']['time']) == 25 for r in rows)
        again = weather.get_irradiance_many(db, 37.5, 127., days)
        assert len(calls) == 1 and all(v['cache_hit'] for v in again.values())
        assert weather.get_irradiance(db, 37.5, 127., days[0])['values'] == result[days[0]]['values']


def test_weather_batch_splits_archive_and_forecast(context, monkeypatch):
    _, factory = context
    calls = fake_network(monkeypatch)
    today = datetime.now(weather.KST).date()
    days = [today - timedelta(days=n) for n in range(10)]
    with factory() as db:
        values = weather.get_irradiance_many(db, 37., 127., days)
    assert len(calls) == 2
    assert values[today - timedelta(days=7)]['dataset'] == 'ERA5'
    assert values[today - timedelta(days=6)]['dataset'] == 'BEST_MATCH_FORECAST'


def test_weather_batch_skips_cached_days_and_refetches_expired(context, monkeypatch):
    _, factory = context
    calls = fake_network(monkeypatch)
    days = [date(2026, 1, 1) + timedelta(days=n) for n in range(5)]
    with factory() as db:
        weather.get_irradiance(db, 37., 127., days[2])
        weather.get_irradiance_many(db, 37., 127., days)
        assert len(calls) == 3  # middle hit splits the two missing contiguous ranges
        row = db.scalar(select(WeatherCache).where(WeatherCache.cache_key.contains('2026-01-03')))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        result = weather.get_irradiance_many(db, 37., 127., days)
    assert len(calls) == 4
    assert not result[days[2]]['cache_hit'] and result[days[0]]['cache_hit']


def test_weather_invalid_later_day_does_not_cache_earlier_days(context, monkeypatch):
    _, factory = context
    start = date(2026, 1, 1)
    invalid = period_raw(start, start + timedelta(days=3))
    invalid['hourly']['diffuse_radiation'][30] = None
    monkeypatch.setattr(weather, 'fetch_raw', lambda *args: invalid)
    with factory() as db:
        with pytest.raises(HTTPException):
            weather.get_irradiance_many(db, 37., 127., [start, start + timedelta(days=1)])
        assert db.scalar(select(func.count()).select_from(WeatherCache)) == 0


def test_weather_invalid_future_date_is_rejected_before_network(context, monkeypatch):
    _, factory = context
    calls = fake_network(monkeypatch)
    with factory() as db:
        with pytest.raises(HTTPException) as exc:
            weather.get_irradiance_many(db, 37., 127., [date(2026, 1, 1), datetime.now(weather.KST).date() + timedelta(days=15)])
        assert exc.value.status_code == 422
    assert calls == []


def test_period_job_reuses_one_worker_and_only_computes_missing_days(context, headers, worker_module, monkeypatch):
    client, _ = context
    rid = make_room(client, headers)
    monkeypatch.setenv('DLI_CALLABLE', 'probe:compute')
    calls = fake_network(monkeypatch)
    body = {'start_date': '2026-01-01', 'end_date': '2026-01-07', 'cell_size_m': 1,
            'mock_sky': True, 'temporary_x_axis_azimuth_deg': 0}
    def submit():
        accepted = client.post(f'/api/v1/rooms/{rid}/dli-series', headers=headers, json=body)
        assert accepted.status_code == 202, accepted.text
        job = client.get(accepted.json()['status_url'], headers=headers).json()
        assert job['status'] == 'COMPLETED', job
        return job
    first = submit()
    stats = bridge.invoke('custom', {'_callable': 'probe:stats'})
    assert stats['calls'] == 7 and len(calls) == 1
    assert [d['total_dli'][0][0] for d in first['result']['days']] == list(range(2, 9))
    assert first['progress']['completed_steps'] == first['progress']['total_steps'] == 7
    body['end_date'] = '2026-01-09'
    submit()
    after = bridge.invoke('custom', {'_callable': 'probe:stats'})
    assert after['pid'] == stats['pid'] and after['calls'] == 9 and len(calls) == 2
    submit()
    assert bridge.invoke('custom', {'_callable': 'probe:stats'})['calls'] == 9


def test_readiness_requires_preloaded_model_when_enabled(client, monkeypatch):
    from app import main
    monkeypatch.setenv('SKY_MODEL_PRELOAD', 'true')
    monkeypatch.setattr(main, 'worker_status', lambda: {'worker': 'running', 'sky_model': 'warming'})
    assert client.get('/health').status_code == 200
    assert client.get('/ready').status_code == 503
    monkeypatch.setattr(main, 'worker_status', lambda: {'worker': 'running', 'sky_model': 'ready'})
    assert client.get('/ready').status_code == 200
