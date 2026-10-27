import { useEffect, useMemo, useState } from 'react';

import { DLI_PERIOD } from '@/constants/labels';
import { runPeriodDliJob } from '@/services/lightForecast';
import { buildMockDliMap, demoGrid } from '@/services/space/dliMap';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { DliPeriod } from '@/types';
import type { ApiDliMap } from '@/types/api';
import { addDays, parseISODate, toISODate } from '@/utils/date';

/**
 * 공간 화면 DLI 지도 — 선택한 기간(최근 N일) 평균.
 * 서버가 계산할 수 있으면 POST /rooms/{id}/dli-map(start~end) 결과, 아니면 기존 예시 지도.
 * 계산된 작업 ID(jobId)는 추천 요청(POST /rooms/{id}/recommendations의 dli_job_id)에 쓴다.
 */

export interface PeriodDliMap {
  /** loading: 서버 계산 중 (map에는 예시 또는 이전 결과) */
  status: 'loading' | 'ready';
  source: 'calculated' | 'mock';
  map: ApiDliMap;
  startDate: string;
  endDate: string;
  provisional: boolean;
  jobId: string | null;
  /** 예시를 보여주는 이유 (서버 계산 실패 등) */
  note: string | null;
}

interface Done {
  key: string;
  ok: boolean;
  map: ApiDliMap | null;
  jobId: string | null;
  provisional: boolean;
  error: string | null;
}

/** 같은 방·기간·날짜는 다시 계산하지 않는다 (앱 실행 중) */
const cache = new Map<string, Done>();

export function periodRange(period: DliPeriod, today: string): { startDate: string; endDate: string } {
  const end = parseISODate(today);
  return { startDate: toISODate(addDays(end, -(DLI_PERIOD[period].days - 1))), endDate: today };
}

export function usePeriodDliMap(period: DliPeriod): PeriodDliMap {
  const { state } = useGarden();
  const signedIn = useAuth().status === 'signedIn';
  const { room, today, sync } = state;

  const mockMap = useMemo(() => state.dliMap ?? buildMockDliMap(room, demoGrid(room), today), [state.dliMap, room, today]);
  const serverReady = signedIn && sync.status === 'synced' && !!room.server && !!room.location;
  const { startDate, endDate } = periodRange(period, today);
  const key = room.server ? `${room.server.roomId}:${room.server.geometryVersion}:${startDate}:${endDate}` : '';

  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!serverReady || cache.has(key)) return;
    let cancelled = false;
    runPeriodDliJob(room, startDate, endDate, () => cancelled).then((r) => {
      if (cancelled || r === null) return;
      const result: Done = r.ok
        ? { key, ok: true, map: r.result, jobId: r.jobId, provisional: r.provisional, error: null }
        : { key, ok: false, map: null, jobId: null, provisional: false, error: r.error };
      // 실패는 캐시하지 않는다 (스캔·위치가 준비되면 다시 시도)
      if (r.ok) cache.set(key, result);
      setDone(result);
    });
    return () => {
      cancelled = true;
    };
    // room 객체 대신 서버 방·기간 키가 바뀔 때만 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverReady, key]);

  const current = cache.get(key) ?? (done?.key === key ? done : null);
  const base = { startDate, endDate };

  if (serverReady && current?.ok && current.map) {
    return { ...base, status: 'ready', source: 'calculated', map: current.map, provisional: current.provisional, jobId: current.jobId, note: null };
  }
  if (serverReady && !current) {
    return { ...base, status: 'loading', source: 'mock', map: mockMap, provisional: false, jobId: null, note: '선택한 기간을 서버에서 계산하는 중이에요' };
  }
  return {
    ...base,
    status: 'ready',
    source: 'mock',
    map: mockMap,
    provisional: false,
    jobId: null,
    note: current?.error ?? null,
  };
}
