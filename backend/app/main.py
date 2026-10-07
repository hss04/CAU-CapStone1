from contextlib import asynccontextmanager

from sqlalchemy import inspect
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.weather import router as weather_router
from app.config import get_settings
from app.database import Base, engine


@asynccontextmanager
async def lifespan(app:FastAPI):
    # Schema additions are applied explicitly with scripts/migrate_v3.py.
    Base.metadata.create_all(bind=engine)
    inspector=inspect(engine)
    for table,column in [('rooms','saved_at'),('windows','measurement')]:
        if column not in {c['name'] for c in inspector.get_columns(table)}:
            raise RuntimeError('Existing DB needs migration: stop server and run python scripts/migrate_v3.py')
    yield


app=FastAPI(title='PlantLight API',version='0.3.0',lifespan=lifespan,
            description='JWT + rooms/windows + plant placement. Open-Meteo DNI/DHI retrieval and DB cache; DLI calculation is a separate module.')
if get_settings().cors_origins:
    app.add_middleware(CORSMiddleware,allow_origins=get_settings().cors_origins,
                       allow_credentials=False,allow_methods=['GET','POST','PUT','DELETE'],
                       allow_headers=['Authorization','Content-Type'])
app.include_router(router)
app.include_router(weather_router)


@app.get('/health',tags=['Health'])
def health():
    return {'status':'ok'}
