"""Real subprocess/algorithm integration; only remote weather is replaced."""
import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from app import integration as i
from app.algorithm_bridge import invoke
from app.config import AlgorithmSettings
from app.integration_models import IntegrationJob
from test_integration import make_room


@pytest.fixture
def connected(monkeypatch):
    for name, value in {
        'DLI_CALLABLE': 'grid_dli_service:compute_room_dli',
        'DIRECTION_CALLABLE': 'room_geometry:compute_room_direction',
        'RECOMMENDATION_CALLABLE': 'recommend_service:recommend_for_room',
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv('ALGORITHM_DIR', raising=False)


def test_dotenv_and_environment_precedence(tmp_path, monkeypatch):
    env = tmp_path / '.env'
    env.write_text('DLI_CALLABLE=grid_dli_service:compute_room_dli\nALGORITHM_DIR=../algorithm\nDLI_CACHE_VERSION=revision-test\n')
    monkeypatch.delenv('DLI_CALLABLE', raising=False)
    monkeypatch.delenv('ALGORITHM_DIR', raising=False)
    config = AlgorithmSettings(_env_file=env)
    assert config.dli_callable == 'grid_dli_service:compute_room_dli'
    assert config.algorithm_dir == '../algorithm'
    assert config.dli_cache_version == 'revision-test'
    monkeypatch.setenv('DLI_CALLABLE', 'override:run')
    assert AlgorithmSettings(_env_file=env).dli_callable == 'override:run'


def weather(*args):
    start = datetime.fromisoformat(str(args[-1]) + 'T00:00:00+09:00')
    values = [{'time': (start + timedelta(hours=h)).isoformat(),
               'dni': 500 if 7 <= h <= 18 else 0,
               'dhi': 100 if 7 <= h <= 18 else 0} for h in range(25)]
    return {'values': values, 'time_basis': 'PRECEDING_HOUR_MEAN', 'dataset': 'ERA5',
            'fetched_at': '2026-10-27T10:00:00+09:00', 'expires_at': '2026-10-27T11:00:00+09:00'}


def test_real_direction_dli_recommendation(context, headers, other_headers, monkeypatch, connected):
    client, factory = context
    rid = make_room(client, headers)
    wid = client.get(f'/api/v1/rooms/{rid}/windows', headers=headers).json()[0]['id']
    # Inject saved scan metadata: camera inference is outside this deterministic test.
    with factory() as db:
        from app.models import Room
        room = db.get(Room, rid)
        db.add(IntegrationJob(id='direction-scan', user_id=room.user_id, room_id=rid,
            window_id=wid, kind='SCAN', status='COMPLETED',
            payload={'geometry_version': room.geometry_version, 'captured_at': '2026-10-01T12:00:00+09:00', 'window_azimuth_deg':180},
            result={}))
        db.commit()
    direction = client.post(f'/api/v1/rooms/{rid}/direction', headers=headers)
    assert direction.status_code == 200, direction.text
    assert 0 <= direction.json()['x_axis_azimuth_deg'] < 360
    for n in range(2):
        response = client.post('/api/v1/plants', headers=headers, json={
            'species_id':1, 'nickname':f'plant-{n}', 'room_id':rid,
            'position':{'x':n+0.5,'y':0.5,'z':0.5}})
        assert response.status_code == 201, response.text
    with factory() as db:
        from app.models import PlantSpecies
        species = db.get(PlantSpecies, 1)
        species.min_dli, species.max_dli = 100, 200
        db.commit()
    monkeypatch.setattr(i, 'get_irradiance', weather)
    accepted = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json={
        'start_date':'2026-10-01', 'end_date':'2026-10-01', 'cell_size_m':1,
        'sample_height_m':0.5, 'mock_sky':True, 'accept_provisional_algorithm':False})
    assert accepted.status_code == 202, accepted.text
    job = client.get(accepted.json()['status_url'], headers=headers).json()
    assert job['status'] == 'COMPLETED', job
    assert not any('PROVISIONAL' in w for w in job['result']['warnings'])
    body = {'dli_job_id':accepted.json()['job_id'], 'blocked_cells':[[0,0]]}
    url = f'/api/v1/rooms/{rid}/recommendations'
    response = client.post(url, headers=headers, json=body)
    assert response.status_code == 200, response.text
    output = response.json()
    assert set(output) == {'room_id','date','period','plants','warnings'}
    assert len(output['plants']) == 2
    cells = []
    for p in output['plants']:
        assert set(p) == {'plant_id','species_id','required_dli','current','recommended'}
        assert p['current']['status'] == 'LOW'
        r = p['recommended']
        assert r and 0 <= r['score'] <= 1
        cells.append((r['row'],r['col']))
    assert len(set(cells)) == 2 and (0,0) not in cells
    assert client.post(url, headers=other_headers, json=body).status_code == 404
    assert client.post(url, headers=headers, json={**body,'blocked_cells':[[-1,0]]}).status_code == 422
    client.put(f'/api/v1/rooms/{rid}/location', headers=headers, json={'latitude':38,'longitude':127})
    assert client.post(url, headers=headers, json=body).status_code == 409


def test_recommendation_ok_and_no_space(connected):
    grid = {'origin':{'x':0,'z':0}, 'cell_size_m':1,'rows':1,'cols':1,'inside_mask':[[True]]}
    payload = {'_callable':'recommend_service:recommend_for_room','room_id':1,
        'dli_map':{'grid':grid,'total_dli':[[4]],'date':'2026-10-01'},
        'plants':[{'plant_id':1,'species_id':1,'min_dli':2,'max_dli':6,'position':{'x':0.5,'y':0,'z':0.5}}]}
    result = invoke('custom', payload)
    assert result['plants'][0]['current']['status'] == 'OK'
    assert result['plants'][0]['recommended'] is None
    payload['plants'][0]['position'] = None
    payload['blocked_cells'] = [{'row':0,'col':0}]
    result = invoke('custom', payload)
    assert result['plants'][0]['current'] is None
    assert result['plants'][0]['recommended'] is None
    assert result['warnings']


def test_polygon_multi_window_api(client, headers, monkeypatch, connected):
    body = json.loads(Path('examples/room.json').read_text())
    body['corners'] = [{'x':x,'y':0,'z':z,'order_index':n} for n,(x,z) in enumerate(
        [(0,0),(4,0),(4,2),(2,2),(2,4),(0,4)])]
    room = client.post('/api/v1/rooms', headers=headers, json=body)
    assert room.status_code == 201, room.text
    rid = room.json()['id']
    window = json.loads(Path('examples/window.json').read_text())
    assert client.post(f'/api/v1/rooms/{rid}/windows', headers=headers, json=window).status_code == 201
    window['corners'] = [{'x':x,'y':y,'z':z,'order_index':n} for n,(x,y,z) in enumerate(
        [(4,0.8,0.3),(4,0.8,1.7),(4,2,1.7),(4,2,0.3)])]
    response = client.post(f'/api/v1/rooms/{rid}/windows', headers=headers, json=window)
    assert response.status_code == 201, response.text
    monkeypatch.setattr(i, 'get_irradiance', weather)
    accepted = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json={
        'start_date':'2026-10-01','end_date':'2026-10-01','mock_sky':True,
        'cell_size_m':1,'sample_height_m':0.5,'accept_provisional_algorithm':False})
    assert accepted.status_code == 202, accepted.text
    result = client.get(accepted.json()['status_url'], headers=headers).json()
    assert result['status'] == 'COMPLETED', result
    assert result['result']['total_dli'][3][3] is None
    assert not any('PROVISIONAL' in w for w in result['result']['warnings'])
