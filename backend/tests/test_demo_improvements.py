"""User-facing regressions: swaps, atomic saves, retries, care correction and restoration."""
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import subprocess
import sys

import pytest
from sqlalchemy import select, func

from app import integration as i, models as m
from app.algorithm_bridge import invoke as real_invoke
from app.integration_models import IntegrationJob, JobRuntime, PlacementPlan
from app.schemas import KST
from test_integration import make_room


@pytest.fixture
def saved(context, headers, monkeypatch):
    client, factory = context
    rid = make_room(client, headers)
    monkeypatch.setenv('DLI_CALLABLE', 'grid_dli_service:compute_room_dli')
    monkeypatch.setenv('DIRECTION_CALLABLE', 'room_geometry:compute_room_direction')
    monkeypatch.setenv('RECOMMENDATION_CALLABLE', 'recommend_service:recommend_for_room')
    def weather(*args):
        return {'values': [], 'time_basis': 'PRECEDING_HOUR_MEAN', 'dataset': 'ERA5',
                'fetched_at': '2026-10-27T10:00:00+09:00', 'expires_at': '2026-10-27T11:00:00+09:00'}
    monkeypatch.setattr(i, 'get_irradiance', weather)
    def calculate(op, payload):
        if payload.get('_callable') == 'grid_dli_service:compute_room_dli':
            spec = payload['grid']
            a = [[2.0 if c < 2 else 10.0 for c in range(spec['cols'])] for _ in range(spec['rows'])]
            return {'direct_dli': a, 'diffuse_dli': a}
        return real_invoke(op, payload)
    monkeypatch.setattr(i, 'invoke', calculate)
    request = {'start_date': '2026-10-01', 'end_date': '2026-10-01',
               'cell_size_m': 1, 'mock_sky': True, 'temporary_x_axis_azimuth_deg': 0}
    response = client.post(f'/api/v1/rooms/{rid}/dli-map', json=request, headers=headers)
    assert response.status_code == 202, response.text
    job_id = response.json()['job_id']
    assert client.get(response.json()['status_url'], headers=headers).json()['status'] == 'COMPLETED'
    return client, factory, rid, job_id, request


def add_plant(client, headers, rid, species_id=1, x=.5, y=0):
    response = client.post('/api/v1/plants', headers=headers, json={
        'species_id': species_id, 'nickname': 'test plant', 'room_id': rid,
        'position': {'x': x, 'y': y, 'z': .5}})
    assert response.status_code == 201, response.text
    return response.json()['id']


def add_swap_plants(saved, headers):
    client, factory, rid, job_id, _ = saved
    with factory() as db:
        low = db.get(m.PlantSpecies, 1)
        low.min_dli, low.max_dli = 18, 40
        high = m.PlantSpecies(name='shade fixture', min_dli=2, max_dli=6, source_note='Test only')
        db.add(high)
        db.commit()
        second_species = high.id
    a = add_plant(client, headers, rid, x=.5)
    b = add_plant(client, headers, rid, second_species, x=2.5)
    return a, b


