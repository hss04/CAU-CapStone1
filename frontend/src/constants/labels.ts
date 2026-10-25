import type { CharacterState, CompassDirection, LightLevel, LightPreference, TimeOfDay } from '@/types';

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
    labelKo: '기분 좋아요',
    message: '오늘 햇빛이 정말 좋아요 ☀️',
    color: Colors.sunlightDeep,
    soft: Colors.sunlightSoft,
  },
  thirsty: {
    label: 'Thirsty',
    labelKo: '목말라요',
    message: '슬슬 목이 말라요 💧',
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
};

export const WATERED_MESSAGE = '물을 마셨더니 개운해요 🌿';

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
