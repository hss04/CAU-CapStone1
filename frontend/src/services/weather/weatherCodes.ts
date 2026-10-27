import type { WeatherCondition } from '@/types';

/**
 * WMO 날씨 코드(Open-Meteo weather_code) → 앱 날씨 상태.
 * https://open-meteo.com/en/docs 의 "WMO Weather interpretation codes"
 */
export function conditionFromWmo(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'sunny';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rainy';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowy';
  if (code >= 95) return 'stormy';
  return 'cloudy';
}

/** 해가 잘 드는 날씨 (맑음, 구름 조금) */
export function isClearCondition(condition: WeatherCondition): boolean {
  return condition === 'sunny' || condition === 'partlyCloudy';
}
