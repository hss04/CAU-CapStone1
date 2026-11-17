import type { ApiRecommendationPlan, ApiSpeciesEvidence } from '@/types/api';

/** 종별 요구 DLI 근거 구분 → 화면 문구 */
export const EVIDENCE_BASIS_LABEL: Record<ApiSpeciesEvidence['basis'], string> = {
  REFERENCE_SPECIES: '같은 종 참고값',
  REFERENCE_GENUS: '같은 속 참고값',
  REFERENCE_GROUP: '비슷한 식물군 참고값',
  ESTIMATED: '분류군 기준 추정값',
  OPERATOR_DEFINED: '직접 입력한 값',
  UNKNOWN: '근거 미상',
};

/** '같은 속 참고값 · 잠정 · 2026-11-02 확인' */
export function evidenceText(e: ApiSpeciesEvidence): string {
  return [EVIDENCE_BASIS_LABEL[e.basis], e.provisional ? '잠정' : null, e.checkedAt ? `${e.checkedAt.slice(0, 10)} 확인` : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * 식물 하나를 추천 칸으로 옮길 때 같이 옮겨야 하는 식물 (서버 식물 ID).
 * 추천 칸에 다른 식물이 있고 그 식물도 옮기기 추천이면 함께 적용해야 서버가 받아 준다 (자리 교환).
 */
export function moveGroup(plan: ApiRecommendationPlan, serverPlantId: number): number[] {
  const movable = new Set(plan.decisions.filter((d) => d.canApply).map((d) => d.plantId));
  const group = [serverPlantId];
  for (let i = 0; i < group.length; i++) {
    const target = plan.result.plants.find((p) => p.plantId === group[i])?.recommended;
    if (!target) continue;
    const occupant = plan.result.plants.find(
      (p) => p.plantId !== group[i] && p.current && p.current.row === target.row && p.current.col === target.col,
    );
    if (occupant && movable.has(occupant.plantId) && !group.includes(occupant.plantId)) group.push(occupant.plantId);
  }
  return group;
}
