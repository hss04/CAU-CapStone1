from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import pytest
from sqlalchemy import select, func
from app import integration as i, weather, dli_cache
from app.integration_models import IntegrationJob, DliDailyCache
from app.models import Plant, PlantSpecies, Room
from app.schemas import KST
from app.species_seed import seed_species
from scripts.migrate_v4 import migrate
from test_integration import make_room


@pytest.fixture
def calculation(client,headers,monkeypatch):
    rid=make_room(client,headers)
    calls=[]
    monkeypatch.setenv('DLI_CALLABLE','test:compute')
    def irradiation(db,lat,lon,day):
        now=datetime.now(timezone.utc)
        return {'values':[],'time_basis':'PRECEDING_HOUR_MEAN',
                'dataset':'ERA5' if day<now.astimezone(KST).date()-timedelta(days=7) else 'BEST_MATCH_FORECAST',
                'fetched_at':now.isoformat(),'expires_at':(now+timedelta(hours=1)).isoformat()}
    monkeypatch.setattr(i,'get_irradiance',irradiation)
    def compute(op,p):
        calls.append(p['date'])
        n=date.fromisoformat(p['date']).day
        g=p['grid']
        return {'direct_dli':[[n]*g['cols'] for _ in range(g['rows'])],
                'diffuse_dli':[[1]*g['cols'] for _ in range(g['rows'])]}
    monkeypatch.setattr(i,'invoke',compute)
    body={'start_date':'2026-01-01','end_date':'2026-01-02','cell_size_m':1,
          'mock_sky':True,'temporary_x_axis_azimuth_deg':0}
    return rid,body,calls


def submit(client,headers,rid,body,endpoint='dli-series'):
    res=client.post(f'/api/v1/rooms/{rid}/{endpoint}',headers=headers,json=body)
    assert res.status_code==202,res.text
    job=client.get(res.json()['status_url'],headers=headers).json()
    assert job['status']=='COMPLETED',job
    return job


def test_series_values_reuse_and_mean(context,headers,calculation):
    client,factory=context; rid,body,calls=calculation
    pid=client.post('/api/v1/plants',headers=headers,json={'species_id':1,'nickname':'test',
        'room_id':rid,'position':{'x':.5,'y':0,'z':.5}}).json()['id']
    job=submit(client,headers,rid,body)
    result=job['result']
    assert [d['total_dli'][0][0] for d in result['days']]==[2,3]
    assert result['days'][0]['dataset']=='ERA5'
    assert result['plants'][0]=={'plant_id':pid,'row':0,'col':0,'daily':[{'date':'2026-01-01','total_dli':2},{'date':'2026-01-02','total_dli':3}]}
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(DliDailyCache))==2
    # New HTTP requests open new sessions; cache lives in the DB, not app memory/job id.
    got=client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params={**body,'end_date':'2026-01-03'}).json()
    assert len(got['days'])==2 and got['missing_dates']==['2026-01-03']
    submit(client,headers,rid,body)
    mean=submit(client,headers,rid,body,'dli-map')['result']
    assert mean['total_dli'][0][0]==2.5 and calls==['2026-01-01','2026-01-02']
    # Different resolution or mock setting must not leak cached data.
    assert client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params={**body,'cell_size_m':.5}).json()['days']==[]
    assert client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params={**body,'mock_sky':False}).json()['days']==[]


def test_forecast_ttl_and_partial_recompute(context,headers,calculation):
    client,factory=context; rid,body,calls=calculation
    today=datetime.now(KST).date()
    body.update(start_date=today.isoformat(),end_date=(today+timedelta(days=1)).isoformat())
    submit(client,headers,rid,body)
    with factory() as db:
        row=db.scalar(select(DliDailyCache).order_by(DliDailyCache.cache_key))
        row.expires_at=datetime.now(timezone.utc)-timedelta(seconds=1)
        db.commit()
    got=client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params=body).json()
    assert len(got['days'])==len(got['missing_dates'])==1
    submit(client,headers,rid,body)
    assert len(calls)==3


