import type { WindowScan } from '@/types';

import { estimateFov } from './cameraFov';

/**
 * WindowScan(앱 내부, camelCase) → 창밖 스캔 업로드 JSON (규격 6장 "스캔 업로드 JSON", snake_case).
 * 사진은 multipart로 같이 보내고, frames[].file 이름으로 서로 연결한다.
 *
 * 규격 6장에 더한 필드 (팀 합의, 2026-10-25):
 *   window_facing_azimuth_deg / window_facing_azimuth_mag_deg — 창문 정면 방위각 (방 방향 계산용)
 *   camera.fov_source — 화각을 EXIF로 계산했는지(exif35mm), 기본값인지(default)
 */

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
  window_facing_azimuth_deg: number | null;
  window_facing_azimuth_mag_deg: number | null;
  camera: {
    hfov_deg: number;
    vfov_deg: number;
    width: number;
    height: number;
    fov_source: string;
  };
  frames: ScanUploadFrame[];
}

export interface ScanUploadFile {
  /** multipart 파트 이름과 frames[].file */
  name: string;
  uri: string;
}

export interface ScanUpload {
  meta: ScanUploadMeta;
  files: ScanUploadFile[];
}

/**
 * @param backendWindowId 백엔드 창문 ID (정수). 앱 창문 ID(windowId)는 아직 Mock 문자열이라 따로 받는다.
 */
export function toScanUpload(scan: WindowScan, backendWindowId: number): ScanUpload {
  const camera = scan.camera ?? estimateFov(null, 0, 0);
  const files = scan.captures.map((c, i) => ({ name: frameFileName(i), uri: c.imageUri }));

  return {
    meta: {
      window_id: backendWindowId,
      captured_at: toKstIso(scan.captures[0]?.timestamp ?? scan.debug?.scannedAt ?? Date.now()),
      declination_deg: scan.declinationDeg,
      window_facing_azimuth_deg: scan.facing?.azimuth ?? null,
      window_facing_azimuth_mag_deg: scan.facing?.magneticAzimuth ?? null,
      camera: {
        hfov_deg: camera.hfovDeg,
        vfov_deg: camera.vfovDeg,
        width: camera.width,
        height: camera.height,
        fov_source: camera.fovSource,
      },
      frames: scan.captures.map((c, i) => ({
        index: i,
        file: frameFileName(i),
        azimuth_deg: c.azimuth,
        azimuth_mag_deg: c.magneticAzimuth,
        pitch_deg: c.pitch ?? null,
        roll_deg: c.roll ?? null,
      })),
    },
    files,
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
