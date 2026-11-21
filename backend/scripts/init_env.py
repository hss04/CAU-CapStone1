import argparse
import io
import json
import os
from pathlib import Path
from secrets import token_urlsafe
import stat
import tempfile
from urllib.parse import urlsplit

from dotenv import dotenv_values, set_key


def web_origin(value):
    parts = urlsplit(value)
    if (any(c.isspace() for c in value) or parts.scheme not in ('http', 'https')
            or not parts.hostname or '*' in parts.netloc or parts.username is not None
            or parts.password is not None or parts.path not in ('', '/')
            or parts.query or parts.fragment):
        raise ValueError('Use an exact http(s) web origin without credentials, paths or wildcards')
    parts.port  # Validate the port before writing any configuration.
    return f'{parts.scheme}://{parts.netloc.lower()}'


def configure(project, origins=()):
    origins = [web_origin(value) for value in origins]
    destination = project / '.env'
    if destination.is_symlink():
        raise ValueError('Edit the symlink target configuration explicitly')
    existed = destination.exists()
    original = destination.read_bytes() if existed else None
    example = (project / '.env.example').read_text(encoding='utf-8')
    text = original.decode('utf-8') if existed else example.replace(
        'replace-with-a-random-secret-at-least-32-characters', token_urlsafe(48))
    values = dotenv_values(stream=io.StringIO(text))
    defaults = dotenv_values(stream=io.StringIO(example))
    keys = ('DLI_CALLABLE', 'DIRECTION_CALLABLE', 'RECOMMENDATION_CALLABLE', 'DLI_CACHE_VERSION',
            'ALGORITHM_PERSISTENT', 'ALGORITHM_TIMEOUT_SECONDS', 'ALGORITHM_NUM_THREADS', 'SKY_MODEL_PRELOAD')
    updates = {key: defaults[key] for key in keys if key not in values}
    if origins:
        try:
            current = json.loads(values.get('CORS_ORIGINS') or '[]')
        except (ValueError, TypeError) as exc:
            raise ValueError('CORS_ORIGINS must be a JSON array of strings') from exc
        if not isinstance(current, list) or any(not isinstance(item, str) for item in current):
            raise ValueError('CORS_ORIGINS must be a JSON array of strings')
        merged = list(dict.fromkeys([*current, *origins]))
        if merged != current:
            updates['CORS_ORIGINS'] = json.dumps(merged, separators=(',', ':'))
    if existed and not updates:
        return {'created': False, 'updated_settings': []}

    mode = stat.S_IMODE(destination.stat().st_mode) if existed else 0o600
    fd, name = tempfile.mkstemp(dir=project, prefix='.env.configure-')
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            output.write(text)
        for key, value in updates.items():
            set_key(temporary, key, value)
        temporary.chmod(mode)
        if destination.exists() != existed or (existed and destination.read_bytes() != original):
            raise RuntimeError('Configuration changed during update; run the command again')
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {'created': not existed, 'updated_settings': list(updates)}


def main():
    parser = argparse.ArgumentParser(description='Create .env or add missing settings without changing existing secrets.')
    parser.add_argument('--web-origin', action='append', default=[], metavar='ORIGIN',
                        help='Allow this exact web frontend origin; repeat to merge multiple origins into CORS_ORIGINS')
    args = parser.parse_args()
    try:
        result = configure(Path(__file__).resolve().parents[1], args.web_origin)
    except (ValueError, OSError, RuntimeError):
        parser.exit(1, 'Could not update .env. Check web origins, CORS_ORIGINS JSON and file permissions.\n')
    print('Created .env with a new JWT secret.' if result['created'] else 'Existing secrets and custom settings preserved.')
    if result['updated_settings']:
        print('Updated settings: ' + ', '.join(result['updated_settings']))
    print('Restart the server after any configuration changes.')


if __name__ == '__main__':
    main()
