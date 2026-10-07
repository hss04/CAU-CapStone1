from typing import Annotated
from datetime import datetime
from app.schemas import KST
from app.geometry import floor_area, perimeter

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import models as m, schemas as s
from app.geometry import contains, grid, validate_window
from app.security import CurrentUser, Db, DUMMY_HASH, create_token, password_hasher, unauthorized


router = APIRouter(prefix='/api/v1')
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


def owned_room(db, user, room_id):
    room = db.scalar(select(m.Room).where(m.Room.id==room_id,m.Room.user_id==user.id))
    if room is None:
        raise HTTPException(404,'Room not found')
    return room


def owned_window(db, user, window_id):
    window = db.scalar(select(m.Window).join(m.Room).where(m.Window.id==window_id,m.Room.user_id==user.id))
    if window is None:
        raise HTTPException(404,'Window not found')
    return window


def owned_plant(db, user, plant_id):
    plant = db.scalar(select(m.Plant).where(m.Plant.id==plant_id,m.Plant.user_id==user.id))
    if plant is None:
        raise HTTPException(404,'Plant not found')
    return plant


def commit(db):
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409,'Data conflict; reload and retry') from exc


def login_user(db, email, password):
    user = db.scalar(select(m.User).where(m.User.email==str(email).strip().lower()))
    valid = password_hasher.verify(password,user.password_hash if user else DUMMY_HASH)
    if user is None or not valid:
        raise unauthorized()
    return create_token(user)


@router.post('/auth/register',response_model=s.UserOut,status_code=201,tags=['Auth'])
def register(body:s.Register, db:Db):
    user=m.User(email=str(body.email).lower(),password_hash=password_hasher.hash(body.password),nickname=body.nickname)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409,'Email already registered') from exc
    return user


@router.post('/auth/login',response_model=s.Token,tags=['Auth'])
def login(body:s.Login,db:Db):
    return login_user(db,body.email,body.password)


@router.post('/auth/token',response_model=s.Token,tags=['Auth'],summary='Swagger login: use email as username')
def form_login(form:Annotated[OAuth2PasswordRequestForm,Depends()],db:Db):
    if len(form.password)>128 or len(form.username)>254:
        raise unauthorized()
    return login_user(db,form.username,form.password)


@router.get('/users/me',response_model=s.UserOut,tags=['Auth'])
def me(user:CurrentUser):
    return user


@router.post('/rooms',response_model=s.RoomOut,status_code=201,tags=['Rooms'])
def create_room(body:s.RoomInput,db:Db,user:CurrentUser):
    values=body.model_dump(exclude={'corners','coordinate_system'})
    room=m.Room(user_id=user.id,coordinate_frame=body.coordinate_system,
                saved_at=datetime.now(KST).isoformat(),**values)
    room.corners=[m.RoomCorner(**c.model_dump()) for c in body.corners]
    db.add(room)
    commit(db)
    return room


@router.get('/rooms',response_model=list[s.RoomOut],tags=['Rooms'])
def rooms(db:Db,user:CurrentUser,limit:Limit=50,offset:Offset=0):
    return db.scalars(select(m.Room).where(m.Room.user_id==user.id).order_by(m.Room.id).limit(limit).offset(offset)).all()


@router.post('/rooms/import-ar',response_model=s.RoomOut,status_code=201,tags=['Rooms'],
             summary='Import the Android schema_version 3 room export atomically')
def import_ar(body:s.ARMeasurement,db:Db,user:CurrentUser,
              name:Annotated[str,Query(min_length=1,max_length=100)]='AR 측정 방',
              x_axis_azimuth_deg:Annotated[float|None,Query(ge=0,lt=360,allow_inf_nan=False)]=None):
    room=m.Room(user_id=user.id,name=name,coordinate_frame=body.coordinate_system,
                saved_at=body.saved_at.isoformat(),x_axis_azimuth_deg=x_axis_azimuth_deg)
    room.corners=[m.RoomCorner(**c.model_dump()) for c in body.corners]
    room.windows=[m.Window(name=f'창문 {i+1}',measurement=w.model_dump(mode='json'),
                           corners=[m.WindowCorner(**c.model_dump()) for c in w.corners])
                  for i,w in enumerate(body.windows)]
    db.add(room)
    commit(db)
    return room