def plan_for(saved, headers, **kwargs):
    client, _, rid, job_id, _ = saved
    response = client.post(f'/api/v1/rooms/{rid}/recommendation-plans',
        json={'dli_job_id': job_id, **kwargs}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_swaps_release_moving_cells_and_apply_atomically(saved, headers, other_headers):
    client, _, rid, _, _ = saved
    a, b = add_swap_plants(saved, headers)
    plan = plan_for(saved, headers)
    assert {d['reason_code'] for d in plan['decisions']} == {'RELOCATE'}
    targets = {p['plant_id']: p['recommended'] for p in plan['result']['plants']}
    assert targets[a]['col'] == 2 and targets[b]['col'] == 0
    url = f"/api/v1/rooms/{rid}/recommendation-plans/{plan['plan_id']}/apply"
    assert client.post(url, headers=other_headers, json={}).status_code == 404
    assert client.post(url, headers=headers, json={'plant_ids': [a]}).status_code == 409
    assert client.get(f'/api/v1/plants/{a}', headers=headers).json()['x'] == .5
    assert client.get(f'/api/v1/plants/{b}', headers=headers).json()['x'] == 2.5
    applied = client.post(url, headers=headers, json={})
    assert applied.status_code == 200, applied.text
    assert applied.json()['applied_count'] == 2
    assert client.get(f'/api/v1/plants/{a}', headers=headers).json()['x'] == 2.5
    assert client.get(f'/api/v1/plants/{b}', headers=headers).json()['x'] == .5
    assert client.post(url, headers=headers, json={}).json() == applied.json()


def test_no_free_cell_is_not_reported_as_current_ok(saved, headers):
    client, _, rid, job_id, _ = saved
    add_swap_plants(saved, headers)
    spec = client.get(f'/api/v1/rooms/{rid}/grid?cell_size_m=1', headers=headers).json()
    blocked = [[r, c] for r, row in enumerate(spec['inside_mask']) for c, inside in enumerate(row) if inside]
    plan = plan_for(saved, headers, blocked_cells=blocked)
    assert {d['reason_code'] for d in plan['decisions']} == {'NO_FREE_CELL'}
    assert all(not d['can_apply'] for d in plan['decisions'])
    assert [p['current']['status'] for p in plan['result']['plants']] == ['LOW', 'HIGH']
    legacy = client.post(f'/api/v1/rooms/{rid}/recommendations',
        json={'dli_job_id': job_id, 'blocked_cells': blocked}, headers=headers).json()
    assert set(legacy) == {'room_id', 'date', 'period', 'plants', 'warnings'}
    assert any('NO_FREE_CELL' in warning for warning in legacy['warnings'])


def test_current_ok_is_distinct_from_no_suitable_cell(saved, headers):
    client, factory, rid, _, _ = saved
    add_plant(client, headers, rid)
    plan = plan_for(saved, headers)
    assert plan['decisions'][0]['reason_code'] == 'CURRENT_OK'
    with factory() as db:
        db.get(m.PlantSpecies, 1).min_dli = 100
        db.get(m.PlantSpecies, 1).max_dli = 200
        db.commit()
    plan = plan_for(saved, headers)
    assert plan['decisions'][0]['reason_code'] == 'NO_SUITABLE_CELL'
    assert plan['decisions'][0]['can_apply'] is False


@pytest.mark.parametrize('change', ['plant', 'rules', 'species', 'algorithm', 'location', 'expired'])
def test_plan_rejects_changed_inputs_without_saving_any_position(saved, headers, monkeypatch, change):
    client, factory, rid, _, _ = saved
    a, b = add_swap_plants(saved, headers)
    plan = plan_for(saved, headers)
    with factory() as db:
        if change == 'plant':
            db.get(m.Plant, b).z = 1.5
        elif change == 'species':
            db.get(m.PlantSpecies, 1).max_dli = 50
        elif change == 'expired':
            db.get(PlacementPlan, plan['plan_id']).expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
        db.commit()
    if change == 'rules':
        geometry = client.get(f'/api/v1/rooms/{rid}', headers=headers).json()['geometry_version']
        response = client.put(f'/api/v1/rooms/{rid}/blocked-cells', headers=headers,
            json={'geometry_version': geometry, 'cell_size_m': 1, 'blocked_cells': [[1, 1]]})
        assert response.status_code == 200
    elif change == 'algorithm':
        monkeypatch.setenv('DLI_CACHE_VERSION', 'new-test-version')
    elif change == 'location':
        client.put(f'/api/v1/rooms/{rid}/location', headers=headers, json={'latitude': 38, 'longitude': 127})
    response = client.post(f"/api/v1/rooms/{rid}/recommendation-plans/{plan['plan_id']}/apply", headers=headers, json={})
    assert response.status_code == 409, response.text
    assert client.get(f'/api/v1/plants/{a}', headers=headers).json()['x'] == .5


def test_height_mismatch_is_rejected_before_recommendation(saved, headers):
    client, _, rid, job_id, _ = saved
    add_plant(client, headers, rid, y=5)
    response = client.post(f'/api/v1/rooms/{rid}/recommendations', headers=headers, json={'dli_job_id': job_id})
    assert response.status_code == 422
    assert 'height' in response.json()['detail']


def test_blocked_cells_persist_validate_and_invalidate_with_geometry(saved, headers, other_headers):
    client, factory, rid, _, _ = saved
    url = f'/api/v1/rooms/{rid}/blocked-cells'
    version = client.get(f'/api/v1/rooms/{rid}', headers=headers).json()['geometry_version']
    body = {'geometry_version': version, 'cell_size_m': 1, 'blocked_cells': [[0, 0], [0, 0]]}
    assert client.put(url, headers=other_headers, json=body).status_code == 404
    assert client.put(url, headers=headers, json=body).json()['blocked_cells'] == [[0, 0]]
    assert client.get(url+'?cell_size_m=1', headers=headers).json()['blocked_cells'] == [[0, 0]]
    assert client.put(url, headers=headers, json={**body, 'blocked_cells': [[-1, 0]]}).status_code == 422
    assert client.put(url, headers=headers, json={**body, 'blocked_cells': [[True, 0]]}).status_code == 422
    with factory() as db:
        db.get(m.Room, rid).geometry_version += 1
        db.commit()
    result = client.get(url+'?cell_size_m=1', headers=headers).json()
    assert result['stale'] and result['blocked_cells'] == []
    assert client.put(url, headers=headers, json=body).status_code == 409
    assert client.delete(url, headers=headers).status_code == 204


def test_dli_retries_reuse_key_and_job_progress(saved, headers):
    client, factory, rid, _, request = saved
    key_headers = {**headers, 'Idempotency-Key': 'one-computation'}
    first = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=key_headers, json=request)
    second = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=key_headers, json=request)
    assert first.status_code == second.status_code == 202
    assert second.json()['job_id'] == first.json()['job_id'] and second.json()['reused']
    changed = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=key_headers, json={**request, 'cell_size_m': 2})
    assert changed.status_code == 409
    job = client.get(first.json()['status_url'], headers=headers).json()
    assert job['progress'] == {'stage': 'COMPLETED', 'completed_steps': 1, 'total_steps': 1}
    assert job['error_code'] is None


