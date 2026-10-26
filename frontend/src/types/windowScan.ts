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
  /** 카메라의 좌우 기울기 (수평 0°, 화면을 보는 사용자 기준 시계 방향 +) */
  roll?: number;
  /** 저장된 이미지 크기 (px, 긴 변 최대 1280으로 축소한 뒤) */
  width?: number;
  height?: number;
  timestamp: number;
};

/**
 * 창문 정면 방위각 — 스캔 전에 휴대폰을 창문과 평행하게(뒷면을 유리에 대고) 들고 기록한다.
 * 계산 쪽에서 창문 바깥 법선(방 좌표)과 비교해 방 방향(x_axis_azimuth_deg)을 구하는 데 쓴다.
 */
export type WindowFacing = {
  /** 진북 기준 (0~360) */
  azimuth: number;
  /** 보정 전 센서 원본 (자북 기준) */
  magneticAzimuth: number;
  /** 기록 구간 방위각의 원형 표준편차 (°) — 손떨림·자기 간섭 정도 */
  spreadDeg: number;
  /** 평균에 쓴 센서 샘플 수 */
  sampleCount: number;
  /** 기록 구간 평균 자기장 세기 (μT) */
  avgFieldStrength: number;
  timestamp: number;
};

/** 화각 출처 — exif35mm: EXIF 35mm 환산 초점거리로 계산 / default: EXIF가 없어 기본값 사용 */
export type FovSource = 'exif35mm' | 'default';

export type ScanCamera = {
  hfovDeg: number;
  vfovDeg: number;
  /** 화각 계산 기준 이미지 크기 (px, 저장된 이미지와 같음) */
  width: number;
  height: number;
  fovSource: FovSource;
};

export type WindowScan = {
  windowId: string;
  /** 창문 정면 방위각 (스캔 시작 전 기록) */
  facing?: WindowFacing;
  /** 카메라 화각·해상도 (첫 사진 EXIF 기준) */
  camera?: ScanCamera;
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
