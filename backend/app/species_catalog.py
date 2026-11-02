"""Curated plant identities, search aliases and explicitly provisional DLI sources."""
from functools import lru_cache
import json
from pathlib import Path
import unicodedata

from app.schemas import SpeciesInput


CATALOG_PATH = Path(__file__).resolve().parent / 'catalogues' / 'plant_species.json'


def scientific_key(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().replace('×', ' x ').split())


def search_key(value):
    return ''.join(char for char in unicodedata.normalize('NFKC', value).casefold() if char.isalnum())


@lru_cache(maxsize=1)
def load_catalog():
    data = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
    if data['schema_version'] != 1 or len(data['plants']) != data['legacy_count'] + data['added_count']:
        raise ValueError('Invalid plant catalog version or entry count')
    names, identities = set(), {}
    entries = []
    for plant in data['plants']:
        name = plant['name']
        if name.casefold() in names:
            raise ValueError(f'Duplicate plant catalog name: {name}')
        names.add(name.casefold())
        for scientific in [plant['scientific_name'], *plant['scientific_synonyms']]:
            key = scientific_key(scientific)
            if key in identities and identities[key] != name:
                raise ValueError(f'Duplicate plant identity: {scientific}')
            identities[key] = name
        profile = data['profiles'][plant['light_profile']]
        if profile['basis'] not in {'REFERENCE_SPECIES', 'REFERENCE_GENUS', 'REFERENCE_GROUP', 'ESTIMATED'}:
            raise ValueError(f'Unknown DLI evidence: {profile["basis"]}')
        evidence = 'ESTIMATED' if profile['basis'] == 'ESTIMATED' else f'PROVISIONAL {profile["basis"]}'
        note = plant.get('legacy_source_note') or (
            f'{evidence}: {profile["source_entry"]}. '
            f'{profile["source_url"]}; botany: {plant["botanical_source"]}; '
            f'checked {data["checked_at"]}. Starting range; species optimum unverified.')
        entry = SpeciesInput.model_validate(dict(name=name, scientific_name=plant['scientific_name'],
            min_dli=profile['min_dli'], max_dli=profile['max_dli'], source_note=note))
        entries.append(entry.model_dump())
    return data, tuple(entries)


def catalog_plants():
    return load_catalog()[0]['plants']


def catalog_entries():
    return [dict(entry) for entry in load_catalog()[1]]


def alias_scientific_names(query):
    """Return canonical names and botanical synonyms for matching display/search aliases."""
    key = search_key(query)
    if not key:
        return []
    matches = set()
    for plant in catalog_plants():
        labels = [plant['name'], plant['scientific_name'], *plant['aliases'], *plant['scientific_synonyms']]
        if any(key in search_key(label) for label in labels):
            matches.update([plant['scientific_name'], *plant['scientific_synonyms']])
    return sorted(matches)
