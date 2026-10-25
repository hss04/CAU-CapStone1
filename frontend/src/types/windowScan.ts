/**
 * 창밖 180° 스캔 데이터.
 *
 * 나중에 백엔드에서 각 사진을 segmentation 하고
 * "사진 픽셀 위치 + 촬영 당시 방위각(진북 기준)"으로 Sky / 장애물 방향을 계산할 예정이므로
 * 사진(imageUri)과 촬영 당시 방위각(azimuth)이 정확히 한 쌍으로 저장되는 것이 핵심이다.
 */

/** 방위각 기준 — 'true' = 진북, 'magnetic' = 자북 */
export type NorthReference = 'true' | 'magnetic';

export type ScanCapture = {
  imageUri: string;
  /** 촬영 당시 카메라가 바라본 방위각 (진북 기준, 0~360°, 시계 방향) — 태양 방위각(NREL SPA)과 같은 기준 */
  azimuth: number;
  /** 보정 전 센서 원본 방위각 (자북 기준). 계산 쪽에서 위경도 기반 편각으로 재보정할 때 사용 */
  magneticAzimuth: number;
  /** 카메라의 상하 기울기 (수평 0°, 위쪽 +) */
  pitch?: number;
  timestamp: number;
};

export type WindowScan = {
  windowId: string;
  /** 진북 기준 */
  startAzimuth: number;
  /** 진북 기준 */
  endAzimuth: number;
  /** azimuth / startAzimuth / endAzimuth의 기준 (항상 'true') */
  northReference: NorthReference;
  /** 자북 → 진북 보정에 적용한 편각 (°, 동쪽 +). 진북 = 자북 + declinationDeg */
  declinationDeg: number;
  /** 편각 출처 — 'koreaDefault' = 한국 중부 근사값 (위경도 미사용) */
  declinationSource: 'koreaDefault';
  /** 시작점부터 실제로 회전한 누적 각도 (예: 180.7) */
  scannedAngle: number;
  captures: ScanCapture[];
  /** 개발 확인용 부가 정보 — 백엔드 전송 스펙과는 무관 */
  debug?: WindowScanDebug;
};

export type HeadingSourceKind = 'sensors' | 'simulated';

export interface WindowScanDebug {
  scannedAt: number;
  durationMs: number;
  headingSource: HeadingSourceKind;
  captureStepDeg: number;
  targetAngle: number;
  /** 촬영 목표 피치 (°) */
  targetPitchDeg?: number;
  /** 피치 허용 범위 (±°) */
  pitchToleranceDeg?: number;
  /** 스캔 중 표시된 경고 횟수 */
  warnings: { reverse: number; tooFast: number; tilt: number; interference: number };
  /** 평균 자기장 세기 (μT) — 25~65 범위를 벗어나면 주변 금속/자석 간섭 가능 */
  avgFieldStrength?: number;
  /** 촬영 실패로 누락된 capture 수 */
  failedCaptures: number;
}
