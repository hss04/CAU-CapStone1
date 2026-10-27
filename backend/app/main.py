from contextlib import asynccontextmanager

from sqlalchemy import inspect, text, update
from app.integration_models import IntegrationJob
from app.database import SessionLocal
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.weather import router as weather_router
from app.integration import router as integration_router
from app.config import get_settings
from app.database import Base, engine
from app.algorithm_bridge import ALGORITHM_DIR
from fastapi.responses import JSONResponse


@asynccontextmanager
async def lifespan(app:FastAPI):
    # Schema additions are applied explicitly with scripts/migrate_v4.py.
    Base.metadata.create_all(bind=engine)
    inspector=inspect(engine)
    for table,column in [('rooms','saved_at'),('windows','measurement'),('rooms','location_name'),('plants','watering_interval_days'),('plants','last_watered_at')]:
        if column not in {c['name'] for c in inspector.get_columns(table)}:
            raise RuntimeError('Existing DB needs migration: stop server and run python scripts/migrate_v4.py')
    # This MVP uses one server worker. A restart interrupts in-process jobs.
    with SessionLocal() as db:
        from app.species_seed import seed_species
        seed_species(db)
        db.execute(update(IntegrationJob).where(IntegrationJob.status.in_(['PENDING','RUNNING']))
                   .values(status='FAILED',error='Server restarted during processing; submit again'))
        db.commit()
    yield


app=FastAPI(title='PlantLight API',version='0.4.0',lifespan=lifespan,
            description='JWT + rooms/windows + plant placement. Open-Meteo DNI/DHI retrieval and DB cache; DLI calculation is a separate module.')
if get_settings().cors_origins:
    app.add_middleware(CORSMiddleware,allow_origins=get_settings().cors_origins,
                       allow_credentials=False,allow_methods=['GET','POST','PUT','DELETE'],
                       allow_headers=['Authorization','Content-Type','Idempotency-Key'])
app.include_router(router)
app.include_router(weather_router)
app.include_router(integration_router)


@app.get('/health',tags=['Health'])
def health():
    return {'status':'ok'}


@app.get('/ready',tags=['Health'],summary='Check database and algorithm directory readiness')
def ready():
    try:
        with engine.connect() as connection:
            connection.execute(text('SELECT 1'))
        database_status='ok'
    except Exception:
        database_status='error'

    algorithm_status='available' if ALGORITHM_DIR.is_dir() else 'missing'
    if database_status!='ok' or algorithm_status!='available':
        return JSONResponse(status_code=503,content={
            'status':'not_ready',
            'checks':{'database':database_status,'algorithm_directory':algorithm_status}
        })
    return {'status':'ready','checks':{'database':'ok','algorithm_directory':'available'}}
