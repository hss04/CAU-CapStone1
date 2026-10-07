import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from sqlalchemy import func, select

from app.config import get_settings
from app.models import RoomCorner, User, Window, WindowCorner


PREFIX='/api/v1'
EXAMPLES=Path(__file__).resolve().parents[1]/'examples'


def example(name):
    return json.loads((EXAMPLES/f'{name}.json').read_text(encoding='utf-8'))


def create_room(client,headers):
    r=client.post(f'{PREFIX}/rooms',headers=headers,json=example('room'))
    assert r.status_code==201,r.text
    return r.json()


def create_window(client,headers,room_id):
    r=client.post(f'{PREFIX}/rooms/{room_id}/windows',headers=headers,json=example('window'))
    assert r.status_code==201,r.text
    return r.json()


def create_plant(client,headers,room_id):
    body=example('plant'); body['room_id']=room_id
    r=client.post(f'{PREFIX}/plants',headers=headers,json=body)
    assert r.status_code==201,r.text
    return r.json()


def test_auth(context,headers):
    client,factory=context
    me=client.get(f'{PREFIX}/users/me',headers=headers)
    assert me.status_code==200
    assert 'password_hash' not in me.json()
    assert me.json()['created_at'].endswith('+09:00')
    assert client.get(f'{PREFIX}/users/me').status_code==401
    with factory() as db:
        user=db.scalar(select(User))
        assert user.password_hash.startswith('$argon2id$')
        assert user.password_hash!=' test-password '
    assert client.post(f'{PREFIX}/auth/login',json={'email':'owner@example.com','password':'test-password'}).status_code==401
    assert client.post(f'{PREFIX}/auth/login',json={'email':'absent@example.com','password':'test-password'}).status_code==401
    assert client.post(f'{PREFIX}/auth/register',json={'email':'OWNER@example.com','password':'password123','nickname':'duplicate'}).status_code==409
    assert client.post(f'{PREFIX}/auth/token',data={'username':'owner@example.com','password':' test-password '}).status_code==200


@pytest.mark.parametrize('case',['expired','wrong-key','no-exp','wrong-audience','bad-subject'])
def test_invalid_jwt(client,headers,case):
    now=datetime.now(timezone.utc)
    payload={'sub':'1','iat':now,'exp':now+timedelta(hours=1),'iss':'plantlight-api','aud':'plantlight-client'}
    key=get_settings().jwt_secret
    if case=='expired': payload['exp']=now-timedelta(seconds=5)
    if case=='wrong-key': key='a-different-key-at-least-32-characters'
    if case=='no-exp': del payload['exp']
    if case=='wrong-audience': payload['aud']='different-client'
    if case=='bad-subject': payload['sub']='not-an-id'
    token=jwt.encode(payload,key,algorithm='HS256')
    assert client.get(f'{PREFIX}/users/me',headers={'Authorization':f'Bearer {token}'}).status_code==401


def test_floor_area_and_room_replacement(context,headers):
    client,factory=context
    body=example('room')
    r=client.post(f'{PREFIX}/rooms',headers=headers,json=body)
    assert r.status_code==201,r.text
    assert r.json()['floor_area_m2']==12
    assert all(c['y']==0 for c in r.json()['corners'])
    room_id=r.json()['id']
    body['corners'][1]['x']=5
    body['corners'][2]['x']=5
    changed=client.put(f'{PREFIX}/rooms/{room_id}',headers=headers,json=body)
    assert changed.status_code==200,changed.text
    assert changed.json()['floor_area_m2']==15
    assert changed.json()['geometry_version']==2
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(RoomCorner))==4


@pytest.mark.parametrize('case',['crossed','duplicate','bad-order','collinear','infinite','extra-owner'])
def test_bad_room(client,headers,case):
    body=example('room')
    if case=='crossed':
        body['corners'][1],body['corners'][2]=body['corners'][2],body['corners'][1]
        for i,c in enumerate(body['corners']): c['order_index']=i
    if case=='duplicate': body['corners'][1].update(x=0,z=0)
    if case=='bad-order': body['corners'][2]['order_index']=7
    if case=='collinear':
        for i,c in enumerate(body['corners']): c.update(x=i,z=0)
    if case=='infinite': body['corners'][0]['x']='NaN'
    if case=='extra-owner': body['user_id']=99
    r=client.post(f'{PREFIX}/rooms',headers=headers,json=body)
    assert r.status_code==422,r.text


