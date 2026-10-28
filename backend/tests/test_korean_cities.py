"""City selection is deterministic, Korean-only and usable without a geocoder."""

import json
from pathlib import Path
import unicodedata

import pytest

from app import integration
from app.integration_models import IntegrationJob
from app.korean_cities import search_cities


def no_geocoder(*args, **kwargs):
    raise AssertionError('Known Korean cities must not call an external geocoder')


@pytest.mark.parametrize(('q', 'expected'), [
    ('서울', '서울특별시'), ('서울시', '서울특별시'), ('서울특별시', '서울특별시'),
    ('부산', '부산광역시'), ('부산광역시', '부산광역시'),
    ('대구', '대구광역시'), ('인천', '인천광역시'), ('대전', '대전광역시'),
    ('울산', '울산광역시'), ('세종', '세종특별자치시'),
    ('수원', '수원시'), ('수원특례시', '수원시'), ('강릉', '강릉시'),
    ('청주', '청주시'), ('천안', '천안시'), ('전주', '전주시'),
    ('목포', '목포시'), ('포항', '포항시'), ('창원', '창원시'),
    ('제주', '제주시'), ('서귀포', '서귀포시'),
    ('  서울  ', '서울특별시'), ('BUSAN', '부산광역시'),
    ('suwon-si', '수원시'), (unicodedata.normalize('NFD', '서울'), '서울특별시'),
])
def test_city_aliases_do_not_need_network(client, headers, monkeypatch, q, expected):
    monkeypatch.setattr(integration, 'fetch_raw', no_geocoder)
    response = client.get('/api/v1/locations/search', params={'q': q}, headers=headers)
    assert response.status_code == 200, response.text
    results = response.json()['results']
    assert [item['name'] for item in results] == [expected]
    assert results[0]['country_code'] == 'KR'
    assert results[0]['timezone'] == 'Asia/Seoul'
    assert results[0]['coordinate_basis'] == 'CITY_REPRESENTATIVE'


def test_catalogue_covers_regions_and_only_cities(client, headers):
    response = client.get('/api/v1/locations/cities', headers=headers)
    assert response.status_code == 200
    cities = response.json()['results']
    assert len(cities) == 85
    assert len({city['id'] for city in cities}) == 85
    assert len({city['display_name'] for city in cities}) == 85
    assert {'서울특별시', '부산광역시', '광주광역시', '광주시', '수원시', '제주시', '서귀포시'} <= {city['name'] for city in cities}
    assert {city['admin1'] for city in cities} == {
        '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
        '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도',
        '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
    }
    for city in cities:
        assert city['name'].endswith('시')
        assert city['country_code'] == 'KR'
        assert 33 <= city['latitude'] <= 39
        assert 124 <= city['longitude'] <= 130
        assert city['timezone'] == 'Asia/Seoul'


def test_gwangju_homonyms_are_both_returned_and_can_be_disambiguated(client, headers, monkeypatch):
    monkeypatch.setattr(integration, 'fetch_raw', no_geocoder)
    for q in ['광주', '광주시', 'Gwangju']:
        results = client.get('/api/v1/locations/search', params={'q': q}, headers=headers).json()['results']
        assert {city['name'] for city in results} == {'광주광역시', '광주시'}
        assert len({city['id'] for city in results}) == 2
    for q, name in [('광주광역시', '광주광역시'), ('경기도 광주시', '광주시'), ('경기광주', '광주시')]:
        results = client.get('/api/v1/locations/search', params={'q': q}, headers=headers).json()['results']
        assert [city['name'] for city in results] == [name]
    response = client.get('/api/v1/locations/cities', params={'q': '광주', 'admin1': '경기'}, headers=headers)
    assert [city['display_name'] for city in response.json()['results']] == ['경기도 광주시']


def test_city_list_supports_prefixes_and_province_filters(client, headers, monkeypatch):
    monkeypatch.setattr(integration, 'fetch_raw', no_geocoder)
    results = client.get('/api/v1/locations/cities', params={'q': '광'}, headers=headers).json()['results']
    assert {city['name'] for city in results} == {'광명시', '광양시', '광주광역시', '광주시'}
    results = client.get('/api/v1/locations/cities', params={'admin1': '경기도'}, headers=headers).json()['results']
    assert len(results) == 28
    assert {city['admin1'] for city in results} == {'경기도'}
    assert client.get('/api/v1/locations/cities', params={'q': '없는도시'}, headers=headers).json() == {'results': []}
    assert client.get('/api/v1/locations/cities', params={'admin1': '없는지역'}, headers=headers).json() == {'results': []}


