import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { ApiError } from '@/services/api/client';
import { fetchJob, uploadWindowScan } from '@/services/api/endpoints';
import type { WindowScan } from '@/types';

import { checkScanForUpload, frameFileName, toScanUpload, UPLOAD_HEIGHT_PX } from './uploadPayload';

/**
 * 창밖 스캔 업로드 → SKY 분석 대기.
 *   ① 사진을 업로드 규격(세로, 높이 1280px, 새로 인코딩한 JPEG)으로 변환
 *   ② POST /windows/{id}/scans (metadata + 사진 13장) → job_id
 *   ③ GET /jobs/{id}로 SKY 분석(백엔드 SegFormer) 완료까지 대기
 */

export type ScanUploadPhase = 'preparing' | 'uploading' | 'analyzing' | 'done' | 'failed';

export interface ScanUploadState {
  phase: ScanUploadPhase;
  jobId: string | null;
  error: string | null;
  /** 업로드 당시 서버 방 구조 버전 — 방이 바뀌면(위치 저장 포함) 서버가 이 스캔을 쓰지 않는다 */
  geometryVersion: number;
  updatedAt: number;
}

const JPEG_COMPRESS = 0.8;
const POLL_INTERVAL_MS = 3000;
/** 첫 실행은 SegFormer 모델을 내려받아 오래 걸릴 수 있다 */
const JOB_TIMEOUT_MS = 20 * 60 * 1000;

/** 다시 인코딩해서 저장하면 EXIF 회전 정보 없이 픽셀이 바로 선 사진이 된다 */
async function preparePhoto(uri: string) {
  const rendered = await ImageManipulator.manipulate(uri).resize({ height: UPLOAD_HEIGHT_PX }).renderAsync();
  return rendered.saveAsync({ compress: JPEG_COMPRESS, format: SaveFormat.JPEG });
}

async function appendJpeg(form: FormData, uri: string, name: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('files', blob, name);
  } else {
    // React Native FormData 파일 형식
    form.append('files', { uri, name, type: 'image/jpeg' } as unknown as Blob);
  }
}

/** 서버 오류(영문 detail) → 사용자 안내 */
export function describeUploadError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return '서버에 연결할 수 없어요';
    if (e.status === 413) return '사진 용량이 너무 커요 (장당 5MB 이하)';
    const m = e.message;
    if (/Frame angles/i.test(m)) return '사진 방향이 기준(정면 −90°부터 15° 간격)에서 5° 넘게 벗어났어요. 다시 스캔해 주세요.';
    if (/azimuth mismatch/i.test(m)) return '방위각 보정 값이 맞지 않아요. 다시 스캔해 주세요.';
    if (/upright JPEG|camera dimensions/i.test(m)) return '사진 크기·방향이 업로드 규격과 달라요.';
    if (/13 matching/i.test(m)) return '사진 13장이 모두 필요해요.';
    return `업로드에 실패했어요 (${e.status}) · ${m}`;
  }
  return e instanceof Error ? e.message : '업로드에 실패했어요';
}

/** 사진 변환 + 업로드. SKY 분석 작업 ID를 돌려준다 */
export async function submitWindowScan(
  scan: WindowScan,
  serverWindowId: number,
  onPhase: (phase: Extract<ScanUploadPhase, 'preparing' | 'uploading'>) => void,
): Promise<string> {
  const problem = checkScanForUpload(scan);
  if (problem) throw new Error(problem);

  onPhase('preparing');
  const photos = [];
  for (const c of scan.captures) photos.push(await preparePhoto(c.imageUri));
  const { width, height } = photos[0];
  if (width > height) throw new Error('가로로 찍힌 사진이 있어요. 휴대폰을 세로로 들고 다시 스캔해 주세요.');
  if (photos.some((p) => p.width !== width || p.height !== height)) throw new Error('사진 크기가 서로 달라요. 다시 스캔해 주세요.');

  const form = new FormData();
  form.append('metadata', JSON.stringify(toScanUpload(scan, serverWindowId, { width, height })));
  for (const [i, p] of photos.entries()) await appendJpeg(form, p.uri, frameFileName(i));

  onPhase('uploading');
  const created = await uploadWindowScan(serverWindowId, form);
  return created.jobId;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** SKY 분석이 끝날 때까지 대기. 취소되면 null */
export async function waitForScanJob(
  jobId: string,
  isCancelled: () => boolean,
): Promise<{ ok: true } | { ok: false; error: string } | null> {
  const started = Date.now();
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    if (isCancelled()) return null;
    const job = await fetchJob<unknown>(jobId);
    if (job.stale) return { ok: false, error: '방 정보가 바뀌어 다시 보내야 해요' };
    if (job.status === 'COMPLETED') return { ok: true };
    if (job.status === 'FAILED') return { ok: false, error: job.error ?? 'SKY 분석에 실패했어요' };
  }
  return { ok: false, error: '분석이 너무 오래 걸려요. 잠시 뒤 다시 보내 주세요.' };
}
