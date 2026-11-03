"""Shared placement constraints and optimistic snapshots for atomic application."""
import math

from fastapi import HTTPException

from app.integration_models import PlacementRules
from app.job_control import digest


def cell_for_position(position, spec, room=None):
    if position is None:
        return None
    size = spec['cell_size_m']
    col = math.floor((position['x'] - spec['origin']['x']) / size)
    row = math.floor((position['z'] - spec['origin']['z']) / size)
    if room is not None:
        if abs(position['x'] - max(p.x for p in room.corners)) < 1e-8:
            col = min(col, spec['cols'] - 1)
        if abs(position['z'] - max(p.z for p in room.corners)) < 1e-8:
            row = min(row, spec['rows'] - 1)
    if not (0 <= row < spec['rows'] and 0 <= col < spec['cols'] and spec['inside_mask'][row][col]):
        return None
    return row, col


def saved_blocked(db, room, spec):
    rules = db.get(PlacementRules, room.id)
    if rules is None:
        return set()
    if rules.geometry_version != room.geometry_version or abs(rules.cell_size_m - spec['cell_size_m']) > 1e-8:
        if rules.blocked_cells:
            raise HTTPException(409, 'Saved blocked cells belong to another geometry/grid; update or clear them')
        return set()
    return {tuple(cell) for cell in rules.blocked_cells}


def effective_blocked(db, room, spec, supplied):
    blocked = saved_blocked(db, room, spec) | {tuple(cell) for cell in supplied}
    if any(not (0 <= r < spec['rows'] and 0 <= c < spec['cols'] and spec['inside_mask'][r][c]) for r, c in blocked):
        raise HTTPException(422, 'Blocked cell must be inside the room grid')
    return blocked


def placement_snapshot(db, room, job, supplied):
    from app.models import PlantSpecies
    species = {p.species_id: db.get(PlantSpecies, p.species_id) for p in room.plants}
    rules = db.get(PlacementRules, room.id)
    return digest({
        'geometry_version': room.geometry_version, 'dli_job_id': job.id,
        'plants': sorted([p.id, p.species_id, p.x, p.y, p.z,
            species[p.species_id].min_dli, species[p.species_id].max_dli] for p in room.plants),
        'rules': None if rules is None else [rules.geometry_version, rules.cell_size_m, rules.blocked_cells],
        'supplied_blocked': sorted([list(cell) for cell in supplied]),
    })


def decisions(output):
    result = []
    for item in output['plants']:
        current, recommended = item['current'], item['recommended']
        if recommended is not None:
            in_range = item['required_dli']['min'] <= recommended['total_dli'] <= item['required_dli']['max']
            reason = 'RELOCATE' if in_range else 'NO_SUITABLE_CELL'
        elif current is not None and current['status'] == 'OK':
            reason = 'CURRENT_OK'
        else:
            reason = 'NO_FREE_CELL'
        result.append({'plant_id': item['plant_id'], 'reason_code': reason,
                       'can_apply': reason == 'RELOCATE'})
    return result


def validate_recommendations(output, room, spec, blocked, expected_plants, total_dli):
    ids = [p['plant_id'] for p in output['plants']]
    if len(ids) != len(set(ids)) or set(ids) != {p.id for p in room.plants}:
        raise HTTPException(502, 'Recommendation must contain each room plant exactly once')
    species_by_plant = {p.id: p.species_id for p in room.plants}
    expected = {p['plant_id']: p for p in expected_plants}
    targets = set()
    for item in output['plants']:
        if item['species_id'] != species_by_plant[item['plant_id']]:
            raise HTTPException(502, 'Recommendation species does not match its plant')
        plant = expected[item['plant_id']]
        if any(abs(item['required_dli'][key]-plant[field]) > 1e-8
               for key, field in [('min', 'min_dli'), ('max', 'max_dli')]):
            raise HTTPException(502, 'Recommendation changed the species DLI requirements')
        current = item['current']
        cell = cell_for_position(plant['position'], spec, room)
        if (current is None) != (cell is None):
            raise HTTPException(502, 'Recommendation current position does not match its plant')
        if current is not None:
            r, c = cell
            value = total_dli[r][c]
            expected_status = 'LOW' if value < plant['min_dli'] else 'HIGH' if value > plant['max_dli'] else 'OK'
            if (current['row'], current['col']) != cell or abs(current['total_dli']-value) > 1e-5 or current['status'] != expected_status:
                raise HTTPException(502, 'Recommendation current light does not match the saved map')
        target = item['recommended']
        if target is None:
            continue
        r, c = target['row'], target['col']
        if not (0 <= r < spec['rows'] and 0 <= c < spec['cols'] and spec['inside_mask'][r][c]):
            raise HTTPException(502, 'Recommendation is outside the room grid')
        if (r, c) in targets or (r, c) in blocked:
            raise HTTPException(502, 'Recommendation overlaps another target or a blocked cell')
        if abs(target['total_dli']-total_dli[r][c]) > 1e-5:
            raise HTTPException(502, 'Recommendation light does not match the saved map')
        targets.add((r, c))
    return output
