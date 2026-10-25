import type { CompassDirection, GridPosition, LightLevel, LightMap, Room, TimeOfDay } from '@/types';
import { colorScale } from '@/utils/color';

import { openingSegment } from './geometry';

/**
 * 창문 위치/방향 기반의 "추정" 광량 맵.
 * 백엔드에서 실제 분석된 lightMaps가 내려오면 그 값을 우선 사용한다.
 */

type Period = Exclude<TimeOfDay, 'average'>;

const WINDOW_STRENGTH: Record<CompassDirection, Record<Period, number>> = {
  N: { morning: 0.35, noon: 0.4, afternoon: 0.35 },
  NE: { morning: 0.7, noon: 0.4, afternoon: 0.25 },
  E: { morning: 1.0, noon: 0.5, afternoon: 0.25 },
  SE: { morning: 0.95, noon: 0.8, afternoon: 0.4 },
  S: { morning: 0.7, noon: 1.0, afternoon: 0.75 },
  SW: { morning: 0.4, noon: 0.8, afternoon: 0.95 },
  W: { morning: 0.25, noon: 0.5, afternoon: 1.0 },
  NW: { morning: 0.25, noon: 0.4, afternoon: 0.7 },
};

export const LIGHT_THRESHOLD = { high: 68, medium: 42 } as const;

function strengthOf(facing: CompassDirection, time: TimeOfDay): number {
  const s = WINDOW_STRENGTH[facing];
  if (time === 'average') return (s.morning + s.noon + s.afternoon) / 3;
  return s[time];
}

function estimateCell(room: Room, x: number, y: number, time: TimeOfDay): number {
  const cx = x + 0.5;
  const cy = y + 0.5;
  let sum = 0;

  for (const w of room.windows) {
    const seg = openingSegment(room, w);
    const horizontal = w.wall === 'top' || w.wall === 'bottom';
    const depth =
      w.wall === 'top' ? cy : w.wall === 'bottom' ? room.rows - cy : w.wall === 'left' ? cx : room.cols - cx;
    const along = horizontal ? cx : cy;
    const start = horizontal ? seg.x1 : seg.y1;
    const end = horizontal ? seg.x2 : seg.y2;
    const lateral = along < start ? start - along : along > end ? along - end : 0;

    const sizeFactor = Math.min(1.15, 0.55 + w.length * 0.15);
    const spread = lateral / (1 + depth * 0.45);
    sum += strengthOf(w.facing, time) * sizeFactor * Math.exp(-depth / 3.4) * Math.exp(-(spread * spread) / 1.6);
  }

  const value = 14 + 86 * (1 - Math.exp(-1.9 * sum));
  return Math.round(Math.min(100, value));
}

export function estimateLightMap(room: Room, time: TimeOfDay = 'average'): LightMap {
  return Array.from({ length: room.rows }, (_, y) =>
    Array.from({ length: room.cols }, (_, x) => estimateCell(room, x, y, time)),
  );
}

const cache = new WeakMap<Room, Partial<Record<TimeOfDay, LightMap>>>();

export function getLightMap(room: Room, time: TimeOfDay = 'average'): LightMap {
  const provided = room.lightMaps?.[time];
  if (provided) return provided;
  let entry = cache.get(room);
  if (!entry) {
    entry = {};
    cache.set(room, entry);
  }
  if (!entry[time]) entry[time] = estimateLightMap(room, time);
  return entry[time]!;
}

export function lightValueAt(room: Room, pos: GridPosition, time: TimeOfDay = 'average'): number {
  return getLightMap(room, time)[pos.y]?.[pos.x] ?? 0;
}

export function lightLevelOf(value: number): LightLevel {
  if (value >= LIGHT_THRESHOLD.high) return 'high';
  if (value >= LIGHT_THRESHOLD.medium) return 'medium';
  return 'low';
}

export function expectedSunHours(value: number): number {
  return Math.round(value * 0.072 * 10) / 10;
}

/** 평면도 위 빛 overlay 색 (연한 green → 연한 yellow) */
export function lightOverlayColor(value: number): string {
  // 단계(Low/Medium/High) 경계에서 색이 확실히 바뀌고, 단계 안에서는 부드럽게 변하도록
  return colorScale(
    [
      [18, '#E3EBE0'],
      [41.9, '#E6EDDB'],
      [42, '#EEF1D2'],
      [67.9, '#F4EFC4'],
      [68, '#F9E6A9'],
      [84, '#F7DA8C'],
      [100, '#F4CD70'],
    ],
    value,
  );
}

export const LIGHT_LEGEND: { level: LightLevel; label: string; labelKo: string; color: string }[] = [
  { level: 'high', label: 'High', labelKo: '밝음', color: lightOverlayColor(80) },
  { level: 'medium', label: 'Medium', labelKo: '보통', color: lightOverlayColor(55) },
  { level: 'low', label: 'Low', labelKo: '어두움', color: lightOverlayColor(30) },
];

export interface LightSummary {
  high: number;
  medium: number;
  low: number;
  averageSunHours: number;
  brightestLabel: string;
}

export function summarizeLight(room: Room, time: TimeOfDay = 'average'): LightSummary {
  const map = getLightMap(room, time);
  let high = 0;
  let medium = 0;
  let total = 0;
  let sum = 0;
  for (const row of map) {
    for (const v of row) {
      total += 1;
      sum += v;
      const level = lightLevelOf(v);
      if (level === 'high') high += 1;
      else if (level === 'medium') medium += 1;
    }
  }
  const pct = (n: number) => Math.round((n / Math.max(total, 1)) * 100);
  const h = pct(high);
  const m = pct(medium);
  return {
    high: h,
    medium: m,
    low: 100 - h - m,
    averageSunHours: expectedSunHours(sum / Math.max(total, 1)),
    brightestLabel: '창가 쪽',
  };
}
