import { ApiError } from '@/services/api/client';
import {
  fetchDliSeries,
  fetchJob,
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

async function waitForJob<T>(jobId: string, isCancelled: () => boolean): Promise<JobOutcome<T> | null> {
  const started = Date.now();
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (isCancelled()) return null;
    const job = await fetchJob<T>(jobId);
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

  // ② 빠진 날짜 계산
  onProgress({ stage: 'dli', done: saved.days.length, total: dates.length });
  let outcome: JobOutcome<ApiDliSeries> | null;
  try {
    const { jobId } = await requestDliSeries(roomId, startDate, endDate, seriesOpts);
    outcome = await waitForJob<ApiDliSeries>(jobId, isCancelled);
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
 * 기간(start~end) 평균 DLI 지도 하나 — 공간 화면 지도, 추천 요청(dli_job_id)에 쓴다.
 * 서버는 날짜별 결과를 저장해 두고 다시 쓴다. 취소되면 null.
 */
export async function runPeriodDliJob(
  room: Room,
  startDate: string,
  endDate: string,
  isCancelled: () => boolean,
): Promise<PeriodDliResult | null> {
  if (!room.server) return { ok: false, error: '서버에 측정한 방이 없어요' };
  try {
    const { jobId } = await requestDliMap(room.server.roomId, periodRequestBody(room, startDate, endDate));
    const outcome = await waitForJob<ApiDliJobResult>(jobId, isCancelled);
    if (outcome === null) return null;
    return outcome.ok ? { ok: true, jobId, result: outcome.result, provisional: isProvisional(outcome.result) } : outcome;
  } catch (e) {
    return { ok: false, error: describeServerError(e) };
  }
}
