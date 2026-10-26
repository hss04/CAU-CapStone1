from datetime import date, datetime, timedelta
import io
import math
import os
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from pydantic import Field, model_validator, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from PIL import Image, ImageOps

from app import models as m
from app.schemas import Input, DliMap, GridSpec, Position
from app.security import CurrentUser, Db
from app.api import owned_room, owned_window, commit
from app.geometry import grid
from app.weather import get_irradiance, fetch_raw
from app.integration_models import IntegrationJob
from app.algorithm_bridge import invoke

router = APIRouter(prefix='/api/v1', tags=['Integration'])
UPLOAD_ROOT = Path(os.environ.get('UPLOAD_ROOT', 'data/scans')).resolve()

class Location(Input):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)

@router.put('/rooms/{room_id}/location')
def set_location(room_id: int, body: Location, db: Db, user: CurrentUser):
    room = owned_room(db, user, room_id)
    room.latitude, room.longitude = body.latitude, body.longitude
    room.geometry_version += 1
    commit(db)
    return body

@router.get('/locations/search')
def locations(user: CurrentUser, q: str = Query(min_length=2, max_length=100)):
    raw = fetch_raw('https://geocoding-api.open-meteo.com/v1/search',
                    {'name': q, 'count': 10, 'language': 'ko', 'format': 'json'})
    return {'results': [{k: r.get(k) for k in ('id','name','country','admin1','latitude','longitude','timezone')}
                        for r in raw.get('results', [])]}

class DliRequest(Input):
    start_date: date
    end_date: date
    cell_size_m: float = Field(default=0.2, ge=0.05, le=5, allow_inf_nan=False)
    sample_height_m: float = Field(default=0, ge=0, le=10, allow_inf_nan=False)
    mock_sky: bool = False
    temporary_x_axis_azimuth_deg: float | None = Field(default=None, ge=0, lt=360, allow_inf_nan=False)
    accept_provisional_algorithm: bool = False

    @model_validator(mode='after')
    def period(self):
        if not 0 <= (self.end_date-self.start_date).days <= 92:
            raise ValueError('Period must contain 1 to 93 days')
        return self

class Period(Input):
    start_date: date
    end_date: date
    day_count: int = Field(ge=1)
    aggregation: str = 'DAILY_MEAN'

class DliResult(DliMap):
    period: Period
    mock_sky: bool
    temporary_direction: bool
    warnings: list[str]


def wall_index(window, room):
    if window.measurement is not None:
        return window.measurement['wall_index']
    # Derive for manually entered windows, which already pass wall validation.
    candidates = []
    for i,a in enumerate(room.corners):
        b = room.corners[(i+1) % len(room.corners)]
        dx,dz = b.x-a.x,b.z-a.z
        length = math.hypot(dx,dz)
        if length and all(abs((p.x-a.x)*dz-(p.z-a.z)*dx)/length <= .05 and
                         -.03 <= ((p.x-a.x)*dx+(p.z-a.z)*dz)/length <= length+.03
                         for p in window.corners):
            candidates.append(i)
    if len(candidates) != 1:
        raise HTTPException(422, 'Window wall is ambiguous; import AR measurement with wall_index')
    return candidates[0]


def prepare_dli(room, body, db):
    if room.latitude is None or room.longitude is None:
        raise HTTPException(422, 'Save room location first')
    angle = body.temporary_x_axis_azimuth_deg if body.temporary_x_axis_azimuth_deg is not None else room.x_axis_azimuth_deg
    if angle is None:
        raise HTTPException(422, 'Room direction is missing; supply explicit temporary direction for testing')
    try:
        spec = grid(room, body.cell_size_m, body.sample_height_m)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    # Upstream v1 assumes corners (0,0),(w,0),(w,d),(0,d), one window and y=0.
    c = room.corners
    supported = len(c)==4 and c[1].x>0 and c[2].z>0 and all(abs(a-b)<1e-6 for a,b in
        [(c[0].x,0),(c[0].z,0),(c[1].z,0),(c[2].x,c[1].x),(c[3].x,0),(c[3].z,c[2].z)])
    custom = os.environ.get('DLI_CALLABLE')
    if not custom and (not supported or len(room.windows)!=1 or body.sample_height_m!=0):
        raise HTTPException(501, 'Current algorithm supports only axis-aligned rectangular rooms, one window and height 0; set DLI_CALLABLE for the polygon/multi-window implementation')
    if not custom and not body.accept_provisional_algorithm:
        raise HTTPException(409, 'Upstream uses 08:00-18:00 and instantaneous interpolation of hourly means. Explicitly accept_provisional_algorithm for integration testing')
    windows=[]
    for w in room.windows:
        wi=wall_index(w,room)
        scan=None
        if not body.mock_sky:
            job=db.scalar(select(IntegrationJob).where(IntegrationJob.window_id==w.id,
                IntegrationJob.kind=='SCAN',IntegrationJob.status=='COMPLETED').order_by(IntegrationJob.created_at.desc()))
            if job is None or job.payload['geometry_version'] != room.geometry_version:
                raise HTTPException(409,'A current completed SKY scan is required for every window')
            scan=job.result
        windows.append({'window_id':w.id,'wall_index':wi,
            **{f'v{i}':[p.x,p.y,p.z] for i,p in enumerate(w.corners)},'sky':scan})
    if not windows:
        raise HTTPException(422,'At least one window is required')
    return spec, angle, windows, custom

