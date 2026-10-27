import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getWeatherOverview, weatherLocationOf } from '@/services/weather';
import { useGarden } from '@/store/GardenProvider';
import type { WeatherOverview } from '@/types';

/**
 * 현재 방 위치의 날씨 (홈 날씨 카드, 주간 그래프의 날짜별 날씨 아이콘).
 * 주간 DLI(LightForecastProvider)와는 다른 데이터라 Provider를 나눴다.
 */

export interface WeatherState {
  /** loading: 처음 받는 중 · ready: 데이터 있음 (error가 있으면 이전 데이터) · error: 받지 못함 */
  status: 'loading' | 'ready' | 'error';
  data: WeatherOverview | null;
  error: string | null;
  refreshing: boolean;
}

interface WeatherContextValue extends WeatherState {
  refresh: () => void;
}

const WeatherContext = createContext<WeatherContextValue | null>(null);

/** 앱이 다시 열렸을 때 이 시간보다 오래된 날씨면 새로 받는다 */
const STALE_MS = 30 * 60 * 1000;

export function WeatherProvider({ children }: { children: ReactNode }) {
  const { state } = useGarden();
  const location = useMemo(() => weatherLocationOf(state.room), [state.room]);
  const { latitude, longitude } = location;
  const today = state.today;

  /** 어떤 위치·날짜로 받은 결과인지 key로 구분한다 (key가 다르면 지금은 새로 받는 중) */
  const fetchKey = `${latitude},${longitude}|${today}`;
  const [result, setResult] = useState<{ key: string; data: WeatherOverview | null; error: string | null } | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const requestId = useRef(0);
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // 상태는 응답을 받은 뒤에만 바꾼다
  const load = useCallback(
    async (force: boolean) => {
      const id = ++requestId.current;
      const loc = locationRef.current;
      const key = `${loc.latitude},${loc.longitude}|${today}`;
      try {
        const data = await getWeatherOverview(loc, today, { force });
        if (id !== requestId.current) return;
        setResult({ key, data, error: null });
      } catch (e) {
        if (id !== requestId.current) return;
        const message = e instanceof Error ? e.message : '날씨를 받지 못했어요';
        // 이전 데이터가 있으면 그대로 두고 오류만 표시한다
        setResult((prev) => ({ key, data: prev?.data ?? null, error: message }));
      } finally {
        if (id === requestId.current) setManualRefreshing(false);
      }
    },
    [today],
  );

  // 위치(위경도)나 날짜가 바뀌면 다시 받는다
  useEffect(() => {
    load(false);
  }, [load, latitude, longitude]);

  // 앱이 오래 백그라운드에 있다가 돌아오면 새로 받는다
  const fetchedAt = result?.data?.fetchedAt ?? 0;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && Date.now() - fetchedAt > STALE_MS) load(true);
    });
    return () => sub.remove();
  }, [fetchedAt, load]);

  const refresh = useCallback(() => {
    setManualRefreshing(true);
    load(true);
  }, [load]);

  const value = useMemo<WeatherContextValue>(() => {
    const raw = result?.data ?? null;
    // 같은 좌표에서 위치 이름만 바뀐 경우 화면에는 지금 위치 정보를 보여준다
    const prev = raw?.location;
    const sameSpot = !!prev && prev.latitude === location.latitude && prev.longitude === location.longitude;
    const data = raw && sameSpot && prev !== location ? { ...raw, location } : raw;
    const pending = !result || result.key !== fetchKey;
    const status: WeatherState['status'] = data ? 'ready' : pending ? 'loading' : 'error';
    return {
      status,
      data,
      error: pending ? null : (result?.error ?? null),
      refreshing: manualRefreshing || (pending && !!data),
      refresh,
    };
  }, [result, fetchKey, manualRefreshing, location, refresh]);

  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

export function useWeather(): WeatherContextValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather must be used inside <WeatherProvider>');
  return ctx;
}
