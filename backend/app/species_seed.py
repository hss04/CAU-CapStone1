"""Starter catalog; preserve operator-edited rows and their IDs."""
from sqlalchemy import select, func
from app.models import PlantSpecies

SOURCE = 'https://growlightmeter.com/light-requirements-for-plants/'
CATALOG = [
    ('몬스테라', 'Monstera deliciosa', 4, 12, 'Monstera genus'),
    ('스킨답서스', 'Epipremnum aureum', 4, 14, 'Pothos / Epipremnum genus'),
    ('올리브', 'Olea europaea', 18, 40, 'Olive / Olea genus'),
    ('산세베리아', 'Dracaena trifasciata', 4, 14, 'Snake Plant entry, not generic Dracaena'),
    ('떡갈고무나무', 'Ficus lyrata', 6, 12, 'Ficus genus; species-specific optimum unverified'),
]


def seed_species(db):
    entries = [dict(name=name, scientific_name=scientific, min_dli=lo, max_dli=hi,
                    source_note=f'PROVISIONAL cultivation starting range, mol/m2/day. Photone: {entry}; {SOURCE}; checked 2026-10-27. Genus/common-name mapping, not a species-specific experimental optimum or damage threshold.')
               for name, scientific, lo, hi, entry in CATALOG]
    entries.append(dict(name='필레아 페페로미오이데스', scientific_name='Pilea peperomioides', min_dli=6, max_dli=12,
        source_note='ESTIMATED app starting range 6-12 mol/m2/day; species-specific DLI not verified. NC State describes bright indirect light, not numeric DLI: https://plants.ces.ncsu.edu/plants/pilea-peperomioides/ . Numeric range is a provisional medium-light category assumption; calibrate with measurements. Checked 2026-10-27.'))
    for entry in entries:
        existing=db.scalar(select(PlantSpecies).where(func.lower(PlantSpecies.scientific_name)==entry['scientific_name'].lower()))
        if existing is None:
            # Keep pre-existing same-name records/foreign keys; do not overwrite curated unrelated data.
            same_name=db.scalar(select(PlantSpecies).where(PlantSpecies.name==entry['name']))
            if same_name is not None:
                entry['name']=entry['scientific_name']
            db.add(PlantSpecies(**entry))
    db.flush()