def test_active_job_deduplication_and_admission_limit(saved, headers, monkeypatch):
    client, _, rid, _, request = saved
    monkeypatch.setattr(i, 'run_job', lambda *args: None)
    first = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json=request)
    retry = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json=request)
    assert first.json()['job_id'] == retry.json()['job_id'] and retry.json()['reused']
    for size in [.2, .3, .4, .5]:
        assert client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json={**request, 'cell_size_m': size}).status_code == 202
    limited = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers, json={**request, 'cell_size_m': .6})
    assert limited.status_code == 429 and limited.headers['retry-after'] == '5'


def test_latest_map_restores_without_recalculation_and_excludes_stale(saved, headers, other_headers, monkeypatch):
    client, _, rid, job_id, _ = saved
    url = f'/api/v1/rooms/{rid}/dli-map/latest?mock_sky=true&cell_size_m=1'
    assert client.get(url, headers=other_headers).status_code == 404
    restored = client.get(url, headers=headers)
    assert restored.status_code == 200 and restored.json()['job_id'] == job_id
    assert client.get(f'/api/v1/rooms/{rid}/dli-map/latest', headers=headers).status_code == 404
    jobs = client.get(f'/api/v1/rooms/{rid}/jobs', headers=headers).json()['jobs']
    assert jobs[0]['job_id'] == job_id and 'result' not in jobs[0]
    monkeypatch.setenv('DLI_CACHE_VERSION', 'new-version')
    assert client.get(url, headers=headers).status_code == 404


def test_watering_correction_undo_and_duplicate_rollback(client, headers, other_headers):
    p = client.post('/api/v1/plants', headers=headers, json={
        'species_id': 1, 'nickname': 'care plant', 'last_watered_at': '2026-10-01'}).json()['id']
    root = f'/api/v1/plants/{p}/waterings'
    client.post(root, headers=headers, json={'watered_at': '2026-10-02'})
    history = client.get(root, headers=headers).json()
    latest, earlier = history[0]['id'], history[1]['id']
    assert client.delete(f'{root}/{latest}', headers=other_headers).status_code == 404
    assert client.delete(f'{root}/{latest}', headers=headers).json()['last_watered_at'] == '2026-10-01'
    assert client.delete(f'{root}/{latest}', headers=headers).json()['last_watered_at'] == '2026-10-01'
    assert client.patch(f'{root}/{earlier}', headers=headers, json={'watered_at': '2026-10-03'}).json()['last_watered_at'] == '2026-10-03'
    client.post(root, headers=headers, json={'watered_at': '2026-10-02'})
    assert client.patch(f'{root}/{earlier}', headers=headers, json={'watered_at': '2026-10-02'}).status_code == 409
    assert client.get(f'/api/v1/plants/{p}', headers=headers).json()['last_watered_at'] == '2026-10-03'


