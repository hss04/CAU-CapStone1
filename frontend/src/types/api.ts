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

/* ---------------- DLI 계산 작업 (POST /rooms/{id}/dli-map → GET /jobs/{id}) ---------------- */

/** POST /rooms/{id}/dli-map — 기간(start~end)의 날짜별 계산을 평균한다. 하루만 원하면 start = end */
export interface ApiDliRequest {
  startDate: string;
  endDate: string;
  cellSizeM: number;
  sampleHeightM: number;
  /** 연동 테스트 전용: 창밖 스캔 없이 계산 */
  mockSky?: boolean;
  /** 연동 테스트 전용: 방 방향을 모를 때 임시 방향 */
  temporaryXAxisAzimuthDeg?: number;
  /** 연동 테스트 전용: 1차 알고리즘의 시간 범위·보간 제한을 알고 실행 */
  acceptProvisionalAlgorithm?: boolean;
}

export interface ApiJobCreated {
  jobId: string;
  status: ApiJobStatus;
  statusUrl: string;
}

export type ApiJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STALE';

/** dli-map 작업 결과 = dli_map_v2 + 기간·임시 입력 표시 */
export interface ApiDliJobResult extends ApiDliMap {
  period: { startDate: string; endDate: string; dayCount: number; aggregation: 'DAILY_MEAN' };
  mockSky: boolean;
  temporaryDirection: boolean;
  warnings: string[];
}

/** GET /locations/search 결과 한 건 (Open-Meteo 지오코딩) */
export interface ApiLocationResult {
  id: number | null;
  name: string | null;
  country: string | null;
  /** 시·도 */
  admin1: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

export interface ApiJob<T> {
  jobId: string;
  kind: 'DLI' | 'SCAN';
  status: ApiJobStatus;
  error: string | null;
  /** 방 구조가 바뀌어 결과가 더 이상 맞지 않음 */
  stale: boolean;
  result: T | null;
}
