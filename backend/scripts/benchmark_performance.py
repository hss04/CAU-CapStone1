"""Repeatable CPU benchmark; synthetic geometry/weather, optional real scan files."""
import argparse
import hashlib
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import sys
from time import perf_counter


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--days', type=int, choices=range(1, 94), default=7, metavar='1..93')
    parser.add_argument('--cell-size', type=float, default=.2)
    parser.add_argument('--one-shot', action='store_true', help='Measure the old new-process-per-day path')
    parser.add_argument('--scan-metadata', type=Path, help='Optional actual scan metadata JSON (for example, 9 or 13 frames)')
    parser.add_argument('--scan-dir', type=Path, help='Directory containing the actual frame JPEGs')
    parser.add_argument('--warm-model', action='store_true', help='Time SegFormer loading and first inference')
    args = parser.parse_args()
    if not .05 <= args.cell_size <= 5:
        parser.error('--cell-size must be between .05 and 5')
    if bool(args.scan_metadata) != bool(args.scan_dir):
        parser.error('--scan-metadata and --scan-dir must be provided together')
    if args.one_shot and (args.warm_model or args.scan_metadata):
        parser.error('Use --one-shot for the DLI baseline, not model reuse')
    return args


def payload_for(day, cell_size):
    from math import ceil
    rows, cols = ceil(3 / cell_size), ceil(4 / cell_size)
    if rows * cols > 40000:
        raise ValueError('Grid exceeds 40000 cells')
    start = datetime.fromisoformat(f'{day}T00:00:00+09:00')
    return {'_callable': 'grid_dli_service:compute_room_dli', 'room_id': 1, 'date': day.isoformat(),
        'room': {'corners': [{'order_index': n, 'x': x, 'z': z}
                            for n, (x, z) in enumerate([(0, 0), (4, 0), (4, 3), (0, 3)])],
                 'height_m': 2.5, 'x_axis_azimuth_deg': 90, 'latitude': 37.5665, 'longitude': 126.978},
        'grid': {'origin': {'x': 0, 'z': 0}, 'rows': rows, 'cols': cols, 'sample_height_m': 0,
                 'cell_size_m': cell_size, 'inside_mask': [[True] * cols for _ in range(rows)]},
        'windows': [{'window_id': 1, 'wall_index': 0, 'v0': [1, .8, 0], 'v1': [3, .8, 0],
                     'v2': [3, 2, 0], 'v3': [1, 2, 0], 'sky': None}],
        'dni_dhi': [{'time': (start + timedelta(hours=h)).isoformat(),
                     'dni': 500. if 7 <= h <= 18 else 0., 'dhi': 100. if 7 <= h <= 18 else 0.}
                    for h in range(25)],
        'time_basis': 'PRECEDING_HOUR_MEAN', 'mock_sky': True}


def main():
    args = arguments()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app.algorithm_bridge import invoke, shutdown_worker, worker_status
    from app.config import get_algorithm_settings
    if args.one_shot != (not get_algorithm_settings().algorithm_persistent):
        raise SystemExit('Set ALGORITHM_PERSISTENT=false with --one-shot; use true otherwise')
    report = {'basis': 'synthetic 4x3m room, one window, fixed hourly irradiance',
              'excludes': ['weather HTTP', 'database', 'photo upload', 'job queue', 'phone UI'],
              'days': args.days, 'cell_size_m': args.cell_size, 'one_shot': args.one_shot}
    try:
        if args.warm_model or args.scan_metadata:
            started = perf_counter()
            invoke('warmup', {})
            report['model_warmup_seconds'] = round(perf_counter() - started, 3)
        started = perf_counter()
        values, hashes, per_day = [], [], []
        for n in range(args.days):
            before = perf_counter()
            result = invoke('custom', payload_for(date(2026, 1, 1) + timedelta(days=n), args.cell_size))
            per_day.append(perf_counter() - before)
            values.append(sum(v for row in result['total_dli'] for v in row if v is not None))
            hashes.append(hashlib.sha256(json.dumps(result, sort_keys=True, allow_nan=False).encode()).hexdigest())
        report.update(dli_seconds=round(perf_counter() - started, 3),
                      first_day_seconds=round(per_day[0], 3),
                      following_days_mean_seconds=round(sum(per_day[1:]) / len(per_day[1:]), 3) if len(per_day) > 1 else None,
                      daily_grid_total_checksums=values, daily_result_sha256=hashes, worker=worker_status())
        if args.scan_metadata:
            metadata = json.loads(args.scan_metadata.read_text())
            frames = [{**f, 'path': str(args.scan_dir / Path(f['file']).name)} for f in metadata['frames']]
            started = perf_counter()
            scan = invoke('scan', {'camera': metadata['camera'], 'frames': frames})
            report['scan'] = {'frames': len(frames), 'seconds': round(perf_counter() - started, 3),
                              'sky_cells': sum(v == 1 for row in scan['sky'] for v in row)}
        print(json.dumps(report, indent=2))
    finally:
        shutdown_worker()


if __name__ == '__main__':
    main()
