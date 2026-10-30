import type { CompassDirection, GridPosition, LightLevel, LightMap, Room, RoomWindow, TimeOfDay } from '@/types';
import { colorScale } from '@/utils/color';

import { isInsideRoom, openingSegment } from './geometry';

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

/** 방향을 모르는 창문은 모든 방향·시간대의 평균 세기로 추정한다 */
const UNKNOWN_STRENGTH = (() => {
  const all = Object.values(WINDOW_STRENGTH).flatMap((s) => [s.morning, s.noon, s.afternoon]);
  return all.reduce((a, b) => a + b, 0) / all.length;
})();

function strengthOf(w: RoomWindow, time: TimeOfDay): number {
  if (w.facingUnknown) return UNKNOWN_STRENGTH;
  const s = WINDOW_STRENGTH[w.facing];
  if (time === 'average') return (s.morning + s.noon + s.afternoon) / 3;
  return s[time];
}

/** 셀 중심에서 창문까지: 방 안쪽 깊이(depth)와 창문 폭 바깥으로 벗어난 거리(lateral), 셀 단위 */
function windowOffsets(room: Room, w: RoomWindow, cx: number, cy: number) {
  const seg = openingSegment(room, w);
  if (w.segment && w.inward) {
    // 기울어진 벽: 창문 선분 방향(u)과 방 안쪽 법선(inward)으로 분해
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1;
    const ux = (seg.x2 - seg.x1) / len;
    const uy = (seg.y2 - seg.y1) / len;
    const rx = cx - seg.x1;
    const ry = cy - seg.y1;
    const along = rx * ux + ry * uy;
    const depth = Math.max(0, rx * w.inward.x + ry * w.inward.y);
    const lateral = along < 0 ? -along : along > len ? along - len : 0;
    return { depth, lateral };
  }
  const horizontal = w.wall === 'top' || w.wall === 'bottom';
  const depth =
    w.wall === 'top' ? cy : w.wall === 'bottom' ? room.rows - cy : w.wall === 'left' ? cx : room.cols - cx;
  const along = horizontal ? cx : cy;
  const start = horizontal ? seg.x1 : seg.y1;
  const end = horizontal ? seg.x2 : seg.y2;
  const lateral = along < start ? start - along : along > end ? along - end : 0;
  return { depth, lateral };
}

/** 추정식 계수는 데모 방 칸 크기(0.45 m) 기준이라, 칸 크기가 다른 방은 거리를 이 단위로 바꿔서 쓴다 */
const REFERENCE_CELL_M = 0.45;

function estimateCell(room: Room, x: number, y: number, time: TimeOfDay): number {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const k = room.cellSizeM / REFERENCE_CELL_M;
  let sum = 0;

  for (const w of room.windows) {
    const offsets = windowOffsets(room, w, cx, cy);
    const depth = offsets.depth * k;
    const lateral = offsets.lateral * k;

    const sizeFactor = Math.min(1.15, 0.55 + w.length * k * 0.15);
    const spread = lateral / (1 + depth * 0.45);
    sum += strengthOf(w, time) * sizeFactor * Math.exp(-depth / 3.4) * Math.exp(-(spread * spread) / 1.6);
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

/**
 * DLI(mol/m²/day) 지도 색 — 실내 기준 구간.
 * 실내 바닥은 창가도 대략 0~5라 온실 기준(<2·2–7·7–15·15+)으로 칠하면 방이 거의 한 색이 된다.
 * 그래서 0~4를 촘촘하게 나눈다. 값은 그대로이고 색 구간만 표시용이며,
 * 식물별 적정 여부(OK/LOW/HIGH)는 종별 min/max DLI로 따로 판정한다.
 */
export function dliOverlayColor(dli: number): string {
  return colorScale(
    [
      [0, '#DCE7DA'],
      [1, '#E6EECF'],
      [2, '#F2F0C0'],
      [4, '#F8E197'],
      [8, '#F3C55E'],
      [12, '#ECB043'],
    ],
    dli,
  );
}

export const DLI_LEGEND: { label: string; color: string }[] = [
  { label: '<1', color: dliOverlayColor(0.5) },
  { label: '1–2', color: dliOverlayColor(1.5) },
  { label: '2–4', color: dliOverlayColor(3) },
  { label: '4–8', color: dliOverlayColor(6) },
  { label: '8+', color: dliOverlayColor(10) },
];

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
  for (const [y, row] of map.entries()) {
    for (const [x, v] of row.entries()) {
      // 다각형 방: 방 밖 칸은 통계에서 뺀다
      if (!isInsideRoom(room, { x, y })) continue;
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
