/**
 * 사진 EXIF → 카메라 화각(hfov/vfov) 추정 (React / Expo와 무관한 순수 함수).
 *
 * 화각은 기종마다 달라(약 65~75°) 고정값을 쓰지 않고, EXIF의 35mm 환산 초점거리로 계산한다.
 *   35mm 환산 초점거리 f35는 "대각선 기준"이므로
 *   픽셀 단위 초점거리 f_px = 이미지 대각선(px) × f35 / 35mm 필름 대각선(43.27mm)
 *   hfov = 2·atan(width / 2f_px), vfov = 2·atan(height / 2f_px)
 * 이미지 크기를 줄여도 화각은 변하지 않으므로, 저장된(축소된) 이미지 크기를 그대로 넣으면 된다.
 */

import type { FovSource } from '@/types';

const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
const RAD = 180 / Math.PI;

/** EXIF가 없을 때 쓰는 긴 변(세로) 화각 기본값 (°) — fovSource 'default'로 구분해서 보낸다 */
export const DEFAULT_LONG_SIDE_FOV_DEG = 70;
/** 크기 정보가 없을 때(카메라 시뮬레이션) 쓰는 기본 이미지 크기 (portrait, 긴 변 1280) */
export const DEFAULT_IMAGE_SIZE = { width: 960, height: 1280 };

/** iOS: FocalLenIn35mmFilm, Android(ExifInterface): FocalLengthIn35mmFilm */
const FOCAL_35MM_KEYS = ['FocalLenIn35mmFilm', 'FocalLengthIn35mmFilm'];

export interface FovEstimate {
  hfovDeg: number;
  vfovDeg: number;
  width: number;
  height: number;
  fovSource: FovSource;
}

/** 숫자, "26", "473/100" 같은 EXIF 값을 숫자로 */
export function readExifNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const [num, den] = value.split('/').map((s) => Number(s.trim()));
  if (!Number.isFinite(num)) return null;
  if (den === undefined) return num;
  return Number.isFinite(den) && den !== 0 ? num / den : null;
}

export function focal35mm(exif: Record<string, unknown> | null | undefined): number | null {
  if (!exif) return null;
  for (const key of FOCAL_35MM_KEYS) {
    const f = readExifNumber(exif[key]);
    // 휴대폰 카메라의 현실적인 범위만 인정 (초광각 ~13mm, 망원 ~120mm)
    if (f !== null && f >= 10 && f <= 200) return f;
  }
  return null;
}

export function estimateFov(
  exif: Record<string, unknown> | null | undefined,
  width: number,
  height: number,
): FovEstimate {
  const hasSize = width > 0 && height > 0;
  const w = hasSize ? width : DEFAULT_IMAGE_SIZE.width;
  const h = hasSize ? height : DEFAULT_IMAGE_SIZE.height;
  const f35 = focal35mm(exif);

  const fPx =
    f35 !== null
      ? (Math.hypot(w, h) * f35) / FULL_FRAME_DIAGONAL_MM
      : Math.max(w, h) / 2 / Math.tan(DEFAULT_LONG_SIDE_FOV_DEG / 2 / RAD);

  return {
    hfovDeg: round2(2 * Math.atan(w / (2 * fPx)) * RAD),
    vfovDeg: round2(2 * Math.atan(h / (2 * fPx)) * RAD),
    width: w,
    height: h,
    fovSource: f35 !== null ? 'exif35mm' : 'default',
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
