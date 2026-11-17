import type { DliStatus, GridPosition, PlacementRecommendation, Room } from '@/types';
import type { ApiDecision, ApiReasonCode, ApiRecommendationCell, ApiRecommendationResult } from '@/types/api';

import { classifyDli } from '../lightForecast/dliStatus';
import { describePosition, nearestWindowDistance } from '../space/geometry';
import { expectedSunHours, getLightMap, lightLevelOf } from '../space/lightAnalysis';
import { lightLabelFor } from './placementEngine';

/**
 * 서버 배치 추천 (POST /rooms/{id}/recommendations) 응답 → 화면용 값.
 * 계산은 서버(알고리즘 recommend_for_room)가 하고, 앱은 칸 위치를 평면도 위치로 바꾸기만 한다.
 * 격자는 서버 grid_v2와 같다: col = GridPosition.x, row = GridPosition.y.
 */

export type { ApiPlantRecommendation, ApiRecommendationCell, ApiRecommendationResult } from '@/types/api';

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
  /** 서버 판정 (추천 계획 API). 옛 추천 API 응답이면 null */
  decision: ApiDecision | null;
}

/** 서버 판정 코드 → 화면 문구 */
export const REASON_COPY: Record<ApiReasonCode, { label: string; description: string }> = {
  CURRENT_OK: { label: '지금 자리 유지', description: '지금 자리가 요구 범위 안이라 옮기지 않아요.' },
  RELOCATE: { label: '옮기기 추천', description: '요구 범위 안에 드는 빈 칸을 찾았어요.' },
  NO_FREE_CELL: { label: '빈 칸 없음', description: '다른 식물과 배치 불가 칸을 빼면 옮길 칸이 없어요.' },
  NO_SUITABLE_CELL: { label: '맞는 칸 없음', description: '빈 칸 중에 요구 범위에 드는 칸이 없어요.' },
};

/**
 * 화면에 그대로 보여줄 서버 경고만 남긴다.
 * 식물별 경고(PLANT_<id>_NO_FREE_CELL 코드, 알고리즘의 영문 'plant <id>: no cell … closest cell')는
 * 판정·추천 칸 문구로 이미 보여주고, 다른 식물 것까지 섞여 오므로 뺀다.
 */
export function readableWarnings(warnings: string[]): string[] {
  return warnings.filter((w) => !/^PLANT_\d+_NO_(FREE|SUITABLE)_CELL$/.test(w) && !/^plant \d+:/i.test(w));
}

const STATUS: Record<'LOW' | 'OK' | 'HIGH', DliStatus> = { LOW: 'low', OK: 'ok', HIGH: 'high' };

function toPosition(cell: ApiRecommendationCell): GridPosition {
  return { x: cell.col, y: cell.row };
}

/** 응답에서 이 식물(serverPlantId)의 결과를 꺼낸다. 없으면 null */
export function toServerPlacement(
  room: Room,
  serverPlantId: number,
  result: ApiRecommendationResult,
  decisions: ApiDecision[] = [],
): ServerPlacement | null {
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
    warnings: readableWarnings(result.warnings),
    decision: decisions.find((d) => d.plantId === serverPlantId) ?? null,
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
