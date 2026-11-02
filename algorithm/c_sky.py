"""c. 창밖 스캔 SKY/NON-SKY 판정 (CLAUDE.md 7장 규격).

실제 사진 입력 -> SKY/NON-SKY 판정은 build_scan_from_frames()가 처리하며, 픽셀 분류는 SegFormer
(classify_sky_mask_segformer)를 쓴다. 그 결과는 generate_mock_scan()과 같은 형식
({"sky": ..., "max_captured_elevation_deg": ...})이라 resolve_unscanned()에 그대로 넘길 수 있다.
generate_mock_scan()은 사진 없이 알고리즘(d/e/f단계)만 단독으로 테스트할 때 쓰는 가짜 스캔이다.

좌표: 방위각 0~359 (360칸), 고도각 0~90 (91칸). 인덱스는 [elevation][azimuth].
값: 1 = SKY, 0 = NON-SKY, -1 = 촬영 안 된 영역.
"""

import math
from dataclasses import dataclass
from typing import Callable

import cv2
import numpy as np

AZ_STEPS = 360
EL_STEPS = 91
SCAN_HALF_RANGE_DEG = 90.0
DEFAULT_MAX_CAPTURED_ELEVATION_DEG = 65.0  # 30도 위로 든 자세 + 세로화각 약 70도 가정


def _az_in_scan_range(azimuth_deg: int, window_outward_azimuth_deg: float) -> bool:
    diff = (azimuth_deg - window_outward_azimuth_deg + 540) % 360 - 180  # -180~180
    return abs(diff) <= SCAN_HALF_RANGE_DEG


def generate_mock_scan(
    window_outward_azimuth_deg: float,
    obstructions: list[tuple[float, float, float]] | None = None,
    max_captured_elevation_deg: float = DEFAULT_MAX_CAPTURED_ELEVATION_DEG,
) -> dict:
    """스캔 원본(raw) 결과를 흉내낸다. obstructions: (az_min, az_max, el_max) 리스트 -> 그 구간은 NON-SKY."""
    obstructions = obstructions or []
    raw_sky = [[-1 for _ in range(AZ_STEPS)] for _ in range(EL_STEPS)]
    max_captured = [-1.0 for _ in range(AZ_STEPS)]

    for az in range(AZ_STEPS):
        if not _az_in_scan_range(az, window_outward_azimuth_deg):
            continue
        max_captured[az] = max_captured_elevation_deg
        for el in range(int(max_captured_elevation_deg) + 1):
            blocked = False
            for az_min, az_max, el_max in obstructions:
                if az_min <= az <= az_max and el <= el_max:
                    blocked = True
                    break
            raw_sky[el][az] = 0 if blocked else 1

    return {"sky": raw_sky, "max_captured_elevation_deg": max_captured}


def resolve_unscanned(scan: dict) -> list[list[int]]:
    """-1 처리 규칙 적용: 촬영 최고고도 위는 SKY, 그 외(스캔 범위 밖 등)는 NON-SKY."""
    raw_sky = scan["sky"]
    max_captured = scan["max_captured_elevation_deg"]
    resolved = [[0 for _ in range(AZ_STEPS)] for _ in range(EL_STEPS)]

    for el in range(EL_STEPS):
        for az in range(AZ_STEPS):
            value = raw_sky[el][az]
            if value != -1:
                resolved[el][az] = value
            elif max_captured[az] != -1 and el > max_captured[az]:
                resolved[el][az] = 1  # SKY
            else:
                resolved[el][az] = 0  # NON-SKY
    return resolved


def lookup_sky(resolved_sky: list[list[int]], azimuth_deg: float, elevation_deg: float) -> int:
    """sky[round(고도)][round(방위각) % 360] 조회."""
    az = round(azimuth_deg) % 360
    el = min(max(round(elevation_deg), 0), EL_STEPS - 1)
    return resolved_sky[el][az]


# ---- 실제 사진 기반 SKY/NON-SKY 판정 (CLAUDE.md 6장 스캔 업로드 규격과 1:1 대응) ----


@dataclass
class CameraParams:
    hfov_deg: float
    vfov_deg: float
    width: int
    height: int


@dataclass
class ScanFrame:
    index: int
    image: np.ndarray  # cv2.imread() 결과 (BGR), EXIF 회전 적용된 portrait 상태
    azimuth_deg: float  # 진북 기준 (앱이 변환해서 보냄, CLAUDE.md 2장/6장)
    pitch_deg: float  # 수평 0, 위를 보면 +
    roll_deg: float  # 수평 0, 시계방향으로 기울면 +


_SEGFORMER_MODEL_NAME = "nvidia/segformer-b0-finetuned-ade-512-512"
_segformer_cache: dict = {}  # {"processor":..., "model":..., "sky_label_id": int} 1회 로드 후 재사용


