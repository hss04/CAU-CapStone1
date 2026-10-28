import type { ApiDliMap } from './api';
import type { DailyWeather } from './weather';

/**
 * 주간 광환경(날짜별 예상 DLI).
 *
 * DLI 값은 LUMAP 계산 엔진(백엔드 POST /rooms/{id}/dli-map → 알고리즘)이 만든 dli_map_v2에서
 * 식물 자리의 칸 값을 읽어 온다. 앱은 광량을 따로 계산하지 않는다.
 * 계산 API를 쓸 수 없을 때만 예시(mock) 지도를 쓰고, source로 구분한다.
 */

/** calculated: 서버 계산 결과 · mock: 화면 확인용 예시 데이터 */
export type LightDataSource = 'calculated' | 'mock';

/** historical: 지난 날짜 — 과거 기상 데이터로 추정 · forecast: 오늘 이후 — 기상 예보로 예측 */
export type LightBasis = 'historical' | 'forecast';

/** 식물 요구 DLI 범위와 비교한 결과 (규격 Recommendation status LOW/OK/HIGH와 같은 기준) */
export type DliStatus = 'low' | 'ok' | 'high';

export interface DliRange {
  /** mol/m²/day */
  min: number;
  max: number;
  /** server: 서버 식물 종 카탈로그 · example: 앱에 넣어 둔 예시 범위 */
  source: 'server' | 'example';
  /** 근거 자료 없이 정한 추정값 (서버 source_note에 ESTIMATED) */
  estimated?: boolean;
}

/** 방 하나의 하루치 계산 결과 */
export interface LightDay {
  /** YYYY-MM-DD */
  date: string;
  basis: LightBasis;
  /** 이 날짜의 DLI 지도. 계산에 실패했거나 아직 없으면 null */
  map: ApiDliMap | null;
  /** 예시 데이터에만 있는 예시 날씨 (서버 계산 결과의 날씨는 Open-Meteo 날씨를 따로 붙인다) */
  exampleWeather?: DailyWeather;
  /** 이 날짜 계산이 실패한 이유 */
  error?: string;
}

/** 식물 자리 기준 하루치 값 (화면용) */
export interface DailyLightPoint {
  date: string;
  basis: LightBasis;
  /** 예상 DLI (mol/m²/day). 값이 없으면 null */
  dli: number | null;
  status: DliStatus | null;
  weather: DailyWeather | null;
}

export interface PlantLightSeries {
  plantId: string;
  range: DliRange;
  /** 지난 7일 (오늘 제외, 오래된 날부터) */
  recent: DailyLightPoint[];
  /** 오늘 + 앞으로 6일 */
  upcoming: DailyLightPoint[];
  /** 위치를 모르는 식물 등 값을 읽을 수 없는 이유 */
  unavailableReason: string | null;
}

/** 계산 대기 중 실제 처리 단계 */
export type LightStage = 'request' | 'dli' | 'plants';

export interface LightProgress {
  stage: LightStage;
  /** dli 단계: 계산 요청 전에 서버에 이미 저장돼 있던 날짜 수 / 전체 날짜 수 */
  done?: number;
  total?: number;
}
