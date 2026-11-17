import type {
  ApiAppliedPlan,
  ApiBlockedCells,
  ApiCalendar,
  ApiCareSchedule,
  ApiCareScheduleInput,
  ApiCityResult,
  ApiComparisonPeriodInput,
  ApiDashboard,
  ApiDliComparison,
  ApiDliJobResult,
  ApiDliMap,
  ApiDliRequest,
  ApiDliSeries,
  ApiGrid,
  ApiGrowthPhoto,
  ApiGrowthPhotoList,
  ApiJob,
  ApiJobCreated,
  ApiNotificationSchedule,
  ApiPlant,
  ApiRecommendationPlan,
  ApiRecommendationResult,
  ApiSpeciesEvidence,
  ApiSuitableSpecies,
  ApiWateringRecord,
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

import { apiRequest, newRequestKey } from './client';

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

/** 종 검색 — 한글·영문 이름, 별칭, 옛 학명까지 서버가 찾는다 (107종 카탈로그) */
export function searchSpecies(q: string, limit = 20) {
  return apiRequest<ApiSpecies[]>('/plant-species', { query: { q, limit } });
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
  return apiRequest<ApiJobCreated>(`/rooms/${roomId}/dli-map`, { method: 'POST', body, idempotencyKey: newRequestKey('dli') });
}

export function fetchDliJob(jobId: string) {
  return fetchJob<ApiDliJobResult>(jobId);
}

/** 비동기 작업 상태 (DLI 계산, 창밖 스캔 SKY 분석 공통) */
export function fetchJob<T>(jobId: string) {
  return apiRequest<ApiJob<T>>(`/jobs/${encodeURIComponent(jobId)}`);
}

/** 배치 추천 (위치 저장 안 함) — 완료된 DLI 작업(기간 지도)과 배치 불가 칸으로 요청한다 */
export function requestRecommendations(roomId: number, input: { dliJobId: string; blockedCells: [number, number][] }) {
  return apiRequest<ApiRecommendationResult>(`/rooms/${roomId}/recommendations`, { method: 'POST', body: input });
}

/**
 * 추천 계획 — 추천 결과 + 식물별 판정(reason_code). 30분 안에 apply로 한 번에 적용할 수 있다.
 * 서버 어댑터가 옮길 식물끼리 자리를 바꾸는 배치도 찾는다. 배치 불가 칸은 서버 저장분과 합친다.
 */
export function createRecommendationPlan(roomId: number, input: { dliJobId: string; blockedCells: [number, number][] }) {
  return apiRequest<ApiRecommendationPlan>(`/rooms/${roomId}/recommendation-plans`, { method: 'POST', body: input });
}

/** 계획 적용 — plantIds를 빼면 옮길 수 있는 식물 전부. 서로 자리를 바꾸는 식물 중 하나만 고르면 409 */
export function applyRecommendationPlan(roomId: number, planId: string, plantIds?: number[]) {
  return apiRequest<ApiAppliedPlan>(`/rooms/${roomId}/recommendation-plans/${encodeURIComponent(planId)}/apply`, {
    method: 'POST',
    body: plantIds ? { plantIds } : {},
  });
}

/* ---------------- 배치 불가 칸 (서버 저장) ---------------- */

export function fetchBlockedCells(roomId: number, cellSizeM = GRID_CELL_SIZE_M) {
  return apiRequest<ApiBlockedCells>(`/rooms/${roomId}/blocked-cells`, { query: { cell_size_m: cellSizeM } });
}

/** 방 구조 버전이 다르면 409 — 방을 다시 받은 뒤 저장한다 */
export function saveBlockedCells(roomId: number, geometryVersion: number, blockedCells: [number, number][], cellSizeM = GRID_CELL_SIZE_M) {
  return apiRequest<ApiBlockedCells>(`/rooms/${roomId}/blocked-cells`, {
    method: 'PUT',
    body: { geometryVersion, cellSizeM, blockedCells },
  });
}

/* ---------------- 저장된 결과 ---------------- */

/** 방의 최근 유효한 기간 평균 지도 (실제 하늘 결과만). 없으면 404 */
export function fetchLatestDliMap(roomId: number, options: { cellSizeM: number; mockSky?: boolean }) {
  return apiRequest<ApiJob<ApiDliJobResult>>(`/rooms/${roomId}/dli-map/latest`, {
    query: { cell_size_m: options.cellSizeM, sample_height_m: 0, mock_sky: options.mockSky ? 'true' : undefined },
  });
}

/** 지금 방의 빈 칸(식물·배치 불가 칸 제외)에 맞는 종 순위 */
export function fetchSuitableSpecies(roomId: number, dliJobId?: string, limit = 20) {
  return apiRequest<ApiSuitableSpecies>(`/rooms/${roomId}/suitable-species`, { query: { dli_job_id: dliJobId, limit } });
}

/** 저장된 날짜별 결과로 2~4개 기간 평균 비교 (없는 날은 0으로 채우지 않고 missingDates) */
export function compareDliPeriods(roomId: number, periods: ApiComparisonPeriodInput[], options: DliSeriesOptions) {
  return apiRequest<ApiDliComparison>(`/rooms/${roomId}/dli-comparison`, {
    method: 'POST',
    body: {
      periods,
      cellSizeM: options.cellSizeM,
      sampleHeightM: 0,
      mockSky: !!options.mockSky,
      temporaryXAxisAzimuthDeg: options.temporaryXAxisAzimuthDeg ?? null,
    },
  });
}

export function fetchSpeciesEvidence(speciesId: number) {
  return apiRequest<ApiSpeciesEvidence & { speciesId: number; minDli: number; maxDli: number }>(
    `/plant-species/${speciesId}/evidence`,
  );
}

/* ---------------- 관리 캘린더 · 물주기 기록 ---------------- */

/** 기간(양끝 포함, 최대 366일)의 날짜별 개수와 일정 목록 */
export function fetchCalendar(startDate: string, endDate: string, filter: { plantId?: number } = {}) {
  return apiRequest<ApiCalendar>('/calendar', { query: { start_date: startDate, end_date: endDate, plant_id: filter.plantId } });
}

export function fetchWaterings(plantId: number) {
  return apiRequest<ApiWateringRecord[]>(`/plants/${plantId}/waterings`, { query: { limit: 100 } });
}

/** 잘못 기록한 날짜 정정 — 남은 기록의 최신 날짜로 마지막 물주기를 다시 계산한다 */
export function correctWatering(plantId: number, recordId: number, wateredAt: string) {
  return apiRequest<ApiPlant>(`/plants/${plantId}/waterings/${recordId}`, { method: 'PATCH', body: { wateredAt } });
}

export function undoWatering(plantId: number, recordId: number) {
  return apiRequest<ApiPlant>(`/plants/${plantId}/waterings/${recordId}`, { method: 'DELETE' });
}

/** 물주기 간격만 바꾼다 (이름·위치·마지막 물준 날 유지) */
export function updateWateringInterval(plantId: number, wateringIntervalDays: number) {
  return apiRequest<ApiPlant>(`/plants/${plantId}/watering-schedule`, { method: 'PUT', body: { wateringIntervalDays } });
}

export function fetchCareSchedules(plantId: number) {
  return apiRequest<ApiCareSchedule[]>(`/plants/${plantId}/care-schedules`, { query: { limit: 100 } });
}

export function createCareSchedule(plantId: number, input: ApiCareScheduleInput) {
  return apiRequest<ApiCareSchedule>(`/plants/${plantId}/care-schedules`, { method: 'POST', body: input });
}

export function deleteCareSchedule(scheduleId: number) {
  return apiRequest<void>(`/care-schedules/${scheduleId}`, { method: 'DELETE' });
}

/** 회차 완료·건너뛰기 — scheduledDate는 원래 예정일, completedOn은 실제 한 날 */
export function recordCareOccurrence(
  scheduleId: number,
  scheduledDate: string,
  input: { status: 'COMPLETED' | 'SKIPPED'; completedOn?: string },
) {
  return apiRequest<unknown>(`/care-schedules/${scheduleId}/occurrences/${scheduledDate}`, { method: 'PUT', body: input });
}

export function undoCareOccurrence(scheduleId: number, scheduledDate: string) {
  return apiRequest<void>(`/care-schedules/${scheduleId}/occurrences/${scheduledDate}`, { method: 'DELETE' });
}

/* ---------------- 생장 사진 ---------------- */

export function fetchGrowthPhotos(plantId: number, order: 'asc' | 'desc' = 'desc', offset = 0) {
  return apiRequest<ApiGrowthPhotoList>(`/plants/${plantId}/growth-photos`, { query: { order, limit: 50, offset } });
}

/** 사진 한 장 업로드 (FormData: file, taken_at, note). 재시도할 때는 같은 key를 쓴다 */
export function uploadGrowthPhoto(plantId: number, form: FormData, idempotencyKey: string) {
  return apiRequest<ApiGrowthPhoto>(`/plants/${plantId}/growth-photos`, {
    method: 'POST',
    form,
    idempotencyKey,
    timeoutMs: 120000,
  });
}

export function updateGrowthPhoto(photoId: number, input: { note?: string | null; takenAt?: string }) {
  return apiRequest<ApiGrowthPhoto>(`/growth-photos/${photoId}`, { method: 'PATCH', body: input });
}

export function deleteGrowthPhoto(photoId: number) {
  return apiRequest<void>(`/growth-photos/${photoId}`, { method: 'DELETE' });
}

/* ---------------- 요약 · 기기 알림 ---------------- */

export function fetchDashboard() {
  return apiRequest<ApiDashboard>('/dashboard');
}

/** 미완료 일정의 알림 시각 (한국 시간 hour:minute) — 휴대폰에서 직접 예약한다 */
export function fetchNotificationSchedule(startDate: string, endDate: string, hour = 9) {
  return apiRequest<ApiNotificationSchedule>('/notifications/schedule', {
    query: { start_date: startDate, end_date: endDate, hour, minute: 0 },
  });
}

/* ---------------- 창밖 스캔 업로드 ---------------- */

/** 사진 13장 + metadata(JSON 문자열) multipart 업로드 → 202 + job_id (SKY 분석은 백그라운드) */
export function uploadWindowScan(windowId: number, form: FormData) {
  return apiRequest<ApiJobCreated>(`/windows/${windowId}/scans`, {
    method: 'POST',
    form,
    timeoutMs: 120000,
    idempotencyKey: newRequestKey('scan'),
  });
}

/* ---------------- 방 위치 ---------------- */

/**
 * 지역 이름 검색 — 서버가 한국 도시 85곳(서울·부산·마포 X, 시 단위)을 먼저 찾고,
 * 없으면 Open-Meteo 지오코딩(한국만)으로 찾는다. q는 2글자 이상
 */
export function searchLocations(q: string) {
  return apiRequest<{ results: ApiCityResult[] }>('/locations/search', { query: { q } });
}

/**
 * 위치 저장 — 서버는 방 구조 버전을 올리지 않아 창밖 스캔이 유지된다.
 * 도시 목록 항목이면 cityId로 저장하고(서버가 대표 좌표·이름을 넣음), 아니면 위경도로 저장한다.
 */
export function updateRoomLocation(
  roomId: number,
  location: { latitude: number; longitude: number; locationName: string | null } | { cityId: number },
) {
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
    idempotencyKey: newRequestKey('dli-series'),
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