def test_historical_cache_and_forecast_rollover():
    now=datetime(2026,10,27,12,tzinfo=KST); day=date(2026,10,26)
    item=SimpleNamespace(fetched_at=now-timedelta(hours=3),expires_at=now-timedelta(hours=2))
    assert dli_cache.fresh(item,day,now)
    item.fetched_at=now-timedelta(days=2)
    assert not dli_cache.fresh(item,day,now)
    item.expires_at=now+timedelta(seconds=1)
    assert dli_cache.fresh(item,day,now)


def test_location_preserves_scan_invalidates_dli(context,headers,calculation):
    client,factory=context; rid,body,calls=calculation
    job=submit(client,headers,rid,body)
    with factory() as db:
        room=db.get(Room,rid); version=room.geometry_version; wid=room.windows[0].id
        db.add(IntegrationJob(id='completed-scan',user_id=room.user_id,room_id=rid,window_id=wid,
            kind='SCAN',status='COMPLETED',payload={'geometry_version':version,'captured_at':'2026-10-25T12:00:00+09:00'},
            result={'sky':[[1]*360 for _ in range(91)],'max_captured_elevation_deg':[90]*360}))
        db.commit()
    result=client.put(f'/api/v1/rooms/{rid}/location',headers=headers,json={'latitude':38,'longitude':127,'location_name':'서울'}).json()
    assert result['geometry_version']==version
    assert client.get('/api/v1/rooms',headers=headers).json()[0]['location_name']=='서울'
    assert client.get('/api/v1/jobs/completed-scan',headers=headers).json()['stale'] is False
    scans=client.get(f'/api/v1/windows/{wid}/scans',headers=headers).json()
    assert scans['scan_completed'] and scans['latest_completed']['job_id']=='completed-scan'
    assert scans['latest']['created_at'].endswith('+09:00')
    assert client.get('/api/v1/jobs/'+job['job_id'],headers=headers).json()['stale']
    assert client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params=body).json()['days']==[]
    # Actual DLI prerequisites can still use the saved real sky after changing location.
    with factory() as db:
        room=db.get(Room,rid)
        _,_,windows,_=i.prepare_dli(room,i.DliRequest(**{**body,'mock_sky':False}),db)
        assert windows[0]['sky']['scan_job_id']=='completed-scan'
    # Renaming only does not invalidate a new DLI result.
    newer=submit(client,headers,rid,body)
    client.put(f'/api/v1/rooms/{rid}/location',headers=headers,json={'latitude':38,'longitude':127,'location_name':'새 이름'})
    assert not client.get('/api/v1/jobs/'+newer['job_id'],headers=headers).json()['stale']


def test_changes_during_job_fail(context,headers,calculation,monkeypatch):
    client,factory=context; rid,body,calls=calculation
    original=i.invoke
    def changing(op,p):
        with factory() as db:
            db.get(Room,rid).latitude=1
            db.commit()
        return original(op,p)
    monkeypatch.setattr(i,'invoke',changing)
    res=client.post(f'/api/v1/rooms/{rid}/dli-series',headers=headers,json={**body,'end_date':body['start_date']})
    assert client.get(res.json()['status_url'],headers=headers).json()['status']=='FAILED'


def test_series_ownership_validation_empty(client,headers,other_headers,calculation):
    rid,body,_=calculation
    url=f'/api/v1/rooms/{rid}/dli-series'
    assert client.get(url,headers=headers,params=body).json()['missing_dates']==['2026-01-01','2026-01-02']
    assert client.get(url,headers=other_headers,params=body).status_code==404
    assert client.post(url,headers=other_headers,json=body).status_code==404
    assert client.get(url,headers=headers,params={**body,'end_date':'2025-01-01'}).status_code==422
    assert client.get(url,headers=headers,params={**body,'cell_size_m':0}).status_code==422
    job=submit(client,headers,rid,body)
    assert client.get('/api/v1/jobs/'+job['job_id'],headers=other_headers).status_code==404


