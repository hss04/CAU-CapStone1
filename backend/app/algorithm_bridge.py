"""Run upstream modules in an isolated process (they use bare 'models' imports)."""
import json
import os
from pathlib import Path
import subprocess
import sys
from fastapi import HTTPException

_root = Path(__file__).resolve().parents[1]
_default = _root.parent / 'algorithm' if (_root.parent / 'algorithm').exists() else _root / 'algorithm'
ALGORITHM_DIR = Path(os.environ.get('ALGORITHM_DIR', _default))

def invoke(operation, payload):
    runner = Path(__file__).with_name('algorithm_worker.py')
    try:
        p = subprocess.run([sys.executable, str(runner), str(ALGORITHM_DIR), operation],
            input=json.dumps(payload, allow_nan=False), text=True, capture_output=True,
            timeout=900, check=False)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, 'Algorithm exceeded 15 minute limit') from exc
    if p.returncode:
        # Model download errors/tracebacks stay out of API responses.
        import logging
        logging.getLogger(__name__).error('Algorithm failed: %s', p.stderr[-4000:])
        raise HTTPException(503, 'Algorithm unavailable; check installation and server logs')
    try:
        return json.loads(p.stdout)
    except ValueError as exc:
        raise HTTPException(502, 'Invalid algorithm response') from exc
