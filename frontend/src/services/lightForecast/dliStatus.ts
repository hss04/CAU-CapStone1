import type { DailyLightPoint, DliRange, DliStatus } from '@/types';

/**
 * 예상 DLI ↔ 식물 요구 범위 비교.
 * 규격의 Recommendation status(min_dli 미만 LOW, max_dli 초과 HIGH, 그 외 OK)와 같은 기준이며
 * 새로운 임계값을 만들지 않는다.
 */
export function classifyDli(dli: number, range: Pick<DliRange, 'min' | 'max'>): DliStatus {
  if (dli < range.min) return 'low';
  if (dli > range.max) return 'high';
  return 'ok';
}

/** 값이 있는 날짜만 평균 (없으면 null) */
export function meanDli(points: DailyLightPoint[]): number | null {
  const values = points.map((p) => p.dli).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 기간 평균을 요구 범위와 비교한 상태 */
export function periodStatus(points: DailyLightPoint[], range: DliRange): DliStatus | null {
  const mean = meanDli(points);
  return mean === null ? null : classifyDli(mean, range);
}

export function formatDli(value: number): string {
  return value.toFixed(1);
}
