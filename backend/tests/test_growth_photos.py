"""Uploaded plant photos: timeline behavior, private media, validation and DB lifetime."""
from datetime import datetime, timedelta
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app import growth_api, growth_images
from app.models import GrowthPhoto, Plant
from app.schemas import KST


API = '/api/v1'


def make_plant(client, headers, **values):
    response = client.post(f'{API}/plants', headers=headers, json={
        'species_id': 1, 'nickname': '생장 기록 식물', **values})
    assert response.status_code == 201, response.text
    return response.json()


def image_bytes(format='JPEG', size=(80, 60), mode='RGB', color='green', **save_options):
    output = BytesIO()
    Image.new(mode, size, color).save(output, format, **save_options)
    return output.getvalue()


def upload(client, headers, plant, *, raw=None, media_type='image/jpeg', filename='leaf.jpg', **values):
    data = {'taken_at': '2026-10-01T10:00:00+09:00', **values}
    data = {key: value for key, value in data.items() if value is not None}
    return client.post(f"{API}/plants/{plant['id']}/growth-photos", headers=headers,
        data=data, files={'file': (filename, image_bytes() if raw is None else raw, media_type)})


def timeline(client, headers, plant, **params):
    response = client.get(f"{API}/plants/{plant['id']}/growth-photos", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_timeline_and_upload_metadata_private_jpegs(context, headers):
    client, factory = context
    plant = make_plant(client, headers)
    assert timeline(client, headers, plant) == {
        'plant_id': plant['id'], 'plant_nickname': plant['nickname'], 'timezone': 'Asia/Seoul',
        'total': 0, 'limit': 50, 'offset': 0, 'has_more': False, 'photos': []}
    response = upload(client, headers, plant, note='  새 잎이 나옴  ')
    assert response.status_code == 201, response.text
    photo = response.json()
    assert photo['plant_id'] == plant['id'] and photo['note'] == '새 잎이 나옴'
    assert photo['taken_at'] == '2026-10-01T10:00:00+09:00' and photo['taken_on'] == '2026-10-01'
    assert photo['created_at'].endswith('+09:00') and photo['content_type'] == 'image/jpeg'
    assert (photo['width'], photo['height']) == (80, 60)
    assert photo['image_url'] == f"{API}/growth-photos/{photo['id']}/image"
    assert photo['thumbnail_url'] == f"{API}/growth-photos/{photo['id']}/thumbnail"
    assert 'image_data' not in photo and 'thumbnail_data' not in photo and 'upload_key' not in photo
    assert client.get(f"{API}/growth-photos/{photo['id']}", headers=headers).json() == photo
    assert timeline(client, headers, plant)['photos'] == [photo]
    for url in [photo['image_url'], photo['thumbnail_url']]:
        media = client.get(url, headers=headers)
        assert media.status_code == 200 and media.headers['content-type'] == 'image/jpeg'
        assert media.headers['cache-control'] == 'private, no-store'
        assert media.headers['x-content-type-options'] == 'nosniff'
        with Image.open(BytesIO(media.content)) as decoded:
            assert decoded.format == 'JPEG' and decoded.mode == 'RGB'
    full = client.get(photo['image_url'], headers=headers).content
    assert len(full) == photo['byte_size']
    # Reopen the same on-disk DB using a separate engine, as after a restart.
    from app.database import build_engine
    engine = build_engine(str(factory.kw['bind'].url))
    with Session(engine) as db:
        saved = db.get(GrowthPhoto, photo['id'])
        assert saved.image_data == full and saved.note == '새 잎이 나옴'
    engine.dispose()


@pytest.mark.parametrize(('format', 'media_type'), [('JPEG', 'image/jpeg'), ('PNG', 'image/png'), ('WEBP', 'image/webp')])
def test_supported_images_and_untrusted_filenames(client, headers, format, media_type):
    plant = make_plant(client, headers)
    # Filename is never interpreted as a server path or trusted for image format.
    response = upload(client, headers, plant, raw=image_bytes(format), media_type=media_type,
                      filename='../../untrusted.svg')
    assert response.status_code == 201, response.text
    media = client.get(response.json()['image_url'], headers=headers)
    with Image.open(BytesIO(media.content)) as decoded:
        assert decoded.format == 'JPEG'


def test_transparent_png_has_white_background(client, headers):
    plant = make_plant(client, headers)
    response = upload(client, headers, plant, raw=image_bytes('PNG', mode='RGBA', color=(0, 0, 0, 0)),
                      media_type='image/png')
    assert response.status_code == 201, response.text
    with Image.open(BytesIO(client.get(response.json()['image_url'], headers=headers).content)) as decoded:
        assert decoded.getpixel((10, 10)) == (255, 255, 255)


def test_camera_orientation_and_exif_are_normalized(client, headers):
    plant = make_plant(client, headers)
    exif = Image.Exif()
    exif[274] = 6
    exif[271] = 'Test camera metadata'
    response = upload(client, headers, plant, raw=image_bytes(size=(80, 40), exif=exif))
    assert response.status_code == 201, response.text
    photo = response.json()
    assert (photo['width'], photo['height']) == (40, 80)
    for url in [photo['image_url'], photo['thumbnail_url']]:
        with Image.open(BytesIO(client.get(url, headers=headers).content)) as decoded:
            assert not decoded.getexif()


def test_full_image_and_thumbnail_are_bounded(client, headers):
    plant = make_plant(client, headers)
    response = upload(client, headers, plant, raw=image_bytes(size=(3000, 1500)))
    assert response.status_code == 201, response.text
    photo = response.json()
    assert (photo['width'], photo['height']) == (2048, 1024)
    with Image.open(BytesIO(client.get(photo['thumbnail_url'], headers=headers).content)) as decoded:
        assert decoded.size == (320, 160)


def test_timeline_uses_capture_time_with_stable_pagination_and_kst_dates(client, headers):
    plant = make_plant(client, headers)
    late = upload(client, headers, plant, taken_at='2026-10-03T10:00:00+09:00').json()
    early = upload(client, headers, plant, taken_at='2026-09-30T16:00:00Z').json()
    same = upload(client, headers, plant, taken_at='2026-10-01T01:00:00+09:00').json()
    assert early['taken_on'] == same['taken_on'] == '2026-10-01'
    first = timeline(client, headers, plant, limit=2)
    assert first['total'] == 3 and first['has_more']
    assert [p['id'] for p in first['photos']] == [early['id'], same['id']]
    last = timeline(client, headers, plant, limit=2, offset=2)
    assert not last['has_more'] and [p['id'] for p in last['photos']] == [late['id']]
    assert timeline(client, headers, plant, order='desc', limit=1)['photos'][0]['id'] == late['id']
    day = timeline(client, headers, plant, start_date='2026-10-01', end_date='2026-10-01')
    assert day['total'] == 2 and [p['id'] for p in day['photos']] == [early['id'], same['id']]
    assert timeline(client, headers, plant, start_date='2026-10-02')['total'] == 1
    assert timeline(client, headers, plant, end_date='2026-10-02')['total'] == 2
    assert timeline(client, headers, plant, offset=100)['photos'] == []


def test_metadata_edit_moves_timeline_without_changing_image(client, headers):
    plant = make_plant(client, headers)
    photo = upload(client, headers, plant, note='원래 메모').json()
    url = f"{API}/growth-photos/{photo['id']}"
    original = client.get(photo['image_url'], headers=headers).content
    response = client.patch(url, headers=headers, json={'note': '  잎이 자랐음  '})
    assert response.status_code == 200, response.text
    assert response.json()['taken_at'] == photo['taken_at'] and response.json()['note'] == '잎이 자랐음'
    response = client.patch(url, headers=headers, json={'taken_at': '2026-10-02T16:00:00Z'})
    assert response.json()['taken_at'] == '2026-10-03T01:00:00+09:00'
    assert response.json()['note'] == '잎이 자랐음'
    assert timeline(client, headers, plant, end_date='2026-10-01')['total'] == 0
    assert timeline(client, headers, plant, start_date='2026-10-03')['total'] == 1
    assert client.get(photo['image_url'], headers=headers).content == original
    assert client.patch(url, headers=headers, json={'note': None}).json()['note'] is None


def test_server_date_default_and_idempotent_upload_retries(context, headers):
    client, factory = context
    plant = make_plant(client, headers)
    auth = {**headers, 'Idempotency-Key': 'mobile-upload-123'}
    first = upload(client, auth, plant, taken_at=None, note='새 사진')
    retry = upload(client, auth, plant, taken_at=None, note='새 사진')
    assert first.status_code == retry.status_code == 201
    assert first.json() == retry.json()
    assert first.json()['taken_on'] == datetime.now(KST).date().isoformat()
    assert upload(client, auth, plant, taken_at=None, note='다른 메모').status_code == 409
    assert upload(client, auth, plant, taken_at=None, note='새 사진', raw=image_bytes(color='red')).status_code == 409
    assert upload(client, auth, plant, taken_at='2026-10-01T10:00:00+09:00', note='새 사진').status_code == 409
    other_plant = make_plant(client, headers)
    assert upload(client, auth, other_plant, taken_at=None, note='새 사진').status_code == 201
    # Without a key, multiple photos on one date are intentional and allowed.
    assert upload(client, headers, plant).status_code == 201
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(GrowthPhoto)) == 3
    assert upload(client, {**headers, 'Idempotency-Key': '   '}, plant).status_code == 422