def _load_segformer():
    if not _segformer_cache:
        from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

        processor = SegformerImageProcessor.from_pretrained(_SEGFORMER_MODEL_NAME)
        model = SegformerForSemanticSegmentation.from_pretrained(_SEGFORMER_MODEL_NAME)
        model.eval()

        sky_label_id = next(
            (int(idx) for idx, label in model.config.id2label.items() if label.lower() == "sky"),
            None,
        )
        if sky_label_id is None:
            raise RuntimeError(f"{_SEGFORMER_MODEL_NAME} 라벨 목록에서 'sky'를 찾을 수 없음")

        _segformer_cache["processor"] = processor
        _segformer_cache["model"] = model
        _segformer_cache["sky_label_id"] = sky_label_id

    return _segformer_cache["processor"], _segformer_cache["model"], _segformer_cache["sky_label_id"]


# build_scan_from_frames 기본: 판정 마스크를 원본 크기 그대로 투영 (1 = 축소 안 함).
# 2~4로 줄여도 0.4초 정도밖에 안 빨라지고 경계 칸 판정이 1~2% 달라져서(verify_sky_fast.py 측정) 쓰지 않음.
SKY_MASK_DOWNSCALE = 1


def classify_sky_mask_segformer(
    image_bgr: np.ndarray, out_size: tuple[int, int] | None = None
) -> np.ndarray:
    """SegFormer(ADE20K, nvidia/segformer-b0-finetuned-ade-512-512)로 SKY 판정.

    입력: BGR 이미지. 출력: (H, W) bool 마스크 (out_size=(h, w)를 주면 그 크기, 없으면 원본 크기).
    모델은 첫 호출 때 1회만 로드해서 재사용(_segformer_cache).

    모델은 입력을 512x512로 줄여서 보고, 128x128 크기의 150개 분류 점수를 낸다. 예전에는 150개 점수를
    전부 원본 크기(예: 1280x720)로 늘린 뒤 가장 높은 분류를 골랐는데, 이 확대가 판정 시간의 절반 이상을
    차지했다. 지금은 128x128에서 "하늘 점수 - 하늘 외 최고 점수"(1개 채널)만 구해 그것만 늘리고,
    0보다 크면 하늘로 본다. 모델이 본 정보는 같고, 결과는 하늘/비하늘 경계의 픽셀만 조금 달라질 수 있다
    (verify_sky_fast.py에서 차이를 측정함).
    """
    processor, model, sky_label_id = _load_segformer()

    import torch

    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    inputs = processor(images=image_rgb, return_tensors="pt")
    with torch.inference_mode():
        logits = model(**inputs).logits[0]  # (num_labels, 128, 128) 저해상도 출력
        sky = logits[sky_label_id]
        others = logits.clone()
        others[sky_label_id] = float("-inf")
        margin = (sky - others.max(dim=0).values)[None, None]  # (1, 1, 128, 128), >0 이면 하늘이 1등
        upsampled = torch.nn.functional.interpolate(
            margin, size=out_size or image_bgr.shape[:2], mode="bilinear", align_corners=False
        )
    return (upsampled[0, 0] > 0).numpy()


def pixel_to_azimuth_elevation(
    px: np.ndarray,
    py: np.ndarray,
    camera: CameraParams,
    camera_azimuth_deg: float,
    pitch_deg: float,
    roll_deg: float,
) -> tuple[np.ndarray, np.ndarray]:
    """사진 픽셀 좌표 -> (방위각, 고도각). px/py는 numpy 배열이어도 벡터화되어 동작.

    1) 픽셀 -> 카메라 로컬 방향 벡터 (hfov/vfov로 구한 초점거리로 pinhole 근사)
    2) 로컬 방향 벡터(right/up/forward)를 촬영 당시 azimuth/pitch/roll로 월드(ENU) 좌표로 회전
       - forward(광축)는 azimuth, pitch에만 영향받고 roll에는 영향받지 않음 (광축 자체는 안 변함)
       - roll은 광축 둘레로 right/up만 회전시킴
    3) 월드 벡터 -> 방위각(atan2)/고도각(arcsin)
    """
    w, h = camera.width, camera.height
    fx = (w / 2) / math.tan(math.radians(camera.hfov_deg) / 2)
    fy = (h / 2) / math.tan(math.radians(camera.vfov_deg) / 2)

    dx = (px + 0.5 - w / 2) / fx
    dy = -(py + 0.5 - h / 2) / fy  # 이미지 y는 아래로 증가 -> 카메라 로컬 up은 반대 부호
    dz = np.ones_like(dx, dtype=np.float64)
    norm = np.sqrt(dx * dx + dy * dy + dz * dz)
    dx, dy, dz = dx / norm, dy / norm, dz / norm

    a = math.radians(camera_azimuth_deg)
    theta = math.radians(pitch_deg)
    rho = math.radians(roll_deg)

    # azimuth=a, pitch=roll=0일 때의 카메라 축 (ENU: East, North, Up)
    fwd0 = (math.sin(a), math.cos(a), 0.0)
    right0 = (math.cos(a), -math.sin(a), 0.0)
    up0 = (0.0, 0.0, 1.0)

    # pitch: forward<->up 평면 회전 (right는 고정축)
    fwd1 = tuple(f * math.cos(theta) + u * math.sin(theta) for f, u in zip(fwd0, up0))
    up1 = tuple(-f * math.sin(theta) + u * math.cos(theta) for f, u in zip(fwd0, up0))
    right1 = right0

    # roll: right<->up 평면 회전 (forward는 고정축)
    right2 = tuple(r * math.cos(rho) + u * math.sin(rho) for r, u in zip(right1, up1))
    up2 = tuple(-r * math.sin(rho) + u * math.cos(rho) for r, u in zip(right1, up1))
    fwd2 = fwd1

    v_east = dx * right2[0] + dy * up2[0] + dz * fwd2[0]
    v_north = dx * right2[1] + dy * up2[1] + dz * fwd2[1]
    v_up = dx * right2[2] + dy * up2[2] + dz * fwd2[2]

    elevation_deg = np.degrees(np.arcsin(np.clip(v_up, -1.0, 1.0)))
    azimuth_deg = np.degrees(np.arctan2(v_east, v_north)) % 360.0
    return azimuth_deg, elevation_deg


