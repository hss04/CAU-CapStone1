import { useEffect, useState } from 'react';

import { ApiError } from '@/services/api/client';
import { createRecommendationPlan, requestRecommendations } from '@/services/api/endpoints';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { ApiRecommendationPlan } from '@/types/api';

import { type PeriodDliMap, usePeriodDliMap } from './usePeriodDliMap';

/**
 * 방 전체 배치 추천 계획 (POST /rooms/{id}/recommendation-plans, 백엔드 v0.9.0).
 * 공간 화면에서 고른 기간의 DLI 지도 작업과 배치 불가 칸으로 요청하고,
 * 추천 화면(식물 하나)과 공간 화면(한 번에 적용)이 같은 계획을 같이 쓴다.
 * 로그인 전이거나 DLI 지도가 예시면 'off'.
 */

export interface RecommendationPlanState {
  /** off: 서버 추천을 쓸 수 없음 · waitingMap: DLI 지도 계산 중 · loading: 추천 요청 중 */
  status: 'off' | 'waitingMap' | 'loading' | 'ready' | 'error';
  plan: ApiRecommendationPlan | null;
  error: string | null;
  map: PeriodDliMap;
}

interface Done {
  key: string;
  plan: ApiRecommendationPlan | null;
  error: string | null;
}

/** 같은 지도·식물 위치·배치 불가 칸이면 다시 요청하지 않는다 (계획 유효 시간 30분 안에서) */
const cache = new Map<string, ApiRecommendationPlan>();
const inflight = new Map<string, Promise<ApiRecommendationPlan>>();

/** 만료 1분 전부터는 새 계획을 받는다 */
function fresh(plan: ApiRecommendationPlan | undefined): plan is ApiRecommendationPlan {
  if (!plan) return false;
  if (!plan.planId) return true;
  return new Date(plan.expiresAt).getTime() - Date.now() > 60_000;
}

/** 계획 API가 없는 서버(v0.8 이하)는 옛 추천 API 결과를 계획 모양으로 바꿔 쓴다 (적용은 식물별 PUT) */
async function requestPlan(roomId: number, dliJobId: string, blockedCells: [number, number][]): Promise<ApiRecommendationPlan> {
  try {
    return await createRecommendationPlan(roomId, { dliJobId, blockedCells });
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e;
    const result = await requestRecommendations(roomId, { dliJobId, blockedCells });
    return { planId: '', expiresAt: '', geometryVersion: 0, result, decisions: [] };
  }
}

/** 계획을 다시 받게 한다 (적용 후·409 후) */
export function clearRecommendationPlans() {
  cache.clear();
}

export function useRecommendationPlan(): RecommendationPlanState {
  const { state } = useGarden();
  const signedIn = useAuth().status === 'signedIn';
  const map = usePeriodDliMap(state.dliPeriod);
  const { room, plants } = state;

  const roomId = room.server?.roomId ?? null;
  const blocked = (state.blockedCells[room.id] ?? []).map((p): [number, number] => [p.y, p.x]);
  const jobId = map.source === 'calculated' ? map.jobId : null;
  const serverPlants = plants.filter((p) => p.serverId !== undefined);
  const usable = signedIn && roomId !== null && serverPlants.length > 0;
  // 식물 위치가 바뀌면(추천 적용·드래그) 다시 요청한다
  const where = serverPlants
    .map((p) => `${p.serverId}@${p.location.position.x},${p.location.position.y}`)
    .sort()
    .join(';');
  const key = usable && jobId ? `${roomId}:${jobId}:${where}:${blocked.map((c) => c.join(',')).join(';')}` : '';

  const [done, setDone] = useState<Done | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key || fresh(cache.get(key)) || roomId === null || jobId === null) return;
    let cancelled = false;
    let job = inflight.get(key);
    if (!job) {
      job = requestPlan(roomId, jobId, blocked).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    job
      .then((plan) => {
        cache.set(key, plan);
        if (!cancelled) setDone({ key, plan, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setDone({ key, plan: null, error: e instanceof Error ? e.message : '추천 요청 실패' });
      });
    // 만료되면 다시 받도록 한 번 깨운다
    const timer = setTimeout(() => setTick((t) => t + 1), 29 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // blocked는 key에 들어 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  if (!usable) return { status: 'off', plan: null, error: null, map };
  if (!jobId) return { status: map.status === 'loading' ? 'waitingMap' : 'off', plan: null, error: map.note, map };

  const cached = cache.get(key);
  const plan = fresh(cached) ? cached : done?.key === key ? done.plan : null;
  if (plan) return { status: 'ready', plan, error: null, map };
  if (done?.key === key && done.error) return { status: 'error', plan: null, error: done.error, map };
  return { status: 'loading', plan: null, error: null, map };
}
