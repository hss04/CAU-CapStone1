export * from './lightForecast';
export * from './plant';
export * from './room';
export * from './weather';
export * from './windowScan';

/**
 * 식물 캐릭터 상태.
 * lowLight / tooBright는 예상 광량(DLI)과 요구 범위를 비교한 안내이며 실제 생육 상태 측정이 아니다.
 */
export type CharacterState = 'healthy' | 'happy' | 'thirsty' | 'veryThirsty' | 'lowLight' | 'tooBright';

export interface UserProfile {
  name: string;
  nameEn: string;
  email: string;
  joinedAt: string;
}

export interface NotificationSettings {
  watering: boolean;
  environment: boolean;
}