@pytest.mark.parametrize('path', ['/api/v1/locations/cities', '/api/v1/locations/search?q=서울'])
def test_location_endpoints_require_login(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize('path,params', [
    ('/api/v1/locations/cities', {'q': ''}),
    ('/api/v1/locations/cities', {'q': '  '}),
    ('/api/v1/locations/cities', {'admin1': '  '}),
    ('/api/v1/locations/search', {'q': '  '}),
    ('/api/v1/locations/search', {'q': ' 서 '}),
])
def test_blank_searches_are_rejected(client, headers, path, params):
    assert client.get(path, params=params, headers=headers).status_code == 422


def test_generic_search_fallback_is_restricted_to_korea(client, headers, monkeypatch):
    calls = []
    def geocoder(url, params):
        calls.append((url, params))
        return {'results': [
            {'id': 1, 'name': '노원구', 'country_code': 'KR', 'latitude': 37.65, 'longitude': 127.05},
            {'id': 2, 'name': 'Foreign homonym', 'country_code': 'US'},
            {'id': 3, 'name': 'Missing country'},
        ]}
    monkeypatch.setattr(integration, 'fetch_raw', geocoder)
    response = client.get('/api/v1/locations/search', params={'q': '노원구'}, headers=headers)
    assert response.status_code == 200
    assert [item['id'] for item in response.json()['results']] == [1]
    assert calls[0][1] == {'name': '노원구', 'count': 10, 'language': 'ko', 'format': 'json', 'countryCode': 'KR'}


def test_city_id_saves_coordinates_and_invalidates_light_results(context, headers, other_headers, monkeypatch):
    client, factory = context
    monkeypatch.setattr(integration, 'fetch_raw', no_geocoder)
    measurement = json.loads(Path('examples/ar-room-v3.json').read_text())
    room = client.post('/api/v1/rooms/import-ar', json=measurement, headers=headers).json()
    rid = room['id']
    seoul = search_cities('서울')[0]
    busan = search_cities('부산')[0]
    url = f'/api/v1/rooms/{rid}/location'
    with factory() as db:
        db.add_all([
            IntegrationJob(id='city-dli', user_id=room['user_id'], room_id=rid, kind='DLI', status='COMPLETED', payload={}),
            IntegrationJob(id='city-series', user_id=room['user_id'], room_id=rid, kind='DLI_SERIES', status='COMPLETED', payload={}),
            IntegrationJob(id='city-scan', user_id=room['user_id'], room_id=rid, kind='SCAN', status='COMPLETED', payload={}),
        ])
        db.commit()
    response = client.put(url, json={'city_id': seoul.id}, headers=headers)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved['latitude'], saved['longitude']) == (seoul.latitude, seoul.longitude)
    assert saved['location_name'] == seoul.display_name
    assert saved['geometry_version'] == room['geometry_version']
    with factory() as db:
        assert db.get(IntegrationJob, 'city-dli').status == 'STALE'
        assert db.get(IntegrationJob, 'city-series').status == 'STALE'
        assert db.get(IntegrationJob, 'city-scan').status == 'COMPLETED'
    assert client.put(url, json={'city_id': busan.id}, headers=other_headers).status_code == 404
    for payload, status in [({'city_id': 999999999}, 404), ({'city_id': -1}, 422),
                            ({'city_id': True}, 422), ({'city_id': seoul.id, 'latitude': 35, 'longitude': 128}, 422)]:
        assert client.put(url, json=payload, headers=headers).status_code == status
    assert client.get(f'/api/v1/rooms/{rid}', headers=headers).json()['location_name'] == seoul.display_name
    # The existing latitude/longitude request remains supported.
    assert client.put(url, json={'latitude': 35, 'longitude': 128, 'location_name': '직접 위치'}, headers=headers).status_code == 200


def test_saving_same_city_preserves_completed_light_results(context, headers):
    client, factory = context
    measurement = json.loads(Path('examples/ar-room-v3.json').read_text())
    room = client.post('/api/v1/rooms/import-ar', json=measurement, headers=headers).json()
    city = search_cities('경기 광주')[0]
    url = f"/api/v1/rooms/{room['id']}/location"
    assert client.put(url, json={'city_id': city.id}, headers=headers).status_code == 200
    with factory() as db:
        db.add(IntegrationJob(id='same-city-dli', user_id=room['user_id'], room_id=room['id'], kind='DLI', status='COMPLETED', payload={}))
        db.commit()
    assert client.put(url, json={'city_id': city.id}, headers=headers).status_code == 200
    with factory() as db:
        assert db.get(IntegrationJob, 'same-city-dli').status == 'COMPLETED'
