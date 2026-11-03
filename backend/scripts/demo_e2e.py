"""Verify real scan -> direction -> real weather/DLI -> recommendation plan over HTTP."""
import argparse
from contextlib import ExitStack
from datetime import datetime
import getpass
import json
import os
from pathlib import Path
import time
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx


def poll(client, job_id, timeout_seconds=1800):
    deadline = time.monotonic()+timeout_seconds
    while time.monotonic() < deadline:
        response = client.get(f'jobs/{job_id}')
        response.raise_for_status()
        result = response.json()
        if result['status'] == 'COMPLETED' and not result['stale']:
            return result['result']
        if result['status'] in ('FAILED', 'STALE') or result['stale']:
            raise RuntimeError(f"Job failed: {result.get('error_code') or result['status']}")
        time.sleep(1)
    raise TimeoutError('Job did not complete before the demo check deadline')


def run(args):
    metadata = json.loads(Path(args.scan_metadata).read_text(encoding='utf-8'))
    token = os.environ.get(args.token_env)
    with httpx.Client(base_url=args.base_url.rstrip('/')+'/api/v1/', timeout=120) as client:
        if not token:
            email = args.email or input('Email: ').strip()
            password = getpass.getpass('Password: ')
            response = client.post('auth/login', json={'email': email, 'password': password})
            response.raise_for_status()
            token = response.json()['access_token']
        client.headers['Authorization'] = 'Bearer '+token
        windows = client.get(f'rooms/{args.room_id}/windows')
        windows.raise_for_status()
        if metadata['window_id'] not in {window['id'] for window in windows.json()}:
            raise ValueError('Scan metadata window does not belong to the selected room')
        run_id = uuid4().hex
        with ExitStack() as stack:
            files = []
            for frame in metadata['frames']:
                path = (Path(args.scan_dir)/frame['file']).resolve()
                if not path.is_relative_to(Path(args.scan_dir).resolve()):
                    raise ValueError('Scan filename escapes scan directory')
                files.append(('files', (frame['file'], stack.enter_context(path.open('rb')), 'image/jpeg')))
            response = client.post(f"windows/{metadata['window_id']}/scans",
                headers={'Idempotency-Key': run_id+'-scan'},
                data={'metadata': json.dumps(metadata)}, files=files)
        response.raise_for_status()
        scan_id = response.json()['job_id']
        poll(client, scan_id)
        response = client.post(f'rooms/{args.room_id}/direction')
        response.raise_for_status()
        request = {'start_date': args.start_date, 'end_date': args.end_date,
            'cell_size_m': args.cell_size_m, 'sample_height_m': 0, 'mock_sky': False}
        response = client.post(f'rooms/{args.room_id}/dli-map', json=request,
                               headers={'Idempotency-Key': run_id+'-dli'})
        response.raise_for_status()
        dli_id = response.json()['job_id']
        result = poll(client, dli_id)
        if result['mock_sky'] or result['temporary_direction']:
            raise RuntimeError('Real-data check unexpectedly used provisional input')
        response = client.post(f'rooms/{args.room_id}/recommendation-plans', json={'dli_job_id': dli_id})
        response.raise_for_status()
        plan = response.json()
        applied = None
        if args.apply:
            response = client.post(f"rooms/{args.room_id}/recommendation-plans/{plan['plan_id']}/apply", json={})
            response.raise_for_status()
            applied = response.json()['applied_count']
        return {'status': 'completed', 'scan_job_id': scan_id, 'dli_job_id': dli_id,
                'plan_id': plan['plan_id'], 'mock_sky': False, 'temporary_direction': False,
                'decisions': [{k: item[k] for k in ('plant_id', 'reason_code', 'can_apply')} for item in plan['decisions']],
                'applied_count': applied}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    parser.add_argument('--room-id', type=int, required=True)
    parser.add_argument('--scan-metadata', required=True)
    parser.add_argument('--scan-dir', required=True)
    parser.add_argument('--token-env', default='PLANTLIGHT_TOKEN')
    parser.add_argument('--email')
    today = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
    parser.add_argument('--start-date', default=today)
    parser.add_argument('--end-date', default=today)
    parser.add_argument('--cell-size-m', type=float, default=.5)
    parser.add_argument('--apply', action='store_true', help='Also persist all applicable recommended positions')
    args = parser.parse_args()
    started = time.monotonic()
    try:
        result = run(args)
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__,
                          'action': 'Check the server job status and logs; no mock fallback is used'}))
        return 1
    result['elapsed_seconds'] = round(time.monotonic()-started, 2)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
