"""Private photo uploads and chronological plant growth timelines."""
from datetime import date, datetime, timezone
import hashlib
import json
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Header, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import undefer

from app import growth_schemas as s, models as m
from app.api import Limit, Offset, commit, owned_plant
from app.growth_images import MAX_UPLOAD_BYTES, prepare_image
from app.schemas import KST
from app.security import CurrentUser, Db


router = APIRouter(prefix='/api/v1', tags=['Plant growth photos'])


def owned_photo(db, user, photo_id, *, binary_field=None):
    query = select(m.GrowthPhoto).join(m.Plant).where(
        m.GrowthPhoto.id == photo_id, m.Plant.user_id == user.id)
    if binary_field is not None:
        query = query.options(undefer(binary_field))
    photo = db.scalar(query)
    if photo is None:
        raise HTTPException(404, 'Growth photo not found')
    return photo


@router.post('/plants/{plant_id}/growth-photos', response_model=s.GrowthPhotoOut, status_code=201,
             summary='Upload one dated plant photo using multipart/form-data')
def upload_photo(plant_id: int, db: Db, user: CurrentUser,
                 file: UploadFile = File(...),
                 taken_at: s.TakenAt | None = Form(default=None),
                 note: str | None = Form(default=None, max_length=2000),
                 idempotency_key: Annotated[str | None, Header(alias='Idempotency-Key', min_length=1, max_length=128)] = None):
    plant = owned_plant(db, user, plant_id)
    if idempotency_key is not None:
        idempotency_key = idempotency_key.strip()
        if not idempotency_key:
            raise HTTPException(422, 'Idempotency-Key must not be blank')
    note = note.strip() if note is not None else None
    try:
        if file.size is not None and file.size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, 'Photo exceeds the 10 MiB upload limit')
        raw = file.file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        file.file.close()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, 'Photo exceeds the 10 MiB upload limit')
    request_hash = hashlib.sha256(json.dumps({
        'image_sha256': hashlib.sha256(raw).hexdigest(),
        'taken_at': taken_at.isoformat() if taken_at is not None else None,
        'note': note,
    }, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()
    if idempotency_key is not None:
        prior = db.scalar(select(m.GrowthPhoto).where(
            m.GrowthPhoto.plant_id == plant.id, m.GrowthPhoto.upload_key == idempotency_key))
        if prior is not None:
            if prior.request_hash != request_hash:
                raise HTTPException(409, 'Idempotency-Key was used for a different photo request')
            return prior
    image, thumbnail, width, height = prepare_image(raw, file.content_type)
    timestamp = taken_at or datetime.now(timezone.utc)
    photo = m.GrowthPhoto(plant_id=plant.id, taken_at=timestamp,
        taken_on=timestamp.astimezone(KST).date(), note=note, width=width, height=height,
        byte_size=len(image), image_data=image, thumbnail_data=thumbnail,
        upload_key=idempotency_key, request_hash=request_hash if idempotency_key is not None else None)
    db.add(photo)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if idempotency_key is not None:
            prior = db.scalar(select(m.GrowthPhoto).where(
                m.GrowthPhoto.plant_id == plant.id, m.GrowthPhoto.upload_key == idempotency_key))
            if prior is not None and prior.request_hash == request_hash:
                return prior
        raise HTTPException(409, 'Photo data conflict; reload and retry') from exc
    return photo


@router.get('/plants/{plant_id}/growth-photos', response_model=s.GrowthPhotoList,
            summary='Paginated photo timeline ordered by capture time')
def photo_timeline(plant_id: int, db: Db, user: CurrentUser,
                   start_date: date | None = None, end_date: date | None = None,
                   order: Literal['asc', 'desc'] = 'asc', limit: Limit = 50, offset: Offset = 0):
    plant = owned_plant(db, user, plant_id)
    if start_date is not None and end_date is not None and end_date < start_date:
        raise HTTPException(422, 'end_date must be on or after start_date')
    conditions = [m.GrowthPhoto.plant_id == plant.id]
    if start_date is not None:
        conditions.append(m.GrowthPhoto.taken_on >= start_date)
    if end_date is not None:
        conditions.append(m.GrowthPhoto.taken_on <= end_date)
    total = db.scalar(select(func.count()).select_from(m.GrowthPhoto).where(*conditions))
    sorting = (m.GrowthPhoto.taken_at.asc(), m.GrowthPhoto.id.asc()) if order == 'asc' else (
        m.GrowthPhoto.taken_at.desc(), m.GrowthPhoto.id.desc())
    photos = db.scalars(select(m.GrowthPhoto).where(*conditions).order_by(*sorting)
                        .limit(limit).offset(offset)).all()
    return s.GrowthPhotoList(plant_id=plant.id, plant_nickname=plant.nickname, total=total,
        limit=limit, offset=offset, has_more=offset + len(photos) < total,
        photos=[s.GrowthPhotoOut.model_validate(photo) for photo in photos])


@router.get('/growth-photos/{photo_id}', response_model=s.GrowthPhotoOut)
def photo_metadata(photo_id: int, db: Db, user: CurrentUser):
    return owned_photo(db, user, photo_id)


@router.patch('/growth-photos/{photo_id}', response_model=s.GrowthPhotoOut,
              summary='Edit capture time or note without replacing the image')
def update_photo(photo_id: int, body: s.GrowthPhotoUpdate, db: Db, user: CurrentUser):
    photo = owned_photo(db, user, photo_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(photo, field, value)
    if 'taken_at' in body.model_fields_set:
        photo.taken_on = body.taken_at.astimezone(KST).date()
    commit(db)
    return photo


def image_response(data):
    return Response(content=data, media_type='image/jpeg', headers={
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/growth-photos/{photo_id}/image', response_class=Response,
            responses={200: {'content': {'image/jpeg': {'schema': {'type': 'string', 'format': 'binary'}}}}})
def photo_image(photo_id: int, db: Db, user: CurrentUser):
    photo = owned_photo(db, user, photo_id, binary_field=m.GrowthPhoto.image_data)
    return image_response(photo.image_data)


@router.get('/growth-photos/{photo_id}/thumbnail', response_class=Response,
            responses={200: {'content': {'image/jpeg': {'schema': {'type': 'string', 'format': 'binary'}}}}})
def photo_thumbnail(photo_id: int, db: Db, user: CurrentUser):
    photo = owned_photo(db, user, photo_id, binary_field=m.GrowthPhoto.thumbnail_data)
    return image_response(photo.thumbnail_data)


@router.delete('/growth-photos/{photo_id}', status_code=204)
def delete_photo(photo_id: int, db: Db, user: CurrentUser):
    db.delete(owned_photo(db, user, photo_id))
    commit(db)
    return Response(status_code=204)
