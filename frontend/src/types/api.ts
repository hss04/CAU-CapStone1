/**
 * 백엔드(FastAPI, /api/v1) 응답·요청 타입.
 * 서버 JSON은 snake_case이고, services/api/client 에서 camelCase로 바꿔서 이 타입으로 다룬다.
 */

export interface ApiUser {
  id: number;
  email: string;
  nickname: string;
  /** ISO 8601 (+09:00) */
  createdAt: string;
}

export interface ApiToken {
  accessToken: string;
  tokenType: string;
  /** 초 */
  expiresIn: number;
}

export interface ApiSpecies {
  id: number;
  name: string;
  scientificName: string | null;
  /** mol/m²/day */
  minDli: number;
  maxDli: number;
  sourceNote: string | null;
}

/** 방 좌표계 실제 위치 (m) */
export interface ApiPosition {
  x: number;
  y: number;
  z: number;
}

export interface ApiPlant {
  id: number;
  userId: number;
  roomId: number | null;
  speciesId: number;
  nickname: string;
  /** 방에 배치되지 않았으면 null (roomId도 null) */
  position: ApiPosition | null;
}

/** POST /plants, PUT /plants/{id} — roomId와 position은 둘 다 있거나 둘 다 null */
export interface ApiPlantInput {
  speciesId: number;
  nickname: string;
  roomId: number | null;
  position: ApiPosition | null;
}

/* ---------------- Room / Window / Grid (ARCore 좌표계, m) ---------------- */

export interface ApiCorner {
  x: number;
  y: number;
  z: number;
  orderIndex: number;
}

export interface ApiRoom {
  id: number;
  name: string;
  /** FIRST_CORNER_ORIGIN_AR_HORIZONTAL — 첫 모서리 원점, AR 수평축 그대로(회전 안 함) */
  coordinateSystem: string;
  xAxisAzimuthDeg: number | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  geometryVersion: number;
  /** 바닥 모서리 (y = 0), 둘레 순서 */
  corners: ApiCorner[];
  floorAreaM2: number;
}

export interface ApiWindow {
  id: number;
  roomId: number;
  name: string;
  /** 방 안에서 볼 때 0 좌하, 1 우하, 2 우상, 3 좌상 */
  corners: ApiCorner[];
}

/** GET /rooms/{id}/grid — schema_version grid_v2 */
export interface ApiGrid {
  schemaVersion: 'grid_v2';
  roomId: number;
  geometryVersion: number;
  coordinateSystem: string;
  unit: 'm';
  /** 방 x, z 최솟값 */
  origin: ApiPosition;
  cellSizeM: number;
  sampleHeightM: number;
  rows: number;
  cols: number;
  arrayOrder: '[row_z][col_x]';
  insideMask: boolean[][];
}

/** 방 밖 칸은 null, 방 안은 0 이상 (mol/m²/day) */
export type DliGrid = (number | null)[][];

/** 격자별 DLI 지도 — schema_version dli_map_v2 (backend docs/dli-map.schema.json) */
export interface ApiDliMap {
  schemaVersion: 'dli_map_v2';
  roomId: number;
  geometryVersion: number;
  /** YYYY-MM-DD */
  date: string;
  timezone: string;
  unit: 'mol/m2/day';
  grid: ApiGrid;
  directDli: DliGrid;
  diffuseDli: DliGrid;
  totalDli: DliGrid;
}
