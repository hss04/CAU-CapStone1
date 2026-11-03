"""Optional relocation adapter. Keep pinned upstream files and scoring unchanged."""
from copy import deepcopy


def with_relocations(function, payload, original):
    """Moving plants release their old cells together; OK plants keep their cells."""
    by_id = {item['plant_id']: item for item in original['plants']}
    revised = deepcopy(payload)
    moving = set()
    for plant in revised['plants']:
        current = by_id[plant['plant_id']]['current']
        if current is None or current['status'] != 'OK':
            moving.add(plant['plant_id'])
            plant['position'] = None
    if not moving:
        return original
    reassigned = function(revised)
    staying_cells = {(by_id[item['plant_id']]['current']['row'], by_id[item['plant_id']]['current']['col'])
        for item in reassigned['plants'] if item['recommended'] is None and by_id[item['plant_id']]['current'] is not None}
    if any((item['recommended']['row'], item['recommended']['col']) in staying_cells
           for item in reassigned['plants'] if item['recommended'] is not None):
        # If a partial assignment leaves an original occupant in place, retain the
        # conservative upstream plan rather than recommending an occupied target.
        return original
    for entry in reassigned['plants']:
        # Restore measured/diagnosed current positions after upstream assignment.
        entry['current'] = by_id[entry['plant_id']]['current']
    reassigned['warnings'] = list(dict.fromkeys(original.get('warnings', []) + [
        warning for warning in reassigned.get('warnings', [])
        if 'no free cell' not in warning]))
    return reassigned
