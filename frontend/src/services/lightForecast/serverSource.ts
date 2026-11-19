import { ApiError } from '@/services/api/client';
import {
  fetchDliSeries,
  fetchJob,
  fetchLatestDliMap,
  requestDliMap,
  requestDliSeries,
  type DliSeriesOptions,
} from '@/services/api/endpoints';
import type { LightBasis, LightDay, LightProgress, Room } from '@/types';
import type { ApiDliJobResult, ApiDliMap, ApiDliRequest, ApiDliSeries } from '@/types/api';

import { forecastDates } from './dates';

/**
 * 서버 계산 주간 광환경 (백엔드 v0.4.0 날짜별 DLI).
 *
 *   ① GET /rooms/{id}/dli-series — 서버에 저장된 날짜별 결과 (계산 안 함)
 *   ② 빠진 날짜가 있으면 POST /rooms/{id}/dli-series → GET /jobs/{id} (저장된 날짜는 서버가 건너뜀)
 * 지난 날짜는 과거 기상(ERA5 등), 오늘 이후는 예보로 계산하고, 결과는 서버 DB에 남는다.
 */

/** 연동 테스트용: 창밖 스캔·방 방향 없이 계산 (결과는 '임시 계산'으로 표시) */
const TEST_MODE = process.env.EXPO_PUBLIC_DLI_TEST_MODE === '1';

const POLL_INTERVAL_MS = 2000;
/** 백엔드 알고리즘 호출 제한(15분)보다 짧게 잡지 않는다 */
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

/** 서버가 준비되지 않아 계산할 수 없는 이유 (영문 detail → 사용자 안내) */
export function describeServerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return '서버에 연결할 수 없어요';
    const m = e.message;
    if (/location/i.test(m)) return '방 위치가 서버에 저장되지 않았어요';
    if (/direction/i.test(m)) return '방 방향을 아직 몰라요 (창밖 스캔 필요)';
    if (/SKY scan/i.test(m)) return '창문마다 창밖 스캔 분석 결과가 필요해요';
    if (e.status === 501) return '서버에 계산 함수가 연결되지 않았어요';
    if (e.status === 409 && /provisional/i.test(m)) return '계산 엔진이 연동 테스트 단계예요';
    if (/window/i.test(m)) return '창문 정보가 필요해요';
    return `서버 계산을 쓸 수 없어요 (${e.status})`;
  }
  return e instanceof Error ? e.message : '서버 계산을 쓸 수 없어요';
}

