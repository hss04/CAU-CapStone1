"""하늘 판정 속도 개선(2026-11-02) 전후 비교 검증.

예전 방식: SegFormer 출력(150개 분류, 128x128)을 전부 원본 크기로 늘린 뒤 1등 분류를 고르고,
           원본의 모든 픽셀을 방위/고도로 투영해 np.add.at으로 투표
새 방식:   "하늘 점수 - 하늘 외 최고 점수" 1개 채널만 원본 크기로 늘리고, 투영은 그대로, 투표는 np.bincount
           (투영을 1/2~1/4로 줄이는 옵션도 있지만 0.4초밖에 안 빨라지고 경계 칸이 1~2% 달라져서 기본값은 1)

같은 사진으로 둘을 돌려서 아래를 비교한다.
  1) 사진별 마스크: 같은 원본 크기에서 판정이 다른 픽셀 비율
  2) 91x360 하늘 격자: 판정이 다른 칸 수 (raw / -1 처리 후)
  3) 그 격자로 계산한 방 DLI 차이 (창문 1개, 맑은 하늘 모델)
  4) 처리 시간 (모델 로딩 제외, 13장 기준)
기준: 하늘 격자 차이 <= 찍힌 칸의 1%, DLI 차이 <= 0.05 mol/m2/day

사용법: python verify_sky_fast.py <사진 폴더> [hfov vfov pitch]
  사진 폴더에 frame_00.jpg ~ frame_12.jpg (세로, 왼쪽→오른쪽 15도 간격)가 있어야 함.
  방향 센서값이 없으면 각도는 가정값(정면 180도, 90~270도, 피치 인자)을 쓴다. 비교 검증이라 두 방식에
  같은 가정을 넣으므로 결과 비교에는 영향이 없다.
"""

import math
import os
import sys
import time

import cv2
import numpy as np

from c_sky import (
    AZ_STEPS,
    EL_STEPS,
    CameraParams,
    ScanFrame,
    _load_segformer,
    build_scan_from_frames,
    classify_sky_mask_segformer,
    pixel_to_azimuth_elevation,
    resolve_unscanned,
)
from grid_dli_service import compute_room_dli
from room_geometry import point_in_polygon

PASS, FAIL = "OK", "!! FAIL !!"
failures = 0


def check(label, cond, detail=""):
    global failures
    failures += 0 if cond else 1
    print(f"  [{PASS if cond else FAIL}] {label}" + (f" ({detail})" if detail else ""))


def old_classify(image_bgr):
    """예전 classify_sky_mask_segformer 그대로 (150개 분류 전체를 원본 크기로 확대 후 argmax)."""
    import torch

    processor, model, sky_id = _load_segformer()
    inputs = processor(images=cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB), return_tensors="pt")
    with torch.no_grad():
        logits = model(**inputs).logits
    up = torch.nn.functional.interpolate(logits, size=image_bgr.shape[:2], mode="bilinear", align_corners=False)
    return up.argmax(dim=1)[0].numpy() == sky_id


def old_build_scan(frames, camera):
    """예전 build_scan_from_frames 그대로 (원본 모든 픽셀 투영 + np.add.at)."""
    sky_votes = np.zeros((EL_STEPS, AZ_STEPS), np.float32)
    total = np.zeros((EL_STEPS, AZ_STEPS), np.float32)
    py, px = np.mgrid[0:camera.height, 0:camera.width]
    for f in frames:
        mask = old_classify(f.image)
        az, el = pixel_to_azimuth_elevation(px, py, camera, f.azimuth_deg, f.pitch_deg, f.roll_deg)
        v = el >= 0
        ai = np.round(az[v]).astype(int) % AZ_STEPS
        ei = np.clip(np.round(el[v]).astype(int), 0, EL_STEPS - 1)
        np.add.at(sky_votes, (ei, ai), mask[v].astype(np.float32))
        np.add.at(total, (ei, ai), 1.0)
    cap = total > 0
    raw = np.full((EL_STEPS, AZ_STEPS), -1, int)
    raw[cap] = (sky_votes[cap] / total[cap] >= 0.5).astype(int)
    maxc = np.full(AZ_STEPS, -1.0)
    for a in range(AZ_STEPS):
        e = np.where(total[:, a] > 0)[0]
        if e.size:
            maxc[a] = float(e.max())
    return {"sky": raw.tolist(), "max_captured_elevation_deg": maxc.tolist()}


