from datetime import date, datetime, timedelta, timezone
from unittest.mock import Mock
import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from app import weather
from app.models import WeatherCache


def raw(day):
    start = datetime.combine(day, datetime.min.time())
    return {'hourly_units': {k: 'W/m²' for k in weather.VARIABLES.split(',')},
        'hourly': {'time': [(start + timedelta(hours=i)).isoformat() for i in range(48)],
        'direct_normal_irradiance': [100.0]*48, 'diffuse_radiation': [30.0]*48}}


def test_cache_and_expiry(context, headers, monkeypatch):
    client, factory = context
    day = datetime.now(weather.KST).date()
    fetch = Mock(return_value=raw(day))
    monkeypatch.setattr(weather, 'fetch_raw', fetch)
    params = {'latitude':37.5665,'longitude':126.978,'date':str(day)}
    url='/api/v1/weather/irradiance'
    first=client.get(url,params=params,headers=headers)
    assert first.status_code==200,first.text
    body=first.json()
    assert len(body['values'])==25
    assert body['values'][-1]['time']==f'{day+timedelta(days=1)}T00:00:00+09:00'
    assert body['time_basis']=='PRECEDING_HOUR_MEAN'
    assert body['cache_hit'] is False
    assert client.get(url,params=params,headers=headers).json()['cache_hit'] is True
    assert fetch.call_count==1
    with factory() as db:
        row=db.scalar(select(WeatherCache))
        assert row.raw_response==raw(day)
        row.expires_at=datetime.now(timezone.utc)-timedelta(seconds=1)
        db.commit()
    assert client.get(url,params=params,headers=headers).json()['cache_hit'] is False
    assert fetch.call_count==2


def test_missing_not_cached(context,headers,monkeypatch):
    client,factory=context
    day=datetime.now(weather.KST).date()
    invalid=raw(day)
    invalid['hourly']['diffuse_radiation'][9]=None
    monkeypatch.setattr(weather,'fetch_raw',lambda *a:invalid)
    params={'latitude':37,'longitude':127,'date':str(day)}
    assert client.get('/api/v1/weather/irradiance',params=params,headers=headers).status_code==502
    with factory() as db: assert db.scalar(select(WeatherCache)) is None
    params['latitude']=91
    assert client.get('/api/v1/weather/irradiance',params=params,headers=headers).status_code==422


def test_room_ownership(client,headers,other_headers,monkeypatch):
    response=client.post('/api/v1/rooms',headers=headers,json={'name':'Room','latitude':37,'longitude':127,
      'corners':[{'x':x,'y':0,'z':z,'order_index':i} for i,(x,z) in enumerate([(0,0),(4,0),(4,3),(0,3)])]})
    assert response.status_code==201,response.text
    day=datetime.now(weather.KST).date()
    monkeypatch.setattr(weather,'fetch_raw',lambda *a:raw(day))
    url=f"/api/v1/rooms/{response.json()['id']}/irradiance?date={day}"
    assert client.get(url,headers=other_headers).status_code==404
    assert client.get(url,headers=headers).status_code==200
    assert client.get(url).status_code==401


def test_routing():
    today=date(2026,10,6)
    assert weather.request_spec(today-timedelta(days=7),today)[1]=='ERA5'
    assert weather.request_spec(today-timedelta(days=6),today)[1]=='BEST_MATCH_FORECAST'
    with pytest.raises(HTTPException): weather.request_spec(today+timedelta(days=15),today)


def test_timeout(monkeypatch):
    get=Mock(side_effect=httpx.ReadTimeout('timeout'))
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def get(self,*args,**kwargs):return get()
    monkeypatch.setattr(weather.httpx,'Client',Client)
    with pytest.raises(HTTPException) as error: weather.fetch_raw('https://api.open-meteo.com/v1/forecast',{})
    assert error.value.status_code==503
    assert get.call_count==3
