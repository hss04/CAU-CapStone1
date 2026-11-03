"""Stored constraints, restorable results and transactional recommendation plans."""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import Field, StrictInt
from sqlalchemy import select, text

from app import models as m, schemas as s, dli_cache
from app.api import commit, owned_room
from app.geometry import grid
from app.integration import RecommendationRequest, recommendation_data, status, light_inputs_changed
from app.integration_models import IntegrationJob, PlacementPlan, PlacementRules
from app.job_control import admission_lock
from app.placement_service import cell_for_position, decisions, effective_blocked, placement_snapshot
from app.security import CurrentUser, Db
from app.species_evidence import evidence_for_species
from app.weather import utc


router = APIRouter(prefix='/api/v1', tags=['Placement plans'])


class BlockedCellsInput(s.Input):
    geometry_version: int = Field(gt=0, strict=True)
    cell_size_m: float = Field(default=.2, ge=.05, le=5, allow_inf_nan=False)
    blocked_cells: list[tuple[StrictInt, StrictInt]] = Field(default_factory=list, max_length=40000)


@router.get('/rooms/{room_id}/blocked-cells')
def get_blocked(room_id: int, db: Db, user: CurrentUser,
                cell_size_m: float = Query(default=.2, ge=.05, le=5, allow_inf_nan=False)):
    room = owned_room(db, user, room_id)
    spec = grid(room, cell_size_m, 0)
    rules = db.get(PlacementRules, room_id)
    stale = bool(rules and (rules.geometry_version != room.geometry_version or
                            abs(rules.cell_size_m-spec['cell_size_m']) > 1e-8))
    return {'room_id': room_id, 'geometry_version': room.geometry_version,
            'cell_size_m': spec['cell_size_m'], 'stale': stale,
            'blocked_cells': rules.blocked_cells if rules and not stale else []}


@router.put('/rooms/{room_id}/blocked-cells')
def put_blocked(room_id: int, body: BlockedCellsInput, db: Db, user: CurrentUser):
    room = owned_room(db, user, room_id)
    if body.geometry_version != room.geometry_version:
        raise HTTPException(409, 'Geometry changed; reload the room grid')
    spec = grid(room, body.cell_size_m, 0)
    cells = sorted(set(body.blocked_cells))
    if any(not (0 <= r < spec['rows'] and 0 <= c < spec['cols'] and spec['inside_mask'][r][c]) for r, c in cells):
        raise HTTPException(422, 'Blocked cell must be inside the room grid')
    rules = db.get(PlacementRules, room_id)
    if rules is None:
        rules = PlacementRules(room_id=room_id)
        db.add(rules)
    rules.geometry_version = room.geometry_version
    rules.cell_size_m = spec['cell_size_m']
    rules.blocked_cells = [list(cell) for cell in cells]
    commit(db)
    return get_blocked(room_id, db, user, spec['cell_size_m'])


@router.delete('/rooms/{room_id}/blocked-cells', status_code=204)
def clear_blocked(room_id: int, db: Db, user: CurrentUser):
    owned_room(db, user, room_id)
    rules = db.get(PlacementRules, room_id)
    if rules is not None:
        db.delete(rules)
        commit(db)
    return Response(status_code=204)


def reusable_job(db, room, job):
    if job.status != 'COMPLETED' or job.kind != 'DLI' or job.result is None:
        return False
    try:
        if light_inputs_changed(job, room, db):
            return False
        return dli_cache.period_is_fresh(db, job.payload)
    except (HTTPException, KeyError, ValueError):
        return False


def latest_job(db, room, *, cell_size_m=None, sample_height_m=None, mock_sky=None):
    jobs = db.scalars(select(IntegrationJob).where(
        IntegrationJob.room_id == room.id, IntegrationJob.kind == 'DLI',
        IntegrationJob.status == 'COMPLETED').order_by(IntegrationJob.created_at.desc(), IntegrationJob.id.desc()))
    for job in jobs:
        spec = job.result['grid']
        if cell_size_m is not None and abs(spec['cell_size_m']-cell_size_m) > .0005:
            continue
        if sample_height_m is not None and abs(spec['sample_height_m']-sample_height_m) > .0005:
            continue
        if mock_sky is not None and job.payload['request']['mock_sky'] != mock_sky:
            continue
        if reusable_job(db, room, job):
            return job
    return None


@router.get('/rooms/{room_id}/dli-map/latest')
def latest_map(room_id: int, db: Db, user: CurrentUser,
               cell_size_m: float | None = Query(default=None, ge=.05, le=5, allow_inf_nan=False),
               sample_height_m: float | None = Query(default=None, ge=0, le=10, allow_inf_nan=False),
               mock_sky: bool = False):
    room = owned_room(db, user, room_id)
    job = latest_job(db, room, cell_size_m=cell_size_m, sample_height_m=sample_height_m, mock_sky=mock_sky)
    if job is None:
        raise HTTPException(404, 'No current saved DLI map for these options; calculate it first')
    return status(job.id, db, user)


