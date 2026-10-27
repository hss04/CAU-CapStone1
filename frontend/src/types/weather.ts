/**
 * 날씨 데이터 (홈 화면 날씨 카드, 주간 광환경 그래프의 날짜별 아이콘).
 *
 * 실시간 날씨는 "바깥 날씨"이고, DLI(식물 자리의 예상 광량)와는 다른 데이터다.
 * DLI는 types/lightForecast 쪽에서 따로 다룬다.
 */

/** open-meteo: Open-Meteo 예보 API 응답 · mock: 화면 확인용 예시 날씨 */
export type WeatherSource = 'open-meteo' | 'mock';

export type WeatherCondition =
  | 'sunny'
  | 'partlyCloudy'
  | 'cloudy'
  | 'foggy'
  | 'drizzle'
  | 'rainy'
  | 'snowy'
  | 'stormy';

/**
 * 날씨를 조회할 위치.
 * room: 방에 저장된 위경도 · demo: 데모 방의 예시 위치 · default: 방 위치가 없어 쓰는 기본 위치(서울)
 */
export interface WeatherLocation {
  latitude: number;
  longitude: number;
  label: string;
  kind: 'room' | 'demo' | 'default';
}

export interface CurrentWeather {
  temperatureC: number;
  humidity: number | null;
  condition: WeatherCondition;
  isDay: boolean;
  /** 예보 모델 기준 시각 (YYYY-MM-DDTHH:mm, 현지 시간) */
  time: string;
}

export interface DailyWeather {
  /** YYYY-MM-DD */
  date: string;
  condition: WeatherCondition;
  maxC: number | null;
  minC: number | null;
  /** 일조 시간 (h) */
  sunshineHours: number | null;
  /** 낮 길이 (h) */
  daylightHours: number | null;
}

export interface WeatherOverview {
  source: WeatherSource;
  location: WeatherLocation;
  /** 받아온 시각 (epoch ms) */
  fetchedAt: number;
  current: CurrentWeather;
  /** 오늘 예보 (daily 안의 오늘) */
  today: DailyWeather | null;
  /** 지난 7일 + 오늘 + 앞으로 6일 */
  daily: DailyWeather[];
}
