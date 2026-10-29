import type { DliStatus, GridPosition, PlacementRecommendation, Room } from '@/types';

import { classifyDli } from '../lightForecast/dliStatus';
import { describePosition, nearestWindowDistance } from '../space/geometry';
import { expectedSunHours, getLightMap, lightLevelOf } from '../space/lightAnalysis';
import { lightLabelFor } from './placementEngine';

/**
 * 서버 배치 추천 (POST /rooms/{id}/recommendations) 응답 → 화면용 값.
 * 계산은 서버(알고리즘 recommend_for_room)가 하고, 앱은 칸 위치를 평면도 위치로 바꾸기만 한다.
 * 격자는 서버 grid_v2와 같다: col = GridPosition.x, row = GridPosition.y.
 */

export interface ApiRecommendationCell {
  row: number;
  col: number;
  totalDli: number;
}

export interface ApiPlantRecommendation {
  plantId: number;
  speciesId: number;
  requiredDli: { min: number; max: number };
  /** 식물 위치가 없으면 null */
  current: (ApiRecommendationCell & { status: 'LOW' | 'OK' | 'HIGH' }) | null;
  /** 지금 자리가 적정이면 null (이동 제안 안 함) */
  recommended: (ApiRecommendationCell & { score: number }) | null;
}

export interface ApiRecommendationResult {
  roomId: number;
  period: { startDate: string; endDate: string; dayCount: number } | null;
  plants: ApiPlantRecommendation[];
  warnings: string[];
}

export interface ServerSpot {
  position: GridPosition;
  label: string;
  dli: number;
  status: DliStatus;
}

export interface ServerPlacement {
  required: { min: number; max: number };
  current: ServerSpot | null;
  recommended: (ServerSpot & { score: number }) | null;
  /** 추천 칸도 요구 범위 밖 — 방 안에 범위에 드는 빈 칸이 없음 */
  noFitCell: boolean;
  period: ApiRecommendationResult['period'];
  warnings: string[];
}

const STATUS: Record<'LOW' | 'OK' | 'HIGH', DliStatus> = { LOW: 'low', OK: 'ok', HIGH: 'high' };

function toPosition(cell: ApiRecommendationCell): GridPosition {
  return { x: cell.col, y: cell.row };
}

/** 응답에서 이 식물(serverPlantId)의 결과를 꺼낸다. 없으면 null */
export function toServerPlacement(room: Room, serverPlantId: number, result: ApiRecommendationResult): ServerPlacement | null {
  const item = result.plants.find((p) => p.plantId === serverPlantId);
  if (!item) return null;
  const required = item.requiredDli;
  const current = item.current
    ? {
        position: toPosition(item.current),
        label: describePosition(room, toPosition(item.current)),
        dli: item.current.totalDli,
        status: STATUS[item.current.status],
      }
    : null;
  const recommended = item.recommended
    ? {
        position: toPosition(item.recommended),
        label: describePosition(room, toPosition(item.recommended)),
        dli: item.recommended.totalDli,
        status: classifyDli(item.recommended.totalDli, required),
        score: item.recommended.score,
      }
    : null;
  return {
    required,
    current,
    recommended,
    noFitCell: recommended !== null && recommended.status !== 'ok',
    period: result.period,
    warnings: result.warnings,
  };
}

/**
 * '이 위치로 설정'에 쓸 추천 값.
 * 일조 시간·창문 거리 같은 보조 값은 앱의 기존 계산을 그대로 쓴다 (서버 응답에 없음).
 */
export function toPlacementRecommendation(room: Room, placement: ServerPlacement): PlacementRecommendation | null {
  const rec = placement.recommended;
  if (!rec) return null;
  const lightValue = getLightMap(room)[rec.position.y]?.[rec.position.x] ?? 0;
  const lightLevel = lightLevelOf(lightValue);
  return {
    position: rec.position,
    label: rec.label,
    score: Math.round(rec.score * 100),
    lightLevel,
    lightValue,
    expectedSunHours: expectedSunHours(lightValue),
    lightLabel: lightLabelFor(lightLevel),
    reasons: [],
    distanceFromWindowM: Math.round(Math.max(0.2, nearestWindowDistance(room, rec.position) * room.cellSizeM) * 10) / 10,
  };
}
