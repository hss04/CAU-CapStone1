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
  /** 물주기 간격 (일, 서버 기본 7) */
  wateringIntervalDays: number;
  /** 마지막 물준 날 YYYY-MM-DD. 기록이 없으면 null */
  lastWateredAt: string | null;
}

/** POST /plants, PUT /plants/{id} — roomId와 position은 둘 다 있거나 둘 다 null */
export interface ApiPlantInput {
  speciesId: number;
  nickname: string;
  roomId: number | null;
  position: ApiPosition | null;
  /** PUT에서 생략하면 서버에 저장된 값을 유지한다 */
  wateringIntervalDays?: number;
  lastWateredAt?: string | null;
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
  /** 지역 이름 (예: 서울 마포구). 위치를 저장할 때 같이 저장 */
  locationName: string | null;
  timezone: string;
  geometryVersion: number;
  /** 바닥 모서리 (y = 0), 둘레 순서 */
  corners: ApiCorner[];
  floorAreaM2: number;
}

/** POST /rooms — 첫 모서리가 원점(0,0,0), 바닥 y = 0, 둘레 순서 */
export interface ApiRoomInput {
  name: string;
  corners: ApiCorner[];
  xAxisAzimuthDeg?: number | null;
}

/** POST /rooms/{id}/windows — 방 안에서 볼 때 0 좌하, 1 우하, 2 우상, 3 좌상 */
export interface ApiWindowInput {
  name: string;
  corners: ApiCorner[];
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
  /** 같은 입력으로 진행 중·완료된 작업을 다시 쓴 경우 — v0.9.0 */
  reused?: boolean;
}

export type ApiJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STALE';

/** dli-map 작업 결과 = dli_map_v2 + 기간·임시 입력 표시 */
export interface ApiDliJobResult extends ApiDliMap {
  period: { startDate: string; endDate: string; dayCount: number; aggregation: 'DAILY_MEAN' };
  mockSky: boolean;
  temporaryDirection: boolean;
  warnings: string[];
}

/* ---------------- 날짜별 DLI (POST·GET /rooms/{id}/dli-series) ---------------- */

export interface ApiDliDay {
  date: string;
  /** 지난 날짜 ERA5, 최근·오늘·미래 BEST_MATCH_FORECAST (Open-Meteo 데이터셋) */
  dataset: 'ERA5' | 'BEST_MATCH_FORECAST';
  totalDli: DliGrid;
  directDli: DliGrid;
  diffuseDli: DliGrid;
  /** timeseries=true로 요청했을 때만 있음 */
  ppfd?: ApiPpfdDay;
}

/** 선택 칸 하나의 10분 PPFD (μmol/m²/s). 같은 인덱스의 직사 + 산란 = 전체 */
export interface ApiPpfdCell {
  row: number;
  col: number;
  directPpfd: number[];
  diffusePpfd: number[];
}

/** 하루치 10분 PPFD — 해가 떠 있는 구간만, times는 구간 가운데 시각(…:05, +09:00) */
export interface ApiPpfdDay {
  times: string[];
  intervalMinutes: 10;
  ppfdUnit: 'umol/m2/s';
  /** cells를 지정했을 때 */
  cellSeries?: ApiPpfdCell[];
  /** 전체 칸 요청 때 [시각][row][col] (방 밖 칸 null) */
  directPpfd?: (number | null)[][][];
  diffusePpfd?: (number | null)[][][];
}

export interface ApiDliSeries {
  roomId: number;
  geometryVersion: number;
  grid: ApiGrid;
  timezone: string;
  unit: 'mol/m2/day';
  mockSky: boolean;
  temporaryDirection: boolean;
  /** PROVISIONAL(임시 알고리즘), 식물 생략 사유 등 */
  warnings: string[];
  days: ApiDliDay[];
  /** 아직 계산되지 않았거나 예보가 만료된 날짜 */
  missingDates: string[];
}

/* ---------------- 창문별 스캔 상태 (GET /windows/{id}/scans) ---------------- */

export interface ApiScanSummary {
  jobId: string;
  status: ApiJobStatus;
  error: string | null;
  createdAt: string;
  capturedAt: string | null;
  geometryVersion: number;
  /** 지금 방 구조와 버전이 달라 쓰지 않는 스캔 */
  stale: boolean;
}

