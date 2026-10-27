import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  buildMockLightDays,
  buildPlantSeries,
  dliRangeFor,
  loadServerLightDays,
} from '@/services/lightForecast';
import { demoGrid } from '@/services/space/dliMap';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import { useWeather } from '@/store/WeatherProvider';
import type { DailyWeather, LightDataSource, LightDay, LightProgress, PlantLightSeries } from '@/types';

/**
 * 주간 광환경 (식물 자리별 날짜별 예상 DLI).
 *
 * - 로그인 + 서버 방 + 방 위치가 있으면 서버 DLI 계산 작업 결과를 쓴다 (source: calculated)
 * - 그 외이거나 서버가 계산할 수 없는 상태면 예시 데이터 (source: mock, note에 이유)
 * 방 단위 지도(days)를 받아 두고, 식물 위치가 바뀌면 지도에서 값만 다시 읽는다.
 */

interface ServerRun {
  status: 'loading' | 'ready' | 'failed';
  days: LightDay[];
  provisional: boolean;
  progress: LightProgress | null;
  /** failed일 때 서버 계산을 쓸 수 없는 이유 */
  reason: string | null;
  /** 어떤 요청의 결과인지 (방·날짜 + 새로고침 횟수) */
  key: string;
  /** 어떤 방·날짜의 결과인지 (방이 바뀌면 이전 결과를 쓰지 않는다) */
  room: string;
}

/** 새 요청의 시작 상태 — 같은 방의 이전 결과(실패 제외)는 남겨 둔다 */
function newRun(key: string, prev: ServerRun | null, room: string): ServerRun {
  const keep = !!prev && prev.room === room && prev.status !== 'failed';
  return {
    status: 'loading',
    days: keep ? prev.days : [],
    provisional: keep ? prev.provisional : false,
    progress: null,
    reason: null,
    key,
    room,
  };
}

export interface LightForecastValue {
  /** loading: 계산·조회 중 (days에 이전/부분 결과가 있을 수 있음) · ready: 끝남 */
  status: 'loading' | 'ready';
  /** 아직 출처를 모르면 null (서버 동기화 중) */
  source: LightDataSource | null;
  /** 연동 테스트 설정(창밖 스캔 없이 등)으로 계산한 임시 결과 */
  provisional: boolean;
  /** 예시 데이터를 보여주는 이유, 일부 날짜 계산 실패 안내 등 */
  note: string | null;
  progress: LightProgress | null;
  today: string;
  days: LightDay[];
  /** plantId → 시계열 */
  series: Record<string, PlantLightSeries>;
  refresh: () => void;
}

const LightForecastContext = createContext<LightForecastValue | null>(null);