@router.post('/rooms/{room_id}/dli-map', status_code=202)
def calculate(room_id:int, body:DliRequest, tasks:BackgroundTasks, db:Db, user:CurrentUser):
    room=owned_room(db,user,room_id)
    spec,angle,windows,custom=prepare_dli(room,body,db)
    payload={'request':body.model_dump(mode='json'),'grid':spec,'room_id':room.id,
        'geometry_version':room.geometry_version,'room':{'corners':[{'order_index':p.order_index,'x':p.x,'z':p.z} for p in room.corners],
        'height_m':max(p.y for w in room.windows for p in w.corners),
        'x_axis_azimuth_deg':angle,'latitude':room.latitude,'longitude':room.longitude},'windows':windows,'callable':custom}
    job=IntegrationJob(id=str(uuid4()),user_id=user.id,room_id=room_id,kind='DLI',payload=payload)
    db.add(job); commit(db)
    tasks.add_task(run_job,job.id,sessionmaker(bind=db.get_bind(),expire_on_commit=False))
    return {'job_id':job.id,'status':'PENDING','status_url':f'/api/v1/jobs/{job.id}'}


def compute_job(p,db):
    body=DliRequest(**p['request']); results=[]
    day=body.start_date
    while day<=body.end_date:
        weather=get_irradiance(db,p['room']['latitude'],p['room']['longitude'],day)
        payload={'room_id':p['room_id'],'room':p['room'],'date':day.isoformat(),'grid':p['grid'],
            'windows':p['windows'],'dni_dhi':weather['values'],'time_basis':weather['time_basis'],
            'mock_sky':body.mock_sky}
        if p['callable']:
            payload['_callable']=p['callable']; result=invoke('custom',payload)
        else:
            window=p['windows'][0]
            dx=window['v1'][0]-window['v0'][0]; dz=window['v1'][2]-window['v0'][2]
            payload.update(window=window,sky=window['sky'],window_outward_azimuth_deg=(p['room']['x_axis_azimuth_deg']+math.degrees(math.atan2(-dx,dz)))%360)
            result=invoke('dli',payload)
        for key in ['direct_dli','diffuse_dli']:
            a=result[key]
            if len(a)!=p['grid']['rows'] or any(len(row)!=p['grid']['cols'] for row in a):
                raise ValueError('Algorithm grid dimensions mismatch')
            if any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for r,row in enumerate(a) for c,v in enumerate(row) if p['grid']['inside_mask'][r][c]):
                raise ValueError('Invalid algorithm values')
        results.append(result); day+=timedelta(days=1)
    arrays={}
    for key in ['direct_dli','diffuse_dli']:
        arrays[key]=[[sum(x[key][r][c] for x in results)/len(results) if inside else None
                     for c,inside in enumerate(row)] for r,row in enumerate(p['grid']['inside_mask'])]
    arrays['total_dli']=[[None if d is None else d+arrays['diffuse_dli'][r][c] for c,d in enumerate(row)] for r,row in enumerate(arrays['direct_dli'])]
    return DliResult(room_id=p['room_id'],geometry_version=p['geometry_version'],date=body.start_date,
        timezone='Asia/Seoul',grid=p['grid'],period=Period(start_date=body.start_date,end_date=body.end_date,day_count=len(results)),
        mock_sky=body.mock_sky,temporary_direction=body.temporary_x_axis_azimuth_deg is not None,
        warnings=[] if p['callable'] else ['PROVISIONAL: upstream 08:00-18:00 only; hourly mean interpolation unresolved'],**arrays).model_dump(mode='json')