export interface ApiWindowScans {
  windowId: number;
  geometryVersion: number;
  /** 지금 방 구조에서 쓸 수 있는 완료 스캔이 있는지 */
  scanCompleted: boolean;
  latest: ApiScanSummary | null;
  latestCompleted: ApiScanSummary | null;
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
  kind: 'DLI' | 'DLI_SERIES' | 'SCAN';
  status: ApiJobStatus;
  error: string | null;
  /** 실패 사유 코드 (예: SERVER_RESTARTED) — v0.9.0 */
  errorCode?: string | null;
  /** 실제 처리 단계. DLI는 날짜 단위, 스캔은 전체가 1단계 — v0.9.0 */
  progress?: { stage: string; completedSteps: number; totalSteps: number };
  /** 방 구조가 바뀌어 결과가 더 이상 맞지 않음 */
  stale: boolean;
  result: T | null;
}

/* ---------------- 배치 추천 (POST /rooms/{id}/recommendations · recommendation-plans) ---------------- */

export interface ApiRecommendationCell {
  row: number;
  col: number;
  totalDli: number;
}

export interface ApiPlantRecommendation {
  plantId: number;
  speciesId: number;
  requiredDli: { min: number; max: number };
  /** 식물 위치가 없으면 null */
  current: (ApiRecommendationCell & { status: 'LOW' | 'OK' | 'HIGH' }) | null;
  /** 옮길 칸이 없으면 null — current.status가 OK일 때만 '지금 자리 유지'다 */
  recommended: (ApiRecommendationCell & { score: number }) | null;
}

export interface ApiRecommendationResult {
  roomId: number;
  date?: string | null;
  period: { startDate: string; endDate: string; dayCount: number } | null;
  plants: ApiPlantRecommendation[];
  warnings: string[];
}

/** CURRENT_OK 유지 · RELOCATE 이동 가능 · NO_FREE_CELL 빈 칸 없음 · NO_SUITABLE_CELL 범위에 맞는 칸 없음 */
export type ApiReasonCode = 'CURRENT_OK' | 'RELOCATE' | 'NO_FREE_CELL' | 'NO_SUITABLE_CELL';

/** 종별 요구 DLI의 근거 (GET /plant-species/{id}/evidence) */
export interface ApiSpeciesEvidence {
  basis: 'REFERENCE_SPECIES' | 'REFERENCE_GENUS' | 'REFERENCE_GROUP' | 'ESTIMATED' | 'OPERATOR_DEFINED' | 'UNKNOWN';
  /** 실험으로 확정된 값이 아니라 참고 범위 */
  provisional: boolean;
  sourceUrl: string | null;
  sourceEntry: string | null;
  checkedAt: string | null;
  botanicalSourceUrl: string | null;
  sourceNote: string | null;
}

export interface ApiDecision {
  plantId: number;
  reasonCode: ApiReasonCode;
  canApply: boolean;
  evidence: ApiSpeciesEvidence;
}

/** POST /rooms/{id}/recommendation-plans — 30분 동안 한 번에 적용할 수 있는 추천 계획 */
export interface ApiRecommendationPlan {
  planId: string;
  expiresAt: string;
  geometryVersion: number;
  result: ApiRecommendationResult;
  decisions: ApiDecision[];
}

export interface ApiAppliedPlan {
  planId: string;
  appliedCount: number;
  plants: ApiPlant[];
}

/* ---------------- 배치 불가 칸 (서버 저장) ---------------- */

export interface ApiBlockedCells {
  roomId: number;
  geometryVersion: number;
  cellSizeM: number;
  /** 저장할 때와 방 구조·격자가 달라 쓰지 않음 */
  stale: boolean;
  /** [row, col] */
  blockedCells: [number, number][];
}

/* ---------------- 한국 도시 (GET /locations/cities, /locations/search) ---------------- */

export interface ApiCityResult extends ApiLocationResult {
  displayName?: string;
  /** CITY_REPRESENTATIVE면 서버 도시 목록 항목 — city_id로 저장한다 */
  coordinateBasis?: string;
  source?: string;
}

/* ---------------- 관리 캘린더 (GET /calendar) ---------------- */

export type ApiTaskType = 'WATERING' | 'FERTILIZING' | 'REPOTTING' | 'PRUNING' | 'MISTING' | 'OTHER';
export type ApiCareType = Exclude<ApiTaskType, 'WATERING'>;
export type ApiEventStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export interface ApiCalendarDay {
  date: string;
  totalCount: number;
  pendingCount: number;
  completedCount: number;
  skippedCount: number;
  overdueCount: number;
  taskTypes: ApiTaskType[];
}

