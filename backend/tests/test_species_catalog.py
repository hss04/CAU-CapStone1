"""Catalog identity, provenance, backward compatibility and searchable household names."""
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.database import Base, build_engine
from app.models import Plant, PlantSpecies
from app.species_catalog import catalog_entries, catalog_plants, load_catalog, scientific_key
from app.species_seed import seed_species


def test_catalog_has_100_additions_and_preserves_legacy_six():
    entries = catalog_entries()
    raw, _ = load_catalog()
    legacy = json.loads(Path('examples/species-six.json').read_text(encoding='utf-8'))
    assert len(entries) == 106 and raw['legacy_count'] == 6 and raw['added_count'] == 100
    assert entries[:6] == legacy
    assert len({row['name'] for row in entries}) == 106
    assert len({scientific_key(row['scientific_name']) for row in entries}) == 106
    for plant, entry in zip(catalog_plants(), entries):
        assert 0 <= entry['min_dli'] <= entry['max_dli']
        assert 0 < len(entry['source_note']) <= 500
        assert plant['botanical_source'].startswith('https://')
        assert entry['source_note'].startswith(('PROVISIONAL', 'ESTIMATED'))
        if raw['profiles'][plant['light_profile']]['basis'] == 'ESTIMATED':
            assert entry['source_note'].startswith('ESTIMATED')
    assert next(row for row in entries if row['scientific_name'] == 'Schlumbergera truncata')['max_dli'] == 10
    assert next(row for row in entries if row['scientific_name'] == 'Dracaena fragrans')['max_dli'] == 8
    assert next(row for row in entries if row['scientific_name'] == 'Dracaena stuckyi')['max_dli'] == 14


def test_seed_preserves_existing_six_ids_edits_and_user_plant(context, headers):
    client, factory = context
    legacy = json.loads(Path('examples/species-six.json').read_text(encoding='utf-8'))
    with factory() as db:
        rows = [PlantSpecies(**row) for row in legacy]
        db.add_all(rows)
        db.commit()
        ids = {row.scientific_name: row.id for row in rows}
        rows[0].min_dli = 3
        rows[0].source_note = 'Operator measurement; keep this value'
        db.commit()
    response = client.post('/api/v1/plants', headers=headers, json={
        'nickname': '기존에 등록한 몬스테라', 'species_id': ids['Monstera deliciosa'],
        'watering_interval_days': 12})
    assert response.status_code == 201, response.text
    plant_id = response.json()['id']
    with factory() as db:
        assert seed_species(db) == 100
        db.commit()
        assert seed_species(db) == 0
        db.commit()
        assert db.scalar(select(func.count()).select_from(PlantSpecies)) == 107  # Includes fixture-only test species.
        for scientific, species_id in ids.items():
            assert db.get(PlantSpecies, species_id).scientific_name == scientific
        saved = db.get(PlantSpecies, ids['Monstera deliciosa'])
        assert saved.min_dli == 3 and saved.source_note == 'Operator measurement; keep this value'
        assert db.get(Plant, plant_id).species_id == ids['Monstera deliciosa']
    assert client.get(f'/api/v1/plants/{plant_id}', headers=headers).json()['watering_interval_days'] == 12


def test_old_botanical_name_reuses_row_and_is_searchable(context, headers):
    client, factory = context
    with factory() as db:
        old = PlantSpecies(name='직접 등록한 홍콩야자', scientific_name=' Schefflera ARBORICOLA ',
                           min_dli=5, max_dli=11, source_note='User curated range')
        db.add(old)
        db.commit()
        old_id = old.id
        assert seed_species(db) == 105
        db.commit()
        assert seed_species(db) == 0
        db.commit()
        assert db.get(PlantSpecies, old_id).scientific_name == ' Schefflera ARBORICOLA '
        assert db.get(PlantSpecies, old_id).min_dli == 5
        assert not db.scalar(select(PlantSpecies.id).where(PlantSpecies.scientific_name == 'Heptapleurum arboricola'))
    for query in ['홍콩야자', '쉐플레라', 'Heptapleurum arboricola', 'schefflera arboricola']:
        result = client.get('/api/v1/plant-species', headers=headers, params={'q': query})
        assert result.status_code == 200, result.text
        assert [row['id'] for row in result.json()] == [old_id]


