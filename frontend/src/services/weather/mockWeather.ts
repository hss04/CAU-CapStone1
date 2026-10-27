import type { WeatherLocation, WeatherOverview } from '@/types';
import { toISODate } from '@/utils/date';

/**
 * 예시 날씨 (EXPO_PUBLIC_WEATHER_SOURCE=mock 일 때만).
 * 인터넷 없이 시연할 때 쓰며, 화면에는 source='mock'으로 '예시 날씨' 표시가 붙는다.
 * 일별 날씨는 비워 둔다 — 주간 광환경 그래프의 날씨는 광환경 데이터 쪽에서 따로 정한다.
 */
export function mockWeatherOverview(location: WeatherLocation, now: Date): WeatherOverview {
  const today = toISODate(now);
  const time = `${today}T${String(now.getHours()).padStart(2, '0')}:00`;
  return {
    source: 'mock',
    location,
    fetchedAt: now.getTime(),
    current: { temperatureC: 23, humidity: 45, condition: 'sunny', isDay: true, time },
    today: { date: today, condition: 'sunny', maxC: 25, minC: 15, sunshineHours: 8.5, daylightHours: 11 },
    daily: [],
  };
}