def test_comparison_uses_saved_values_and_marks_missing_periods(saved, headers):
    client, _, rid, _, _ = saved
    response = client.post(f'/api/v1/rooms/{rid}/dli-comparison', headers=headers, json={
        'cell_size_m': 1, 'mock_sky': True, 'temporary_x_axis_azimuth_deg': 0,
        'periods': [{'label': 'saved', 'start_date': '2026-10-01', 'end_date': '2026-10-01'},
                    {'label': 'missing', 'start_date': '2026-10-02', 'end_date': '2026-10-02'}]})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['source'] == 'SAVED_DLI'
    assert result['periods'][0]['complete'] and result['periods'][0]['mean_total_dli'][0][0] == 4
    assert result['periods'][1]['mean_total_dli'] is None
    assert result['periods'][1]['missing_dates'] == ['2026-10-02']


def test_new_species_matching_excludes_blocked_and_occupied_cells(saved, headers):
    client, _, rid, job_id, _ = saved
    result = client.get(f'/api/v1/rooms/{rid}/suitable-species?dli_job_id={job_id}', headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()['reason_code'] == 'MATCHES_FOUND'
    assert result.json()['results'][0]['best_cell']['total_dli'] == 4
    assert result.json()['results'][0]['evidence']['basis'] == 'OPERATOR_DEFINED'


def test_evidence_preserves_legacy_species_contract(client, headers, context):
    _, factory = context
    from app.species_seed import seed_species
    with factory() as db:
        seed_species(db)
        db.commit()
    species = client.get('/api/v1/plant-species?q=적상추', headers=headers).json()[0]
    assert set(species) == {'id', 'name', 'scientific_name', 'min_dli', 'max_dli', 'source_note'}
    evidence = client.get(f"/api/v1/plant-species/{species['id']}/evidence", headers=headers).json()
    assert evidence['provisional'] and evidence['basis'].startswith('REFERENCE_')
    assert evidence['source_url'].startswith('https://')
    with factory() as db:
        db.get(m.PlantSpecies, species['id']).min_dli += 1
        db.commit()
    assert client.get(f"/api/v1/plant-species/{species['id']}/evidence", headers=headers).json()['basis'] == 'OPERATOR_DEFINED'


def test_dashboard_and_notifications_follow_undone_watering(client, headers, other_headers):
    today = datetime.now(KST).date()
    previous = today-timedelta(days=7)
    plant = client.post('/api/v1/plants', headers=headers, json={
        'species_id': 1, 'nickname': 'today care', 'watering_interval_days': 7,
        'last_watered_at': previous.isoformat()}).json()['id']
    url = f'/api/v1/notifications/schedule?start_date={today}&end_date={today}'
    before = client.get(url, headers=headers).json()
    assert before['delivery'] == 'DEVICE_LOCAL' and before['push_configured'] is False
    assert len(before['notifications']) == 1 and before['notifications'][0]['scheduled_at'].endswith('+09:00')
    assert client.get(url, headers=other_headers).json()['notifications'] == []
    client.post(f'/api/v1/plants/{plant}/waterings', headers=headers, json={'watered_at': today.isoformat()})
    after = client.get(url, headers=headers).json()
    assert not after['notifications'] and after['schedule_version'] != before['schedule_version']
    dashboard = client.get('/api/v1/dashboard', headers=headers).json()
    assert dashboard['plant_count'] == 1 and not dashboard['today_tasks']
    assert client.get('/api/v1/dashboard', headers=other_headers).json()['plant_count'] == 0


def test_additive_metadata_tables_survive_recreation(context):
    _, factory = context
    from app.database import Base
    with factory() as db:
        engine = db.get_bind()
        before = db.scalar(select(func.count()).select_from(m.PlantSpecies))
        Base.metadata.create_all(engine)
        assert db.scalar(select(func.count()).select_from(m.PlantSpecies)) == before
        assert engine.dialect.has_table(db.connection(), 'placement_plans')
        assert engine.dialect.has_table(db.connection(), 'job_runtime')


def test_demo_scripts_import_and_show_cli_help():
    for script in ('check_demo.py', 'demo_e2e.py'):
        result = subprocess.run([sys.executable, f'scripts/{script}', '--help'], capture_output=True, text=True)
        assert result.returncode == 0 and 'usage:' in result.stdout


@pytest.mark.parametrize('bad_field', ['light', 'requirements', 'current'])
def test_invalid_adapter_outputs_are_rejected(saved, headers, monkeypatch, bad_field):
    client, _, rid, job_id, _ = saved
    add_swap_plants(saved, headers)
    original = i.invoke
    def broken(op, payload):
        result = original(op, payload)
        if bad_field == 'light':
            result['plants'][0]['recommended']['total_dli'] += 1
        elif bad_field == 'requirements':
            result['plants'][0]['required_dli']['max'] += 1
        else:
            result['plants'][0]['current']['status'] = 'OK'
        return result
    monkeypatch.setattr(i, 'invoke', broken)
    assert client.post(f'/api/v1/rooms/{rid}/recommendations', headers=headers,
        json={'dli_job_id': job_id}).status_code == 502


def test_failed_weather_has_machine_readable_job_error(saved, headers, monkeypatch):
    from fastapi import HTTPException
    client, _, rid, _, request = saved
    def fail(*args):
        raise HTTPException(503, 'Open-Meteo unavailable; retry later')
    monkeypatch.setattr(i, 'get_irradiance', fail)
    response = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers,
        json={**request, 'start_date': '2026-10-02', 'end_date': '2026-10-02'})
    job = client.get(response.json()['status_url'], headers=headers).json()
    assert job['status'] == 'FAILED' and job['error_code'] == 'WEATHER_UNAVAILABLE'
    assert job['progress']['stage'] == 'FAILED'