def test_owner_isolation(client,headers,other_headers):
    room=create_room(client,headers)
    window=create_window(client,headers,room['id'])
    plant=create_plant(client,headers,room['id'])
    for path,body in [(f"rooms/{room['id']}",example('room')),(f"windows/{window['id']}",example('window')),(f"plants/{plant['id']}",example('plant'))]:
        assert client.get(f'{PREFIX}/{path}',headers=other_headers).status_code==404
        assert client.put(f'{PREFIX}/{path}',headers=other_headers,json=body).status_code==404
        assert client.delete(f'{PREFIX}/{path}',headers=other_headers).status_code==404
    for path in ['rooms','plants']:
        assert client.get(f'{PREFIX}/{path}',headers=other_headers).json()==[]
    for suffix in ['windows','grid']:
        assert client.get(f"{PREFIX}/rooms/{room['id']}/{suffix}",headers=other_headers).status_code==404
    assert client.post(f"{PREFIX}/rooms/{room['id']}/windows",headers=other_headers,json=example('window')).status_code==404
    assert client.post(f'{PREFIX}/plants',headers=other_headers,json=example('plant')).status_code==404
    assert client.get(f"{PREFIX}/plants?room_id={room['id']}",headers=other_headers).status_code==404


@pytest.mark.parametrize('case',['three-corners','wrong-order','wrong-wall','reversed-view','non-planar'])
def test_bad_window(client,headers,case):
    room=create_room(client,headers)
    body=example('window')
    if case=='three-corners': body['corners'].pop()
    if case=='wrong-order': body['corners'][2]['order_index']=1
    if case=='wrong-wall':
        for c in body['corners']: c['z']=1
    if case=='reversed-view':
        for c in body['corners']: c['x']=3.5-c['x']
    if case=='non-planar': body['corners'][3]['z']=0.4
    assert client.post(f"{PREFIX}/rooms/{room['id']}/windows",headers=headers,json=body).status_code==422


def test_window_crud(context,headers):
    client,factory=context
    room=create_room(client,headers)
    window=create_window(client,headers,room['id'])
    body=example('window'); body['name']='updated'
    r=client.put(f"{PREFIX}/windows/{window['id']}",headers=headers,json=body)
    assert r.status_code==200,r.text
    assert r.json()['name']=='updated'
    assert len(client.get(f"{PREFIX}/rooms/{room['id']}/windows",headers=headers).json())==1
    assert client.get(f"{PREFIX}/rooms/{room['id']}",headers=headers).json()['geometry_version']==3
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(WindowCorner))==4
    assert client.delete(f"{PREFIX}/windows/{window['id']}",headers=headers).status_code==204
    assert client.get(f"{PREFIX}/windows/{window['id']}",headers=headers).status_code==404


def test_plant_crud_and_room_delete(context,headers):
    client,factory=context
    room=create_room(client,headers)
    create_window(client,headers,room['id'])
    plant=create_plant(client,headers,room['id'])
    assert plant['position']=={'x':1,'y':0.5,'z':1}
    invalid=example('plant'); invalid['position']['x']=99
    assert client.put(f"{PREFIX}/plants/{plant['id']}",headers=headers,json=invalid).status_code==422
    invalid=example('plant'); invalid['species_id']=999
    assert client.post(f'{PREFIX}/plants',headers=headers,json=invalid).status_code==404
    assert client.get(f'{PREFIX}/plant-species?q=Test',headers=headers).json()[0]['min_dli']==2
    assert client.delete(f"{PREFIX}/rooms/{room['id']}",headers=headers).status_code==204
    saved=client.get(f"{PREFIX}/plants/{plant['id']}",headers=headers).json()
    assert saved['room_id'] is None and saved['position'] is None
    with factory() as db:
        for model in [RoomCorner,Window,WindowCorner]:
            assert db.scalar(select(func.count()).select_from(model))==0
    unplaced={'species_id':1,'nickname':'unplaced','room_id':None,'position':None}
    assert client.put(f"{PREFIX}/plants/{plant['id']}",headers=headers,json=unplaced).status_code==200
    assert client.delete(f"{PREFIX}/plants/{plant['id']}",headers=headers).status_code==204


def test_room_change_conflicts(client,headers):
    room=create_room(client,headers)
    create_plant(client,headers,room['id'])
    body=example('room')
    body['corners'][1]['x']=0.5
    body['corners'][2]['x']=0.5
    assert client.put(f"{PREFIX}/rooms/{room['id']}",headers=headers,json=body).status_code==409
    assert client.get(f"{PREFIX}/rooms/{room['id']}",headers=headers).json()['floor_area_m2']==12


