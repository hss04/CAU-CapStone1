"""Run explicitly before a demo. Model loading is optional and never a health check."""
import argparse
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def verify_cors(origins, base_url):
    if not origins:
        raise RuntimeError('No web origins configured')
    requested_headers = {'authorization', 'content-type', 'idempotency-key'}
    result = {}
    # A wildcard configuration still needs a real browser origin for the probe.
    probes = ['http://localhost:8082' if origin == '*' else origin for origin in origins]
    loopback = urlsplit(base_url).hostname in ('localhost', '127.0.0.1', '::1')
    # Local service checks must not be sent to a system HTTP/SOCKS proxy.
    with httpx.Client(base_url=base_url.rstrip('/') + '/', timeout=10, trust_env=not loopback) as client:
        for origin in dict.fromkeys(probes):
            response = client.options('api/v1/windows/1/scans', headers={
                'Origin': origin, 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': ', '.join(sorted(requested_headers))})
            allowed_headers = {value.strip().lower() for value in
                               response.headers.get('Access-Control-Allow-Headers', '').split(',')}
            allowed_methods = {value.strip().upper() for value in
                               response.headers.get('Access-Control-Allow-Methods', '').split(',')}
            if (response.status_code != 200
                    or response.headers.get('Access-Control-Allow-Origin') not in (origin, '*')
                    or 'POST' not in allowed_methods or not requested_headers <= allowed_headers):
                raise RuntimeError('Live CORS preflight failed')
            result[origin] = 'ok'
    return result


def check(*, check_model=False, image_path=None, check_weather=False,
          check_cors=False, base_url='http://127.0.0.1:8000'):
    from sqlalchemy import text
    from app.algorithm_bridge import algorithm_directory, invoke
    from app.config import get_settings, get_algorithm_settings
    from app.database import engine
    from app.weather import fetch_raw

    settings = get_settings()
    with engine.connect() as connection:
        connection.execute(text('SELECT 1'))
    if not algorithm_directory().is_dir():
        raise RuntimeError('Algorithm directory is missing')
    config = get_algorithm_settings()
    payload = {'callables': {'DLI_CALLABLE': config.dli_callable,
        'DIRECTION_CALLABLE': config.direction_callable,
        'RECOMMENDATION_CALLABLE': config.recommendation_callable}, 'check_model': check_model}
    if image_path:
        image = Path(image_path).resolve()
        if not image.is_file():
            raise RuntimeError('Test image does not exist')
        payload['image_path'] = str(image)
    started = time.monotonic()
    result = {'database': 'ok', 'algorithm_directory': 'ok', **invoke('preflight', payload)}
    result['weather'] = 'not_requested'
    if check_weather:
        data = fetch_raw('https://api.open-meteo.com/v1/forecast', {
            'latitude': 37.56, 'longitude': 126.97, 'current': 'temperature_2m'})
        if data.get('current', {}).get('temperature_2m') is None:
            raise RuntimeError('Weather endpoint returned incomplete data')
        result['weather'] = 'ok'
    result['cors'] = verify_cors(settings.cors_origins, base_url) if check_cors else 'not_requested'
    result['elapsed_seconds'] = round(time.monotonic()-started, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-model', action='store_true')
    parser.add_argument('--image', help='Run real SegFormer inference on this local image')
    parser.add_argument('--check-weather', action='store_true')
    parser.add_argument('--check-cors', action='store_true', help='Send live OPTIONS requests for configured web origins')
    parser.add_argument('--base-url', default='http://127.0.0.1:8000', help='Running API to use for the CORS check')
    args = parser.parse_args()
    try:
        result = check(check_model=args.check_model, image_path=args.image, check_weather=args.check_weather,
                       check_cors=args.check_cors, base_url=args.base_url)
    except Exception as exc:
        # Do not print configuration values, passwords, absolute paths or tracebacks.
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__,
                          'action': 'Check configuration, installed dependencies, model access, CORS settings and server logs'}))
        return 1
    print(json.dumps({'status': 'ready', 'checks': result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
