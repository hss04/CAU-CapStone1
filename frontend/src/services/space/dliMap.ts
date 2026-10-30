import type { Room } from '@/types';
import type { ApiDliMap, ApiGrid, DliGrid } from '@/types/api';

import { isInsideRoom } from './geometry';
import { getLightMap } from './lightAnalysis';

/**
 * DLI 지도 (dli_map_v2).
 *
 * 아직 백엔드에 DLI 계산 API가 없어서, 지금은 창문 위치로 추정한 광량 지수(0~100)를
 * DLI처럼 보이게 바꾼 "예시 값"을 같은 형식으로 만든다. 형식은 서버 규격과 같으므로
 * 계산 API가 생기면 이 함수 대신 서버 응답을 그대로 쓰면 된다.
 * (값 자체는 물리 계산이 아님 — 화면·연동 테스트용)
 */

export const MOCK_DLI_NOTE = '예시 값 · 알고리즘 연동 전';

/**
 * 광량 지수 100 ≈ 8 mol/m²/day 로 환산 (예시 값 전용).
 * 실내 범례(<1 · 1–2 · 2–4 · 4–8 · 8+)에서 창가 → 안쪽이 여러 색으로 나뉘도록 실내 수준(약 1~8)에 맞춘다.
 */
const INDEX_TO_DLI = 0.08;
/** 예시 값에서 산란광이 차지하는 비율 */
const DIFFUSE_SHARE = 0.35;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 서버 grid가 없는 데모 방용 grid (모든 칸이 방 안) */
export function demoGrid(room: Room): ApiGrid {
  return {
    schemaVersion: 'grid_v2',
    roomId: 1,
    geometryVersion: 1,
    coordinateSystem: 'FIRST_CORNER_ORIGIN_AR_HORIZONTAL',
    unit: 'm',
    origin: { x: 0, y: 0, z: 0 },
    cellSizeM: room.cellSizeM,
    sampleHeightM: 0,
    rows: room.rows,
    cols: room.cols,
    arrayOrder: '[row_z][col_x]',
    insideMask: Array.from({ length: room.rows }, (_, y) => Array.from({ length: room.cols }, (_, x) => isInsideRoom(room, { x, y }))),
  };
}

export function buildMockDliMap(room: Room, grid: ApiGrid, date: string): ApiDliMap {
  const index = getLightMap(room, 'average');
  const direct: DliGrid = [];
  const diffuse: DliGrid = [];
  const total: DliGrid = [];

  for (let y = 0; y < grid.rows; y++) {
    const d: (number | null)[] = [];
    const f: (number | null)[] = [];
    const t: (number | null)[] = [];
    for (let x = 0; x < grid.cols; x++) {
      // 방 밖 칸은 null (0과 미평가를 구분, 서버 검증 규칙)
      if (!grid.insideMask[y]?.[x]) {
        d.push(null);
        f.push(null);
        t.push(null);
        continue;
      }
      const dli = (index[y]?.[x] ?? 0) * INDEX_TO_DLI;
      const diffuseValue = round2(dli * DIFFUSE_SHARE);
      const directValue = round2(dli - diffuseValue);
      d.push(directValue);
      f.push(diffuseValue);
      // total = direct + diffuse 가 정확히 맞도록 반올림한 두 값을 더한다
      t.push(round2(directValue + diffuseValue));
    }
    direct.push(d);
    diffuse.push(f);
    total.push(t);
  }

  return {
    schemaVersion: 'dli_map_v2',
    roomId: grid.roomId,
    geometryVersion: grid.geometryVersion,
    date,
    timezone: 'Asia/Seoul',
    unit: 'mol/m2/day',
    grid,
    directDli: direct,
    diffuseDli: diffuse,
    totalDli: total,
  };
}

export interface CellDli {
  total: number;
  direct: number;
  diffuse: number;
}

export function dliAt(map: ApiDliMap, x: number, y: number): CellDli | null {
  const total = map.totalDli[y]?.[x];
  if (total === null || total === undefined) return null;
  return { total, direct: map.directDli[y]?.[x] ?? 0, diffuse: map.diffuseDli[y]?.[x] ?? 0 };
}