def run_job(job_id,factory):
    with factory() as db:
        job=db.get(IntegrationJob,job_id)
        if job is None:return
        job.status='RUNNING'; db.commit()
        try:
            result=compute_job(job.payload,db) if job.kind=='DLI' else invoke('scan',job.payload)
            if job.kind=='SCAN':
                if len(result['sky'])!=91 or any(len(r)!=360 for r in result['sky']) or len(result['max_captured_elevation_deg'])!=360:
                    raise ValueError('Invalid SKY dimensions')
                if any(v not in (-1,0,1) for row in result['sky'] for v in row):raise ValueError('Invalid SKY value')
            room=db.get(m.Room,job.room_id)
            db.refresh(room)
            if room.geometry_version!=job.payload['geometry_version']:raise ValueError('Room changed during calculation; submit again')
            if job.kind=='DLI' and job.payload['request']['temporary_x_axis_azimuth_deg'] is None and room.x_axis_azimuth_deg!=job.payload['room']['x_axis_azimuth_deg']:
                raise ValueError('Room direction changed during calculation')
            job.result=result; job.status='COMPLETED'
        except Exception as exc:
            db.rollback()
            job=db.get(IntegrationJob,job_id)
            if job is None:return
            job.status='FAILED'; job.error=exc.detail if isinstance(exc,HTTPException) else 'Processing failed; inspect server logs'
            import logging
            logging.getLogger(__name__).exception('Job %s failed',job_id)
        db.commit()

@router.get('/jobs/{job_id}')
def status(job_id:str,db:Db,user:CurrentUser):
    job=db.scalar(select(IntegrationJob).where(IntegrationJob.id==job_id,IntegrationJob.user_id==user.id))
    if job is None:raise HTTPException(404,'Job not found')
    room=owned_room(db,user,job.room_id)
    return {'job_id':job.id,'kind':job.kind,'status':job.status,'error':job.error,
            'stale':job.status=='STALE' or room.geometry_version!=job.payload['geometry_version'],'result':job.result}

class Camera(Input):
    hfov_deg:float=Field(gt=0,lt=180,allow_inf_nan=False)
    vfov_deg:float=Field(gt=0,lt=180,allow_inf_nan=False)
    width:int=Field(ge=1,le=1280)
    height:int=Field(default=1280,ge=1280,le=1280)

class Frame(Input):
    index:int=Field(ge=0,le=12)
    file:str=Field(min_length=1,max_length=100)
    azimuth_deg:float=Field(ge=0,lt=360,allow_inf_nan=False)
    azimuth_mag_deg:float=Field(ge=0,lt=360,allow_inf_nan=False)
    pitch_deg:float=Field(ge=-90,le=90,allow_inf_nan=False)
    roll_deg:float=Field(ge=-180,le=180,allow_inf_nan=False)

class Scan(Input):
    window_id:int
    captured_at:datetime
    declination_deg:float=Field(ge=-180,le=180,allow_inf_nan=False)
    window_azimuth_deg:float=Field(ge=0,lt=360,allow_inf_nan=False)
    window_azimuth_mag_deg:float=Field(ge=0,lt=360,allow_inf_nan=False)
    camera:Camera
    frames:list[Frame]=Field(min_length=13,max_length=13)

    @model_validator(mode='after')
    def valid_scan(self):
        if self.captured_at.utcoffset()!=timedelta(hours=9):raise ValueError('captured_at requires +09:00')
        if sorted(f.index for f in self.frames)!=list(range(13)) or len({f.file for f in self.frames})!=13:raise ValueError('Unique indices 0..12 and filenames required')
        def delta(a,b):return abs((a-b+180)%360-180)
        for a,b in [(self.window_azimuth_deg,self.window_azimuth_mag_deg)]+[(f.azimuth_deg,f.azimuth_mag_deg) for f in self.frames]:
            if delta(a,b+self.declination_deg)>1:raise ValueError('True/magnetic azimuth mismatch')
        for f in self.frames:
            if delta(f.azimuth_deg,self.window_azimuth_deg-90+15*f.index)>5:raise ValueError('Frame angles must span -90..90 at 15 degree intervals (5 degree tolerance)')
        return self