def build_scan_from_frames(
    frames: list[ScanFrame],
    camera: CameraParams,
    classify_fn: Callable[[np.ndarray], np.ndarray] | None = None,
    mask_downscale: int = SKY_MASK_DOWNSCALE,
) -> dict:
    """사진 N장 -> generate_mock_scan()과 같은 형식의 raw scan. 그대로 resolve_unscanned()에 넘기면 된다.

    사진끼리 겹치는 (azimuth, elevation) 칸은 다수결(SKY 비율 0.5 이상이면 SKY)로 합친다.
    분류는 기본적으로 SegFormer(classify_sky_mask_segformer)를 쓴다. mask_downscale로 마스크를 원본의
    1/n 크기로 만들어 투영할 수도 있지만, 기본(1)은 원본 크기라 예전 방식과 결과가 완전히 같다.
    classify_fn을 주면 그 함수(BGR 이미지 -> bool 마스크)를 쓴다. 마스크 크기는 원본과 달라도 되고,
    마스크 칸의 중심을 원본 픽셀 좌표로 바꿔서 투영한다.
    칸별 투표는 np.add.at 대신 np.bincount로 합산한다(결과 같음, 훨씬 빠름).
    """
    if classify_fn is None:
        out_size = (max(1, camera.height // mask_downscale), max(1, camera.width // mask_downscale))
        classify_fn = lambda image: classify_sky_mask_segformer(image, out_size=out_size)  # noqa: E731

    n_cells = EL_STEPS * AZ_STEPS
    sky_votes = np.zeros(n_cells, dtype=np.float64)
    total_votes = np.zeros(n_cells, dtype=np.float64)
    grids: dict[tuple[int, int], tuple[np.ndarray, np.ndarray]] = {}

    for frame in frames:
        mask = classify_fn(frame.image)
        mh, mw = mask.shape[:2]
        if (mh, mw) not in grids:
            # 마스크 칸 (i, j)의 중심을 원본 픽셀 좌표로: 원본 크기와 같으면 그대로 j, i
            ys = (np.arange(mh) + 0.5) * (camera.height / mh) - 0.5
            xs = (np.arange(mw) + 0.5) * (camera.width / mw) - 0.5
            py_grid, px_grid = np.meshgrid(ys, xs, indexing="ij")
            grids[(mh, mw)] = (px_grid, py_grid)
        px_grid, py_grid = grids[(mh, mw)]

        az, el = pixel_to_azimuth_elevation(
            px_grid, py_grid, camera, frame.azimuth_deg, frame.pitch_deg, frame.roll_deg
        )

        valid = el >= 0  # 고도 0 이하(바닥 방향)는 스캔 격자(0~90) 밖이라 제외
        az_idx = np.round(az[valid]).astype(int) % AZ_STEPS
        el_idx = np.clip(np.round(el[valid]).astype(int), 0, EL_STEPS - 1)
        cell = el_idx * AZ_STEPS + az_idx
        # np.add.at보다 훨씬 빠른 칸별 합계
        sky_votes += np.bincount(cell, weights=mask[valid].astype(np.float64), minlength=n_cells)
        total_votes += np.bincount(cell, minlength=n_cells)

    sky_votes = sky_votes.reshape(EL_STEPS, AZ_STEPS)
    total_votes = total_votes.reshape(EL_STEPS, AZ_STEPS)
    captured = total_votes > 0
    raw_sky = np.full((EL_STEPS, AZ_STEPS), -1, dtype=int)
    raw_sky[captured] = (sky_votes[captured] / total_votes[captured] >= 0.5).astype(int)

    max_captured = np.full(AZ_STEPS, -1.0)
    for az in range(AZ_STEPS):
        captured_els = np.where(total_votes[:, az] > 0)[0]
        if captured_els.size > 0:
            max_captured[az] = float(captured_els.max())

    return {"sky": raw_sky.tolist(), "max_captured_elevation_deg": max_captured.tolist()}
