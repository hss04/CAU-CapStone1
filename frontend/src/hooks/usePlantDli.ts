import { DLI_STATUS_COPY } from '@/constants/labels';
import { classifyDli, dliRangeFor, formatDli } from '@/services/lightForecast';
import { dliAt } from '@/services/space/dliMap';
import { useGarden } from '@/store/GardenProvider';
import type { DliRange, DliStatus, GridPosition, Plant, PlantSpeciesId } from '@/types';
import { withRo } from '@/utils/korean';

import { type PeriodDliMap, usePeriodDliMap } from './usePeriodDliMap';

/**
 * 식물 자리의 예상 DLI — 공간 화면에서 고른 기간의 DLI 지도에서 식물 칸 값을 읽는다.
 * 적합도(%) 대신 이 값과 종별 요구 DLI 범위로 부족·적정·과다를 보여준다.
 * - calculated: 서버 계산 지도 · mock: 예시 방의 예시 지도 · pending: 서버 방인데 아직 계산 전(값 없음)
 */

export interface SpotDli {
  position: GridPosition;
  label: string;
  dli: number | null;
  status: DliStatus | null;
}

export interface PlantDli {
  range: DliRange;
  source: 'calculated' | 'mock' | 'pending';
  current: SpotDli;
  /** 앱 예시 추천 칸 (예시 방만). 서버 방은 추천 화면에서 서버 추천을 본다 */
  recommended: SpotDli | null;
}

export function usePlantsDli(): { byId: Record<string, PlantDli>; map: PeriodDliMap } {
  const { state } = useGarden();
  const map = usePeriodDliMap(state.dliPeriod);
  const serverRoom = !!state.room.server;
  const source: PlantDli['source'] = map.source === 'calculated' ? 'calculated' : serverRoom ? 'pending' : 'mock';

  const spot = (position: GridPosition, label: string, range: DliRange): SpotDli => {
    const dli = source === 'pending' ? null : (dliAt(map.map, position.x, position.y)?.total ?? null);
    return { position, label, dli, status: dli === null ? null : classifyDli(dli, range) };
  };

  const byId: Record<string, PlantDli> = {};
  for (const p of state.plants) {
    const range = dliRangeFor(p, state.serverSpecies);
    const rec = serverRoom ? null : p.analysis.recommended;
    byId[p.id] = {
      range,
      source,
      current: spot(p.location.position, p.location.label, range),
      recommended: rec ? spot(rec.position, rec.label, range) : null,
    };
  }
  return { byId, map };
}

/** 아직 등록 전인 식물(식물 등록 화면)의 자리 하나 */
export function useSpotDli(
  position: GridPosition | null,
  speciesId: PlantSpeciesId | null,
): { dli: number | null; status: DliStatus | null; range: DliRange; source: PlantDli['source'] } | null {
  const { state } = useGarden();
  const map = usePeriodDliMap(state.dliPeriod);
  if (!position || !speciesId) return null;
  const source: PlantDli['source'] = map.source === 'calculated' ? 'calculated' : state.room.server ? 'pending' : 'mock';
  const range = dliRangeFor({ speciesId }, state.serverSpecies);
  const dli = source === 'pending' ? null : (dliAt(map.map, position.x, position.y)?.total ?? null);
  return { dli, status: dli === null ? null : classifyDli(dli, range), range, source };
}

export function usePlantDli(plant: Plant | undefined): PlantDli | null {
  const { byId } = usePlantsDli();
  return plant ? (byId[plant.id] ?? null) : null;
}

/** '1.2' 또는 계산 전이면 '—' */
export function dliValueText(dli: number | null): string {
  return dli === null ? '—' : formatDli(dli);
}

/** '요구 4–12' */
export function rangeText(range: Pick<DliRange, 'min' | 'max'>): string {
  return `요구 ${range.min}–${range.max}`;
}

/**
 * 식물 카드·홈에 쓰는 한 줄 배치 안내.
 * move: 옮기면 나아지는 칸이 있거나 지금 자리가 범위 밖 · ok: 범위 안 · pending: 계산 전
 */
export function placementLine(pd: PlantDli): { tone: 'move' | 'ok' | 'pending'; text: string } {
  const range = `(${rangeText(pd.range)})`;
  if (pd.source === 'pending') return { tone: 'pending', text: `빛 지도 계산 전이에요 · ${rangeText(pd.range)}` };
  const cur = pd.current;
  if (pd.recommended) {
    return {
      tone: 'move',
      text: `${withRo(pd.recommended.label)} 옮기면 DLI ${dliValueText(cur.dli)} → ${dliValueText(pd.recommended.dli)} ${range}`,
    };
  }
  if (cur.status && cur.status !== 'ok') {
    return { tone: 'move', text: `DLI ${dliValueText(cur.dli)} · ${DLI_STATUS_COPY[cur.status].label} ${range} · 추천 위치 확인` };
  }
  return { tone: 'ok', text: `지금 자리가 잘 맞아요 · DLI ${dliValueText(cur.dli)} ${range}` };
}
