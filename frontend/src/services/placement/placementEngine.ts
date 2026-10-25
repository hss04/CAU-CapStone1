import type {
  GridPosition,
  LightPreference,
  PlacementAnalysis,
  PlacementRecommendation,
  PlacementSpot,
  Room,
} from '@/types';

import {
  describePosition,
  isPlaceable,
  nearestWindowDistance,
  samePosition,
  touchesWallOrFurniture,
} from '../space/geometry';
import { expectedSunHours, getLightMap, lightLevelOf } from '../space/lightAnalysis';

/**
 * 로컬 배치 추천 엔진 (Mock).
 * 백엔드 추천 API가 연결되면 analyzePlacement 대신 API 응답을 PlacementAnalysis로 변환해 사용하면 된다.
 */

const PREFERENCE: Record<LightPreference, { ideal: number; tolerance: number; harshAbove: number }> = {
  direct: { ideal: 90, tolerance: 26, harshAbove: 101 },
  brightIndirect: { ideal: 72, tolerance: 22, harshAbove: 86 },
  partialShade: { ideal: 52, tolerance: 20, harshAbove: 78 },
  shade: { ideal: 34, tolerance: 18, harshAbove: 64 },
};

const PREFERENCE_REASON: Record<LightPreference, string> = {
  direct: '좋아하는 직사광을 충분히 받을 수 있어요.',
  brightIndirect: '밝은 간접광을 받을 수 있어요.',
  partialShade: '은은하게 빛이 드는 반그늘이에요.',
  shade: '강한 빛을 피할 수 있는 편안한 자리예요.',
};

const GOOD_LIGHT_LABEL: Record<LightPreference, string> = {
  direct: 'Full Sun',
  brightIndirect: 'Good Light',
  partialShade: 'Soft Light',
  shade: 'Gentle Shade',
};

const LEVEL_EN = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function lightLabelFor(level: keyof typeof LEVEL_EN): string {
  return `${LEVEL_EN[level]} Light`;
}

function lightFit(pref: LightPreference, value: number): number {
  const p = PREFERENCE[pref];
  const ratio = Math.abs(value - p.ideal) / p.tolerance;
  let score = 97 - 36 * Math.pow(ratio, 1.15);
  if (value > p.harshAbove) score -= (value - p.harshAbove) * 0.9;
  return score;
}

export function scorePosition(room: Room, pos: GridPosition, pref: LightPreference): number {
  const value = getLightMap(room)[pos.y][pos.x];
  let score = lightFit(pref, value);
  // 방 한가운데(동선)는 약간 감점
  if (!touchesWallOrFurniture(room, pos)) score -= 6;
  return Math.round(Math.min(93, Math.max(12, score)));
}

function toSpot(room: Room, pos: GridPosition, pref: LightPreference, label?: string): PlacementSpot {
  const value = getLightMap(room)[pos.y][pos.x];
  return {
    position: pos,
    label: label ?? describePosition(room, pos),
    score: scorePosition(room, pos, pref),
    lightLevel: lightLevelOf(value),
    lightValue: value,
    expectedSunHours: expectedSunHours(value),
  };
}

function buildReasons(
  room: Room,
  pref: LightPreference,
  current: PlacementSpot,
  best: PlacementSpot,
): string[] {
  const reasons = [PREFERENCE_REASON[pref]];
  if (best.expectedSunHours > current.expectedSunHours + 0.4) {
    reasons.push('현재 위치보다 예상 일조량이 높아요.');
  } else if (best.expectedSunHours < current.expectedSunHours - 0.4) {
    reasons.push('현재 위치보다 빛이 부드러워요.');
  }
  if (pref !== 'direct' && best.lightValue <= PREFERENCE[pref].harshAbove) {
    reasons.push('강한 직사광선을 피할 수 있어요.');
  }
  const meters = Math.max(0.2, nearestWindowDistance(room, best.position) * room.cellSizeM);
  reasons.push(`창문에서 약 ${meters.toFixed(1)}m 떨어져 있어요.`);
  return reasons;
}

export interface AnalyzeInput {
  position: GridPosition;
  preferredLight: LightPreference;
  label?: string;
}

/** 현재 위치 평가 + 방 전체에서 더 좋은 위치 탐색 */
export function analyzePlacement(
  room: Room,
  input: AnalyzeInput,
  occupied: GridPosition[] = [],
): PlacementAnalysis {
  const current = toSpot(room, input.position, input.preferredLight, input.label);

  let best: PlacementSpot | null = null;
  let bestRank = -Infinity;
  for (let y = 0; y < room.rows; y++) {
    for (let x = 0; x < room.cols; x++) {
      const pos = { x, y };
      if (!isPlaceable(room, pos)) continue;
      if (occupied.some((o) => samePosition(o, pos))) continue;
      const score = scorePosition(room, pos, input.preferredLight);
      // 같은 점수면 현재 위치에서 가까운 곳을 우선
      const rank = score - Math.hypot(x - input.position.x, y - input.position.y) * 0.05;
      if (rank > bestRank) {
        bestRank = rank;
        best = toSpot(room, pos, input.preferredLight);
      }
    }
  }

  if (!best || best.score < current.score + 8 || samePosition(best.position, current.position)) {
    return { current, recommended: null, message: '지금 위치가 잘 맞아요.' };
  }

  const recommended: PlacementRecommendation = {
    ...best,
    lightLabel: best.score >= 80 ? GOOD_LIGHT_LABEL[input.preferredLight] : lightLabelFor(best.lightLevel),
    reasons: buildReasons(room, input.preferredLight, current, best),
    distanceFromWindowM:
      Math.round(Math.max(0.2, nearestWindowDistance(room, best.position) * room.cellSizeM) * 10) / 10,
  };

  const message =
    best.lightValue > current.lightValue + 8
      ? '조금 더 밝은 위치를 추천해요.'
      : best.lightValue < current.lightValue - 8
        ? '조금 더 은은한 빛이 드는 곳을 추천해요.'
        : '더 잘 맞는 위치가 있어요.';

  return { current, recommended, message };
}
