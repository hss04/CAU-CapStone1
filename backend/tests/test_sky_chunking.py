"""Exact equivalence to upsample-all-channels argmax, including class ties."""
import importlib.util
from pathlib import Path
import sys

import numpy as np
import pytest
import torch


@pytest.fixture(scope='module')
def sky_module():
    path = Path(__file__).resolve().parents[1] / 'algorithm' / 'c_sky.py'
    spec = importlib.util.spec_from_file_location('sky_chunking_subject', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('classes,sky', [(1, 0), (7, 0), (7, 3), (7, 6), (150, 2), (150, 149)])
@pytest.mark.parametrize('size', [(1, 1), (11, 17), (6, 9)])
def test_chunked_mask_exactly_matches_original(sky_module, classes, sky, size):
    generator = torch.Generator().manual_seed(194)
    logits = torch.randn((1, classes, 6, 9), generator=generator)
    # Introduce exact ties as well as ordinary class boundaries.
    if classes > 1:
        logits[:, (sky + 1) % classes, :2, :2] = logits[:, sky, :2, :2]
    full = torch.nn.functional.interpolate(logits, size=size, mode='bilinear', align_corners=False)
    expected = (full.argmax(dim=1)[0] == sky).numpy()
    np.testing.assert_array_equal(sky_module._sky_from_logits(logits, sky, size), expected)


@pytest.mark.parametrize('sky', [0, 1, 3, 6])
def test_equal_scores_keep_first_class_tie_rule(sky_module, sky):
    logits = torch.ones((1, 7, 3, 5))
    mask = sky_module._sky_from_logits(logits, sky, (13, 17))
    assert bool(mask.all()) if sky == 0 else not bool(mask.any())


def test_no_full_resolution_tensor_contains_all_150_classes(sky_module, monkeypatch):
    original = torch.nn.functional.interpolate
    channels = []
    def interpolate(tensor, *args, **kwargs):
        channels.append(tensor.shape[1])
        return original(tensor, *args, **kwargs)
    monkeypatch.setattr(torch.nn.functional, 'interpolate', interpolate)
    sky_module._sky_from_logits(torch.randn(1, 150, 6, 9), 2, (24, 32))
    assert max(channels) <= 4 and sum(channels) == 150


def test_invalid_logits_fail_explicitly(sky_module):
    logits = torch.zeros((1, 3, 2, 2))
    logits[0, 1, 0, 0] = float('nan')
    with pytest.raises(ValueError, match='Non-finite'):
        sky_module._sky_from_logits(logits, 1, (4, 4))
