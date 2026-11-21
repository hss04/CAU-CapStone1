"""Configure web origins without losing deployed secrets, then probe real CORS."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

from dotenv import dotenv_values
import httpx
import pytest

from scripts import check_demo, init_env


PROJECT = Path(__file__).resolve().parents[1]
ORIGINS = ['http://localhost:8082', 'http://127.0.0.1:8082']


@pytest.fixture
def project(tmp_path):
    (tmp_path / '.env.example').write_bytes((PROJECT / '.env.example').read_bytes())
    return tmp_path


def test_web_origins_preserve_secrets_custom_callables_and_repeat_safely(project):
    env = project / '.env'
    env.write_text('# deployment settings\nJWT_SECRET=keep-the-existing-secret\n'
                   'DATABASE_URL=sqlite:///./existing.db\nDLI_CALLABLE=custom:calculate\n'
                   'DIRECTION_CALLABLE=room_geometry:compute_room_direction\n'
                   'RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room\n'
                   'CORS_ORIGINS=["https://garden.example"]\n', encoding='utf-8')
    env.chmod(0o600)
    before = dotenv_values(env)
    result = init_env.configure(project, [*ORIGINS, ORIGINS[0] + '/'])
    after = dotenv_values(env)
    for name in ('JWT_SECRET', 'DATABASE_URL', 'DLI_CALLABLE', 'DIRECTION_CALLABLE', 'RECOMMENDATION_CALLABLE'):
        assert after[name] == before[name]
    assert json.loads(after['CORS_ORIGINS']) == ['https://garden.example', *ORIGINS]
    assert 'CORS_ORIGINS' in result['updated_settings']
    assert stat.S_IMODE(env.stat().st_mode) == 0o600
    content = env.read_bytes()
    assert init_env.configure(project, ORIGINS)['updated_settings'] == []
    assert env.read_bytes() == content
    assert env.read_text().count('CORS_ORIGINS=') == 1


def test_new_install_creates_private_env_with_bundled_functions(project):
    assert init_env.configure(project, ORIGINS)['created']
    env = project / '.env'
    values = dotenv_values(env)
    assert len(values['JWT_SECRET']) >= 32 and not values['JWT_SECRET'].startswith('replace-with-')
    assert values['DLI_CALLABLE'] == 'grid_dli_service:compute_room_dli'
    assert values['DIRECTION_CALLABLE'] == 'room_geometry:compute_room_direction'
    assert values['RECOMMENDATION_CALLABLE'] == 'recommend_service:recommend_for_room'
    assert json.loads(values['CORS_ORIGINS']) == ORIGINS
    assert stat.S_IMODE(env.stat().st_mode) == 0o600


def test_default_run_does_not_enable_cors_or_override_explicit_blank_function(project):
    init_env.configure(project)
    env = project / '.env'
    assert json.loads(dotenv_values(env)['CORS_ORIGINS']) == []
    from dotenv import set_key
    set_key(env, 'DLI_CALLABLE', '')
    init_env.configure(project)
    assert dotenv_values(env)['DLI_CALLABLE'] == ''


@pytest.mark.parametrize('origin', ['*', 'file://localhost', 'http://user:password@localhost:8082',
                                  'http://localhost:8082/api', 'http://localhost:8082?key=x',
                                  'http://localhost:99999', 'http://localhost:8082\n'])
def test_invalid_web_origin_does_not_change_existing_env(project, origin):
    init_env.configure(project)
    before = (project / '.env').read_bytes()
    with pytest.raises(ValueError):
        init_env.configure(project, [origin])
    assert (project / '.env').read_bytes() == before


@pytest.mark.parametrize('invalid', ['null', '"localhost"', '[1]', '{broken}'])
def test_invalid_existing_cors_is_preserved_for_manual_review(project, invalid):
    env = project / '.env'
    env.write_text(f'JWT_SECRET=keep-me\nCORS_ORIGINS={invalid}\n')
    before = env.read_bytes()
    with pytest.raises(ValueError, match='CORS_ORIGINS'):
        init_env.configure(project, ORIGINS)
    assert env.read_bytes() == before


def test_write_failure_leaves_original_env_and_no_partial_configuration(project, monkeypatch):
    init_env.configure(project)
    before = (project / '.env').read_bytes()
    def fail(*args, **kwargs):
        raise OSError('simulated write failure')
    monkeypatch.setattr(init_env, 'set_key', fail)
    with pytest.raises(OSError):
        init_env.configure(project, ORIGINS)
    assert (project / '.env').read_bytes() == before
    assert not list(project.glob('.env.configure-*'))


def test_actual_app_preflight_and_unauthorized_response_include_cors():
    code = '''
import json
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)  # Probe middleware without running the database/model lifespan.
headers = {'Origin': 'http://localhost:8082', 'Access-Control-Request-Method': 'POST',
           'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key'}
first = client.options('/api/v1/windows/1/scans', headers=headers)
second = client.options('/api/v1/windows/1/scans', headers={**headers, 'Origin': 'http://127.0.0.1:8082'})
denied = client.options('/api/v1/windows/1/scans', headers={**headers, 'Origin': 'https://unlisted.example'})
auth = client.get('/api/v1/rooms', headers={'Origin': headers['Origin']})
print(json.dumps({'status': first.status_code, 'origin': first.headers.get('access-control-allow-origin'),
                  'credentials': first.headers.get('access-control-allow-credentials'),
                  'second': second.status_code, 'denied': denied.status_code,
                  'denied_origin': denied.headers.get('access-control-allow-origin'),
                  'auth': auth.status_code, 'auth_origin': auth.headers.get('access-control-allow-origin')}))
client.close()
'''
    response = subprocess.run([sys.executable, '-c', code], cwd=PROJECT, capture_output=True,
                              text=True, env={**os.environ, 'CORS_ORIGINS': json.dumps(ORIGINS)})
    assert response.returncode == 0, response.stderr
    data = json.loads(response.stdout)
    assert data == {'status': 200, 'origin': ORIGINS[0], 'credentials': None, 'second': 200,
                    'denied': 400, 'denied_origin': None, 'auth': 401, 'auth_origin': ORIGINS[0]}


@pytest.mark.parametrize('fault', [None, 'disabled', 'wrong_origin', 'missing_headers'])
def test_live_cors_checker_accepts_only_complete_preflight(monkeypatch, fault):
    real_client = httpx.Client
    def respond(request):
        assert request.method == 'OPTIONS' and request.url.path == '/api/v1/windows/1/scans'
        assert 'authorization' not in request.headers
        headers = {'Access-Control-Allow-Origin': request.headers['Origin'],
                   'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
                   'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key'}
        if fault == 'wrong_origin':
            headers['Access-Control-Allow-Origin'] = 'https://unlisted.example'
        elif fault == 'missing_headers':
            headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return httpx.Response(405 if fault == 'disabled' else 200, headers=headers)
    monkeypatch.setattr(check_demo.httpx, 'Client', lambda **kwargs:
                        real_client(**kwargs, transport=httpx.MockTransport(respond)))
    if fault is None:
        assert check_demo.verify_cors(ORIGINS, 'http://api.example') == dict.fromkeys(ORIGINS, 'ok')
    else:
        with pytest.raises(RuntimeError, match='preflight'):
            check_demo.verify_cors(ORIGINS, 'http://api.example')


@pytest.mark.parametrize('base_url,trust_env', [('http://127.0.0.1:8000', False),
                                             ('http://localhost:8000', False),
                                             ('https://api.example', True)])
def test_cors_loopback_probe_ignores_system_proxy_but_remote_probe_honors_it(monkeypatch, base_url, trust_env):
    real_client = httpx.Client
    def client(**kwargs):
        assert kwargs['trust_env'] is trust_env
        def respond(request):
            return httpx.Response(200, headers={'Access-Control-Allow-Origin': request.headers['Origin'],
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key'})
        return real_client(**kwargs, transport=httpx.MockTransport(respond))
    monkeypatch.setattr(check_demo.httpx, 'Client', client)
    assert check_demo.verify_cors(ORIGINS, base_url) == dict.fromkeys(ORIGINS, 'ok')
