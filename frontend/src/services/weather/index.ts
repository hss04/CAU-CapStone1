import type { Room, WeatherLocation, WeatherOverview } from '@/types';

import { mockWeatherOverview } from './mockWeather';
import { fetchOpenMeteoWeather } from './openMeteo';

export { weatherHeadline } from './headline';
export { WeatherError } from './openMeteo';
export { conditionFromWmo, isClearCondition } from './weatherCodes';

/**
 * 날씨 서비스 진입점. 화면·Provider는 이 파일의 함수만 쓴다.
 *
 * 데이터 출처
 *  - 기본: Open-Meteo 예보 API (실제 예보값)
 *  - EXPO_PUBLIC_WEATHER_SOURCE=mock: 예시 날씨 (오프라인 시연용, 화면에 '예시' 표시)
 */

/** 방 위치가 없을 때 쓰는 기본 위치 (서울시청) */
export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  latitude: 37.5665,
  longitude: 126.978,
  label: '서울',
  kind: 'default',
};

/** 방에 저장된 위경도 → 날씨 조회 위치 */
export function weatherLocationOf(room: Room): WeatherLocation {
  const loc = room.location;
  if (!loc) return DEFAULT_WEATHER_LOCATION;
  return {
    latitude: loc.latitude,
    longitude: loc.longitude,
    label: loc.label ?? '내 방 위치',
    kind: loc.demo ? 'demo' : 'room',
  };
}

const useMock = process.env.EXPO_PUBLIC_WEATHER_SOURCE === 'mock';

/** 같은 위치를 짧은 시간에 여러 번 부르지 않도록 메모리 캐시 (Open-Meteo 예보 갱신 주기보다 짧게) */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, WeatherOverview>();

const cacheKey = (loc: WeatherLocation, today: string) => `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}|${today}`;

export async function getWeatherOverview(
  location: WeatherLocation,
  today: string,
  options: { force?: boolean } = {},
): Promise<WeatherOverview> {
  if (useMock) return mockWeatherOverview(location, new Date());

  const key = cacheKey(location, today);
  const hit = cache.get(key);
  if (!options.force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    // 라벨·종류는 지금 위치 정보를 따른다 (같은 좌표라도 방 이름이 바뀔 수 있음)
    return { ...hit, location };
  }
  const fresh = await fetchOpenMeteoWeather(location, today);
  cache.set(key, fresh);
  return fresh;
}
