"""Single-worker admission, persistent request deduplication and visible progress."""
import hashlib
import json
from threading import BoundedSemaphore, RLock

from fastapi import HTTPException
from sqlalchemy import select, func

from app.integration_models import IntegrationJob, JobRequestKey, JobRuntime


admission_lock = RLock()
job_slot = BoundedSemaphore(1)
MAX_ACTIVE_PER_USER = 5
MAX_ACTIVE_TOTAL = 20


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def clean_key(key):
    if key is not None:
        key = key.strip()
        if not 1 <= len(key) <= 128:
            raise HTTPException(422, 'Idempotency-Key must contain 1 to 128 characters')
    return key


def find_existing(db, user_id, request_hash, key=None):
    key = clean_key(key)
    if key is not None:
        prior = db.get(JobRequestKey, (user_id, key))
        if prior is not None:
            if prior.request_hash != request_hash:
                raise HTTPException(409, 'Idempotency-Key was used for a different calculation or scan')
            return db.get(IntegrationJob, prior.job_id)
    return db.scalar(select(IntegrationJob).join(JobRuntime).where(
        IntegrationJob.user_id == user_id, JobRuntime.dedup_key == request_hash,
        IntegrationJob.status.in_(['PENDING', 'RUNNING'])))


def admit(db, user_id):
    active = select(IntegrationJob).where(IntegrationJob.status.in_(['PENDING', 'RUNNING']))
    own = db.scalar(select(func.count()).select_from(active.where(IntegrationJob.user_id == user_id).subquery()))
    total = db.scalar(select(func.count()).select_from(active.subquery()))
    if own >= MAX_ACTIVE_PER_USER or total >= MAX_ACTIVE_TOTAL:
        raise HTTPException(429, 'Calculation queue is full; wait for an existing job', headers={'Retry-After': '5'})


def attach(db, job, request_hash, key=None, total_steps=1):
    db.flush()
    db.add(JobRuntime(job_id=job.id, dedup_key=request_hash, total_steps=total_steps))
    remember_key(db, job, request_hash, key)


def remember_key(db, job, request_hash, key):
    key = clean_key(key)
    if key is not None and db.get(JobRequestKey, (job.user_id, key)) is None:
        db.add(JobRequestKey(user_id=job.user_id, key=key, request_hash=request_hash, job_id=job.id))


def accepted(job, reused=False):
    # Keep the original 202 response contract. Poll status_url for the actual state.
    return {'job_id': job.id, 'status': 'PENDING', 'status_url': f'/api/v1/jobs/{job.id}', 'reused': reused}


def progress(db, job_id, stage, completed_steps=None, error_code=None):
    item = db.get(JobRuntime, job_id)
    if item is not None:
        item.stage = stage
        if completed_steps is not None:
            item.completed_steps = completed_steps
        item.error_code = error_code


def classify_error(exc, kind):
    detail = str(getattr(exc, 'detail', exc))
    if 'Open-Meteo' in detail:
        return 'WEATHER_UNAVAILABLE'
    if 'changed' in detail or 'restarted' in detail:
        return 'INPUTS_CHANGED'
    if getattr(exc, 'status_code', None) == 504:
        return 'ALGORITHM_TIMEOUT'
    if kind == 'SCAN':
        return 'SCAN_ANALYSIS_FAILED'
    return 'CALCULATION_FAILED'