export function LightForecastProvider({ children }: { children: ReactNode }) {
  const { state } = useGarden();
  const { status: authStatus } = useAuth();
  const weather = useWeather();
  const { room, plants, today, serverSpecies, sync } = state;

  const signedIn = authStatus === 'signedIn';
  const syncing = signedIn && sync.status === 'loading';
  const serverReady = signedIn && sync.status === 'synced' && !!room.server && !!room.location;
  const runKey = room.server ? `${room.server.roomId}:${room.server.geometryVersion}:${today}` : '';

  // 예시 데이터 — 서버 방이면 서버 격자 모양 그대로, 데모 방이면 데모 격자
  const grid = useMemo(() => state.dliMap?.grid ?? demoGrid(room), [state.dliMap, room]);
  const mockDays = useMemo(() => buildMockLightDays(room, grid, today), [room, grid, today]);

  const [run, setRun] = useState<ServerRun | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const runId = useRef(0);
  /** refresh()로 시작한 계산만 캐시를 무시한다 */
  const forceNext = useRef(false);

  // 계산 요청 하나를 구분하는 키 (같은 방이라도 새로고침하면 새 요청)
  const requestKey = `${runKey}#${refreshCount}`;

  useEffect(() => {
    if (!serverReady) return;
    const id = ++runId.current;
    const isCancelled = () => id !== runId.current;
    const force = forceNext.current;
    forceNext.current = false;
    // 상태는 비동기 콜백에서만 바꾼다 (요청 키가 바뀐 것만으로 화면은 '계산 중'이 된다)
    const update = (patch: Partial<ServerRun>) =>
      setRun((prev) => ({ ...(prev?.key === requestKey ? prev : newRun(requestKey, prev, runKey)), ...patch }));

    loadServerLightDays({
      room,
      today,
      force,
      isCancelled,
      onProgress: (progress) => {
        if (!isCancelled()) update({ progress });
      },
      onPartial: (days, provisional) => {
        if (!isCancelled()) update({ days, provisional });
      },
    }).then((result) => {
      if (isCancelled()) return;
      if (result.ok) update({ status: 'ready', days: result.days, provisional: result.provisional, progress: null });
      else update({ status: 'failed', days: [], provisional: false, progress: null, reason: result.reason });
    });

    return () => {
      // 언마운트·방 변경 시 진행 중인 폴링을 멈춘다
      runId.current += 1;
    };
    // room 객체 자체가 아니라 서버 방 식별자(runKey)·새로고침이 바뀔 때만 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverReady, requestKey]);

  const refresh = useCallback(() => {
    forceNext.current = true;
    setRefreshCount((n) => n + 1);
  }, []);

  // 서버 계산 결과에는 같은 위치의 Open-Meteo 일별 날씨를 붙인다 (방 위치 날씨일 때만)
  const weatherByDate = useMemo(() => {
    const data = weather.data;
    if (!data || data.source !== 'open-meteo' || data.location.kind !== 'room') return null;
    return new Map<string, DailyWeather>(data.daily.map((d) => [d.date, d]));
  }, [weather.data]);

  const value = useMemo<LightForecastValue>(() => {
    // 이번 요청 결과가 아직 없으면 같은 방의 이전 결과를 먼저 보여준다 (상태는 계산 중)
    const sameRoom = run && run.room === runKey ? run : null;
    const currentRun: ServerRun | null =
      sameRoom && sameRoom.key !== requestKey ? newRun(requestKey, sameRoom, runKey) : sameRoom;
    const useServer = serverReady && currentRun?.status !== 'failed';

    let base: Omit<LightForecastValue, 'series' | 'refresh'>;
    if (syncing) {
      base = { status: 'loading', source: null, provisional: false, note: null, progress: null, today, days: [] };
    } else if (useServer) {
      const failedDays = currentRun?.days.filter((d) => d.error).length ?? 0;
      base = {
        status: !currentRun || currentRun.status === 'loading' ? 'loading' : 'ready',
        source: 'calculated',
        provisional: currentRun?.provisional ?? false,
        note: failedDays > 0 ? `${failedDays}일은 계산하지 못했어요` : null,
        progress: currentRun?.progress ?? null,
        today,
        days: currentRun?.days ?? [],
      };
    } else {
      base = {
        status: 'ready',
        source: 'mock',
        provisional: false,
        note: currentRun?.reason ?? mockReason({ signedIn, hasServerRoom: !!room.server, hasLocation: !!room.location }),
        progress: null,
        today,
        days: mockDays,
      };
    }

    const series: Record<string, PlantLightSeries> = {};
    if (base.days.length > 0) {
      for (const plant of plants) {
        series[plant.id] = buildPlantSeries(
          plant,
          base.days,
          dliRangeFor(plant, serverSpecies),
          today,
          base.source === 'calculated' ? weatherByDate : null,
        );
      }
    }
    return { ...base, series, refresh };
  }, [run, runKey, requestKey, serverReady, syncing, today, mockDays, signedIn, room.server, room.location, plants, serverSpecies, weatherByDate, refresh]);

  return <LightForecastContext.Provider value={value}>{children}</LightForecastContext.Provider>;
}

function mockReason({ signedIn, hasServerRoom, hasLocation }: { signedIn: boolean; hasServerRoom: boolean; hasLocation: boolean }) {
  if (!signedIn) return '로그인 전이라 예시 방 기준 예시 데이터예요';
  if (!hasServerRoom) return '측정한 방이 없어 예시 방 기준 예시 데이터예요';
  if (!hasLocation) return '방 위치가 저장되지 않아 예시 데이터예요';
  return '예시 데이터예요';
}

export function useLightForecast(): LightForecastValue {
  const ctx = useContext(LightForecastContext);
  if (!ctx) throw new Error('useLightForecast must be used inside <LightForecastProvider>');
  return ctx;
}