@router.post('/windows/{window_id}/scans',status_code=202)
async def upload_scan(window_id:int,tasks:BackgroundTasks,db:Db,user:CurrentUser,
                      metadata:str=Form(...),files:list[UploadFile]=File(...)):
    window=owned_window(db,user,window_id); room=owned_room(db,user,window.room_id)
    try:body=Scan.model_validate_json(metadata)
    except ValidationError as exc:raise HTTPException(422,str(exc)) from exc
    if body.window_id!=window_id:raise HTTPException(422,'window_id mismatch')
    if len(files)!=13 or len({f.filename for f in files})!=13 or {f.filename for f in files}!={f.file for f in body.frames}:raise HTTPException(422,'Exactly 13 matching JPEG files required')
    job_id=str(uuid4()); folder=UPLOAD_ROOT/job_id; folder.mkdir(parents=True)
    payload=body.model_dump(mode='json'); payload['geometry_version']=room.geometry_version
    by_name={f.filename:f for f in files}
    try:
        for frame in payload['frames']:
            raw=await by_name[frame['file']].read(5*1024*1024+1)
            if len(raw)>5*1024*1024:raise HTTPException(413,'Each JPEG must be <=5 MiB')
            try:
                im=Image.open(io.BytesIO(raw))
                if im.format!='JPEG' or im.size!=(body.camera.width,body.camera.height):raise ValueError()
                if im.getexif().get(274,1)!=1:raise ValueError()
                im.verify()
            except Exception as exc:raise HTTPException(422,'Expected upright JPEG matching camera dimensions') from exc
            path=folder/f"{frame['index']:02d}.jpg"; path.write_bytes(raw); frame['path']=str(path)
        job=IntegrationJob(id=job_id,user_id=user.id,room_id=room.id,window_id=window_id,kind='SCAN',payload=payload)
        db.add(job); commit(db)
    except Exception:
        shutil.rmtree(folder,ignore_errors=True); raise
    finally:
        for f in files:await f.close()
    tasks.add_task(run_job,job_id,sessionmaker(bind=db.get_bind(),expire_on_commit=False))
    return {'job_id':job_id,'status':'PENDING','status_url':f'/api/v1/jobs/{job_id}'}

@router.post('/rooms/{room_id}/direction')
def direction(room_id:int,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    fn=os.environ.get('DIRECTION_CALLABLE')
    if not fn:raise HTTPException(501,'Direction function not supplied; configure DIRECTION_CALLABLE=module:function')
    scans=[]
    for w in room.windows:
        jobs=db.scalars(select(IntegrationJob).where(IntegrationJob.window_id==w.id,IntegrationJob.kind=='SCAN')).all()
        jobs=[j for j in jobs if j.payload['geometry_version']==room.geometry_version]
        if jobs:
            j=max(jobs,key=lambda x:x.payload['captured_at'])
            scans.append({'wall_index':wall_index(w,room),'window_azimuth_deg':j.payload['window_azimuth_deg']})
    if not scans:raise HTTPException(409,'Upload window scans first')
    result=invoke('custom',{'_callable':fn,'corners':[{'x':p.x,'z':p.z,'order_index':p.order_index} for p in room.corners],'windows':scans})
    angle=result['x_axis_azimuth_deg']
    if not isinstance(angle,(int,float)) or not math.isfinite(angle) or not 0<=angle<360:raise HTTPException(502,'Invalid direction result')
    room.x_axis_azimuth_deg=angle
    # Direction does not change scan geometry; DLI results using old direction marked stale separately.
    for j in db.scalars(select(IntegrationJob).where(IntegrationJob.room_id==room.id,IntegrationJob.kind=='DLI')):
        if j.status=='COMPLETED':j.status='STALE'
    commit(db)
    return {'x_axis_azimuth_deg':angle}

class RecommendationRequest(Input):
    dli_job_id:str
    blocked_cells:list[tuple[int,int]]=Field(default_factory=list,max_length=40000)

@router.post('/rooms/{room_id}/recommendations')
def recommend(room_id:int,body:RecommendationRequest,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    result=status(body.dli_job_id,db,user)
    job=db.get(IntegrationJob,body.dli_job_id)
    if job.room_id!=room.id or job.kind!='DLI' or result['status']!='COMPLETED' or result['stale']:raise HTTPException(409,'A current completed DLI job for this room is required')
    fn=os.environ.get('RECOMMENDATION_CALLABLE')
    if not fn:raise HTTPException(501,'Recommendation function not supplied; configure RECOMMENDATION_CALLABLE=module:function')
    plants=[]
    for p in room.plants:
        species=db.get(m.PlantSpecies,p.species_id)
        plants.append({'plant_id':p.id,'species_id':species.id,'position':{'x':p.x,'y':p.y,'z':p.z},'min_dli':species.min_dli,'max_dli':species.max_dli})
    spec=job.result['grid']
    if any(not(0<=r<spec['rows'] and 0<=c<spec['cols']) for r,c in body.blocked_cells):raise HTTPException(422,'Blocked cell outside grid')
    return invoke('custom',{'_callable':fn,'room_id':room.id,'dli_map':job.result,'plants':plants,'blocked_cells':[{'row':r,'col':c} for r,c in body.blocked_cells]})