def test_forecast_expiry_makes_completed_job_stale(saved, headers, monkeypatch):
    from app.integration_models import DliDailyCache
    client, factory, rid, _, request = saved
    now = datetime.now(timezone.utc)
    today = now.astimezone(KST).date().isoformat()
    monkeypatch.setattr(i, 'get_irradiance', lambda *args: {
        'values': [], 'time_basis': 'PRECEDING_HOUR_MEAN', 'dataset': 'BEST_MATCH_FORECAST',
        'fetched_at': now.isoformat(), 'expires_at': (now+timedelta(hours=1)).isoformat()})
    response = client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers,
        json={**request, 'start_date': today, 'end_date': today})
    assert client.get(response.json()['status_url'], headers=headers).json()['stale'] is False
    with factory() as db:
        for item in db.scalars(select(DliDailyCache)):
            item.expires_at = now-timedelta(seconds=1)
        db.commit()
    assert client.get(response.json()['status_url'], headers=headers).json()['stale'] is True
    assert client.post(f'/api/v1/rooms/{rid}/recommendations', headers=headers,
        json={'dli_job_id': response.json()['job_id']}).status_code == 409


def test_scan_idempotency_does_not_duplicate_files(context, headers, monkeypatch, tmp_path):
    import io, json
    from PIL import Image
    client, factory = context
    rid = make_room(client, headers)
    wid = client.get(f'/api/v1/rooms/{rid}/windows', headers=headers).json()[0]['id']
    monkeypatch.setattr(i, 'UPLOAD_ROOT', tmp_path)
    monkeypatch.setattr(i, 'invoke', lambda *args: {'sky': [[1]*360 for _ in range(91)], 'max_captured_elevation_deg': [90]*360})
    metadata = {'window_id': wid, 'captured_at': '2026-10-25T12:00:00+09:00', 'declination_deg': 0,
        'window_azimuth_deg': 180, 'window_azimuth_mag_deg': 180,
        'camera': {'width': 64, 'height': 1280, 'hfov_deg': 55, 'vfov_deg': 70},
        'frames': [{'index': n, 'file': f'{n}.jpg', 'azimuth_deg': 90+15*n, 'azimuth_mag_deg': 90+15*n,
                    'pitch_deg': 30, 'roll_deg': 0} for n in range(13)]}
    def files(color):
        image = io.BytesIO()
        Image.new('RGB', (64, 1280), color).save(image, 'JPEG')
        return [('files', (f'{n}.jpg', image.getvalue(), 'image/jpeg')) for n in range(13)]
    args = {'headers': {**headers, 'Idempotency-Key': 'same-scan'}, 'data': {'metadata': json.dumps(metadata)}}
    first = client.post(f'/api/v1/windows/{wid}/scans', files=files('blue'), **args)
    retry = client.post(f'/api/v1/windows/{wid}/scans', files=files('blue'), **args)
    assert first.status_code == retry.status_code == 202
    assert first.json()['job_id'] == retry.json()['job_id'] and retry.json()['reused']
    assert len(list(tmp_path.rglob('*.jpg'))) == 13
    assert client.post(f'/api/v1/windows/{wid}/scans', files=files('red'), **args).status_code == 409
    assert len(list(tmp_path.rglob('*.jpg'))) == 13


