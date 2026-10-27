import { buildMockDliMap } from '@/services/space/dliMap';
import type { DailyWeather, LightDay, Room, WeatherCondition } from '@/types';
import type { ApiDliMap, ApiGrid, DliGrid } from '@/types/api';

import { forecastDates } from './dates';

/**
 * 예시 주간 광환경 (Mock).
 *
 * 서버 계산을 쓸 수 없을 때(로그인 전, 방 위치·창밖 스캔이 없을 때 등) 화면을 보여주기 위한 데이터다.
 * - 기준 지도: 기존 예시 DLI 지도(services/space/dliMap — 이미 '예시 값'으로 표시 중)
 * - 날짜별 변화: 아래 SCENARIO 표에 직접 적어 둔 예시 날씨·배율
 * 실제 날씨를 DLI로 바꾸는 계산식이 아니며, 화면에는 항상 '예시 데이터'로 표시된다.
 * 서버 계산이 가능해지면 serverSource가 이 데이터를 대신한다.
 */

interface ScenarioDay {
  condition: WeatherCondition;
  /** 기준 지도 대비 배율 (예시) */
  ratio: number;
}

/** 오늘 −7일 ~ 오늘 +6일, 14일치 예시 시나리오 */
const SCENARIO: ScenarioDay[] = [
  { condition: 'partlyCloudy', ratio: 0.92 },
  { condition: 'cloudy', ratio: 0.6 },
  { condition: 'rainy', ratio: 0.38 },
  { condition: 'rainy', ratio: 0.32 },
  { condition: 'cloudy', ratio: 0.55 },
  { condition: 'partlyCloudy', ratio: 0.82 },
  { condition: 'cloudy', ratio: 0.62 },
  { condition: 'partlyCloudy', ratio: 0.86 },
  { condition: 'sunny', ratio: 1.12 },
  { condition: 'sunny', ratio: 1.18 },
  { condition: 'cloudy', ratio: 0.58 },
  { condition: 'drizzle', ratio: 0.42 },
  { condition: 'partlyCloudy', ratio: 0.9 },
  { condition: 'sunny', ratio: 1.15 },
];

const round2 = (v: number) => Math.round(v * 100) / 100;

function scaleGrid(grid: DliGrid, ratio: number): DliGrid {
  return grid.map((row) => row.map((v) => (v === null ? null : round2(v * ratio))));
}

function scaleMap(base: ApiDliMap, date: string, ratio: number): ApiDliMap {
  const directDli = scaleGrid(base.directDli, ratio);
  const diffuseDli = scaleGrid(base.diffuseDli, ratio);
  const totalDli = directDli.map((row, y) =>
    row.map((d, x) => (d === null ? null : round2(d + (diffuseDli[y][x] ?? 0)))),
  );
  return { ...base, date, directDli, diffuseDli, totalDli };
}

function exampleWeather(date: string, condition: WeatherCondition): DailyWeather {
  // 예시 날씨에는 기온·일조 시간을 넣지 않는다 (실제 값처럼 보이지 않도록)
  return { date, condition, maxC: null, minC: null, sunshineHours: null, daylightHours: null };
}

export function buildMockLightDays(room: Room, grid: ApiGrid, today: string): LightDay[] {
  const base = buildMockDliMap(room, grid, today);
  return forecastDates(today).map(({ date, basis }, i) => {
    const scenario = SCENARIO[i % SCENARIO.length];
    return {
      date,
      basis,
      map: scaleMap(base, date, scenario.ratio),
      exampleWeather: exampleWeather(date, scenario.condition),
    };
  });
}
