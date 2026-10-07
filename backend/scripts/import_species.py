"""Local operator-only catalog import. No public write API for shared species."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import PlantSpecies
from app.schemas import SpeciesInput


def main():
    parser=argparse.ArgumentParser(description='Import verified species DLI ranges from a JSON array')
    parser.add_argument('file',type=Path)
    args=parser.parse_args()
    raw=json.loads(args.file.read_text(encoding='utf-8'))
    if not isinstance(raw,list):
        raise ValueError('Expected a JSON array')
    values=[SpeciesInput.model_validate(item) for item in raw]
    if len({v.name for v in values}) != len(values):
        raise ValueError('Duplicate species names in input')
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        for item in values:
            species=db.scalar(select(PlantSpecies).where(PlantSpecies.name==item.name))
            if species is None:
                species=PlantSpecies()
                db.add(species)
            for key,value in item.model_dump().items():
                setattr(species,key,value)
        db.commit()
    print(f'Imported {len(values)} species (upsert by name).')


if __name__ == '__main__':
    main()
