"""Line-delimited request/reply server, also supporting the original CLI mode."""
import contextlib
import importlib
import json
import sys
import traceback

_model_ready = False


def execute(op, payload):
    global _model_ready
    if op == 'warmup':
        import numpy as np
        from c_sky import classify_sky_mask_segformer
        # Includes lazy imports, model loading and first-inference initialization.
        classify_sky_mask_segformer(np.zeros((64, 64, 3), dtype=np.uint8))
        _model_ready = True
        return {'model': 'loaded', 'inference': 'ok'}
    if op == 'preflight':
        result = {'callables': {}, 'model': 'not_requested'}
        for key, configured in payload['callables'].items():
            if not configured:
                raise ValueError(f'{key} is not configured')
            module, name = configured.split(':')
            function = getattr(importlib.import_module(module), name)
            if not callable(function):
                raise TypeError(f'{key} is not callable')
            result['callables'][key] = 'ok'
        if payload.get('check_model') or payload.get('image_path'):
            from c_sky import _load_segformer, classify_sky_mask_segformer
            _load_segformer()
            result['model'] = 'loaded'
            if payload.get('image_path'):
                import cv2
                image = cv2.imread(payload['image_path'])
                if image is None:
                    raise ValueError('Cannot read the supplied test image')
                mask = classify_sky_mask_segformer(image)
                _model_ready = True
                result['inference'] = {'height': int(mask.shape[0]), 'width': int(mask.shape[1]),
                                       'sky_fraction': float(mask.mean())}
        return result
    if op == 'dli':
        from grid_dli_service import compute_grid_dli
        from c_sky import generate_mock_scan
        if payload.get('mock_sky'):
            payload['sky'] = generate_mock_scan(payload.pop('window_outward_azimuth_deg'))
        return compute_grid_dli(payload)
    if op == 'scan':
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
        _model_ready = True
        return result
    module, name = payload.pop('_callable').split(':')
    allow_swaps = payload.pop('_allow_relocation_swaps', False)
    function = getattr(importlib.import_module(module), name)
    result = function(payload)
    if allow_swaps and (module, name) == ('recommend_service', 'recommend_for_room'):
        from recommendation_worker import with_relocations
        result = with_relocations(function, payload, result)
    return result


def main():
    sys.path.insert(0, sys.argv[1])
    if sys.argv[2] != '--serve':
        payload = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            result = execute(sys.argv[2], payload)
        json.dump(result, sys.stdout, allow_nan=False)
        return
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                result = execute(request['operation'], request['payload'])
            reply = json.dumps({'id': request['id'], 'ok': True, 'result': result,
                                'model_ready': _model_ready}, allow_nan=False)
        except Exception:
            traceback.print_exc(file=sys.stderr)
            reply = json.dumps({'id': request.get('id'), 'ok': False})
        print(reply, flush=True)


if __name__ == '__main__':
    main()
