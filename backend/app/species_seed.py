"""Add missing plants and refresh the legacy lettuce default, preserving edits and IDs."""
from sqlalchemy import select

from app.models import PlantSpecies
from app.species_catalog import catalog_entries, catalog_plants, scientific_key


LEGACY_LETTUCE_SOURCE_NOTE = (
    'PROVISIONAL REFERENCE_GROUP: Lettuce 12-17 starting reference; cultivar/airflow dependent; '
    'not red-cultivar optimum or damage limit. '
    'https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf; '
    'botany: https://plants.ces.ncsu.edu/plants/lactuca-sativa/; '
    'checked 2026-11-03. Starting range; species optimum unverified.')


def seed_species(db):
    rows = db.scalars(select(PlantSpecies)).all()
    existing = {scientific_key(row.scientific_name) for row in rows if row.scientific_name}
    used_names = {row.name.casefold() for row in rows}
    added = 0
    for plant, entry in zip(catalog_plants(), catalog_entries()):
        identities = {scientific_key(name) for name in
                      [plant['scientific_name'], *plant['scientific_synonyms']]}
        if existing.intersection(identities):
            # Upgrade only the untouched 12-17 default; retain operator edits and IDs.
            if plant['light_profile'] == 'red_leaf_lettuce':
                for row in rows:
                    if (scientific_key(row.scientific_name or '') in identities
                            and (row.min_dli, row.max_dli, row.source_note)
                            == (12, 17, LEGACY_LETTUCE_SOURCE_NOTE)):
                        row.min_dli = entry['min_dli']
                        row.max_dli = entry['max_dli']
                        row.source_note = entry['source_note']
            continue
        if entry['name'].casefold() in used_names:
            # A common-name collision does not authorize replacing an unrelated row.
            base = entry['scientific_name']
            candidate = base
            suffix = 2
            while candidate.casefold() in used_names:
                candidate = f'{base} ({suffix})'
                suffix += 1
            entry['name'] = candidate
        db.add(PlantSpecies(**entry))
        used_names.add(entry['name'].casefold())
        existing.update(identities)
        added += 1
    db.flush()
    return added
