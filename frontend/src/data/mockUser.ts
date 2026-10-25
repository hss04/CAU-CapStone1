import type { UserProfile, WeatherSnapshot } from '@/types';
import { addDays, toISODate } from '@/utils/date';

export function createMockUser(today: Date): UserProfile {
  return {
    name: '지우',
    nameEn: 'Jiwoo',
    email: 'jiwoo@example.com',
    joinedAt: toISODate(addDays(today, -41)),
  };
}

/** 날씨 API 연동 전까지 사용하는 Mock 날씨 */
export const MOCK_WEATHER: WeatherSnapshot = {
  temperature: 24,
  condition: 'sunny',
  conditionLabel: '맑음',
  humidity: 45,
  sunlight: 'high',
  sunlightLabel: 'High',
  bestLightWindow: '오전 10시 – 오후 2시',
  location: '서울 마포구',
};
