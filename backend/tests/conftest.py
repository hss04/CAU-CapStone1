import os

os.environ['JWT_SECRET']='only-for-tests-never-use-in-production-123456789'
os.environ['DATABASE_URL']='sqlite:///:memory:'

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, build_engine, get_db
from app.main import app
from app.models import PlantSpecies


@pytest.fixture
def context(tmp_path):
    engine=build_engine(f'sqlite:///{tmp_path}/test.db')
    Base.metadata.create_all(engine)
    factory=sessionmaker(engine,expire_on_commit=False)
    def override_db():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db]=override_db
    with factory() as db:
        db.add(PlantSpecies(name='Test species',min_dli=2,max_dli=6,source_note='Synthetic test values'))
        db.commit()
    with TestClient(app) as client:
        yield client,factory
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def client(context):
    return context[0]


@pytest.fixture
def headers(client):
    response=client.post('/api/v1/auth/register',json={'email':'owner@example.com','password':' test-password ','nickname':'owner'})
    assert response.status_code==201,response.text
    token=client.post('/api/v1/auth/login',json={'email':'owner@example.com','password':' test-password '}).json()['access_token']
    return {'Authorization':f'Bearer {token}'}


@pytest.fixture
def other_headers(client):
    client.post('/api/v1/auth/register',json={'email':'other@example.com','password':'other-password','nickname':'other'})
    token=client.post('/api/v1/auth/login',json={'email':'other@example.com','password':'other-password'}).json()['access_token']
    return {'Authorization':f'Bearer {token}'}
