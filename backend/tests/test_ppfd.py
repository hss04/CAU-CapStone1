"""PPFD through HTTP jobs, the real subprocess algorithm and persistent retrieval."""
from copy import deepcopy
from datetime import datetime, timedelta
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import integration as i
from app.algorithm_bridge import invoke as real_invoke
from app.integration_models import DliDailyCache, IntegrationJob
from test_algorithm_v5 import weather
from test_integration import make_room


@pytest.fixture
def prepared(client, headers, monkeypatch):
    rid = make_room(client, headers)
    monkeypatch.setattr(i, 'get_irradiance', weather)
    body = {'start_date': '2026-10-01', 'end_date': '2026-10-01', 'cell_size_m': 1,
            'sample_height_m': .5, 'mock_sky': True, 'temporary_x_axis_azimuth_deg': 0,
            'timeseries': True}
    return rid, body


def submit(client, headers, rid, body):
    response = client.post(f'/api/v1/rooms/{rid}/dli-series', headers=headers, json=body)
    assert response.status_code == 202, response.text
    job = client.get(response.json()['status_url'], headers=headers).json()
    assert job['status'] == 'COMPLETED', job
    assert not job['stale']
    return job


def query(body):
    return {key: json.dumps(value) if key == 'cells' else value for key, value in body.items()}


@pytest.mark.parametrize('cells', [None, [[1, 2], [0, 0], [1, 2]]])
@pytest.mark.parametrize('configured', [False, True])
def test_real_ppfd_jobs_persistence_and_cache(context, headers, other_headers, prepared,
                                             monkeypatch, cells, configured):
    client, factory = context
    rid, body = prepared
    if configured:
        monkeypatch.setenv('DLI_CALLABLE', 'grid_dli_service:compute_room_dli')
    if cells is not None:
        body['cells'] = cells
    calls = []
    def calculate(operation, payload):
        calls.append(deepcopy(payload))
        return real_invoke(operation, payload)
    monkeypatch.setattr(i, 'invoke', calculate)
    job = submit(client, headers, rid, body)
    day = job['result']['days'][0]
    ppfd = day['ppfd']
    assert ppfd['interval_minutes'] == 10 and ppfd['ppfd_unit'] == 'umol/m2/s'
    times = [datetime.fromisoformat(t) for t in ppfd['times']]
    assert len(times) > 1 and all(t.utcoffset() == timedelta(hours=9) for t in times)
    assert all(b-a == timedelta(minutes=10) for a, b in zip(times, times[1:]))
    assert all(t.minute % 10 == 5 for t in times)
    assert calls[0]['timeseries'] is True
    if cells is None:
        assert 'cell_series' not in ppfd
        for component in ('direct', 'diffuse'):
            frames = ppfd[component + '_ppfd']
            assert len(frames) == len(times)
            for r in range(job['result']['grid']['rows']):
                for c in range(job['result']['grid']['cols']):
                    total = sum(frame[r][c] for frame in frames) * 600 / 1e6
                    assert total == pytest.approx(day[component + '_dli'][r][c], abs=.01)
    else:
        assert calls[0]['cells'] == [[0, 0], [1, 2]]
        assert 'direct_ppfd' not in ppfd
        assert [(c['row'], c['col']) for c in ppfd['cell_series']] == [(0, 0), (1, 2)]
        for cell in ppfd['cell_series']:
            for component in ('direct', 'diffuse'):
                values = cell[component + '_ppfd']
                assert len(values) == len(times)
                assert sum(values) * 600 / 1e6 == pytest.approx(
                    day[component + '_dli'][cell['row']][cell['col']], abs=.01)
    url = f'/api/v1/rooms/{rid}/dli-series'
    got = client.get(url, headers=headers, params=query(body))
    assert got.status_code == 200, got.text
    assert got.json() == job['result']
    assert submit(client, headers, rid, body)['result'] == job['result']
    assert len(calls) == 1
    assert client.get(url, headers=other_headers, params=query(body)).status_code == 404
    assert client.post(url, headers=other_headers, json=body).status_code == 404
    # A different selection cannot reuse full-grid or other-cell PPFD output.
    different = {**body, 'cells': [[0, 1]]}
    assert client.get(url, headers=headers, params=query(different)).json()['missing_dates'] == ['2026-10-01']
    plain = {k: v for k, v in body.items() if k not in ('timeseries', 'cells')}
    assert client.get(url, headers=headers, params=plain).json()['days'] == []
    if not configured:
        # Keep the legacy non-PPFD algorithm's height restriction untouched.
        plain['sample_height_m'] = 0
    normal = submit(client, headers, rid, plain)
    assert 'ppfd' not in normal['result']['days'][0]
    assert 'ppfd' not in client.get(url, headers=headers, params=plain).json()['days'][0]
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(DliDailyCache)) == 2
    client.put(f'/api/v1/rooms/{rid}/location', headers=headers, json={'latitude': 38, 'longitude': 127})
    assert client.get('/api/v1/jobs/' + job['job_id'], headers=headers).json()['stale']
    assert client.get(url, headers=headers, params=query(body)).json()['days'] == []


@pytest.mark.parametrize('overrides', [
    {'cells': []}, {'cells': [[-1, 0]]}, {'cells': [[True, 0]]}, {'cells': [['0', 0]]},
    {'cells': [[.5, 0]]}, {'cells': [[0]]}, {'cells': [[999, 0]]},
    {'cells': [[0, 0]], 'timeseries': False}, {'timeseries': 'true'},
    {'cell_size_m': .05}, {'end_date': '2027-01-03'},
])
def test_invalid_ppfd_requests_do_not_start_jobs(context, headers, prepared, monkeypatch, overrides):
    client, factory = context
    rid, body = prepared
    monkeypatch.setattr(i, 'invoke', lambda *args: pytest.fail('Invalid request reached algorithm'))
    response = client.post(f'/api/v1/rooms/{rid}/dli-series', headers=headers, json={**body, **overrides})
    assert response.status_code == 422, response.text
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(IntegrationJob)) == 0


