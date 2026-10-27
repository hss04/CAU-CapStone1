import { ApiError } from '@/services/api/client';
import { fetchDliJob, requestDliMap } from '@/services/api/endpoints';
import type { LightDay, LightProgress, Room } from '@/types';
import type { ApiDliJobResult, ApiDliRequest } from '@/types/api';

import { forecastDates } from './dates';

/**
 * 서버 계산 주간 광환경.
 *
 * 백엔드 POST /rooms/{id}/dli-map은 기간 평균 지도 하나를 돌려주므로,
 * 날짜별 값을 얻기 위해 하루짜리(start = end) 작업을 날짜마다 요청하고 GET /jobs/{id}로 결과를 받는다.
 * 백엔드는 지난 날짜에 과거 기상 데이터(ERA5 등), 오늘 이후에 예보 데이터를 쓴다.
 * (백엔드에 날짜별 결과를 한 번에 주는 API가 생기면 이 파일의 loadServerLightDays만 바꾸면 된다)
 */

/** 연동 테스트용: 창밖 스캔·방 방향 없이 1차 알고리즘으로 계산 (결과는 '임시 계산'으로 표시) */
const TEST_MODE = process.env.EXPO_PUBLIC_DLI_TEST_MODE === '1';

const POLL_INTERVAL_MS = 2000;
/** 백엔드 알고리즘 호출 제한(15분)보다 짧게 잡지 않는다 */
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
/** 서버 작업은 프로세스를 따로 띄우므로 동시에 너무 많이 요청하지 않는다 */
const CONCURRENCY = 2;
/** 오늘·미래 날짜는 예보가 바뀌므로 이 시간이 지나면 다시 계산한다 (백엔드 예보 캐시 TTL과 같음) */
const FORECAST_TTL_MS = 60 * 60 * 1000;

interface CachedDay {
  day: LightDay;
  provisional: boolean;
  fetchedAt: number;
}

/** 앱 실행 중 메모리 캐시 — 다시 계산하는 동안 이전 결과를 먼저 보여주는 데 쓴다 */
const cache = new Map<string, CachedDay>();

const roomKey = (room: Room) => `${room.server!.roomId}:${room.server!.geometryVersion}:${room.cellSizeM}:${TEST_MODE ? 'test' : 'real'}`;

function cachedDay(room: Room, date: string, today: string): CachedDay | null {
  const hit = cache.get(`${roomKey(room)}:${date}`);
  if (!hit) return null;
  const isPast = date < today;
  if (!isPast && Date.now() - hit.fetchedAt > FORECAST_TTL_MS) return null;
  return hit;
}

/** 서버가 준비되지 않아 계산할 수 없는 이유 (영문 detail → 사용자 안내) */
export function describeServerError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return '서버에 연결할 수 없어요';
    const m = e.message;
    if (/location/i.test(m)) return '방 위치가 서버에 저장되지 않았어요';
    if (/direction/i.test(m)) return '방 방향을 아직 몰라요 (창밖 스캔 필요)';
    if (/SKY scan/i.test(m)) return '창문마다 창밖 스캔 분석 결과가 필요해요';
    if (e.status === 501) return '계산 엔진이 이 방 구조(다각형·창문 여러 개)를 아직 지원하지 않아요';
    if (e.status === 409 && /provisional/i.test(m)) return '계산 엔진이 연동 테스트 단계예요';
    if (/window/i.test(m)) return '창문 정보가 필요해요';
    return `서버 계산을 쓸 수 없어요 (${e.status})`;
  }
  return e instanceof Error ? e.message : '서버 계산을 쓸 수 없어요';
}

function requestBody(room: Room, startDate: string, endDate: string = startDate): ApiDliRequest {
  const body: ApiDliRequest = { startDate, endDate, cellSizeM: room.cellSizeM, sampleHeightM: 0 };
  if (TEST_MODE) {
    body.mockSky = true;
    body.acceptProvisionalAlgorithm = true;
    if (room.server!.xAxisAzimuthDeg === null) body.temporaryXAxisAzimuthDeg = 180;
  }
  return body;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type JobOutcome = { ok: true; result: ApiDliJobResult } | { ok: false; error: string };

async function waitForJob(jobId: string, isCancelled: () => boolean): Promise<JobOutcome | null> {
  const started = Date.now();
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (isCancelled()) return null;
    const job = await fetchDliJob(jobId);
    if (job.status === 'COMPLETED' && job.result && !job.stale) return { ok: true, result: job.result };
    if (job.status === 'COMPLETED' || job.status === 'STALE' || job.stale) {
      return { ok: false, error: '방 정보가 바뀌어 다시 계산해야 해요' };
    }
    if (job.status === 'FAILED') return { ok: false, error: job.error ?? '계산에 실패했어요' };
  }
  return { ok: false, error: '계산 시간이 너무 오래 걸려요' };
}

function isProvisional(result: ApiDliJobResult): boolean {
  return result.mockSky || result.temporaryDirection || result.warnings.length > 0;
}

