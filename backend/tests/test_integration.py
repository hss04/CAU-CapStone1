import io
import json
from pathlib import Path
from PIL import Image
from app import integration as i


def make_room(client, headers):
    payload=json.loads(Path('examples/ar-room-v3.json').read_text())
    res=client.post('/api/v1/rooms/import-ar',json=payload,headers=headers)
    assert res.status_code==201,res.text
    rid=res.json()['id']
    assert client.put(f'/api/v1/rooms/{rid}/location',json={'latitude':37.56,'longitude':126.97},headers=headers).status_code==200
    return rid


def test_dli_job_and_ownership(client,headers,other_headers,monkeypatch):
    rid=make_room(client,headers)
    monkeypatch.setenv('DLI_CALLABLE','test_adapter:compute')
    monkeypatch.setattr(i,'get_irradiance',lambda *args:{'values':[],'time_basis':'PRECEDING_HOUR_MEAN','dataset':'ERA5','fetched_at':'2026-10-27T10:00:00+09:00','expires_at':'2026-10-27T11:00:00+09:00'})
    captured=[]
    def compute(op,p):
        captured.append(p)
        g=p['grid']; a=[[1.0]*g['cols'] for _ in range(g['rows'])]
        return {'direct_dli':a,'diffuse_dli':a}
    monkeypatch.setattr(i,'invoke',compute)
    res=client.post(f'/api/v1/rooms/{rid}/dli-map',headers=headers,json={'start_date':'2026-10-01','end_date':'2026-10-02','mock_sky':True,'temporary_x_axis_azimuth_deg':0})
    assert res.status_code==202,res.text
    path=res.json()['status_url']; result=client.get(path,headers=headers)
    assert result.json()['status']=='COMPLETED',result.text
    assert result.json()['result']['period']['day_count']==2
    assert len(captured)==2 and 'wall_index' in captured[0]['windows'][0]
    assert client.get(path,headers=other_headers).status_code==404
    assert client.put(f'/api/v1/rooms/{rid}/location',json={'latitude':38,'longitude':127},headers=other_headers).status_code==404
    client.put(f'/api/v1/rooms/{rid}/location',json={'latitude':38,'longitude':127},headers=headers)
    assert client.get(path,headers=headers).json()['stale'] is True


def test_invalid_period(client,headers):
    rid=make_room(client,headers)
    res=client.post(f'/api/v1/rooms/{rid}/dli-map',headers=headers,json={'start_date':'2026-10-02','end_date':'2026-10-01'})
    assert res.status_code==422


def test_scan_upload(client,headers,monkeypatch,tmp_path):
    rid=make_room(client,headers)
    wid=client.get(f'/api/v1/rooms/{rid}/windows',headers=headers).json()[0]['id']
    monkeypatch.setattr(i,'UPLOAD_ROOT',tmp_path)
    monkeypatch.setattr(i,'invoke',lambda op,p:{'sky':[[1]*360 for _ in range(91)],'max_captured_elevation_deg':[90]*360})
    im=io.BytesIO(); Image.new('RGB',(960,1280)).save(im,format='JPEG')
    meta={'window_id':wid,'captured_at':'2026-10-25T12:00:00+09:00','declination_deg':0,
        'window_azimuth_deg':180,'window_azimuth_mag_deg':180,'camera':{'width':960,'height':1280,'hfov_deg':55,'vfov_deg':70},
        'frames':[{'index':n,'file':f'{n}.jpg','azimuth_deg':90+15*n,'azimuth_mag_deg':90+15*n,'pitch_deg':30,'roll_deg':0} for n in range(13)]}
    files=[('files',(f'{n}.jpg',im.getvalue(),'image/jpeg')) for n in range(13)]
    res=client.post(f'/api/v1/windows/{wid}/scans',headers=headers,data={'metadata':json.dumps(meta)},files=files)
    assert res.status_code==202,res.text
    result=client.get(res.json()['status_url'],headers=headers)
    assert result.json()['status']=='COMPLETED',result.text
    assert len(list(tmp_path.rglob('*.jpg')))==13
    bad=client.post(f'/api/v1/windows/{wid}/scans',headers=headers,data={'metadata':json.dumps(meta)},files=files[:12])
    assert bad.status_code==422


def test_unavailable_algorithms_are_explicit(client,headers):
    rid=make_room(client,headers)
    res=client.post(f'/api/v1/rooms/{rid}/direction',headers=headers)
    assert res.status_code==501
    res=client.post(f'/api/v1/rooms/{rid}/dli-map',headers=headers,json={'start_date':'2026-10-01','end_date':'2026-10-01','mock_sky':True,'temporary_x_axis_azimuth_deg':0})
    assert res.status_code in (409,501)


def test_algorithm_failure_is_persisted(client,headers,monkeypatch):
    rid=make_room(client,headers)
    monkeypatch.setenv('DLI_CALLABLE','test_adapter:compute')
    monkeypatch.setattr(i,'get_irradiance',lambda *args:{'values':[],'time_basis':'PRECEDING_HOUR_MEAN','dataset':'ERA5','fetched_at':'2026-10-27T10:00:00+09:00','expires_at':'2026-10-27T11:00:00+09:00'})
    def fail(*args): raise RuntimeError('test failure')
    monkeypatch.setattr(i,'invoke',fail)
    res=client.post(f'/api/v1/rooms/{rid}/dli-map',headers=headers,json={'start_date':'2026-10-01','end_date':'2026-10-01','mock_sky':True,'temporary_x_axis_azimuth_deg':0})
    assert res.status_code==202
    assert client.get(res.json()['status_url'],headers=headers).json()['status']=='FAILED'