def test_ppfd_query_validation_and_map_contract(client, headers, prepared):
    rid, body = prepared
    url = f'/api/v1/rooms/{rid}/dli-series'
    for cells in ('bad json', '{}', '[]', '[[true,0]]', '[[-1,0]]', '[[999,0]]'):
        response = client.get(url, headers=headers, params={**body, 'cells': cells})
        assert response.status_code == 422, response.text
    assert client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json=body).status_code == 422


def synthetic(payload):
    spec = payload['grid']
    raw = {'times': [payload['date'] + 'T12:05:00+09:00'],
           'interval_minutes': 10, 'ppfd_unit': 'umol/m2/s',
           'direct_dli': [[.06] * spec['cols'] for _ in range(spec['rows'])],
           'diffuse_dli': [[.03] * spec['cols'] for _ in range(spec['rows'])]}
    if 'cells' in payload:
        raw['cell_series'] = [{'row': r, 'col': c, 'direct_ppfd': [100.], 'diffuse_ppfd': [50.]}
                              for r, c in payload['cells']]
    else:
        raw['direct_ppfd'] = [[[100.] * spec['cols'] for _ in range(spec['rows'])]]
        raw['diffuse_ppfd'] = [[[50.] * spec['cols'] for _ in range(spec['rows'])]]
    return raw


@pytest.mark.parametrize('corruption', ['missing', 'unit', 'interval', 'time', 'naive', 'date',
                                       'shape', 'nan', 'negative', 'boolean', 'integral', 'cells', 'length'])
def test_invalid_algorithm_ppfd_is_not_cached(context, headers, prepared, monkeypatch, corruption):
    client, factory = context
    rid, body = prepared
    def broken(operation, payload):
        raw = synthetic(payload)
        if corruption == 'missing': del raw['times']
        elif corruption == 'unit': raw['ppfd_unit'] = 'mol/m2/day'
        elif corruption == 'interval': raw['interval_minutes'] = 60
        elif corruption == 'time': raw['times'][0] = payload['date'] + 'T12:00:00+09:00'
        elif corruption == 'naive': raw['times'][0] = payload['date'] + 'T12:05:00'
        elif corruption == 'date': raw['times'][0] = '2026-10-02T12:05:00+09:00'
        elif corruption == 'shape': raw['direct_ppfd'][0] = []
        elif corruption == 'nan': raw['direct_ppfd'][0][0][0] = float('nan')
        elif corruption == 'negative': raw['direct_ppfd'][0][0][0] = -1
        elif corruption == 'boolean': raw['direct_ppfd'][0][0][0] = True
        elif corruption == 'integral': raw['direct_ppfd'][0][0][0] = 0
        elif corruption == 'cells': raw['cell_series'][0]['col'] = 1
        elif corruption == 'length': raw['cell_series'][0]['direct_ppfd'] = []
        return raw
    if corruption in ('cells', 'length'):
        body['cells'] = [[0, 0]]
    monkeypatch.setattr(i, 'invoke', broken)
    response = client.post(f'/api/v1/rooms/{rid}/dli-series', headers=headers, json=body)
    assert response.status_code == 202
    job = client.get(response.json()['status_url'], headers=headers).json()
    assert job['status'] == 'FAILED' and job['result'] is None
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(DliDailyCache)) == 0


def test_multi_day_ppfd_keeps_each_day_and_selection_separate(client, headers, prepared, monkeypatch):
    rid, body = prepared
    body.update(end_date='2026-10-02', cells=[[0, 0]])
    monkeypatch.setattr(i, 'invoke', lambda operation, payload: synthetic(payload))
    result = submit(client, headers, rid, body)['result']
    assert [day['date'] for day in result['days']] == ['2026-10-01', '2026-10-02']
    assert [day['ppfd']['times'][0][:10] for day in result['days']] == ['2026-10-01', '2026-10-02']
    assert client.get(f'/api/v1/rooms/{rid}/dli-series', headers=headers, params=query(body)).json() == result


def test_polygon_ppfd_masks_outside_cells(client, headers, monkeypatch):
    monkeypatch.setenv('DLI_CALLABLE', 'grid_dli_service:compute_room_dli')
    monkeypatch.setattr(i, 'get_irradiance', weather)
    room = json.loads(Path('examples/room.json').read_text())
    room['corners'] = [{'x': x, 'y': 0, 'z': z, 'order_index': n} for n, (x, z) in enumerate(
        [(0, 0), (4, 0), (4, 2), (2, 2), (2, 4), (0, 4)])]
    response = client.post('/api/v1/rooms', headers=headers, json=room)
    assert response.status_code == 201, response.text
    rid = response.json()['id']
    window = json.loads(Path('examples/window.json').read_text())
    assert client.post(f'/api/v1/rooms/{rid}/windows', headers=headers, json=window).status_code == 201
    body = {'start_date': '2026-10-01', 'end_date': '2026-10-01', 'cell_size_m': 1,
            'sample_height_m': .5, 'mock_sky': True, 'timeseries': True}
    day = submit(client, headers, rid, body)['result']['days'][0]
    assert day['total_dli'][3][3] is None
    assert all(frame[3][3] is None for frame in day['ppfd']['direct_ppfd'])
    response = client.post(f'/api/v1/rooms/{rid}/dli-series', headers=headers,
                           json={**body, 'cells': [[3, 3]]})
    assert response.status_code == 422