def test_common_name_collision_does_not_replace_unrelated_species(context):
    _, factory = context
    with factory() as db:
        first = PlantSpecies(name='파키라', scientific_name=None, min_dli=1, max_dli=2,
                             source_note='An existing common-name record')
        second = PlantSpecies(name='Pachira aquatica', scientific_name='Synthetic unrelated taxon',
                              min_dli=1, max_dli=2, source_note='Name collision fixture')
        db.add_all([first, second])
        db.commit()
        seed_species(db)
        db.commit()
        assert db.get(PlantSpecies, first.id).scientific_name is None
        assert db.get(PlantSpecies, second.id).scientific_name == 'Synthetic unrelated taxon'
        new = db.scalar(select(PlantSpecies).where(PlantSpecies.scientific_name == 'Pachira aquatica'))
        assert new.name == 'Pachira aquatica (2)'
        assert seed_species(db) == 0


@pytest.mark.parametrize(('query', 'scientific'), [
    ('미니몬스테라', 'Rhaphidophora tetrasperma'), ('  미니 몬스테라  ', 'Rhaphidophora tetrasperma'),
    ('쉐플레라', 'Heptapleurum arboricola'), ('Schefflera arboricola', 'Heptapleurum arboricola'),
    ('아레카야자', 'Chrysalidocarpus lutescens'), ('Dypsis lutescens', 'Chrysalidocarpus lutescens'),
    ('로즈메리', 'Salvia rosmarinus'), ('Rosmarinus officinalis', 'Salvia rosmarinus'),
    ('Calathea lancifolia', 'Goeppertia insignis'), ('세인트폴리아', 'Streptocarpus ionanthus'),
    ('ZZ PLANT', 'Zamioculcas zamiifolia'), ('피커스 리라타', 'Ficus lyrata'),
    ('콩란', 'Curio rowleyanus'), ('금호', 'Kroenleinia grusonii'),
    ('Peperomia argyreia', 'Peperomia argyraea'),
])
def test_search_aliases_and_synonyms(context, headers, query, scientific):
    client, factory = context
    with factory() as db:
        seed_species(db)
        db.commit()
    response = client.get('/api/v1/plant-species', headers=headers, params={'q': query})
    assert response.status_code == 200, response.text
    assert scientific in [row['scientific_name'] for row in response.json()]


def test_pagination_existing_response_and_new_plant_registration(context, headers):
    client, factory = context
    with factory() as db:
        seed_species(db)
        db.commit()
    first = client.get('/api/v1/plant-species', headers=headers, params={'limit': 100}).json()
    second = client.get('/api/v1/plant-species', headers=headers, params={'limit': 100, 'offset': 100}).json()
    assert len(first) == 100 and len(second) == 7
    assert len({row['id'] for row in first + second}) == 107
    assert len(client.get('/api/v1/plant-species', headers=headers).json()) == 50
    assert set(first[0]) == {'id', 'name', 'scientific_name', 'min_dli', 'max_dli', 'source_note'}
    for query in ['%', '_', 'no-such-plant-in-catalog']:
        assert client.get('/api/v1/plant-species', headers=headers, params={'q': query}).json() == []
    assert client.get('/api/v1/plant-species').status_code == 401
    basil = client.get('/api/v1/plant-species', headers=headers, params={'q': '바질'}).json()[0]
    response = client.post('/api/v1/plants', headers=headers, json={'species_id': basil['id'], 'nickname': '내 바질'})
    assert response.status_code == 201, response.text
    assert response.json()['species_id'] == basil['id']


def test_startup_seeds_new_catalog_and_is_repeatable(tmp_path, monkeypatch):
    from app import main
    engine = build_engine('sqlite:///' + str(tmp_path / 'startup.db'))
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main, 'engine', engine)
    monkeypatch.setattr(main, 'SessionLocal', factory)
    ids = None
    for _ in range(2):
        with TestClient(main.app) as client:
            assert client.get('/health').status_code == 200
            with factory() as db:
                rows = db.scalars(select(PlantSpecies).order_by(PlantSpecies.id)).all()
                assert len(rows) == 106
                if ids is None:
                    ids = [row.id for row in rows]
                assert [row.id for row in rows] == ids
    engine.dispose()


def test_botanical_source_audit_covers_each_catalog_entry():
    audit = json.loads(Path('docs/plant-catalog-sources.json').read_text(encoding='utf-8'))
    assert len(audit['sources']) == 106
    by_name = {row['scientific_name']: row for row in audit['sources']}
    assert set(by_name) == {plant['scientific_name'] for plant in catalog_plants()}
    for plant in catalog_plants():
        source = by_name[plant['scientific_name']]
        assert source['source_url'] == plant['botanical_source']
        assert source['status'] in (200, 'VERIFIED_VIA_WEB_SEARCH')
        assert source['scientific_name_present'] is True
