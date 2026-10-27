import type { CurrentWeather, DailyWeather, WeatherLocation, WeatherOverview } from '@/types';

import { conditionFromWmo } from './weatherCodes';

/**
 * Open-Meteo 예보 API에서 현재 날씨 + 지난 7일 ~ 앞으로 6일 일별 날씨를 받는다.
 *
 * 백엔드는 같은 Open-Meteo에서 DNI/DHI(일사량)만 받아 DLI 계산에 쓰고,
 * 기온·날씨 코드 API는 아직 없어서 앱이 공개 API를 직접 부른다(키 필요 없음).
 * 백엔드에 날씨 프록시(GET /rooms/{id}/weather)가 생기면 fetchOpenMeteoWeather만 바꾸면 된다.
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 12000;
const TIMEZONE = 'Asia/Seoul';

export const PAST_DAYS = 7;
/** 오늘 포함 */
export const FORECAST_DAYS = 7;

interface OpenMeteoResponse {
  current?: {
    time: string;
    temperature_2m: number | null;
    relative_humidity_2m: number | null;
    weather_code: number | null;
    is_day: number | null;
  };
  daily?: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    sunshine_duration: (number | null)[];
    daylight_duration: (number | null)[];
  };
}

export class WeatherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hours = (seconds: number | null | undefined) => (isNum(seconds) ? Math.round((seconds / 3600) * 10) / 10 : null);

function buildUrl(location: WeatherLocation): string {
  const params: Record<string, string> = {
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunshine_duration,daylight_duration',
    timezone: TIMEZONE,
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${ENDPOINT}?${query}`;
}

function parseCurrent(raw: OpenMeteoResponse['current']): CurrentWeather {
  // 누락값을 0이나 다른 값으로 채우지 않는다 (백엔드 weather.py와 같은 원칙)
  if (!raw || !isNum(raw.temperature_2m) || !isNum(raw.weather_code)) {
    throw new WeatherError('현재 날씨 값이 비어 있어요');
  }
  return {
    temperatureC: raw.temperature_2m,
    humidity: isNum(raw.relative_humidity_2m) ? raw.relative_humidity_2m : null,
    condition: conditionFromWmo(raw.weather_code),
    isDay: raw.is_day !== 0,
    time: raw.time,
  };
}

function parseDaily(raw: OpenMeteoResponse['daily']): DailyWeather[] {
  if (!raw || !Array.isArray(raw.time)) return [];
  const days: DailyWeather[] = [];
  raw.time.forEach((date, i) => {
    const code = raw.weather_code?.[i];
    // 날씨 코드가 없는 날은 아이콘을 만들 수 없으니 뺀다
    if (!isNum(code)) return;
    const max = raw.temperature_2m_max?.[i];
    const min = raw.temperature_2m_min?.[i];
    days.push({
      date,
      condition: conditionFromWmo(code),
      maxC: isNum(max) ? max : null,
      minC: isNum(min) ? min : null,
      sunshineHours: hours(raw.sunshine_duration?.[i]),
      daylightHours: hours(raw.daylight_duration?.[i]),
    });
  });
  return days;
}

export async function fetchOpenMeteoWeather(location: WeatherLocation, today: string): Promise<WeatherOverview> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildUrl(location), { signal: controller.signal });
  } catch {
    throw new WeatherError('날씨 서버에 연결할 수 없어요');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new WeatherError(`날씨를 받지 못했어요 (${response.status})`);

  const data = (await response.json().catch(() => null)) as OpenMeteoResponse | null;
  if (!data) throw new WeatherError('날씨 응답 형식이 올바르지 않아요');

  const daily = parseDaily(data.daily);
  return {
    source: 'open-meteo',
    location,
    fetchedAt: Date.now(),
    current: parseCurrent(data.current),
    today: daily.find((d) => d.date === today) ?? null,
    daily,
  };
}
