import copy
import json
import math
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import Room, Window
from app.schemas import round_m
from scripts.migrate_v3 import migrate

EXAMPLE=Path(__file__).resolve().parents[1]/'examples/ar-room-v3.json'


def body():
    return json.loads(EXAMPLE.read_text())


def test_ar_import_export_and_owner_isolation(context,headers,other_headers):
    client,factory=context
    payload=body()
    response=client.post('/api/v1/rooms/import-ar?name=Measured',headers=headers,json=payload)
    assert response.status_code==201,response.text
    room=response.json()
    assert room['coordinate_system']==payload['coordinate_system']
    assert room['x_axis_azimuth_deg'] is None
    assert room['area_square_meters']==12
    assert room['perimeter_meters']==14
    path=f"/api/v1/rooms/{room['id']}/ar-measurement"
    assert client.get(path,headers=headers).json()==payload
    assert client.get(path,headers=other_headers).status_code==404
    windows=client.get(f"/api/v1/rooms/{room['id']}/windows",headers=headers).json()
    assert windows[0]['measurement']==payload['windows'][0]
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Room))==1
        assert db.scalar(select(func.count()).select_from(Window))==1
    # Raw measurements may differ from the corrected rectangle within Android tolerances.
    payload['windows'][0]['measured_corners'][0]['y']=0.85
    payload['windows'][0]['measured_corners'][1]['y']=0.75
    response=client.post('/api/v1/rooms/import-ar',headers=headers,json=payload)
    assert response.status_code==201,response.text


def test_rotated_negative_room_keeps_ar_axes(client,headers):
    payload=body()
    angle=math.radians(123)
    points=payload['corners']+payload['windows'][0]['corners']+payload['windows'][0]['measured_corners']+[payload['windows'][0]['floor_reference']]
    for point in points:
        x,z=point['x'],point['z']
        point['x']=round_m(x*math.cos(angle)-z*math.sin(angle))
        point['z']=round_m(x*math.sin(angle)+z*math.cos(angle))
    response=client.post('/api/v1/rooms/import-ar',headers=headers,json=payload)
    assert response.status_code==201,response.text
    room=response.json()
    assert room['corners']==payload['corners']
    assert room['corners'][1]['z']!=0
    grid=client.get(f"/api/v1/rooms/{room['id']}/grid?cell_size_m=1",headers=headers).json()
    assert grid['coordinate_system']==payload['coordinate_system']
    assert grid['origin']['x']<0


@pytest.mark.parametrize('case',['floor-y','non-origin','three-corners','wrong-frame','wrong-time',
 'wrong-wall','sill','area','raw-order','residual','duplicate-window','second-window'])
def test_invalid_ar_import_is_atomic(context,headers,case):
    client,factory=context
    payload=body()
    if case=='floor-y': payload['corners'][2]['y']=1
    if case=='non-origin': payload['corners'][0]['x']=1
    if case=='three-corners': payload['corners'].pop()
    if case=='wrong-frame': payload['coordinate_system']='room_local_v1'
    if case=='wrong-time': payload['saved_at']='2026-10-05T10:30:00Z'
    if case=='wrong-wall': payload['windows'][0]['wall_index']=1
    if case=='sill': payload['windows'][0]['sill_height_m']=1.8
    if case=='area': payload['area_square_meters']=20
    if case=='raw-order': payload['windows'][0]['measured_corners'].reverse()
    if case=='residual':
        for c in payload['windows'][0]['measured_corners']: c['z']=0.1
    if case=='duplicate-window': payload['windows'].append(copy.deepcopy(payload['windows'][0]))
    if case=='second-window':
        payload['windows'].append(copy.deepcopy(payload['windows'][0]))
        payload['windows'][1].update(window_id='second',wall_index=20)
    response=client.post('/api/v1/rooms/import-ar',headers=headers,json=payload)
    assert response.status_code==422,response.text
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Room))==0
        assert db.scalar(select(func.count()).select_from(Window))==0


def test_six_corners_and_millimeter_rounding(client,headers):
    payload=body()
    payload['windows']=[]
    payload['corners']=[dict(order_index=i,x=x,y=0,z=z) for i,(x,z) in enumerate([(0,0),(3,0),(3,1),(1,1),(1,3),(0,3)])]
    payload.update(area_square_meters=5,perimeter_meters=12)
    response=client.post('/api/v1/rooms/import-ar',headers=headers,json=payload)
    assert response.status_code==201,response.text
    assert len(response.json()['corners'])==6
    assert round_m(1.2345)==1.235
    assert round_m(-1.2345)==-1.235


def test_old_db_migration_keeps_frame_and_data(tmp_path):
    path=tmp_path/'old.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE rooms (id INTEGER PRIMARY KEY, coordinate_frame TEXT)')
        db.execute("INSERT INTO rooms VALUES (1,'room_local_v1')")
        db.execute('CREATE TABLE windows (id INTEGER PRIMARY KEY)')
    migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT coordinate_frame,saved_at FROM rooms').fetchone()==('room_local_v1',None)
        assert 'measurement' in {row[1] for row in db.execute('PRAGMA table_info(windows)')}
    assert len(list(tmp_path.glob('*.bak')))==1
    migrate(path)
    assert len(list(tmp_path.glob('*.bak')))==1


def test_legacy_frame_requires_reimport(context,headers):
    client,factory=context
    response=client.post('/api/v1/rooms/import-ar',headers=headers,json=body())
    room_id=response.json()['id']
    with factory() as db:
        db.get(Room,room_id).coordinate_frame='room_local_v1'
        db.commit()
    assert client.get(f'/api/v1/rooms/{room_id}/grid',headers=headers).status_code==409
    assert client.get(f'/api/v1/rooms/{room_id}/ar-measurement',headers=headers).status_code==409


def test_floor_hit_residual_is_preserved(client,headers):
    payload=body()
    payload['windows'][0]['max_plane_residual_m']=0.3
    response=client.post('/api/v1/rooms/import-ar',headers=headers,json=payload)
    assert response.status_code==201,response.text
    result=client.get(f"/api/v1/rooms/{response.json()['id']}/ar-measurement",headers=headers).json()
    assert result['windows'][0]['max_plane_residual_m']==0.3
