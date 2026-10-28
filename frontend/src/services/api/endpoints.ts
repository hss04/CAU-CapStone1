import type {
  ApiDliJobResult,
  ApiDliMap,
  ApiDliRequest,
  ApiDliSeries,
  ApiGrid,
  ApiJob,
  ApiJobCreated,
  ApiLocationResult,
  ApiPlant,
  ApiPlantInput,
  ApiRoom,
  ApiRoomInput,
  ApiSpecies,
  ApiToken,
  ApiUser,
  ApiWindow,
  ApiWindowInput,
  ApiWindowScans,
} from '@/types/api';

import { apiRequest } from './client';

/** 백엔드 API 목록 (경로는 backend 브랜치 app/api.py 기준) */

/* ---------------- Auth ---------------- */

export function register(input: { email: string; password: string; nickname: string }) {
  return apiRequest<ApiUser>('/auth/register', { method: 'POST', body: input, auth: false });
}

export function login(input: { email: string; password: string }) {
  return apiRequest<ApiToken>('/auth/login', { method: 'POST', body: input, auth: false });
}

export function fetchMe() {
  return apiRequest<ApiUser>('/users/me');
}

/* ---------------- Plant species (공통 카탈로그) ---------------- */

/** 목록 API는 한 번에 최대 100개라서 끝까지 이어서 받는다 */
export async function fetchAllSpecies(): Promise<ApiSpecies[]> {
  const pageSize = 100;
  const all: ApiSpecies[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await apiRequest<ApiSpecies[]>('/plant-species', { query: { limit: pageSize, offset } });
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

/* ---------------- Plants (내 식물) ---------------- */

export async function fetchAllPlants(): Promise<ApiPlant[]> {
  const pageSize = 100;
  const all: ApiPlant[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await apiRequest<ApiPlant[]>('/plants', { query: { limit: pageSize, offset } });
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

export function createPlant(input: ApiPlantInput) {
  return apiRequest<ApiPlant>('/plants', { method: 'POST', body: input });
}

/** PUT은 전체 교체 — 바꾸지 않는 필드도 모두 보낸다 */
export function updatePlant(id: number, input: ApiPlantInput) {
  return apiRequest<ApiPlant>(`/plants/${id}`, { method: 'PUT', body: input });
}

export function deletePlant(id: number) {
  return apiRequest<void>(`/plants/${id}`, { method: 'DELETE' });
}

/* ---------------- Rooms (ARCore 측정 방) ---------------- */

export function fetchRooms() {
  return apiRequest<ApiRoom[]>('/rooms', { query: { limit: 100 } });
}

export function fetchWindows(roomId: number) {
  return apiRequest<ApiWindow[]>(`/rooms/${roomId}/windows`, { query: { limit: 100 } });
}

/** 규격: 격자 한 칸 20 cm 고정 (서버 기본값은 0.25 m라서 명시해서 요청) */
export const GRID_CELL_SIZE_M = 0.2;

export function fetchGrid(roomId: number, cellSizeM = GRID_CELL_SIZE_M) {
  return apiRequest<ApiGrid>(`/rooms/${roomId}/grid`, { query: { cell_size_m: cellSizeM, sample_height_m: 0 } });
}

/** DLI 지도 JSON이 서버 규격(dli_map_v2)·현재 격자와 맞는지 검증만 한다 (계산·저장 안 함) */
export function validateDliMap(map: ApiDliMap) {
  return apiRequest<ApiDliMap>(`/rooms/${map.roomId}/dli-map/validate`, { method: 'POST', body: map });
}

/* ---------------- DLI 계산 (비동기 작업) ---------------- */

/** 격자별 DLI 계산 요청 — 202와 job_id를 받고, 결과는 fetchDliJob으로 조회한다 */
export function requestDliMap(roomId: number, body: ApiDliRequest) {
  return apiRequest<ApiJobCreated>(`/rooms/${roomId}/dli-map`, { method: 'POST', body });
}

export function fetchDliJob(jobId: string) {
  return fetchJob<ApiDliJobResult>(jobId);
}

/** 비동기 작업 상태 (DLI 계산, 창밖 스캔 SKY 분석 공통) */
export function fetchJob<T>(jobId: string) {
  return apiRequest<ApiJob<T>>(`/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * 배치 추천 — 완료된 DLI 작업(기간 지도)과 배치 불가 칸으로 요청한다.
 * 백엔드는 알고리즘 추천 함수가 연결되기 전까지 501을 돌려준다. 응답 형식은 아직 미정이라 unknown.
 */
export function requestRecommendations(roomId: number, input: { dliJobId: string; blockedCells: [number, number][] }) {
  return apiRequest<unknown>(`/rooms/${roomId}/recommendations`, { method: 'POST', body: input });
}

/* ---------------- 창밖 스캔 업로드 ---------------- */

/** 사진 13장 + metadata(JSON 문자열) multipart 업로드 → 202 + job_id (SKY 분석은 백그라운드) */
export function uploadWindowScan(windowId: number, form: FormData) {
  return apiRequest<ApiJobCreated>(`/windows/${windowId}/scans`, { method: 'POST', form, timeoutMs: 120000 });
}

/* ---------------- 방 위치 ---------------- */

/** 지역 이름 검색 (Open-Meteo 지오코딩, 서버 경유) — q는 2글자 이상 */
export function searchLocations(q: string) {
  return apiRequest<{ results: ApiLocationResult[] }>('/locations/search', { query: { q } });
}

/** 위치 저장 — 서버는 방 구조 버전을 올리지 않아 창밖 스캔이 유지된다 (v0.4.0) */
export function updateRoomLocation(roomId: number, location: { latitude: number; longitude: number; locationName: string | null }) {
  return apiRequest<ApiRoom>(`/rooms/${roomId}/location`, { method: 'PUT', body: location });
}

/* ---------------- 방 직접 입력 ---------------- */

export function createRoom(input: ApiRoomInput) {
  return apiRequest<ApiRoom>('/rooms', { method: 'POST', body: input });
}

export function deleteRoom(roomId: number) {
  return apiRequest<void>(`/rooms/${roomId}`, { method: 'DELETE' });
}

export function createWindow(roomId: number, input: ApiWindowInput) {
  return apiRequest<ApiWindow>(`/rooms/${roomId}/windows`, { method: 'POST', body: input });
}

/* ---------------- 방 방향 · 창문 스캔 상태 · 물주기 ---------------- */

/** 창문별 최신 스캔의 창문 방위각으로 방 방향(x_axis_azimuth_deg)을 계산해 저장 (구조 버전은 그대로) */
export function computeRoomDirection(roomId: number) {
  return apiRequest<{ xAxisAzimuthDeg: number }>(`/rooms/${roomId}/direction`, { method: 'POST' });
}

export function fetchWindowScans(windowId: number) {
  return apiRequest<ApiWindowScans>(`/windows/${windowId}/scans`, { query: { limit: 5 } });
}

/** 물 준 날 기록 — 같은 날 다시 보내도 되고, 늦게 도착한 옛 날짜가 마지막 물주기를 되돌리지 않는다 */
export function waterPlant(plantId: number, wateredAt: string) {
  return apiRequest<ApiPlant>(`/plants/${plantId}/waterings`, { method: 'POST', body: { wateredAt } });
}

/* ---------------- 날짜별 DLI ---------------- */

/** 계산 옵션 — GET 조회에도 POST와 같은 옵션을 보내야 같은 결과를 찾는다 */
export interface DliSeriesOptions {
  cellSizeM: number;
  mockSky?: boolean;
  temporaryXAxisAzimuthDeg?: number;
}

/** 저장된 날짜별 결과 조회 (계산 안 함). 없는 날짜는 missingDates */
export function fetchDliSeries(roomId: number, startDate: string, endDate: string, options: DliSeriesOptions) {
  return apiRequest<ApiDliSeries>(`/rooms/${roomId}/dli-series`, {
    query: {
      start_date: startDate,
      end_date: endDate,
      cell_size_m: options.cellSizeM,
      sample_height_m: 0,
      mock_sky: options.mockSky ? 'true' : undefined,
      temporary_x_axis_azimuth_deg: options.temporaryXAxisAzimuthDeg,
    },
  });
}

/** 날짜별 계산 요청 — 이미 저장된 날짜는 서버가 건너뛴다 */
export function requestDliSeries(roomId: number, startDate: string, endDate: string, options: DliSeriesOptions) {
  return apiRequest<ApiJobCreated>(`/rooms/${roomId}/dli-series`, {
    method: 'POST',
    body: {
      startDate,
      endDate,
      cellSizeM: options.cellSizeM,
      sampleHeightM: 0,
      ...(options.mockSky ? { mockSky: true } : {}),
      ...(options.temporaryXAxisAzimuthDeg !== undefined ? { temporaryXAxisAzimuthDeg: options.temporaryXAxisAzimuthDeg } : {}),
    },
  });
}
