"""Calendar behavior, persisted care history, repeat rules and user isolation."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import calendar_service as service
from app.models import CareOccurrence, CareSchedule, Plant, WateringRecord
from app.schemas import KST


API = '/api/v1'


def make_plant(client, headers, **values):
    response = client.post(f'{API}/plants', headers=headers, json={
        'species_id': 1, 'nickname': '몬스테라 1호',
        'last_watered_at': '2026-10-01', 'watering_interval_days': 7, **values})
    assert response.status_code == 201, response.text
    return response.json()


def make_schedule(client, headers, plant, **values):
    response = client.post(f"{API}/plants/{plant['id']}/care-schedules", headers=headers, json={
        'task_type': 'FERTILIZING', 'start_date': '2026-10-03', 'interval_days': 7, **values})
    assert response.status_code == 201, response.text
    return response.json()


def calendar(client, headers, **params):
    response = client.get(f'{API}/calendar', headers=headers, params={
        'start_date': '2026-10-01', 'end_date': '2026-10-31', **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_month_dots_cards_and_single_day_match(client, headers):
    plant = make_plant(client, headers)
    second = make_plant(client, headers, nickname='두 번째 식물', watering_interval_days=14)
    result = calendar(client, headers)
    assert result['timezone'] == 'Asia/Seoul'
    assert result['today'] == datetime.now(KST).date().isoformat()
    assert len(result['days']) == 31
    first = [event for event in result['events'] if event['plant_id'] == plant['id']]
    assert [(e['date'], e['status']) for e in first] == [
        ('2026-10-01', 'COMPLETED'), ('2026-10-08', 'PENDING'),
        ('2026-10-15', 'PENDING'), ('2026-10-22', 'PENDING'), ('2026-10-29', 'PENDING')]
    event = first[1]
    assert event['plant_nickname'] == '몬스테라 1호'
    assert event['species_name'] == 'Test species' and event['species_id'] == 1
    assert event['room_id'] is None and event['schedule_id'] is None
    assert event['is_overdue'] and event['event_id'] == f"watering:{plant['id']}:2026-10-08"
    assert result['days'][14]['total_count'] == 2
    assert result['days'][14]['pending_count'] == 2
    assert result['days'][14]['task_types'] == ['WATERING']
    assert result['days'][1]['total_count'] == 0
    daily = calendar(client, headers, start_date='2026-10-15', end_date='2026-10-15')
    assert daily['events'] == [e for e in result['events'] if e['date'] == '2026-10-15']
    assert {e['plant_id'] for e in daily['events']} == {plant['id'], second['id']}


def test_watering_records_reschedule_and_retry_are_persistent(context, headers):
    client, factory = context
    plant = make_plant(client, headers)
    url = f"{API}/plants/{plant['id']}/waterings"
    for day in ['2026-10-10', '2026-10-10', '2026-10-05']:
        response = client.post(url, headers=headers, json={'watered_at': day})
        assert response.status_code == 200, response.text
        assert response.json()['last_watered_at'] == '2026-10-10'
    result = calendar(client, headers)
    assert [e['date'] for e in result['events'] if e['status'] == 'COMPLETED'] == [
        '2026-10-01', '2026-10-05', '2026-10-10']
    assert [e['date'] for e in result['events'] if e['status'] == 'PENDING'] == [
        '2026-10-17', '2026-10-24', '2026-10-31']
    history = client.get(url, headers=headers).json()
    assert [row['watered_at'] for row in history] == ['2026-10-10', '2026-10-05', '2026-10-01']
    assert len(client.get(url, headers=headers, params={'limit': 1, 'offset': 1}).json()) == 1
    bounded = client.get(url, headers=headers, params={'start_date': '2026-10-04', 'end_date': '2026-10-09'})
    assert [row['watered_at'] for row in bounded.json()] == ['2026-10-05']
    assert client.get(url, headers=headers, params={'start_date': '2026-10-09', 'end_date': '2026-10-04'}).status_code == 422
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(WateringRecord)) == 3
        assert db.get(Plant, plant['id']).last_watered_at == date(2026, 10, 10)


def test_interval_update_preserves_plant_and_recalculates(client, headers):
    plant = make_plant(client, headers)
    url = f"{API}/plants/{plant['id']}/watering-schedule"
    response = client.put(url, headers=headers, json={'watering_interval_days': 10})
    assert response.status_code == 200, response.text
    assert response.json() == {**plant, 'watering_interval_days': 10}
    assert [e['date'] for e in calendar(client, headers)['events'] if e['status'] == 'PENDING'] == [
        '2026-10-11', '2026-10-21', '2026-10-31']
    assert client.put(url, headers=headers, json={'watering_interval_days': 0}).status_code == 422


def test_no_watering_record_uses_registration_date_in_kst(context, headers):
    client, factory = context
    plant = make_plant(client, headers, last_watered_at=None)
    with factory() as db:
        # October 1 UTC is already October 2 in Seoul.
        db.get(Plant, plant['id']).created_at = datetime(2026, 10, 1, 16, tzinfo=timezone.utc)
        db.commit()
    result = calendar(client, headers)
    assert [e['date'] for e in result['events']] == ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']
    assert all(e['status'] == 'PENDING' for e in result['events'])


def test_repeat_one_off_and_end_date(client, headers):
    plant = make_plant(client, headers)
    repeat = make_schedule(client, headers, plant, end_date='2026-10-17', note='물을 준 뒤 확인')
    one = make_schedule(client, headers, plant, task_type='REPOTTING', start_date='2026-10-13', interval_days=None)
    events = calendar(client, headers)['events']
    repeated = [e for e in events if e['schedule_id'] == repeat['id']]
    assert [e['date'] for e in repeated] == ['2026-10-03', '2026-10-10', '2026-10-17']
    assert repeated[0]['title'] == '비료 주기' and repeated[0]['note'] == '물을 준 뒤 확인'
    assert [e['date'] for e in events if e['schedule_id'] == one['id']] == ['2026-10-13']
    assert len(client.get(f"{API}/plants/{plant['id']}/care-schedules", headers=headers).json()) == 2
    assert client.get(f"{API}/care-schedules/{one['id']}", headers=headers).json() == one


def test_complete_skip_undo_and_snapshot_survive_schedule_edits(context, headers):
    client, factory = context
    plant = make_plant(client, headers)
    schedule = make_schedule(client, headers, plant)
    url = f"{API}/care-schedules/{schedule['id']}"
    done = {'status': 'COMPLETED', 'completed_on': '2026-10-04', 'note': '완료 기록'}
    first = client.put(url + '/occurrences/2026-10-03', headers=headers, json=done)
    retry = client.put(url + '/occurrences/2026-10-03', headers=headers, json=done)
    assert first.status_code == retry.status_code == 200
    assert first.json() == retry.json()
    retry_without_date = client.put(url + '/occurrences/2026-10-03', headers=headers,
                                    json={'status': 'COMPLETED', 'note': '완료 기록'})
    assert retry_without_date.json()['completed_on'] == '2026-10-04'
    assert client.put(url + '/occurrences/2026-10-10', headers=headers, json={'status': 'SKIPPED'}).status_code == 200
    result = calendar(client, headers, task_type='FERTILIZING')
    assert [(e['date'], e['status']) for e in result['events']][:2] == [
        ('2026-10-03', 'COMPLETED'), ('2026-10-10', 'SKIPPED')]
    assert result['days'][2]['completed_count'] == 1 and result['days'][9]['skipped_count'] == 1
    assert not any(e['is_overdue'] for e in result['events'][:2])
    assert client.delete(url + '/occurrences/2026-10-10', headers=headers).status_code == 204
    assert client.delete(url + '/occurrences/2026-10-10', headers=headers).status_code == 204
    assert calendar(client, headers, task_type='FERTILIZING')['events'][1]['status'] == 'PENDING'
    # Changing the rule retains the old completed occurrence with its original meaning.
    changed = {'task_type': 'PRUNING', 'title': '새 일정', 'start_date': '2026-10-20', 'active': False}
    assert client.put(url, headers=headers, json=changed).status_code == 200
    archived = calendar(client, headers, task_type='FERTILIZING')['events']
    assert len(archived) == 1 and archived[0]['title'] == '비료 주기'
    assert archived[0]['completed_on'] == '2026-10-04' and archived[0]['note'] == '완료 기록'
    assert not calendar(client, headers, task_type='PRUNING')['events']
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(CareOccurrence)) == 1
    assert client.delete(url, headers=headers).status_code == 204
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(CareOccurrence)) == 0
    assert not calendar(client, headers, task_type='FERTILIZING')['events']


def test_completion_defaults_to_kst_today_and_allows_early_care(client, headers):
    plant = make_plant(client, headers)
    tomorrow = (datetime.now(KST).date() + timedelta(days=1)).isoformat()
    schedule = make_schedule(client, headers, plant, start_date=tomorrow, interval_days=None)
    url = f"{API}/care-schedules/{schedule['id']}/occurrences/{tomorrow}"
    result = client.put(url, headers=headers, json={'status': 'COMPLETED'})
    assert result.status_code == 200, result.text
    assert result.json()['completed_on'] == datetime.now(KST).date().isoformat()


@pytest.mark.parametrize('body', [
    {'interval_days': 0}, {'interval_days': -1}, {'interval_days': True},
    {'interval_days': '7'}, {'interval_days': 1.5}, {'interval_days': 3651},
    {'task_type': 'WATERING'}, {'task_type': 'INVALID'}, {'title': '  '},
    {'end_date': '2026-10-02'}, {'active': 'false'}, {'user_id': 999},
])
def test_bad_schedule_requests(client, headers, body):
    plant = make_plant(client, headers)
    response = client.post(f"{API}/plants/{plant['id']}/care-schedules", headers=headers, json={
        'task_type': 'FERTILIZING', 'start_date': '2026-10-03', **body})
    assert response.status_code == 422, response.text


def test_invalid_occurrences_and_future_actual_completion(client, headers):
    plant = make_plant(client, headers)
    schedule = make_schedule(client, headers, plant, end_date='2026-10-17')
    url = f"{API}/care-schedules/{schedule['id']}"
    for day in ['2026-10-02', '2026-10-04', '2026-10-24']:
        assert client.put(url + '/occurrences/' + day, headers=headers, json={'status': 'COMPLETED'}).status_code == 422
    for body in [
        {'status': 'PENDING'}, {'status': 'SKIPPED', 'completed_on': '2026-10-03'},
        {'status': 'COMPLETED', 'completed_on': (datetime.now(KST).date() + timedelta(days=1)).isoformat()},
    ]:
        assert client.put(url + '/occurrences/2026-10-03', headers=headers, json=body).status_code == 422
    values = {k: v for k, v in schedule.items() if k not in ('id', 'plant_id')}
    client.put(url, headers=headers, json={**values, 'active': False})
    assert client.put(url + '/occurrences/2026-10-03', headers=headers, json={'status': 'SKIPPED'}).status_code == 422


def test_calendar_filters_empty_days_and_ownership(client, headers, other_headers):
    plant = make_plant(client, headers)
    make_plant(client, other_headers, nickname='다른 사용자의 식물')
    schedule = make_schedule(client, headers, plant)
    filtered = calendar(client, headers, task_type='WATERING', status='COMPLETED', plant_id=plant['id'])
    assert len(filtered['events']) == 1 and len(filtered['days']) == 31
    assert sum(day['total_count'] for day in filtered['days']) == 1
    assert {e['plant_id'] for e in calendar(client, headers)['events']} == {plant['id']}
    assert client.get(f'{API}/calendar').status_code == 401
    params = {'start_date': '2026-10-01', 'end_date': '2026-10-31', 'plant_id': plant['id']}
    assert client.get(f'{API}/calendar', headers=other_headers, params=params).status_code == 404
    url = f"{API}/care-schedules/{schedule['id']}"
    for method, path, body in [
        ('get', url, None), ('put', url, {'task_type': 'OTHER', 'start_date': '2026-10-03'}),
        ('delete', url, None), ('put', url + '/occurrences/2026-10-03', {'status': 'SKIPPED'}),
        ('delete', url + '/occurrences/2026-10-03', None),
        ('get', f"{API}/plants/{plant['id']}/waterings", None),
        ('get', f"{API}/plants/{plant['id']}/care-schedules", None),
        ('put', f"{API}/plants/{plant['id']}/watering-schedule", {'watering_interval_days': 3}),
        ('post', f"{API}/plants/{plant['id']}/care-schedules", {'task_type': 'OTHER', 'start_date': '2026-10-03'}),
    ]:
        kwargs = {'json': body} if body is not None else {}
        assert client.request(method, path, headers=other_headers, **kwargs).status_code == 404
    assert client.get(url, headers=headers).status_code == 200


def test_room_filter_and_room_deletion_keep_care_events(client, headers, other_headers):
    from test_api import example
    response = client.post(f'{API}/rooms', headers=headers, json=example('room'))
    assert response.status_code == 201, response.text
    room = response.json()
    plant = make_plant(client, headers, room_id=room['id'], position={'x': 1, 'y': 0, 'z': 1})
    make_plant(client, headers)
    make_schedule(client, headers, plant)
    assert {e['plant_id'] for e in calendar(client, headers, room_id=room['id'])['events']} == {plant['id']}
    assert client.get(f'{API}/calendar', headers=other_headers, params={
        'start_date': '2026-10-01', 'end_date': '2026-10-31', 'room_id': room['id']}).status_code == 404
    assert client.delete(f"{API}/rooms/{room['id']}", headers=headers).status_code == 204
    events = calendar(client, headers, plant_id=plant['id'])['events']
    assert events and all(e['room_id'] is None for e in events)


def test_plant_deletion_cascades_records(context, headers):
    client, factory = context
    plant = make_plant(client, headers)
    schedule = make_schedule(client, headers, plant)
    client.put(f"{API}/care-schedules/{schedule['id']}/occurrences/2026-10-03", headers=headers,
               json={'status': 'COMPLETED'})
    assert client.delete(f"{API}/plants/{plant['id']}", headers=headers).status_code == 204
    assert not calendar(client, headers)['events']
    with factory() as db:
        for model in [WateringRecord, CareSchedule, CareOccurrence]:
            assert db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize('params', [
    {'start_date': '2026-11-01', 'end_date': '2026-10-01'},
    {'start_date': '2026-01-01', 'end_date': '2027-01-02'},
    {'start_date': 'invalid'}, {'task_type': 'bad'}, {'status': 'bad'}, {'plant_id': 0},
])
def test_invalid_calendar_range_and_filters(client, headers, params):
    response = client.get(f'{API}/calendar', headers=headers, params={
        'start_date': '2026-10-01', 'end_date': '2026-10-31', **params})
    assert response.status_code == 422


def test_calendar_empty_year_leap_days_and_event_limit(client, headers, monkeypatch):
    empty = calendar(client, headers, start_date='2024-01-01', end_date='2024-12-31')
    assert not empty['events'] and len(empty['days']) == 366
    plant = make_plant(client, headers, last_watered_at='2024-02-28', watering_interval_days=2)
    result = calendar(client, headers, start_date='2024-02-28', end_date='2024-03-02')
    assert [e['date'] for e in result['events']] == ['2024-02-28', '2024-03-01']
    assert [d['date'] for d in result['days']] == ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']
    make_schedule(client, headers, plant, start_date='9999-12-30', interval_days=1)
    far = calendar(client, headers, start_date='9999-12-30', end_date='9999-12-31', task_type='FERTILIZING')
    assert [e['date'] for e in far['events']] == ['9999-12-30', '9999-12-31']
    monkeypatch.setattr(service, 'MAX_CALENDAR_EVENTS', 2)
    response = client.get(f'{API}/calendar', headers=headers, params={
        'start_date': '2026-10-01', 'end_date': '2026-10-31'})
    assert response.status_code == 422 and 'Too many' in response.json()['detail']


def test_old_last_date_backfill_and_correction_keep_known_history(context, headers):
    client, factory = context
    plant = make_plant(client, headers, last_watered_at=None)
    with factory() as db:
        db.get(Plant, plant['id']).last_watered_at = date(2026, 10, 1)
        db.commit()
        service.backfill_waterings(db)
        db.commit()
        service.backfill_waterings(db)
        db.commit()
        assert db.scalar(select(func.count()).select_from(WateringRecord)) == 1
    client.post(f"{API}/plants/{plant['id']}/waterings", headers=headers, json={'watered_at': '2026-10-10'})
    # Existing full PUT still allows an explicit correction, without erasing history.
    client.put(f"{API}/plants/{plant['id']}", headers=headers, json={
        'nickname': '이름 수정', 'species_id': 1, 'last_watered_at': '2026-10-05'})
    assert client.get(f"{API}/plants/{plant['id']}", headers=headers).json()['last_watered_at'] == '2026-10-05'
    assert [e['date'] for e in calendar(client, headers, status='COMPLETED')['events']] == [
        '2026-10-01', '2026-10-05', '2026-10-10']


def test_watering_insert_rolls_back_with_outer_transaction(context, headers):
    client, factory = context
    plant = make_plant(client, headers, last_watered_at=None)
    with factory() as db:
        service.record_watering(db, db.get(Plant, plant['id']), date(2026, 10, 1))
        db.rollback()
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(WateringRecord)) == 0
        assert db.get(Plant, plant['id']).last_watered_at is None


def test_kst_today_and_overdue_change_at_utc_1500(client, headers, monkeypatch):
    make_plant(client, headers, last_watered_at='2026-11-01', watering_interval_days=1)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 2, 15, 1, tzinfo=timezone.utc).astimezone(tz)
    monkeypatch.setattr(service, 'datetime', Clock)
    result = calendar(client, headers, start_date='2026-11-02', end_date='2026-11-03')
    assert result['today'] == '2026-11-03'
    assert [e['is_overdue'] for e in result['events']] == [True, False]


def test_legacy_database_upgrade_adds_tables_and_preserves_plants(tmp_path):
    import sqlite3
    from sqlalchemy.orm import Session
    from app.database import Base, build_engine
    from app.models import PlantSpecies, User
    from scripts.migrate_v4 import migrate

    target = tmp_path / 'legacy.db'
    engine = build_engine('sqlite:///' + str(target))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(email='legacy@example.com', password_hash='unused', nickname='기존 사용자')
        species = PlantSpecies(name='기존 종류', min_dli=2, max_dli=6)
        db.add_all([user, species])
        db.flush()
        db.add(Plant(id=42, user_id=user.id, species_id=species.id, nickname='기존 식물',
                     watering_interval_days=10, last_watered_at=date(2026, 10, 20)))
        db.commit()
    engine.dispose()
    with sqlite3.connect(target) as connection:
        for table in ['care_occurrences', 'care_schedules', 'watering_records']:
            connection.execute(f'DROP TABLE {table}')
    migrate(target)
    migrate(target)
    with sqlite3.connect(target) as connection:
        assert connection.execute('SELECT id,nickname,watering_interval_days,last_watered_at FROM plants').fetchone() == (
            42, '기존 식물', 10, '2026-10-20')
        assert connection.execute('SELECT plant_id,watered_at FROM watering_records').fetchall() == [(42, '2026-10-20')]
    assert len(list(tmp_path.glob('*.bak'))) == 2