@pytest.mark.parametrize(('raw', 'media_type', 'status'), [
    (b'', 'image/jpeg', 422), (b'not a photo', 'image/jpeg', 422),
    (b'%PDF-1.4\npretend photo', 'image/jpeg', 422),
    (image_bytes()[:30], 'image/jpeg', 422),
    (image_bytes('GIF'), 'image/gif', 415),
    (image_bytes('PNG'), 'image/jpeg', 415),
])
def test_invalid_uploads_create_no_records(context, headers, raw, media_type, status):
    client, factory = context
    plant = make_plant(client, headers)
    response = upload(client, headers, plant, raw=raw, media_type=media_type)
    assert response.status_code == status, response.text
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(GrowthPhoto)) == 0


def test_animation_size_and_pixel_limits(client, headers, monkeypatch):
    plant = make_plant(client, headers)
    output = BytesIO()
    Image.new('RGB', (8, 8), 'red').save(output, 'PNG', save_all=True,
        append_images=[Image.new('RGB', (8, 8), 'blue')], duration=100, loop=0)
    assert upload(client, headers, plant, raw=output.getvalue(), media_type='image/png').status_code == 415
    with monkeypatch.context() as patch:
        patch.setattr(growth_api, 'MAX_UPLOAD_BYTES', 100)
        assert upload(client, headers, plant).status_code == 413
    monkeypatch.setattr(growth_images, 'MAX_IMAGE_PIXELS', 100)
    assert upload(client, headers, plant).status_code == 413


