"""Run explicitly before a demo. Model loading is optional and never a health check."""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def check(*, check_model=False, image_path=None, check_weather=False):
    from sqlalchemy import text
    from app.algorithm_bridge import algorithm_directory, invoke
    from app.config import get_settings, get_algorithm_settings
    from app.database import engine
    from app.weather import fetch_raw

    get_settings()
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
    result['elapsed_seconds'] = round(time.monotonic()-started, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-model', action='store_true')
    parser.add_argument('--image', help='Run real SegFormer inference on this local image')
    parser.add_argument('--check-weather', action='store_true')
    args = parser.parse_args()
    try:
        result = check(check_model=args.check_model, image_path=args.image, check_weather=args.check_weather)
    except Exception as exc:
        # Do not print configuration values, passwords, absolute paths or tracebacks.
        print(json.dumps({'status': 'failed', 'error_type': type(exc).__name__,
                          'action': 'Check configuration, installed dependencies, model access and server logs'}))
        return 1
    print(json.dumps({'status': 'ready', 'checks': result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