@router.get('/rooms/{room_id}/ar-measurement',response_model=s.ARMeasurement,tags=['Rooms'])
def export_ar(room_id:int,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    if room.coordinate_frame != s.COORDINATE_SYSTEM or not room.saved_at:
        raise HTTPException(409,'Legacy coordinates require reimport from the Android source')
    if any(w.measurement is None for w in room.windows):
        raise HTTPException(409,'This room has manually entered windows without Android measurement metadata')
    return {'schema_version':3,'unit':'m','coordinate_system':room.coordinate_frame,
            'saved_at':room.saved_at,'corners':[s.Corner.model_validate(c) for c in room.corners],
            'area_square_meters':s.round_m(floor_area(room.corners)),
            'perimeter_meters':s.round_m(perimeter(room.corners)),
            'windows':[w.measurement for w in room.windows]}


@router.get('/rooms/{room_id}',response_model=s.RoomOut,tags=['Rooms'])
def get_room(room_id:int,db:Db,user:CurrentUser):
    return owned_room(db,user,room_id)


@router.put('/rooms/{room_id}',response_model=s.RoomOut,tags=['Rooms'])
def update_room(room_id:int,body:s.RoomInput,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    if room.coordinate_frame != body.coordinate_system and (room.plants or room.windows):
        raise HTTPException(409,'Coordinate frame change requires source reimport into a new room')
    for plant in room.plants:
        if not contains(body.corners,plant.x,plant.z):
            raise HTTPException(409,'Existing plant lies outside new room; move or unassign it first')
    for window in room.windows:
        try:
            if window.measurement is not None:
                s.ARMeasurement(schema_version=3,unit='m',coordinate_system=body.coordinate_system,
                    saved_at=room.saved_at,corners=body.corners,
                    area_square_meters=floor_area(body.corners),perimeter_meters=perimeter(body.corners),
                    windows=[window.measurement])
            else:
                validate_window(window.corners,body.corners)
        except ValueError as exc:
            raise HTTPException(409,'Existing window conflicts with new room; update/delete it first') from exc
    for key,value in body.model_dump(exclude={'corners','coordinate_system'}).items():
        setattr(room,key,value)
    room.coordinate_frame=body.coordinate_system
    room.saved_at=datetime.now(KST).isoformat()
    room.corners.clear()
    db.flush() # Delete old unique (room_id, order_index) before replacement.
    room.corners=[m.RoomCorner(**c.model_dump()) for c in body.corners]
    room.geometry_version+=1
    commit(db)
    return room


@router.delete('/rooms/{room_id}',status_code=204,tags=['Rooms'])
def delete_room(room_id:int,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    for plant in list(room.plants):
        plant.room=None
        plant.x=plant.y=plant.z=None
    db.delete(room)
    commit(db)
    return Response(status_code=204)


@router.get('/rooms/{room_id}/grid',response_model=s.GridSpec,tags=['Geometry'])
def get_grid(room_id:int,db:Db,user:CurrentUser,
             cell_size_m:Annotated[float,Query(ge=0.05,le=5,allow_inf_nan=False)]=0.25,
             sample_height_m:Annotated[float,Query(ge=0,le=10,allow_inf_nan=False)]=0):
    room=owned_room(db,user,room_id)
    if room.coordinate_frame != s.COORDINATE_SYSTEM:
        raise HTTPException(409,'Legacy coordinates require reimport from Android before grid generation')
    try:
        return grid(room,cell_size_m,sample_height_m)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc


@router.post('/rooms/{room_id}/dli-map/validate',response_model=s.DliMap,tags=['Geometry'],
             summary='Validate a proposed DLI JSON payload; does not calculate or persist light')
def validate_dli(room_id:int,body:s.DliMap,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    if room.coordinate_frame != s.COORDINATE_SYSTEM:
        raise HTTPException(409,'Legacy coordinates require reimport from Android before DLI validation')
    if body.room_id!=room.id:
        raise HTTPException(422,'DLI map room_id must match URL')
    if body.geometry_version!=room.geometry_version:
        raise HTTPException(409,'Geometry changed; regenerate the grid and light results')
    if body.timezone!=room.timezone:
        raise HTTPException(422,'DLI timezone must match room timezone')
    try:
        expected=grid(room,body.grid.cell_size_m,body.grid.sample_height_m)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    if body.grid.model_dump()!=s.GridSpec.model_validate(expected).model_dump():
        raise HTTPException(422,'Grid must match GET /rooms/{room_id}/grid')
    return body


@router.post('/rooms/{room_id}/windows',response_model=s.WindowOut,status_code=201,tags=['Windows'])
def create_window(room_id:int,body:s.WindowInput,db:Db,user:CurrentUser):
    room=owned_room(db,user,room_id)
    try:
        corners=validate_window(body.corners,room.corners)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    window=m.Window(room_id=room.id,name=body.name,corners=[m.WindowCorner(**c.model_dump()) for c in corners])
    db.add(window)
    room.geometry_version+=1
    commit(db)
    return window


@router.get('/rooms/{room_id}/windows',response_model=list[s.WindowOut],tags=['Windows'])
def windows(room_id:int,db:Db,user:CurrentUser,limit:Limit=50,offset:Offset=0):
    owned_room(db,user,room_id)
    return db.scalars(select(m.Window).where(m.Window.room_id==room_id).order_by(m.Window.id).limit(limit).offset(offset)).all()


@router.get('/windows/{window_id}',response_model=s.WindowOut,tags=['Windows'])
def get_window(window_id:int,db:Db,user:CurrentUser):
    return owned_window(db,user,window_id)


@router.put('/windows/{window_id}',response_model=s.WindowOut,tags=['Windows'])
def update_window(window_id:int,body:s.WindowInput,db:Db,user:CurrentUser):
    window=owned_window(db,user,window_id)
    room=owned_room(db,user,window.room_id)
    try:
        corners=validate_window(body.corners,room.corners)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    window.name=body.name
    window.measurement=None # A manual replacement cannot retain original AR measurement claims.
    window.corners.clear()
    db.flush()
    window.corners=[m.WindowCorner(**c.model_dump()) for c in corners]
    room.geometry_version+=1
    commit(db)
    return window


@router.delete('/windows/{window_id}',status_code=204,tags=['Windows'])
def delete_window(window_id:int,db:Db,user:CurrentUser):
    window=owned_window(db,user,window_id)
    owned_room(db,user,window.room_id).geometry_version+=1
    db.delete(window)
    commit(db)
    return Response(status_code=204)


@router.get('/plant-species',response_model=list[s.SpeciesOut],tags=['Plant species'])
def species(db:Db,user:CurrentUser,q:str=Query(default='',max_length=100),limit:Limit=50,offset:Offset=0):
    query=select(m.PlantSpecies)
    if q:
        query=query.where(m.PlantSpecies.name.contains(q,autoescape=True))
    return db.scalars(query.order_by(m.PlantSpecies.id).limit(limit).offset(offset)).all()


@router.get('/plant-species/{species_id}',response_model=s.SpeciesOut,tags=['Plant species'])
def get_species(species_id:int,db:Db,user:CurrentUser):
    item=db.get(m.PlantSpecies,species_id)
    if item is None:
        raise HTTPException(404,'Plant species not found')
    return item


def set_plant(plant,body,db,user):
    if db.get(m.PlantSpecies,body.species_id) is None:
        raise HTTPException(404,'Plant species not found')
    if body.room_id is not None:
        room=owned_room(db,user,body.room_id)
        if not contains(room.corners,body.position.x,body.position.z):
            raise HTTPException(422,'Plant x/z must be inside its room')
    plant.species_id=body.species_id
    plant.nickname=body.nickname
    plant.room_id=body.room_id
    for key in ('x','y','z'):
        setattr(plant,key,getattr(body.position,key) if body.position else None)


@router.post('/plants',response_model=s.PlantOut,status_code=201,tags=['Plants'])
def create_plant(body:s.PlantInput,db:Db,user:CurrentUser):
    plant=m.Plant(user_id=user.id)
    set_plant(plant,body,db,user)
    db.add(plant)
    commit(db)
    return plant


@router.get('/plants',response_model=list[s.PlantOut],tags=['Plants'])
def plants(db:Db,user:CurrentUser,room_id:int|None=Query(default=None,gt=0),limit:Limit=50,offset:Offset=0):
    query=select(m.Plant).where(m.Plant.user_id==user.id)
    if room_id is not None:
        owned_room(db,user,room_id)
        query=query.where(m.Plant.room_id==room_id)
    return db.scalars(query.order_by(m.Plant.id).limit(limit).offset(offset)).all()


@router.get('/plants/{plant_id}',response_model=s.PlantOut,tags=['Plants'])
def get_plant(plant_id:int,db:Db,user:CurrentUser):
    return owned_plant(db,user,plant_id)


@router.put('/plants/{plant_id}',response_model=s.PlantOut,tags=['Plants'])
def update_plant(plant_id:int,body:s.PlantInput,db:Db,user:CurrentUser):
    plant=owned_plant(db,user,plant_id)
    set_plant(plant,body,db,user)
    commit(db)
    return plant


@router.delete('/plants/{plant_id}',status_code=204,tags=['Plants'])
def delete_plant(plant_id:int,db:Db,user:CurrentUser):
    db.delete(owned_plant(db,user,plant_id))
    commit(db)
    return Response(status_code=204)