def test_invalid_capture_metadata_and_pagination(client, headers):
    plant = make_plant(client, headers)
    future = (datetime.now(KST) + timedelta(days=1)).isoformat()
    for value in ['invalid', '2026-10-01T10:00:00', future]:
        assert upload(client, headers, plant, taken_at=value).status_code == 422
    assert upload(client, headers, plant, note='x' * 2001).status_code == 422
    photo = upload(client, headers, plant).json()
    url = f"{API}/growth-photos/{photo['id']}"
    for body in [{}, {'taken_at': None}, {'taken_at': future}, {'taken_at': '2026-10-01T10:00:00'},
                 {'plant_id': 123}, {'note': 'x' * 2001}]:
        assert client.patch(url, headers=headers, json=body).status_code == 422
    for params in [{'order': 'invalid'}, {'limit': 0}, {'limit': 101}, {'offset': -1},
                   {'start_date': 'bad'}, {'start_date': '2026-10-03', 'end_date': '2026-10-01'}]:
        assert client.get(f"{API}/plants/{plant['id']}/growth-photos", headers=headers, params=params).status_code == 422


def test_photo_access_is_limited_to_owner(client, headers, other_headers):
    plant = make_plant(client, headers)
    other_plant = make_plant(client, other_headers)
    photo = upload(client, headers, plant).json()
    url = f"{API}/growth-photos/{photo['id']}"
    for auth, expected in [({}, 401), (other_headers, 404)]:
        for path in [url, photo['image_url'], photo['thumbnail_url'], f"{API}/plants/{plant['id']}/growth-photos"]:
            assert client.get(path, headers=auth).status_code == expected
        assert client.patch(url, headers=auth, json={'note': 'tamper'}).status_code == expected
        assert client.delete(url, headers=auth).status_code == expected
        assert upload(client, auth, plant).status_code == expected
    assert timeline(client, other_headers, other_plant)['photos'] == []
    assert client.get(url, headers=headers).json()['note'] is None
    assert client.get(f'{API}/growth-photos/999999/image', headers=headers).status_code == 404


