import type { NorthReference } from '@/types';

import { normalizeDeg } from './headingMath';

/**
 * 자북 → 진북 보정 (자기 편각, magnetic declination).
 *
 * Magnetometer 방위각은 자북 기준이고, 태양 위치(NREL SPA)는 진북 기준이다.
 *   진북 방위각 = 자북 방위각 + 편각   (편각: 동쪽 +, 서쪽 −)
 *
 * 한국의 편각은 약 −7.5°(제주) ~ −9.5°(중부 내륙) 범위다.
 * 현재 앱에는 위경도가 없으므로(지역 → 위경도 변환은 백엔드 담당) 한국 중부 기준 근사값을 쓴다.
 * 근사 오차(≈ ±1°)는 15° 촬영 간격보다 충분히 작고, 스캔 데이터에 자북 원본(magneticAzimuth)도
 * 함께 저장하므로 계산 쪽에서 실제 위경도 기반 편각(WMM)으로 다시 보정할 수 있다.
 */

export const KOREA_DEFAULT_DECLINATION_DEG = -8.7;

export interface DeclinationInfo {
  /** 저장된 azimuth 값의 기준 */
  northReference: NorthReference;
  /** 적용한 편각 (°, 동쪽 +) */
  declinationDeg: number;
  /** 편각 출처 */
  declinationSource: 'koreaDefault';
}

export const DEFAULT_DECLINATION: DeclinationInfo = {
  northReference: 'true',
  declinationDeg: KOREA_DEFAULT_DECLINATION_DEG,
  declinationSource: 'koreaDefault',
};

/** 자북 방위각 → 진북 방위각 (0~360) */
export function magneticToTrue(magneticAzimuth: number, declinationDeg = KOREA_DEFAULT_DECLINATION_DEG): number {
  return normalizeDeg(magneticAzimuth + declinationDeg);
}