def test_watering_persistence_and_old_clients(context,headers,other_headers):
    client,factory=context
    res=client.post('/api/v1/plants',headers=headers,json={'nickname':'물주기','species_id':1,'watering_interval_days':10})
    assert res.status_code==201,res.text
    plant=res.json(); pid=plant['id']; assert plant['last_watered_at'] is None
    today=datetime.now(KST).date(); old=today-timedelta(days=2)
    url=f'/api/v1/plants/{pid}/waterings'
    assert client.post(url,headers=other_headers,json={'watered_at':today.isoformat()}).status_code==404
    for day in [today,today,old]:
        result=client.post(url,headers=headers,json={'watered_at':day.isoformat()})
        assert result.json()['last_watered_at']==today.isoformat()
    client.put(f'/api/v1/plants/{pid}',headers=headers,json={'nickname':'updated','species_id':1})
    with factory() as db:
        plant=db.get(Plant,pid)
        assert plant.last_watered_at==today and plant.watering_interval_days==10
    assert client.post(url,headers=headers,json={'watered_at':(today+timedelta(days=1)).isoformat()}).status_code==422
    assert client.post('/api/v1/plants',headers=headers,json={'nickname':'bad','species_id':1,'watering_interval_days':0}).status_code==422


def test_species_seed_idempotent(context,headers):
    client,factory=context
    with factory() as db:
        seed_species(db);db.commit()
        rows=db.scalars(select(PlantSpecies).where(PlantSpecies.scientific_name.is_not(None))).all()
        assert len(rows)==6
        ids=[r.id for r in rows]; rows[0].min_dli=3;db.commit()
        seed_species(db);db.commit()
        assert [r.id for r in db.scalars(select(PlantSpecies).where(PlantSpecies.scientific_name.is_not(None)))]==ids
        assert db.get(PlantSpecies,ids[0]).min_dli==3
    found=client.get('/api/v1/plant-species',headers=headers,params={'q':'Monstera deliciosa'}).json()
    assert len(found)==1 and found[0]['scientific_name']=='Monstera deliciosa'


def test_migration_keeps_records_and_is_repeatable(tmp_path):
    target=tmp_path/'legacy.db'
    # Real v3 schema, with new v4 columns removed using SQLite supported DROP COLUMN.
    from app.database import build_engine, Base
    engine=build_engine('sqlite:///'+str(target)); Base.metadata.create_all(engine);engine.dispose()
    with sqlite3.connect(target) as conn:
        conn.execute('ALTER TABLE rooms DROP COLUMN location_name')
        # SQLite cannot drop a referenced CHECK column: reconstruct legacy plants.
        conn.execute('DROP TABLE plants')
        conn.execute('CREATE TABLE plants (id INTEGER PRIMARY KEY,user_id INTEGER,room_id INTEGER,species_id INTEGER,nickname VARCHAR(100),x FLOAT,y FLOAT,z FLOAT,created_at DATETIME)')
        conn.execute("INSERT INTO plants(id,nickname) VALUES(42,'existing')")
        conn.execute('DROP TABLE dli_daily_cache')
    migrate(target); migrate(target)
    with sqlite3.connect(target) as conn:
        assert conn.execute('SELECT id,nickname,watering_interval_days,last_watered_at FROM plants').fetchone()==(42,'existing',7,None)
        assert conn.execute('SELECT count(*) FROM plant_species').fetchone()[0]==6
        assert conn.execute("SELECT count(*) FROM sqlite_master WHERE name='dli_daily_cache'").fetchone()[0]==1
    assert len(list(tmp_path.glob('*.bak')))==2


def test_weather_proxy_cache_and_location(client,headers,other_headers,monkeypatch):
    rid=make_room(client,headers); calls=[]
    def fetch(url,params):
        calls.append(params)
        return {'current':{'time':'2026-10-27T12:00','temperature_2m':20},
                'daily':{'time':['2026-10-27'],'sunrise':['2026-10-27T06:00'],'sunset':['2026-10-27T18:00']}}
    monkeypatch.setattr(weather,'fetch_raw',fetch)
    url=f'/api/v1/rooms/{rid}/weather'
    assert client.get(url,headers=other_headers).status_code==404
    one=client.get(url,headers=headers).json(); two=client.get(url,headers=headers).json()
    assert not one['cache_hit'] and two['cache_hit'] and len(calls)==1
    assert one['current']['time'].endswith('+09:00')
    assert one['fetched_at'].endswith('+09:00')
    client.put(f'/api/v1/rooms/{rid}/location',headers=headers,json={'latitude':38,'longitude':127})
    assert not client.get(url,headers=headers).json()['cache_hit'] and len(calls)==2