def test_grid_and_dli_contract(client,headers,other_headers):
    room=create_room(client,headers)
    room_id=room['id']
    grid=client.get(f'{PREFIX}/rooms/{room_id}/grid?cell_size_m=1',headers=headers).json()
    assert (grid['rows'],grid['cols'])==(3,4)
    assert grid['inside_mask']==[[True]*4]*3
    body={'schema_version':'dli_map_v2','room_id':room_id,'geometry_version':1,'date':'2026-10-05',
          'timezone':'Asia/Seoul','unit':'mol/m2/day','grid':grid,
          'direct_dli':[[2]*4]*3,'diffuse_dli':[[1]*4]*3,'total_dli':[[3]*4]*3}
    path=f'{PREFIX}/rooms/{room_id}/dli-map/validate'
    assert client.post(path,headers=headers,json=body).status_code==200
    assert client.post(path,headers=other_headers,json=body).status_code==404
    bad=copy.deepcopy(body); bad['total_dli'][0][0]=4
    assert client.post(path,headers=headers,json=bad).status_code==422
    bad=copy.deepcopy(body); bad['grid']['origin']['x']=100
    assert client.post(path,headers=headers,json=bad).status_code==422
    bad=copy.deepcopy(body); bad['total_dli'].pop()
    assert client.post(path,headers=headers,json=bad).status_code==422
    create_window(client,headers,room_id)
    assert client.post(path,headers=headers,json=body).status_code==409


def test_concave_room_mask(client,headers):
    body=example('room')
    body['corners']=[dict(x=x,y=0,z=z,order_index=i) for i,(x,z) in enumerate([(0,0),(3,0),(3,1),(1,1),(1,3),(0,3)])]
    room=client.post(f'{PREFIX}/rooms',headers=headers,json=body).json()
    assert room['floor_area_m2']==5
    grid=client.get(f"{PREFIX}/rooms/{room['id']}/grid?cell_size_m=1",headers=headers).json()
    assert grid['inside_mask']==[[True,True,True],[True,False,False],[True,False,False]]
    matrices=[[[1 if cell else None for cell in row] for row in grid['inside_mask']] for _ in range(2)]
    total=[[2 if cell else None for cell in row] for row in grid['inside_mask']]
    payload={'room_id':room['id'],'geometry_version':1,'date':'2026-10-05','timezone':'Asia/Seoul','grid':grid,
             'direct_dli':matrices[0],'diffuse_dli':matrices[1],'total_dli':total}
    path=f"{PREFIX}/rooms/{room['id']}/dli-map/validate"
    assert client.post(path,headers=headers,json=payload).status_code==200
    payload['total_dli'][1][1]=0
    assert client.post(path,headers=headers,json=payload).status_code==422


def test_openapi(client):
    schema=client.get('/openapi.json')
    assert schema.status_code==200
    assert 'DliMap' in schema.json()['components']['schemas']
    assert client.get('/health').json()=={'status':'ok'}


def test_existing_window_prevents_incompatible_room_change(client,headers):
    room=create_room(client,headers)
    create_window(client,headers,room['id'])
    body=example('room')
    body['corners'][1]['z']=1
    assert client.put(f"{PREFIX}/rooms/{room['id']}",headers=headers,json=body).status_code==409
    current=client.get(f"{PREFIX}/rooms/{room['id']}",headers=headers).json()
    assert current['corners'][0]['z']==0
    assert current['geometry_version']==2


def test_cannot_move_own_plant_to_another_users_room(client,headers,other_headers):
    room=create_room(client,headers)
    plant=create_plant(client,headers,room['id'])
    foreign_room=create_room(client,other_headers)
    body=example('plant'); body['room_id']=foreign_room['id']
    assert client.put(f"{PREFIX}/plants/{plant['id']}",headers=headers,json=body).status_code==404
    assert client.get(f"{PREFIX}/plants/{plant['id']}",headers=headers).json()['room_id']==room['id']


def test_grid_limit_and_location_pair(client,headers):
    body=example('room')
    body['latitude']=None
    assert client.post(f'{PREFIX}/rooms',headers=headers,json=body).status_code==422
    body=example('room')
    for c in body['corners']:
        c['x']*=100
        c['z']*=100
    room=client.post(f'{PREFIX}/rooms',headers=headers,json=body).json()
    assert client.get(f"{PREFIX}/rooms/{room['id']}/grid?cell_size_m=0.05",headers=headers).status_code==422
    invalid=example('plant'); invalid['position']=None
    assert client.post(f'{PREFIX}/plants',headers=headers,json=invalid).status_code==422


def test_catalog_range_validation():
    from app.schemas import SpeciesInput
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        SpeciesInput(name='bad',min_dli=6,max_dli=2,source_note='test')
