import type {
  CharacterState,
  CompassDirection,
  DliPeriod,
  DliStatus,
  LightLevel,
  LightPreference,
  TimeOfDay,
  WeatherCondition,
} from '@/types';

import { Colors } from './theme';

export const LIGHT_PREFERENCE_LABEL: Record<LightPreference, string> = {
  direct: '직사광',
  brightIndirect: '밝은 간접광',
  partialShade: '반그늘',
  shade: '그늘',
};

export const LIGHT_PREFERENCE_DESC: Record<LightPreference, string> = {
  direct: '4시간+ 햇빛',
  brightIndirect: '밝은 창가 근처',
  partialShade: '은은한 빛',
  shade: '빛이 적어도 OK',
};

export const LIGHT_LEVEL_LABEL: Record<LightLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const LIGHT_LEVEL_LABEL_KO: Record<LightLevel, string> = {
  high: '밝음',
  medium: '보통',
  low: '어두움',
};

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  average: '하루 평균',
  morning: '오전',
  noon: '정오',
  afternoon: '오후',
};

export const CHARACTER_COPY: Record<
  CharacterState,
  { label: string; labelKo: string; message: string; color: string; soft: string }
> = {
  healthy: {
    label: 'Healthy',
    labelKo: '싱그러워요',
    message: '오늘도 싱그러운 하루예요 🌿',
    color: Colors.primary,
    soft: Colors.lightGreen,
  },
  happy: {
    label: 'Happy',
    labelKo: '잘 지내요',
    message: '오늘도 잘 지내고 있어요!',
    color: Colors.sunlightDeep,
    soft: Colors.sunlightSoft,
  },
  thirsty: {
    label: 'Thirsty',
    labelKo: '목말라요',
    message: '물을 줄 시간이 되었어요!',
    color: Colors.waterDeep,
    soft: Colors.waterSoft,
  },
  veryThirsty: {
    label: 'Very thirsty',
    labelKo: '많이 목말라요',
    message: '물을 기다리고 있어요.',
    color: Colors.clayDeep,
    soft: Colors.claySoft,
  },
  lowLight: {
    label: 'Low light',
    labelKo: '햇빛이 아쉬워요',
    message: '요즘 햇빛이 조금 부족한 것 같아요.',
    color: Colors.dliLowDeep,
    soft: Colors.dliLowSoft,
  },
  tooBright: {
    label: 'Too bright',
    labelKo: '눈부셔요',
    message: '햇빛이 너무 강할 수 있어요!',
    color: Colors.sunlightDeep,
    soft: Colors.sunlightSoft,
  },
};

export const WATERED_MESSAGE = '물을 마셨더니 개운해요 🌿';

/**
 * 예상 광량 상태 (식물 요구 DLI 범위와 비교).
 * 실제 측정이 아니라 계산된 예상치 기준이라 문장은 '~것 같아요/예상돼요'로 쓴다.
 */
export const DLI_STATUS_COPY: Record<
  DliStatus,
  { label: string; sentence: string; tone: 'green' | 'dusk' | 'sun'; color: string }
> = {
  low: { label: '부족', sentence: '빛이 부족해요', tone: 'dusk', color: Colors.dliLow },
  ok: { label: '적정', sentence: '빛이 알맞아요', tone: 'green', color: Colors.primary },
  high: { label: '과다', sentence: '빛이 강해요', tone: 'sun', color: Colors.dliHigh },
};

/** DLI 지도 계산 기간 — 오늘까지 최근 N일 평균 */
export const DLI_PERIOD: Record<DliPeriod, { label: string; days: number }> = {
  week: { label: '최근 7일', days: 7 },
  month: { label: '최근 30일', days: 30 },
  season: { label: '최근 90일', days: 90 },
};

export const WEATHER_LABEL: Record<WeatherCondition, string> = {
  sunny: '맑음',
  partlyCloudy: '구름 조금',
  cloudy: '흐림',
  foggy: '안개',
  drizzle: '이슬비',
  rainy: '비',
  snowy: '눈',
  stormy: '뇌우',
};

export const FACING_KO: Record<CompassDirection, string> = {
  N: '북',
  NE: '북동',
  E: '동',
  SE: '남동',
  S: '남',
  SW: '남서',
  W: '서',
  NW: '북서',
};

/** 창문이 바라보는 방향의 대표 방위각 (스캔 결과 검증용) */
export const FACING_AZIMUTH: Record<CompassDirection, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

/**
 * 계산 대기 화면의 처리 단계 이름 — 실제로 진행 중인 단계만 화면에 보여준다.
 * sky(창밖 스캔 분석)·recommend(추천 API)는 프론트 연동 후 같은 컴포넌트로 표시한다.
 */
export const ANALYSIS_STEP_LABEL = {
  sync: '방·식물 정보 불러오는 중',
  request: '계산 요청 보내는 중',
  sky: '창밖 환경 분석 중',
  dli: '일조 환경 계산 중',
  plants: '식물별 광환경 정리 중',
  recommend: '식물별 추천 위치 분석 중',
} as const;
