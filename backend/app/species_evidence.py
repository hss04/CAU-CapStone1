"""Expose existing source provenance without claiming that estimates are verified."""
from app.species_catalog import load_catalog, scientific_key


def evidence_for_species(species):
    data, entries = load_catalog()
    identity = scientific_key(species.scientific_name or '')
    for plant, entry in zip(data['plants'], entries):
        names = [plant['scientific_name'], *plant['scientific_synonyms']]
        if identity and identity in {scientific_key(name) for name in names}:
            if (species.min_dli, species.max_dli, species.source_note) == (
                    entry['min_dli'], entry['max_dli'], entry['source_note']):
                profile = data['profiles'][plant['light_profile']]
                return {'basis': profile['basis'], 'provisional': True,
                        'source_url': profile.get('source_url'),
                        'source_entry': profile.get('source_entry'),
                        'checked_at': profile.get('checked_at', data['checked_at']),
                        'botanical_source_url': plant.get('botanical_source'),
                        'source_note': species.source_note}
    return {'basis': 'OPERATOR_DEFINED' if species.source_note else 'UNKNOWN',
            'provisional': True, 'source_url': None, 'source_entry': None,
            'checked_at': None, 'botanical_source_url': None, 'source_note': species.source_note}
