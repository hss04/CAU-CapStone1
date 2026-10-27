import type {
  ApiDliJobResult,
  ApiDliMap,
  ApiDliRequest,
  ApiGrid,
  ApiJob,
  ApiJobCreated,
  ApiLocationResult,
  ApiPlant,
  ApiPlantInput,
  ApiRoom,
  ApiSpecies,
  ApiToken,
  ApiUser,
  ApiWindow,
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

export function updateRoomLocation(roomId: number, location: { latitude: number; longitude: number }) {
  return apiRequest<{ latitude: number; longitude: number }>(`/rooms/${roomId}/location`, { method: 'PUT', body: location });
}
