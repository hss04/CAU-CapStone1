"""Reuse one isolated algorithm process, including imported libraries/model.

The algorithm uses bare models imports, so it must not share Python's module
namespace with FastAPI. Requests remain serialized as in the original bridge.
"""
import atexit
from collections import deque
import json
import logging
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
import sys
from threading import Event, RLock, Thread
from time import monotonic

from fastapi import HTTPException

from app.config import get_algorithm_settings

_root = Path(__file__).resolve().parents[1]
_algorithm_slot = RLock()
_worker_guard = RLock()
_worker = None
_starts = 0
_warming = False
_warmup_error = False
_warmup_thread = None
_warmup_cancel = Event()
_preload_requested = False
_runner = Path(__file__).with_name('algorithm_worker.py')
log = logging.getLogger(__name__)


def algorithm_directory():
    configured = get_algorithm_settings().algorithm_dir
    path = Path(configured) if configured else _root / 'algorithm'
    return (path if path.is_absolute() else _root / path).resolve()


def _environment(settings):
    env = os.environ.copy()
    # Limit only the child process, avoiding CPU oversubscription on small VMs.
    for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'NUMEXPR_NUM_THREADS'):
        env[key] = str(settings.algorithm_num_threads)
    return env


class _Worker:
    def __init__(self, directory, settings):
        self.identity = (directory, settings.algorithm_num_threads)
        self.messages = Queue()
        self.errors = deque(maxlen=40)
        self.model_ready = False
        self.completed = 0
        self.sequence = 0
        self.process = subprocess.Popen(
            [sys.executable, '-u', str(_runner), str(directory), '--serve'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', errors='replace', bufsize=1,
            env=_environment(settings),
        )
        Thread(target=self._read_stdout, daemon=True).start()
        Thread(target=self._read_stderr, daemon=True).start()

    def _read_stdout(self):
        try:
            for line in self.process.stdout:
                self.messages.put(('line', line))
        except (OSError, ValueError):
            pass
        finally:
            self.messages.put(('closed', None))

    def _read_stderr(self):
        try:
            for line in self.process.stderr:
                self.errors.append(line[-4000:])
        except (OSError, ValueError):
            pass

    def _write(self, request):
        try:
            self.process.stdin.write(request + '\n')
            self.process.stdin.flush()
        except (OSError, ValueError):
            self.messages.put(('closed', None))

    def request(self, operation, payload, timeout):
        self.sequence += 1
        request = json.dumps({'id': self.sequence, 'operation': operation, 'payload': payload}, allow_nan=False)
        deadline = monotonic() + timeout
        # A blocked pipe write is subject to the same timeout as computation.
        Thread(target=self._write, args=(request,), daemon=True).start()
        try:
            kind, line = self.messages.get(timeout=max(0, deadline - monotonic()))
        except Empty as exc:
            raise HTTPException(504, 'Algorithm exceeded configured time limit') from exc
        if kind != 'line':
            raise HTTPException(503, 'Algorithm unavailable; check installation and server logs')
        try:
            message = json.loads(line)
            if not isinstance(message, dict) or message.get('id') != self.sequence:
                raise ValueError('Mismatched worker response')
            if not message.get('ok'):
                raise HTTPException(503, 'Algorithm unavailable; check installation and server logs')
            result = message['result']
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(502, 'Invalid algorithm response') from exc
        self.model_ready = message.get('model_ready') is True
        self.completed += 1
        return result

    def stop(self):
        if self.process.poll() is None:
            try:
                self.process.kill()
            except ProcessLookupError:
                pass
        self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass


def shutdown_worker():
    """Stop without waiting for a long-running request to acquire the slot."""
    global _worker
    _warmup_cancel.set()
    with _worker_guard:
        current, _worker = _worker, None
    if current is not None:
        current.stop()


def worker_status():
    """Non-blocking readiness data, including while warmup holds the slot."""
    settings = get_algorithm_settings()
    current = _worker
    alive = current is not None and current.process.poll() is None
    model = 'ready' if alive and current.model_ready else (
        'warming' if _warming else 'error' if _warmup_error else 'not_loaded')
    if not settings.algorithm_persistent or not settings.sky_model_preload:
        model = 'ready' if alive and current.model_ready else 'lazy'
    return {'worker': 'running' if alive else 'not_started', 'sky_model': model,
            'pid': current.process.pid if alive else None,
            'requests_completed': current.completed if alive else 0, 'starts': _starts}


def _invoke_once(operation, payload, settings):
    """Opt-out path and a reproducible baseline for performance comparisons."""
    try:
        p = subprocess.run(
            [sys.executable, str(_runner), str(algorithm_directory()), operation],
            input=json.dumps(payload, allow_nan=False), text=True, capture_output=True,
            encoding='utf-8', timeout=settings.algorithm_timeout_seconds, check=False,
            env=_environment(settings),
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, 'Algorithm exceeded configured time limit') from exc
    if p.returncode:
        log.error('Algorithm failed: %s', p.stderr[-4000:])
        raise HTTPException(503, 'Algorithm unavailable; check installation and server logs')
    try:
        return json.loads(p.stdout)
    except ValueError as exc:
        raise HTTPException(502, 'Invalid algorithm response') from exc


def invoke(operation, payload):
    return _invoke(operation, payload)


def _invoke(operation, payload, cancellation=None):
    global _worker, _starts
    settings = get_algorithm_settings()
    with _algorithm_slot:
        deadline = monotonic() + settings.algorithm_timeout_seconds
        if not settings.algorithm_persistent:
            shutdown_worker()
            return _invoke_once(operation, payload, settings)
        identity = (algorithm_directory(), settings.algorithm_num_threads)
        current = None
        try:
            with _worker_guard:
                if cancellation is not None and cancellation.is_set():
                    return None
                if _worker is not None and (_worker.identity != identity or _worker.process.poll() is not None):
                    _worker.stop()
                    _worker = None
                if _worker is None:
                    _worker = _Worker(identity[0], settings)
                    _starts += 1
                current = _worker
            if _preload_requested and settings.sky_model_preload and not current.model_ready and operation != 'warmup':
                current.request('warmup', {}, max(.001, deadline-monotonic()))
            return current.request(operation, payload, max(.001, deadline-monotonic()))
        except (OSError, HTTPException) as exc:
            if current is not None:
                log.error('Algorithm worker failed: %s', ''.join(current.errors)[-4000:])
                with _worker_guard:
                    if _worker is current:
                        _worker = None
                current.stop()
            if isinstance(exc, HTTPException):
                raise
            raise HTTPException(503, 'Algorithm unavailable; check installation and server logs') from exc


def start_worker_warmup():
    """Load and exercise the model in the SAME child that handles later scans."""
    global _warmup_thread, _warming, _warmup_error, _warmup_cancel, _preload_requested
    settings = get_algorithm_settings()
    if not settings.algorithm_persistent or not settings.sky_model_preload:
        return
    if _warmup_thread is not None and _warmup_thread.is_alive():
        return
    _preload_requested = True
    _warming, _warmup_error = True, False
    cancellation = _warmup_cancel = Event()

    def prepare():
        global _warming, _warmup_error
        try:
            _invoke('warmup', {}, cancellation)
        except Exception:
            if not cancellation.is_set():
                _warmup_error = True
                log.exception('SKY model warmup failed; check dependencies/model cache and restart')
        finally:
            _warming = False

    _warmup_thread = Thread(target=prepare, name='plantlight-model-warmup', daemon=True)
    _warmup_thread.start()


atexit.register(shutdown_worker)