@router.get('/rooms/{room_id}/jobs')
def room_jobs(room_id: int, db: Db, user: CurrentUser,
              kind: Literal['DLI', 'DLI_SERIES', 'SCAN'] | None = None,
              limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    owned_room(db, user, room_id)
    query = select(IntegrationJob).where(IntegrationJob.room_id == room_id, IntegrationJob.user_id == user.id)
    if kind is not None:
        query = query.where(IntegrationJob.kind == kind)
    jobs = db.scalars(query.order_by(IntegrationJob.created_at.desc(), IntegrationJob.id.desc()).limit(limit).offset(offset))
    result = []
    for job in jobs:
        item = status(job.id, db, user)
        item.pop('result')
        item['created_at'] = utc(job.created_at).isoformat()
        result.append(item)
    return {'room_id': room_id, 'jobs': result}


@router.post('/rooms/{room_id}/recommendation-plans', status_code=201)
def create_plan(room_id: int, body: RecommendationRequest, db: Db, user: CurrentUser):
    room = owned_room(db, user, room_id)
    output = recommendation_data(room_id, body, db, user)
    job = db.get(IntegrationJob, body.dli_job_id)
    if not reusable_job(db, room, job):
        raise HTTPException(409, 'DLI weather/cache has expired; calculate a fresh map')
    plan = PlacementPlan(id=str(uuid4()), user_id=user.id, room_id=room.id, dli_job_id=job.id,
        expires_at=datetime.now(timezone.utc)+timedelta(minutes=30),
        input_hash=placement_snapshot(db, room, job, body.blocked_cells),
        payload={'result': output, 'blocked_cells': [list(cell) for cell in body.blocked_cells]})
    db.add(plan)
    commit(db)
    species = {p.id: db.get(m.PlantSpecies, p.species_id) for p in room.plants}
    return {'plan_id': plan.id, 'expires_at': utc(plan.expires_at).isoformat(),
            'geometry_version': room.geometry_version, 'result': output,
            'decisions': [{**item, 'evidence': evidence_for_species(species[item['plant_id']])} for item in decisions(output)]}


class ApplyPlanInput(s.Input):
    plant_ids: list[Annotated[int, Field(gt=0, strict=True)]] | None = Field(default=None, min_length=1, max_length=1000)


@router.post('/rooms/{room_id}/recommendation-plans/{plan_id}/apply')
def apply_plan(room_id: int, plan_id: str, body: ApplyPlanInput, db: Db, user: CurrentUser):
    with admission_lock:
        user_id = user.id
        # SQLite's default SELECT does not acquire a write reservation. Reserve before
        # rereading the snapshot, so concurrent clients cannot split this transaction.
        if db.get_bind().dialect.name == 'sqlite':
            db.rollback()
            db.execute(text('BEGIN IMMEDIATE'))
            user = db.get(m.User, user_id)
        room = owned_room(db, user, room_id)
        db.execute(select(m.Room).where(m.Room.id == room_id).with_for_update())
        db.execute(select(m.Plant).where(m.Plant.room_id == room_id).with_for_update())
        db.expire(room, ['plants'])
        plan = db.get(PlacementPlan, plan_id)
        if plan is None or plan.user_id != user_id or plan.room_id != room_id:
            raise HTTPException(404, 'Recommendation plan not found')
        requested = None if body.plant_ids is None else sorted(body.plant_ids)
        if requested is not None and len(requested) != len(set(requested)):
            raise HTTPException(422, 'plant_ids must be unique')
        if plan.applied_result is not None:
            applied_ids = sorted(p['id'] for p in plan.applied_result['plants'])
            if requested is not None and requested != applied_ids:
                raise HTTPException(409, 'This plan was already applied to another selection')
            return plan.applied_result
        if utc(plan.expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(409, 'Recommendation plan expired; request a new plan')
        job = db.get(IntegrationJob, plan.dli_job_id)
        if not reusable_job(db, room, job):
            raise HTTPException(409, 'DLI inputs or weather changed; request a fresh calculation')
        if placement_snapshot(db, room, job, plan.payload['blocked_cells']) != plan.input_hash:
            raise HTTPException(409, 'Plants, species or blocked cells changed; request a new plan')
        entries = {p['plant_id']: p for p in plan.payload['result']['plants']}
        allowed = {item['plant_id'] for item in decisions(plan.payload['result']) if item['can_apply']}
        ids = allowed if requested is None else set(requested)
        if not ids or not ids <= allowed:
            raise HTTPException(409, 'Selection contains a plant without a suitable recommendation')
        spec = job.result['grid']
        blocked = effective_blocked(db, room, spec, plan.payload['blocked_cells'])
        targets = {pid: (entries[pid]['recommended']['row'], entries[pid]['recommended']['col']) for pid in ids}
        occupied = {cell_for_position({'x': p.x, 'z': p.z}, spec, room) for p in room.plants if p.id not in ids}
        if len(set(targets.values())) != len(targets) or any(cell in blocked or cell in occupied for cell in targets.values()):
            raise HTTPException(409, 'Apply all affected plants together; a target is occupied or blocked')
        changed = []
        for plant in room.plants:
            if plant.id not in ids:
                continue
            r, c = targets[plant.id]
            if not (0 <= r < spec['rows'] and 0 <= c < spec['cols'] and spec['inside_mask'][r][c]):
                raise HTTPException(409, 'A target is outside the current grid')
            plant.x = s.round_m(spec['origin']['x']+(c+.5)*spec['cell_size_m'])
            plant.z = s.round_m(spec['origin']['z']+(r+.5)*spec['cell_size_m'])
            plant.y = spec['sample_height_m']
            changed.append(s.PlantOut.model_validate(plant).model_dump(mode='json'))
        result = {'plan_id': plan.id, 'applied_count': len(changed), 'plants': sorted(changed, key=lambda p: p['id'])}
        plan.applied_result = result
        commit(db)
        return result


@router.get('/plant-species/{species_id}/evidence', tags=['Plant species'])
def species_evidence(species_id: int, db: Db, user: CurrentUser):
    species = db.get(m.PlantSpecies, species_id)
    if species is None:
        raise HTTPException(404, 'Plant species not found')
    return {'species_id': species.id, 'min_dli': species.min_dli, 'max_dli': species.max_dli,
            **evidence_for_species(species)}
