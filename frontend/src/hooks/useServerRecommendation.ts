import { useEffect, useState } from 'react';

import { requestRecommendations } from '@/services/api/endpoints';
import {
  type ApiRecommendationResult,
  type ServerPlacement,
  toServerPlacement,
} from '@/services/placement/serverRecommendation';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { Plant } from '@/types';

import { type PeriodDliMap, usePeriodDliMap } from './usePeriodDliMap';

/**
 * 서버 배치 추천.
 * 공간 화면에서 고른 기간의 DLI 지도 작업(jobId)과 배치 불가 칸으로 POST /rooms/{id}/recommendations를 요청한다.
 * 로그인 전이거나 DLI 지도가 예시면 'off' → 화면은 앱 예시 추천을 쓴다.
 */

export interface ServerRecommendation {
  /** off: 서버 추천을 쓸 수 없음 · waitingMap: DLI 지도 계산 중 · loading: 추천 요청 중 */
  status: 'off' | 'waitingMap' | 'loading' | 'ready' | 'error';
  placement: ServerPlacement | null;
  error: string | null;
  map: PeriodDliMap;
}

interface Done {
  key: string;
  result: ApiRecommendationResult | null;
  error: string | null;
}

/** 같은 DLI 작업·배치 불가 칸이면 다시 요청하지 않는다 (앱 실행 중) */
const cache = new Map<string, ApiRecommendationResult>();

export function useServerRecommendation(plant: Plant | undefined): ServerRecommendation {
  const { state } = useGarden();
  const signedIn = useAuth().status === 'signedIn';
  const map = usePeriodDliMap(state.dliPeriod);
  const { room } = state;

  const roomId = room.server?.roomId ?? null;
  const blocked = (state.blockedCells[room.id] ?? []).map((p): [number, number] => [p.y, p.x]);
  const usable = signedIn && roomId !== null && plant?.serverId !== undefined;
  const jobId = map.source === 'calculated' ? map.jobId : null;
  // 식물 위치가 바뀌면(추천 적용 등) 다시 요청한다
  const where = plant ? `${plant.location.position.x},${plant.location.position.y}` : '';
  const key = usable && jobId ? `${roomId}:${jobId}:${where}:${blocked.map((c) => c.join(',')).join(';')}` : '';

  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!key || cache.has(key) || roomId === null || jobId === null) return;
    let cancelled = false;
    requestRecommendations(roomId, { dliJobId: jobId, blockedCells: blocked })
      .then((data) => {
        const result = data as ApiRecommendationResult;
        cache.set(key, result);
        if (!cancelled) setDone({ key, result, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setDone({ key, result: null, error: e instanceof Error ? e.message : '추천 요청 실패' });
      });
    return () => {
      cancelled = true;
    };
    // blocked는 key에 들어 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!usable || !plant || plant.serverId === undefined) return { status: 'off', placement: null, error: null, map };
  if (!jobId) return { status: map.status === 'loading' ? 'waitingMap' : 'off', placement: null, error: map.note, map };

  const result = cache.get(key) ?? (done?.key === key ? done.result : null);
  if (result) {
    const placement = toServerPlacement(room, plant.serverId, result);
    return placement
      ? { status: 'ready', placement, error: null, map }
      : { status: 'error', placement: null, error: '서버 추천 결과에 이 식물이 없어요', map };
  }
  if (done?.key === key && done.error) return { status: 'error', placement: null, error: done.error, map };
  return { status: 'loading', placement: null, error: null, map };
}