export type PeriodDliResult =
  | { ok: true; jobId: string; result: ApiDliJobResult; provisional: boolean }
  | { ok: false; error: string };

/**
 * 기간(start~end) 평균 DLI 지도 하나 — 공간 화면 지도, 추천 요청(dli_job_id)에 쓴다.
 * 취소되면 null.
 */
export async function runPeriodDliJob(
  room: Room,
  startDate: string,
  endDate: string,
  isCancelled: () => boolean,
): Promise<PeriodDliResult | null> {
  if (!room.server) return { ok: false, error: '서버에 측정한 방이 없어요' };
  try {
    const { jobId } = await requestDliMap(room.server.roomId, requestBody(room, startDate, endDate));
    const outcome = await waitForJob(jobId, isCancelled);
    if (outcome === null) return null;
    return outcome.ok ? { ok: true, jobId, result: outcome.result, provisional: isProvisional(outcome.result) } : outcome;
  } catch (e) {
    return { ok: false, error: describeServerError(e) };
  }
}

export type ServerLightResult =
  | { ok: true; days: LightDay[]; provisional: boolean }
  | { ok: false; reason: string; cancelled?: boolean };

export interface ServerLightOptions {
  room: Room;
  today: string;
  /** 다시 계산 (캐시 무시) */
  force?: boolean;
  /** 실제 처리 단계 (진행률 %는 알 수 없어 완료한 날짜 수만 알린다) */
  onProgress: (progress: LightProgress) => void;
  /** 날짜 하나가 끝날 때마다 지금까지의 결과 (화면에 먼저 보여주기) */
  onPartial: (days: LightDay[], provisional: boolean) => void;
  isCancelled: () => boolean;
}

export async function loadServerLightDays(options: ServerLightOptions): Promise<ServerLightResult> {
  const { room, today, force, onProgress, onPartial, isCancelled } = options;
  if (!room.server) return { ok: false, reason: '서버에 측정한 방이 없어요' };

  const dates = forecastDates(today);
  const days: LightDay[] = dates.map(({ date, basis }) => ({ date, basis, map: null }));
  let provisional = false;

  // 1) 캐시에 있는 날짜는 먼저 채운다
  const missing: number[] = [];
  dates.forEach(({ date }, i) => {
    const hit = force ? null : cachedDay(room, date, today);
    if (hit) {
      days[i] = hit.day;
      provisional ||= hit.provisional;
    } else {
      missing.push(i);
    }
  });
  if (missing.length === 0) return { ok: true, days, provisional };
  onPartial([...days], provisional);

  // 2) 첫 요청으로 서버가 계산할 수 있는 상태인지 확인 (방 위치·방향·창밖 스캔 등)
  onProgress({ stage: 'request' });
  const jobIds = new Map<number, string>();
  try {
    const first = await requestDliMap(room.server.roomId, requestBody(room, dates[missing[0]].date));
    jobIds.set(missing[0], first.jobId);
  } catch (e) {
    return { ok: false, reason: describeServerError(e) };
  }
  if (isCancelled()) return { ok: false, reason: 'cancelled', cancelled: true };

  // 3) 날짜별 작업 요청·대기 (동시에 CONCURRENCY개)
  let done = 0;
  let succeeded = 0;
  let firstError: string | null = null;
  onProgress({ stage: 'dli', done, total: missing.length });

  const runOne = async (index: number) => {
    const { date } = dates[index];
    let outcome: JobOutcome | null;
    try {
      const jobId = jobIds.get(index) ?? (await requestDliMap(room.server!.roomId, requestBody(room, date))).jobId;
      outcome = await waitForJob(jobId, isCancelled);
    } catch (e) {
      outcome = { ok: false, error: describeServerError(e) };
    }
    if (outcome === null || isCancelled()) return;

    if (outcome.ok) {
      const day: LightDay = { date, basis: dates[index].basis, map: outcome.result };
      const dayProvisional = isProvisional(outcome.result);
      cache.set(`${roomKey(room)}:${date}`, { day, provisional: dayProvisional, fetchedAt: Date.now() });
      days[index] = day;
      provisional ||= dayProvisional;
      succeeded += 1;
    } else {
      days[index] = { ...days[index], error: outcome.error };
      firstError ??= outcome.error;
    }
    done += 1;
    onProgress({ stage: 'dli', done, total: missing.length });
    onPartial([...days], provisional);
  };

  const queue = [...missing];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && !isCancelled()) await runOne(queue.shift()!);
    }),
  );
  if (isCancelled()) return { ok: false, reason: 'cancelled', cancelled: true };

  // 4) 한 날짜도 계산하지 못했으면 실패로 본다 (캐시로 채운 날짜는 그대로 쓴다)
  if (succeeded === 0 && missing.length === dates.length) {
    return { ok: false, reason: firstError ?? '서버 계산에 실패했어요' };
  }
  onProgress({ stage: 'plants' });
  return { ok: true, days, provisional };
}
