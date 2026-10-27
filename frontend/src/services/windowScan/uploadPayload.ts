import type { WindowScan } from '@/types';

import { signedDelta } from '../orientation/headingMath';
import { estimateFov } from './cameraFov';
import { DEFAULT_SCAN_CONFIG } from './scanTracker';

/**
 * WindowScan(앱 내부, camelCase) → 창밖 스캔 업로드 metadata (백엔드 POST /windows/{id}/scans, snake_case).
 * 사진은 multipart `files`로 같이 보내고, frames[].file 이름으로 서로 연결한다.
 *
 * 백엔드는 정해진 필드 외에는 거절한다(extra='forbid'). 규칙(backend app/integration.py Scan 모델):
 *   - 사진 13장, index 0~12, 파일 이름 중복 없음
 *   - 진북 = 자북 + 편각 (오차 1° 이내) — 창문 정면과 각 사진 모두
 *   - 사진 i의 방위각 = 창문 정면 − 90° + 15°·i (오차 5° 이내)
 *   - 세로 JPEG, 높이 1280px, camera.width/height와 같은 크기, EXIF 회전 없음, 장당 5 MiB 이하
 */

/** 0°~180°를 15° 간격으로 = 13장 */
export const SCAN_FRAME_COUNT = DEFAULT_SCAN_CONFIG.targetAngle / DEFAULT_SCAN_CONFIG.captureStep + 1;
/** 백엔드가 허용하는 사진 방향 오차 (°) */
export const FRAME_TOLERANCE_DEG = 5;
/** 백엔드가 요구하는 사진 높이 (px) */
export const UPLOAD_HEIGHT_PX = 1280;

export interface ScanUploadFrame {
  index: number;
  file: string;
  azimuth_deg: number;
  azimuth_mag_deg: number;
  pitch_deg: number | null;
  roll_deg: number | null;
}

export interface ScanUploadMeta {
  window_id: number;
  captured_at: string;
  declination_deg: number;
  /** 창문 정면 방위각 (진북) — 백엔드 방 방향 계산용 */
  window_azimuth_deg: number | null;
  window_azimuth_mag_deg: number | null;
  camera: {
    hfov_deg: number;
    vfov_deg: number;
    width: number;
    height: number;
  };
  frames: ScanUploadFrame[];
}

/** 사진 i가 바라봐야 하는 방위각 (진북) */
export function expectedFrameAzimuth(facingAzimuth: number, index: number): number {
  return facingAzimuth - DEFAULT_SCAN_CONFIG.targetAngle / 2 + DEFAULT_SCAN_CONFIG.captureStep * index;
}

/**
 * 업로드 전에 백엔드와 같은 규칙으로 확인한다. 문제가 있으면 사용자 안내 문장, 없으면 null.
 * (서버가 422로 거절하기 전에 '다시 스캔'을 안내하기 위해)
 */
export function checkScanForUpload(scan: WindowScan): string | null {
  const { facing, captures } = scan;
  if (!facing) return '창문 정면 방향이 기록되지 않았어요. 다시 스캔해 주세요.';
  if (captures.length !== SCAN_FRAME_COUNT) {
    return `사진이 ${captures.length}장이에요. ${SCAN_FRAME_COUNT}장이 필요해서 다시 스캔해 주세요.`;
  }
  if (captures.some((c) => !c.imageUri)) return '카메라 없이 찍은 테스트 스캔은 보낼 수 없어요.';
  if (captures.some((c) => c.pitch === undefined || c.roll === undefined)) {
    return '기울기 값이 없는 사진이 있어요. 다시 스캔해 주세요.';
  }
  let worst = { index: -1, off: 0 };
  captures.forEach((c, i) => {
    const off = Math.abs(signedDelta(expectedFrameAzimuth(facing.azimuth, i), c.azimuth));
    if (off > worst.off) worst = { index: i, off };
  });
  if (worst.off > FRAME_TOLERANCE_DEG) {
    return `${worst.index + 1}번째 사진 방향이 기준에서 ${worst.off.toFixed(0)}° 벗어났어요 (${FRAME_TOLERANCE_DEG}° 이내 필요). 시작 위치를 맞춰 다시 스캔해 주세요.`;
  }
  return null;
}

/**
 * @param backendWindowId 백엔드 창문 ID
 * @param size 업로드할 사진 크기 (축소 후). 없으면 스캔 때 기록한 크기
 */
export function toScanUpload(scan: WindowScan, backendWindowId: number, size?: { width: number; height: number }): ScanUploadMeta {
  const camera = scan.camera ?? estimateFov(null, 0, 0);
  return {
    window_id: backendWindowId,
    captured_at: toKstIso(scan.captures[0]?.timestamp ?? scan.debug?.scannedAt ?? Date.now()),
    declination_deg: scan.declinationDeg,
    window_azimuth_deg: scan.facing?.azimuth ?? null,
    window_azimuth_mag_deg: scan.facing?.magneticAzimuth ?? null,
    // 화각은 이미지 크기를 줄여도 변하지 않는다 (cameraFov.ts)
    camera: {
      hfov_deg: camera.hfovDeg,
      vfov_deg: camera.vfovDeg,
      width: size?.width ?? camera.width,
      height: size?.height ?? camera.height,
    },
    frames: scan.captures.map((c, i) => ({
      index: i,
      file: frameFileName(i),
      azimuth_deg: c.azimuth,
      azimuth_mag_deg: c.magneticAzimuth,
      pitch_deg: c.pitch ?? null,
      roll_deg: c.roll ?? null,
    })),
  };
}

export function frameFileName(index: number) {
  return `frame_${String(index).padStart(2, '0')}.jpg`;
}

/** epoch ms → 한국시간 ISO 8601 (예: 2026-10-05T14:30:00+09:00) */
export function toKstIso(ms: number): string {
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
}