def test_scan_status_ownership_empty(client,headers,other_headers):
    rid=make_room(client,headers)
    wid=client.get(f'/api/v1/rooms/{rid}/windows',headers=headers).json()[0]['id']
    url=f'/api/v1/windows/{wid}/scans'
    assert client.get(url,headers=other_headers).status_code==404
    assert client.get(url,headers=headers).json()['latest'] is None
    assert not client.get(url,headers=headers).json()['scan_completed']


def test_simple_series_payload_and_default_algorithm(context,headers,monkeypatch):
    # Exact minimal requested shape works with real saved room/direction/scan inputs.
    from test_api import create_room,create_window
    client,factory=context
    room=create_room(client,headers)
    rid=room['id'];create_window(client,headers,rid)
    with factory() as db:
        room=db.get(Room,rid)
        db.add(IntegrationJob(id='default-engine-scan',user_id=room.user_id,room_id=rid,
            window_id=room.windows[0].id,kind='SCAN',status='COMPLETED',
            payload={'geometry_version':room.geometry_version},
            result={'sky':[[1]*360 for _ in range(91)],'max_captured_elevation_deg':[90]*360}))
        db.commit()
    now=datetime.now(timezone.utc)
    monkeypatch.setattr(i,'get_irradiance',lambda *a:{'values':[],'time_basis':'PRECEDING_HOUR_MEAN',
        'dataset':'ERA5','fetched_at':now.isoformat(),'expires_at':(now+timedelta(hours=1)).isoformat()})
    monkeypatch.setattr(i,'invoke',lambda op,p:{'direct_dli':[[1]*p['grid']['cols'] for _ in range(p['grid']['rows'])],
        'diffuse_dli':[[2]*p['grid']['cols'] for _ in range(p['grid']['rows'])]})
    body={'start_date':'2026-01-01','end_date':'2026-01-01','cell_size_m':.2,'sample_height_m':0}
    result=submit(client,headers,rid,body)['result']
    assert result['days'][0]['total_dli'][0][0]==3
    assert result['warnings'][0].startswith('PROVISIONAL')
    got=client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params=body)
    assert got.status_code==200 and len(got.json()['days'])==1



def test_new_scan_invalidates_cached_real_sky(context,headers,calculation):
    client,factory=context;rid,body,calls=calculation
    with factory() as db:
        room=db.get(Room,rid)
        wid=room.windows[0].id; uid=room.user_id; version=room.geometry_version
        def scan(id,created):
            return IntegrationJob(id=id,user_id=uid,room_id=rid,window_id=wid,kind='SCAN',status='COMPLETED',
                created_at=created,payload={'geometry_version':version},
                result={'sky':[[1]*360 for _ in range(91)],'max_captured_elevation_deg':[90]*360})
        now=datetime.now(timezone.utc)
        db.add(scan('scan-one',now));db.commit()
    body={**body,'mock_sky':False}
    job=submit(client,headers,rid,body)
    with factory() as db:
        db.add(scan('scan-two',now+timedelta(seconds=1)));db.commit()
    assert client.get(f'/api/v1/rooms/{rid}/dli-series',headers=headers,params=body).json()['days']==[]
    assert client.get('/api/v1/jobs/'+job['job_id'],headers=headers).json()['stale']


def test_invalid_algorithm_does_not_publish(context,headers,calculation,monkeypatch):
    client,factory=context;rid,body,_=calculation
    monkeypatch.setattr(i,'invoke',lambda *a:{'direct_dli':[[float('nan')]],'diffuse_dli':[[0]]})
    res=client.post(f'/api/v1/rooms/{rid}/dli-series',headers=headers,json=body)
    assert client.get(res.json()['status_url'],headers=headers).json()['status']=='FAILED'
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(DliDailyCache))==0