def room_dli(scan):
    """남향 창문 1개(바깥 방향 180도) 4x5m 방, 20cm 격자, 맑은 하늘 모델."""
    pts = [(0, 0), (4, 0), (4, 5), (0, 5)]
    cell = 0.2
    cols, rows = math.ceil(4 / cell), math.ceil(5 / cell)
    grid = {"origin": {"x": 0, "y": 0, "z": 0}, "cell_size_m": cell, "sample_height_m": 0, "rows": rows, "cols": cols,
            "inside_mask": [[point_in_polygon(pts, (c + .5) * cell, (r + .5) * cell) for c in range(cols)] for r in range(rows)]}
    window = {"window_id": 1, "wall_index": 2, "v0": [3, 1, 5], "v1": [1, 1, 5], "v2": [1, 2.2, 5], "v3": [3, 2.2, 5], "sky": scan}
    room = {"corners": [{"order_index": i, "x": x, "z": z} for i, (x, z) in enumerate(pts)],
            "x_axis_azimuth_deg": 90.0, "latitude": 37.5665, "longitude": 126.978}
    out = compute_room_dli({"date": "2026-10-20", "room": room, "grid": grid, "windows": [window]})
    return np.array([[v for v in row] for row in out["total_dli"]], dtype=float)


def main():
    frames_dir = sys.argv[1]
    hfov, vfov, pitch = (float(x) for x in sys.argv[2:5]) if len(sys.argv) >= 5 else (42.0, 69.0, -17.0)
    imgs = [cv2.imdecode(np.fromfile(os.path.join(frames_dir, f"frame_{k:02d}.jpg"), np.uint8), cv2.IMREAD_COLOR)
            for k in range(13)]
    h, w = imgs[0].shape[:2]
    cam = CameraParams(hfov, vfov, w, h)
    frames = [ScanFrame(k, imgs[k], 90 + 15 * k, pitch, 0.0) for k in range(13)]
    _load_segformer()  # 모델 로딩은 시간 비교에서 제외

    print("\n[1] 사진별 마스크 (원본 크기에서 비교)")
    diffs = []
    for img in imgs:
        a = old_classify(img)
        b = classify_sky_mask_segformer(img)
        diffs.append((a != b).mean() * 100)
    check("사진별 판정이 다른 픽셀 비율 <= 0.5%", max(diffs) <= 0.5,
          f"평균 {np.mean(diffs):.3f}%, 최대 {max(diffs):.3f}%")

    print("\n[2] 91x360 하늘 격자")
    t0 = time.perf_counter(); old = old_build_scan(frames, cam); t_old = time.perf_counter() - t0
    t0 = time.perf_counter(); new = build_scan_from_frames(frames, cam); t_new = time.perf_counter() - t0
    ro, rn = np.array(old["sky"]), np.array(new["sky"])
    cap_o, cap_n = (ro != -1), (rn != -1)
    both = cap_o & cap_n
    raw_diff = int((ro[both] != rn[both]).sum())
    check("찍힌 칸(촬영 범위) 거의 같음 (차이 <= 1%)", abs(int(cap_o.sum()) - int(cap_n.sum())) <= 0.01 * cap_o.sum(),
          f"예전 {int(cap_o.sum())}칸, 새 {int(cap_n.sum())}칸, 한쪽만 찍힘 {int((cap_o ^ cap_n).sum())}칸")
    check("둘 다 찍힌 칸 중 판정 다른 칸 <= 1%", raw_diff <= 0.01 * both.sum(),
          f"{raw_diff}칸 / {int(both.sum())}칸 = {raw_diff / both.sum() * 100:.2f}%")
    reso, resn = np.array(resolve_unscanned(old)), np.array(resolve_unscanned(new))
    res_diff = int((reso != resn).sum())
    check("-1 처리 후 최종 격자에서 다른 칸 <= 찍힌 칸의 1%", res_diff <= 0.01 * cap_o.sum(),
          f"{res_diff}칸 / 전체 {reso.size}칸")
    maxc_diff = np.abs(np.array(old["max_captured_elevation_deg"]) - np.array(new["max_captured_elevation_deg"]))
    check("방위별 최고 촬영 고도 차이 <= 1도", maxc_diff.max() <= 1.0, f"최대 차이 {maxc_diff.max():.0f}도")

    print("\n[3] 그 격자로 계산한 방 DLI (남향 창문, 2026-10-20, 맑은 하늘 모델)")
    d_old, d_new = room_dli(old), room_dli(new)
    dd = np.abs(d_old - d_new)
    check("칸별 DLI 차이 <= 0.05 mol/m2/day", np.nanmax(dd) <= 0.05,
          f"최대 {np.nanmax(dd):.3f}, 평균 {np.nanmean(dd):.4f}, 방 최대 DLI {np.nanmax(d_old):.2f}")

    print("\n[4] 처리 시간 (13장, 모델 로딩 제외)")
    print(f"  예전 {t_old:.1f}s -> 새 {t_new:.1f}s  ({t_old / t_new:.1f}배 빠름)")
    check("새 방식이 더 빠름", t_new < t_old)

    print(f"\n결과: 실패 {failures}건")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
