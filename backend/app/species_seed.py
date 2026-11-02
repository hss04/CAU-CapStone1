"""Add missing catalog plants while preserving operator-edited rows and existing IDs."""
from sqlalchemy import select

from app.models import PlantSpecies
from app.species_catalog import catalog_entries, catalog_plants, scientific_key


def seed_species(db):
    rows = db.scalars(select(PlantSpecies)).all()
    existing = {scientific_key(row.scientific_name) for row in rows if row.scientific_name}
    used_names = {row.name.casefold() for row in rows}
    added = 0
    for plant, entry in zip(catalog_plants(), catalog_entries()):
        identities = {scientific_key(name) for name in
                      [plant['scientific_name'], *plant['scientific_synonyms']]}
        if existing.intersection(identities):
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