function seriesOptions(room: Room): DliSeriesOptions {
  if (!TEST_MODE) return { cellSizeM: room.cellSizeM };
  return {
    cellSizeM: room.cellSizeM,
    mockSky: true,
    temporaryXAxisAzimuthDeg: room.server?.xAxisAzimuthDeg === null ? 180 : undefined,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type JobOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** 서버가 알려주는 실제 진행 단계 (DLI는 날짜 단위) */
export interface JobProgress {
  done: number;
  total: number;
  /** 서버가 다른 계산을 먼저 하느라 아직 시작 전 (작업은 한 번에 하나씩) */
  queued?: boolean;
}

async function waitForJob<T>(
  jobId: string,
  isCancelled: () => boolean,
  onProgress?: (p: JobProgress) => void,
): Promise<JobOutcome<T> | null> {
  const started = Date.now();
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (isCancelled()) return null;
    const job = await fetchJob<T>(jobId);
    if (job.progress && job.progress.totalSteps > 1) {
      onProgress?.({ done: job.progress.completedSteps, total: job.progress.totalSteps, queued: job.progress.stage === 'QUEUED' });
    }
    if (job.status === 'FAILED' && job.errorCode === 'SERVER_RESTARTED') {
      return { ok: false, error: '서버가 다시 시작돼 계산이 멈췄어요 · 다시 계산해 주세요' };
    }
    if (job.status === 'COMPLETED' && job.result && !job.stale) return { ok: true, result: job.result };
    if (job.status === 'COMPLETED' || job.status === 'STALE' || job.stale) {
      return { ok: false, error: '방 정보가 바뀌어 다시 계산해야 해요' };
    }
    if (job.status === 'FAILED') return { ok: false, error: job.error ?? '계산에 실패했어요' };
  }
  return { ok: false, error: '계산 시간이 너무 오래 걸려요' };
}

/** 모의 하늘·임시 방향·임시 알고리즘(PROVISIONAL)으로 계산한 결과 */
function isProvisional(r: { mockSky: boolean; temporaryDirection: boolean; warnings: string[] }): boolean {
  return r.mockSky || r.temporaryDirection || r.warnings.some((w) => /PROVISIONAL/i.test(w));
}

/** 서버 날짜별 결과 → 화면용 하루치 (없는 날짜는 map null) */
function toLightDays(dates: { date: string; basis: LightBasis }[], series: ApiDliSeries): LightDay[] {
  const byDate = new Map(series.days.map((d) => [d.date, d]));
  return dates.map(({ date, basis }) => {
    const d = byDate.get(date);
    if (!d) return { date, basis, map: null };
    const map: ApiDliMap = {
      schemaVersion: 'dli_map_v2',
      roomId: series.roomId,
      geometryVersion: series.geometryVersion,
      date,
      timezone: series.timezone,
      unit: 'mol/m2/day',
      grid: series.grid,
      directDli: d.directDli,
      diffuseDli: d.diffuseDli,
      totalDli: d.totalDli,
    };
    return { date, basis, map };
  });
}

export type ServerLightResult =
  | { ok: true; days: LightDay[]; provisional: boolean }
  | { ok: false; reason: string; cancelled?: boolean };

export interface ServerLightOptions {
  room: Room;
  today: string;
  /** 다시 계산 요청 (저장된 날짜는 서버가 그대로 쓴다) */
  force?: boolean;
  /** 실제 처리 단계 (진행률 %는 알 수 없어 저장된 날짜 수만 알린다) */
  onProgress: (progress: LightProgress) => void;
  /** 저장된 결과를 먼저 보여주기 */
  onPartial: (days: LightDay[], provisional: boolean) => void;
  isCancelled: () => boolean;
}

const CANCELLED: ServerLightResult = { ok: false, reason: 'cancelled', cancelled: true };

export async function loadServerLightDays(options: ServerLightOptions): Promise<ServerLightResult> {
  const { room, today, force, onProgress, onPartial, isCancelled } = options;
  if (!room.server) return { ok: false, reason: '서버에 측정한 방이 없어요' };
  const roomId = room.server.roomId;
  const dates = forecastDates(today);
  const startDate = dates[0].date;
  const endDate = dates[dates.length - 1].date;
  const seriesOpts = seriesOptions(room);

  // ① 저장된 결과부터 — 앱을 다시 켜도 계산을 반복하지 않는다
  onProgress({ stage: 'request' });
  let saved: ApiDliSeries;
  try {
    saved = await fetchDliSeries(roomId, startDate, endDate, seriesOpts);
  } catch (e) {
    return { ok: false, reason: describeServerError(e) };
  }
  if (isCancelled()) return CANCELLED;
  const savedDays = toLightDays(dates, saved);
  const savedProvisional = isProvisional(saved);
  if (saved.days.length > 0) onPartial(savedDays, savedProvisional);
  if (saved.missingDates.length === 0 && !force) return { ok: true, days: savedDays, provisional: savedProvisional };

  // ② 빠진 날짜 계산 — 서버가 날짜 단위 진행을 알려준다 (저장된 날짜는 건너뛴다)
  onProgress({ stage: 'dli', done: saved.days.length, total: dates.length });
  let outcome: JobOutcome<ApiDliSeries> | null;
  try {
    const { jobId } = await requestDliSeries(roomId, startDate, endDate, seriesOpts);
    outcome = await waitForJob<ApiDliSeries>(jobId, isCancelled, (p) => onProgress({ stage: 'dli', done: p.done, total: p.total }));
  } catch (e) {
    outcome = { ok: false, error: describeServerError(e) };
  }
  if (outcome === null || isCancelled()) return CANCELLED;

  if (!outcome.ok) {
    // 저장된 날짜가 있으면 그것만이라도 보여주고, 나머지 날짜에 실패 이유를 붙인다
    if (saved.days.length === 0) return { ok: false, reason: outcome.error };
    const error = outcome.error;
    return { ok: true, days: savedDays.map((d) => (d.map ? d : { ...d, error })), provisional: savedProvisional };
  }
  onProgress({ stage: 'plants' });
  return { ok: true, days: toLightDays(dates, outcome.result), provisional: isProvisional(outcome.result) };
}

function periodRequestBody(room: Room, startDate: string, endDate: string): ApiDliRequest {
  const opts = seriesOptions(room);
  const body: ApiDliRequest = { startDate, endDate, cellSizeM: room.cellSizeM, sampleHeightM: 0 };
  if (opts.mockSky) {
    body.mockSky = true;
    body.acceptProvisionalAlgorithm = true;
    if (opts.temporaryXAxisAzimuthDeg !== undefined) body.temporaryXAxisAzimuthDeg = opts.temporaryXAxisAzimuthDeg;
  }
  return body;
}

export type PeriodDliResult =
  | { ok: true; jobId: string; result: ApiDliJobResult; provisional: boolean }
  | { ok: false; error: string };

/**
 * 저장된 최근 기간 지도 (GET /rooms/{id}/dli-map/latest) — 같은 기간이면 다시 계산하지 않고 바로 쓴다.
 * 예보가 만료되거나 방·스캔·위치가 바뀌면 서버가 주지 않는다 (404).
 */
async function latestPeriodMap(room: Room, startDate: string, endDate: string): Promise<PeriodDliResult | null> {
  if (!room.server) return null;
  try {
    const job = await fetchLatestDliMap(room.server.roomId, { cellSizeM: room.cellSizeM, mockSky: seriesOptions(room).mockSky });
    const r = job.result;
    if (!r || job.stale || job.status !== 'COMPLETED') return null;
    if (r.period.startDate !== startDate || r.period.endDate !== endDate) return null;
    return { ok: true, jobId: job.jobId, result: r, provisional: isProvisional(r) };
  } catch {
    // 404(저장된 지도 없음)·옛 서버 → 새로 계산
    return null;
  }
}

/**
 * 기간(start~end) 평균 DLI 지도 하나 — 공간 화면 지도, 추천 요청(dli_job_id)에 쓴다.
 * 저장된 같은 기간 지도가 있으면 그대로 쓰고, 없으면 계산한다 (서버는 날짜별 결과를 저장해 두고 다시 쓴다).
 * 취소되면 null.
 */
export async function runPeriodDliJob(
  room: Room,
  startDate: string,
  endDate: string,
  isCancelled: () => boolean,
  onProgress?: (p: JobProgress) => void,
): Promise<PeriodDliResult | null> {
  if (!room.server) return { ok: false, error: '서버에 측정한 방이 없어요' };
  const restored = await latestPeriodMap(room, startDate, endDate);
  if (restored) return restored;
  if (isCancelled()) return null;
  try {
    const { jobId } = await requestDliMap(room.server.roomId, periodRequestBody(room, startDate, endDate));
    const outcome = await waitForJob<ApiDliJobResult>(jobId, isCancelled, onProgress);
    if (outcome === null) return null;
    return outcome.ok ? { ok: true, jobId, result: outcome.result, provisional: isProvisional(outcome.result) } : outcome;
  } catch (e) {
    return { ok: false, error: describeServerError(e) };
  }
}

/** 비교·검증용 계산 옵션 (공간 화면과 같은 칸 크기·연동 테스트 설정) */
export function dliOptionsFor(room: Room): DliSeriesOptions {
  return seriesOptions(room);
}

/** 식물 자리 한 칸의 하루 10분 PPFD (μmol/m²/s) — 서버 계산값, 측정값 아님 */
export interface CellPpfd {
  date: string;
  /** 구간 가운데 시각, 자정부터 분 (12:05 → 725) */
  minutes: number[];
  direct: number[];
  diffuse: number[];
  provisional: boolean;
}

export type CellPpfdResult = { ok: true; data: CellPpfd } | { ok: false; error: string };

/** "2026-11-18T12:05:00+09:00" → 725. 서버가 한국시간(+09:00)으로 주므로 기기 시간대와 상관없이 문자열에서 읽는다 */
function minutesOfDay(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function pickCellPpfd(series: ApiDliSeries, date: string, row: number, col: number): CellPpfd | null {
  const ppfd = series.days.find((d) => d.date === date)?.ppfd;
  const cell = ppfd?.cellSeries?.find((c) => c.row === row && c.col === col);
  if (!ppfd || !cell) return null;
  return {
    date,
    minutes: ppfd.times.map(minutesOfDay),
    direct: cell.directPpfd,
    diffuse: cell.diffusePpfd,
    provisional: isProvisional(series),
  };
}

/**
 * 한 칸(row=z, col=x)의 하루 10분 PPFD (POST·GET /rooms/{id}/dli-series + timeseries, cells).
 * 저장된 결과가 있으면 그대로 쓰고, 없으면 그 날짜 하루만 계산한다. 취소되면 null.
 */
export async function loadCellPpfd(
  room: Room,
  date: string,
  row: number,
  col: number,
  isCancelled: () => boolean,
  onProgress?: (p: JobProgress) => void,
): Promise<CellPpfdResult | null> {
  if (!room.server) return { ok: false, error: '서버에 측정한 방이 없어요' };
  const roomId = room.server.roomId;
  const opts: DliSeriesOptions = { ...seriesOptions(room), timeseries: true, cells: [[row, col]] };
  try {
    const saved = await fetchDliSeries(roomId, date, date, opts);
    const hit = pickCellPpfd(saved, date, row, col);
    if (hit) return { ok: true, data: hit };
    if (isCancelled()) return null;
    const { jobId } = await requestDliSeries(roomId, date, date, opts);
    const outcome = await waitForJob<ApiDliSeries>(jobId, isCancelled, onProgress);
    if (outcome === null) return null;
    if (!outcome.ok) return outcome;
    const data = pickCellPpfd(outcome.result, date, row, col);
    return data ? { ok: true, data } : { ok: false, error: '서버 결과에 시간대별 값이 없어요 (서버 업데이트 필요)' };
  } catch (e) {
    return { ok: false, error: describeServerError(e) };
  }
}

/**
 * 기간(start~end, 최대 93일)의 날짜별 결과를 서버에 저장해 둔다 — 이미 있는 날짜는 서버가 건너뛴다.
 * 기간 비교(POST /dli-comparison)는 저장된 결과만 쓰므로 그 전에 부른다. 취소되면 null.
 */
export async function ensureDliSeries(
  room: Room,
  startDate: string,
  endDate: string,
  isCancelled: () => boolean,
  onProgress?: (p: JobProgress) => void,
): Promise<{ ok: true } | { ok: false; error: string } | null> {
  if (!room.server) return { ok: false, error: '서버에 측정한 방이 없어요' };
  const opts = seriesOptions(room);
  try {
    const saved = await fetchDliSeries(room.server.roomId, startDate, endDate, opts);
    if (saved.missingDates.length === 0) return { ok: true };
    if (isCancelled()) return null;
    const { jobId } = await requestDliSeries(room.server.roomId, startDate, endDate, opts);
    const outcome = await waitForJob<ApiDliSeries>(jobId, isCancelled, onProgress);
    if (outcome === null) return null;
    return outcome.ok ? { ok: true } : outcome;
  } catch (e) {
    return { ok: false, error: describeServerError(e) };
  }
}
