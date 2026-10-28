"""SegFormer SKY/NON-SKY 판정 결과를 사진에 반투명 초록(SKY)/빨강(NON-SKY)으로 덧칠해서 눈으로 검증하는 도구.

폰 기본 카메라로 하늘 사진을 찍어서 PC로 옮긴 다음 실행하면 됨 (앱 빌드 불필요).

사용법:
    python visualize_sky_mask.py <입력 사진.jpg> [출력 파일.png]
"""

import sys

import cv2
import numpy as np

from c_sky import classify_sky_mask_segformer

ALPHA = 0.45  # 오버레이 투명도
GREEN = np.array([0, 255, 0], dtype=np.uint8)  # SKY
RED = np.array([0, 0, 255], dtype=np.uint8)  # NON-SKY


def overlay_sky_mask(image_bgr: np.ndarray) -> np.ndarray:
    mask = classify_sky_mask_segformer(image_bgr)
    overlay = image_bgr.copy().astype(np.float32)
    overlay[mask] = overlay[mask] * (1 - ALPHA) + GREEN * ALPHA
    overlay[~mask] = overlay[~mask] * (1 - ALPHA) + RED * ALPHA
    return overlay.astype(np.uint8)


def main() -> None:
    if len(sys.argv) < 2:
        print("사용법: python visualize_sky_mask.py <입력 사진.jpg> [출력 파일.png]")
        return

    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "sky_mask_overlay.png"

    image = cv2.imread(in_path)
    if image is None:
        print(f"이미지를 읽을 수 없음: {in_path}")
        return

    print("SegFormer 모델 로드 중 (첫 실행 시 다운로드 때문에 시간이 걸릴 수 있음)...")
    result = overlay_sky_mask(image)
    cv2.imwrite(out_path, result)
    print(f"저장됨: {out_path} (초록 = SKY 판정, 빨강 = NON-SKY 판정)")


if __name__ == "__main__":
    main()
