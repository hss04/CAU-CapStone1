import { getSpecies } from '@/data/plantSpecies';
import { UNPLACED_LABEL, type SpeciesLinks } from '@/services/api/plantSync';
import { dliAt } from '@/services/space/dliMap';
import type { DailyLightPoint, DailyWeather, DliRange, DliStatus, LightDay, Plant, PlantLightSeries } from '@/types';

import { classifyDli, periodStatus } from './dliStatus';

/** 식물 요구 DLI 범위 — 서버 종 카탈로그가 연결돼 있으면 그 값, 아니면 앱의 예시 범위 */
export function dliRangeFor(plant: Plant, serverSpecies: SpeciesLinks): DliRange {
  const server = serverSpecies[plant.speciesId];
  if (server) {
    return { min: server.minDli, max: server.maxDli, source: 'server', estimated: /ESTIMATED/i.test(server.sourceNote ?? '') };
  }
  const { min, max } = getSpecies(plant.speciesId).exampleDliRange;
  return { min, max, source: 'example' };
}

/**
 * 방의 날짜별 DLI 지도에서 식물 자리(격자 칸)의 값을 읽어 식물별 시계열을 만든다.
 * 값 자체는 지도에 있는 계산 결과를 그대로 쓰고, 상태는 요구 범위와 비교만 한다.
 */
export function buildPlantSeries(
  plant: Plant,
  days: LightDay[],
  range: DliRange,
  today: string,
  /** 서버 계산 결과에 붙일 실제 날씨 (예시 데이터는 각 날짜의 exampleWeather를 쓴다) */
  weatherByDate: Map<string, DailyWeather> | null,
): PlantLightSeries {
  const unplaced = plant.location.label === UNPLACED_LABEL;
  const { x, y } = plant.location.position;

  const points: DailyLightPoint[] = days.map((day) => {
    const cell = !unplaced && day.map ? dliAt(day.map, x, y) : null;
    const dli = cell ? cell.total : null;
    return {
      date: day.date,
      basis: day.basis,
      dli,
      status: dli === null ? null : classifyDli(dli, range),
      weather: day.exampleWeather ?? weatherByDate?.get(day.date) ?? null,
    };
  });

  return {
    plantId: plant.id,
    range,
    recent: points.filter((p) => p.date < today),
    upcoming: points.filter((p) => p.date >= today),
    unavailableReason: unplaced ? '방 안 위치가 정해지지 않아 계산할 수 없어요' : null,
  };
}

/** 최근 7일 평균 예상 DLI 기준 상태 (캐릭터·식물 상태 카드) */
export function recentStatusOf(series: PlantLightSeries): DliStatus | null {
  return periodStatus(series.recent, series.range);
}

export function todayPointOf(series: PlantLightSeries, today: string): DailyLightPoint | null {
  return series.upcoming.find((p) => p.date === today) ?? null;
}