def test_deletion_and_parent_lifetime(context, headers):
    client, factory = context
    from test_api import example
    room = client.post(f'{API}/rooms', headers=headers, json=example('room')).json()
    plant = make_plant(client, headers, room_id=room['id'], position={'x': 1, 'y': 0, 'z': 1})
    first = upload(client, headers, plant).json()
    second = upload(client, headers, plant).json()
    assert client.delete(f"{API}/growth-photos/{first['id']}", headers=headers).status_code == 204
    assert client.get(first['image_url'], headers=headers).status_code == 404
    assert client.get(first['thumbnail_url'], headers=headers).status_code == 404
    assert timeline(client, headers, plant)['total'] == 1
    assert client.delete(f"{API}/rooms/{room['id']}", headers=headers).status_code == 204
    assert client.get(second['image_url'], headers=headers).status_code == 200
    assert client.delete(f"{API}/plants/{plant['id']}", headers=headers).status_code == 204
    assert client.get(second['image_url'], headers=headers).status_code == 404
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(GrowthPhoto)) == 0


def test_metadata_queries_do_not_load_binary_columns(context, headers):
    client, factory = context
    plant = make_plant(client, headers)
    photo = upload(client, headers, plant).json()
    statements = []
    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement.lower())
    engine = factory.kw['bind']
    event.listen(engine, 'before_cursor_execute', record)
    try:
        assert timeline(client, headers, plant)['total'] == 1
        assert client.get(f"{API}/growth-photos/{photo['id']}", headers=headers).status_code == 200
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    assert any('growth_photos' in statement for statement in statements)
    assert all('image_data' not in statement and 'thumbnail_data' not in statement for statement in statements)


def test_existing_database_upgrade_is_additive(context, headers):
    client, factory = context
    plant = make_plant(client, headers, watering_interval_days=12, last_watered_at='2026-10-01')
    from scripts.migrate_v4 import migrate
    from sqlalchemy import text
    engine = factory.kw['bind']
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE growth_photos'))
    migrate(engine.url.database)
    migrate(engine.url.database)
    response = upload(client, headers, plant)
    assert response.status_code == 201, response.text
    with factory() as db:
        saved = db.get(Plant, plant['id'])
        assert saved.nickname == plant['nickname'] and saved.watering_interval_days == 12
        assert saved.last_watered_at.isoformat() == '2026-10-01'
    assert client.get(response.json()['image_url'], headers=headers).status_code == 200
