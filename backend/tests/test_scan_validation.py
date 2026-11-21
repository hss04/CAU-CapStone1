"""Scan compatibility and rejection cases at the metadata/multipart boundary."""
from copy import deepcopy
import io
import json

from PIL import Image
from pydantic import ValidationError
import pytest

from app import integration as i
from test_integration import make_room


def metadata(azimuths=None, facing=180):
    if azimuths is None:
        azimuths = list(range(120, 241, 15))  # 120 degrees, nine photographs.
    return {
        'window_id': 1,
        'captured_at': '2026-11-21T12:00:00+09:00',
        'declination_deg': -8.7,
        'window_azimuth_deg': facing,
        'window_azimuth_mag_deg': (facing + 8.7) % 360,
        'camera': {'width': 64, 'height': 1280, 'hfov_deg': 38, 'vfov_deg': 70},
        'frames': [
            {'index': n, 'file': f'frame_{n:02d}.jpg', 'azimuth_deg': angle,
             'azimuth_mag_deg': (angle + 8.7) % 360, 'pitch_deg': 30, 'roll_deg': 0}
            for n, angle in enumerate(azimuths)
        ],
    }


@pytest.mark.parametrize('azimuths,facing', [
    ([172.5, 187.5], 180),
    (list(range(135, 226, 15)), 180),
    (list(range(120, 241, 15)), 180),
    (list(range(105, 256, 15)), 180),
    (list(range(90, 271, 15)), 180),
    ([305, 320, 335, 350, 5, 20, 35, 50, 65], 5),
])
def test_model_accepts_centered_scans_and_north_crossing(azimuths, facing):
    body = i.Scan.model_validate(metadata(azimuths, facing))
    assert [frame.azimuth_deg for frame in body.frames] == azimuths


@pytest.mark.parametrize('offset', [-5, 5, -5.01, 5.01])
def test_frame_angle_tolerance_remains_five_degrees(offset):
    body = metadata()
    body['frames'][0]['azimuth_deg'] += offset
    body['frames'][0]['azimuth_mag_deg'] += offset
    if abs(offset) <= 5:
        i.Scan.model_validate(body)
    else:
        with pytest.raises(ValidationError, match='Frame angles'):
            i.Scan.model_validate(body)


@pytest.mark.parametrize('fault', [
    'duplicate_index', 'negative_index', 'index_outside_count', 'duplicate_filename',
    'wrong_start', 'magnetic_mismatch', 'wrong_timezone',
])
def test_invalid_scan_metadata_is_rejected(fault):
    body = metadata()
    if fault == 'duplicate_index':
        body['frames'][-1]['index'] = 0
    elif fault == 'negative_index':
        body['frames'][0]['index'] = -1
    elif fault == 'index_outside_count':
        body['frames'][-1]['index'] = 9
    elif fault == 'duplicate_filename':
        body['frames'][-1]['file'] = body['frames'][0]['file']
    elif fault == 'wrong_start':
        body = metadata(list(range(90, 211, 15)))  # Nine images starting at -90.
    elif fault == 'magnetic_mismatch':
        body['frames'][0]['azimuth_mag_deg'] += 1.01
    elif fault == 'wrong_timezone':
        body['captured_at'] = '2026-11-21T12:00:00+00:00'
    with pytest.raises(ValidationError):
        i.Scan.model_validate(body)


@pytest.mark.parametrize('count', [0, 1, 14])
def test_degenerate_and_over_180_degree_scans_are_rejected(count):
    body = metadata()
    body['frames'] = [deepcopy(body['frames'][0]) for _ in range(count)]
    with pytest.raises(ValidationError, match='frames'):
        i.Scan.model_validate(body)


def test_frame_list_may_arrive_out_of_index_order():
    body = metadata()
    body['frames'].reverse()
    i.Scan.model_validate(body)


@pytest.mark.parametrize('fault', ['missing', 'extra', 'duplicate', 'mismatched_name'])
def test_multipart_files_must_match_metadata(client, headers, monkeypatch, tmp_path, fault):
    rid = make_room(client, headers)
    window = client.get(f'/api/v1/rooms/{rid}/windows', headers=headers).json()[0]
    body = metadata()
    body['window_id'] = window['id']
    monkeypatch.setattr(i, 'UPLOAD_ROOT', tmp_path)
    calls = []
    monkeypatch.setattr(i, 'invoke', lambda *args: calls.append(args))
    image = io.BytesIO()
    Image.new('RGB', (64, 1280)).save(image, 'JPEG')
    files = [('files', (frame['file'], image.getvalue(), 'image/jpeg')) for frame in body['frames']]
    if fault == 'missing':
        files.pop()
    elif fault == 'extra':
        files.append(('files', ('extra.jpg', image.getvalue(), 'image/jpeg')))
    elif fault == 'duplicate':
        files[-1] = files[0]
    elif fault == 'mismatched_name':
        files[-1] = ('files', ('wrong.jpg', image.getvalue(), 'image/jpeg'))
    response = client.post(f"/api/v1/windows/{window['id']}/scans", headers=headers,
                           data={'metadata': json.dumps(body)}, files=files)
    assert response.status_code == 422, response.text
    assert 'matching JPEG files required' in response.json()['detail']
    assert not calls
    assert not list(tmp_path.rglob('*.jpg'))