def test_jobs_run_serially_while_second_job_remains_pending(saved, headers, monkeypatch):
    from threading import Event, Lock, Thread
    client, factory, rid, _, request = saved
    runner = i.run_job
    monkeypatch.setattr(i, 'run_job', lambda *args: None)
    jobs = []
    for day in ('2026-10-02', '2026-10-03'):
        jobs.append(client.post(f'/api/v1/rooms/{rid}/dli-map', headers=headers,
            json={**request, 'start_date': day, 'end_date': day}).json()['job_id'])
    first_started, release_first, second_started = Event(), Event(), Event()
    lock = Lock()
    calls = []
    original = i.invoke
    def slow(op, payload):
        with lock:
            calls.append(payload['date'])
            call = len(calls)
        if call == 1:
            first_started.set()
            assert release_first.wait(5)
        else:
            second_started.set()
        return original(op, payload)
    monkeypatch.setattr(i, 'invoke', slow)
    first = Thread(target=runner, args=(jobs[0], factory))
    second = Thread(target=runner, args=(jobs[1], factory))
    first.start()
    try:
        assert first_started.wait(5)
        second.start()
        assert not second_started.wait(.25)
        with factory() as db:
            assert db.get(IntegrationJob, jobs[1]).status == 'PENDING'
    finally:
        release_first.set()
        first.join(5)
        if second.ident is not None:
            second.join(5)
    assert second_started.is_set() and not first.is_alive() and not second.is_alive()


def test_v6_migration_preserves_existing_data_and_is_repeatable(tmp_path):
    import os
    from app.database import Base, build_engine
    from sqlalchemy.orm import Session
    path = tmp_path/'existing.db'
    engine = build_engine('sqlite:///'+str(path))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = m.User(email='migration@example.com', password_hash='fixture-only', nickname='owner')
        species = m.PlantSpecies(name='original', min_dli=2, max_dli=6, source_note='Keep this')
        db.add_all([user, species]); db.flush()
        plant = m.Plant(user_id=user.id, species_id=species.id, nickname='keep plant')
        db.add(plant); db.flush()
        photo = m.GrowthPhoto(plant_id=plant.id, taken_at=datetime.now(timezone.utc),
            taken_on=datetime.now(KST).date(), width=1, height=1, byte_size=3,
            image_data=b'abc', thumbnail_data=b'xyz')
        db.add(photo); db.commit()
        pid, photo_id = plant.id, photo.id
    engine.dispose()
    env = {**os.environ, 'DATABASE_URL': 'sqlite:///'+str(path)}
    for _ in range(2):
        result = subprocess.run([sys.executable, 'scripts/migrate_v6.py'], env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    engine = build_engine('sqlite:///'+str(path))
    with Session(engine) as db:
        assert db.get(m.Plant, pid).nickname == 'keep plant'
        assert db.get(m.GrowthPhoto, photo_id).image_data == b'abc'
        assert db.get(m.PlantSpecies, 1).source_note == 'Keep this'
        assert db.scalar(select(func.count()).select_from(m.PlantSpecies)) == 108
    engine.dispose()
