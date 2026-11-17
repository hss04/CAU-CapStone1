import { type ServerPlacement, toServerPlacement } from '@/services/placement/serverRecommendation';
import { useGarden } from '@/store/GardenProvider';
import type { Plant } from '@/types';
import type { ApiRecommendationPlan } from '@/types/api';

import { useRecommendationPlan } from './useRecommendationPlan';
import type { PeriodDliMap } from './usePeriodDliMap';

/**
 * 식물 하나의 서버 배치 추천 — 방 전체 추천 계획(useRecommendationPlan)에서 이 식물 결과를 꺼낸다.
 * 로그인 전이거나 DLI 지도가 예시면 'off' → 화면은 앱 예시 추천을 쓴다.
 */

export interface ServerRecommendation {
  /** off: 서버 추천을 쓸 수 없음 · waitingMap: DLI 지도 계산 중 · loading: 추천 요청 중 */
  status: 'off' | 'waitingMap' | 'loading' | 'ready' | 'error';
  placement: ServerPlacement | null;
  /** 적용에 쓰는 방 전체 계획 */
  plan: ApiRecommendationPlan | null;
  error: string | null;
  map: PeriodDliMap;
}

export function useServerRecommendation(plant: Plant | undefined): ServerRecommendation {
  const { state } = useGarden();
  const room = useRecommendationPlan();
  const { status, plan, error, map } = room;

  if (!plant || plant.serverId === undefined || status === 'off') {
    return { status: 'off', placement: null, plan: null, error: null, map };
  }
  if (status !== 'ready' || !plan) return { status, placement: null, plan: null, error, map };

  const placement = toServerPlacement(state.room, plant.serverId, plan.result, plan.decisions);
  return placement
    ? { status: 'ready', placement, plan, error: null, map }
    : { status: 'error', placement: null, plan: null, error: '서버 추천 결과에 이 식물이 없어요', map };
}
