import contextlib
import importlib
import json
import sys

sys.path.insert(0, sys.argv[1])
op = sys.argv[2]
payload = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    if op == 'dli':
        from grid_dli_service import compute_grid_dli
        from c_sky import generate_mock_scan
        if payload.get('mock_sky'):
            payload['sky'] = generate_mock_scan(payload.pop('window_outward_azimuth_deg'))
        result = compute_grid_dli(payload)
    elif op == 'scan':
        import cv2
        from c_sky import build_scan_from_frames, CameraParams, ScanFrame
        camera = CameraParams(**payload['camera'])
        frames = []
        for f in payload['frames']:
            im = cv2.imread(f['path'])
            if im is None or im.shape[:2] != (camera.height, camera.width):
                raise ValueError('Invalid frame dimensions')
            frames.append(ScanFrame(f['index'], im, f['azimuth_deg'], f['pitch_deg'], f['roll_deg']))
        result = build_scan_from_frames(frames, camera)
    else:
        # Future upstream functions: explicitly configured module:function, dict -> dict.
        module, name = payload.pop('_callable').split(':')
        result = getattr(importlib.import_module(module), name)(payload)
json.dump(result, sys.stdout, allow_nan=False)