export interface ApiCalendarEvent {
  eventId: string;
  /** 예정일 (완료 기록도 원래 예정일에 표시) */
  date: string;
  plantId: number;
  plantNickname: string;
  speciesId: number;
  speciesName: string;
  scientificName: string | null;
  roomId: number | null;
  /** 물주기는 null */
  scheduleId: number | null;
  taskType: ApiTaskType;
  title: string;
  status: ApiEventStatus;
  isOverdue: boolean;
  completedOn: string | null;
  intervalDays: number | null;
  note: string | null;
}

export interface ApiCalendar {
  timezone: 'Asia/Seoul';
  today: string;
  startDate: string;
  endDate: string;
  days: ApiCalendarDay[];
  events: ApiCalendarEvent[];
}

export interface ApiCareScheduleInput {
  taskType: ApiCareType;
  title?: string | null;
  startDate: string;
  /** null이면 시작일 한 번만 */
  intervalDays?: number | null;
  endDate?: string | null;
  active?: boolean;
  note?: string | null;
}

export interface ApiCareSchedule extends Required<Omit<ApiCareScheduleInput, 'title'>> {
  id: number;
  plantId: number;
  title: string;
}

export interface ApiWateringRecord {
  id: number;
  plantId: number;
  wateredAt: string;
}

/* ---------------- 생장 사진 (GET /plants/{id}/growth-photos) ---------------- */

export interface ApiGrowthPhoto {
  id: number;
  plantId: number;
  takenAt: string;
  takenOn: string;
  note: string | null;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  contentType: string;
  /** 서버 상대 경로 — 조회에도 Bearer 토큰 필요 */
  imageUrl: string;
  thumbnailUrl: string;
}

export interface ApiGrowthPhotoList {
  plantId: number;
  plantNickname: string;
  timezone: string;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  photos: ApiGrowthPhoto[];
}

/* ---------------- 요약 · 알림 · 적합 종 · 기간 비교 ---------------- */

export interface ApiDashboard {
  date: string;
  timezone: string;
  plantCount: number;
  roomCount: number;
  overdueWindowStart: string;
  todayTasks: ApiCalendarEvent[];
  overdueTasks: ApiCalendarEvent[];
  plants: {
    plantId: number;
    nickname: string;
    roomId: number | null;
    lastWateredAt: string | null;
    latestPhotoAt: string | null;
    light: { totalDli: number; status: 'LOW' | 'OK' | 'HIGH'; dliJobId: string } | null;
  }[];
}

export interface ApiNotificationSchedule {
  timezone: string;
  delivery: 'DEVICE_LOCAL';
  pushConfigured: boolean;
  /** 일정이 바뀌면 달라진다 — 같으면 다시 예약할 필요 없음 */
  scheduleVersion: string;
  notifications: {
    notificationId: string;
    eventId: string;
    plantId: number;
    title: string;
    scheduledAt: string;
    taskType: ApiTaskType;
  }[];
}

export interface ApiSuitableSpecies {
  roomId: number;
  dliJobId: string;
  mockSky: boolean;
  reasonCode: 'MATCHES_FOUND' | 'NO_FREE_CELL' | 'NO_SUITABLE_SPECIES';
  total: number;
  results: {
    speciesId: number;
    name: string;
    scientificName: string | null;
    requiredDli: { min: number; max: number };
    suitableCells: number;
    availableCells: number;
    suitableFraction: number;
    bestCell: { row: number; col: number; totalDli: number; score: number };
    evidence: ApiSpeciesEvidence;
  }[];
}

export interface ApiComparisonPeriodInput {
  label: string;
  startDate: string;
  endDate: string;
}

export interface ApiDliComparison {
  roomId: number;
  geometryVersion: number;
  grid: ApiGrid;
  mockSky: boolean;
  temporaryDirection: boolean;
  periods: (ApiComparisonPeriodInput & {
    /** 기간의 날짜별 결과가 모두 저장돼 있어야 평균을 낸다 */
    complete: boolean;
    missingDates: string[];
    meanTotalDli: DliGrid | null;
    plants: { plantId: number; meanDli: number | null; status: 'LOW' | 'OK' | 'HIGH' | 'UNAVAILABLE' }[];
  })[];
}
