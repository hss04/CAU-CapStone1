import type { ScanCapture, WindowScan } from '@/types';

import { relativeAngle, signedDelta } from '../orientation/headingMath';

/**
 * 개발 확인용 — 스캔 결과가 정상인지 검증하는 통계/체크.
 */

export interface CaptureStat {
  index: number;
  capture: ScanCapture;
  /** 시작 방위각 기준 상대 각도 */
  relative: number;
  /** 직전 capture와의 방위각 차이 (첫 장은 null) */
  diff: number | null;
  /** 스캔 시작 후 경과 시간 (ms) */
  elapsedMs: number;
}

export interface ScanCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ScanAnalysis {
  stats: CaptureStat[];
  minStep: number | null;
  maxStep: number | null;
  avgStep: number | null;
  /** 마지막 사진의 상대 각도 = 사진으로 실제 커버한 범위 */
  photoCoverage: number;
  checks: ScanCheck[];
}

export function analyzeWindowScan(scan: WindowScan, captureStep = 15, targetAngle = 180): ScanAnalysis {
  const t0 = scan.captures[0]?.timestamp ?? 0;
  const stats: CaptureStat[] = scan.captures.map((capture, index) => ({
    index,
    capture,
    relative: relativeAngle(scan.startAzimuth, capture.azimuth),
    diff: index === 0 ? null : signedDelta(scan.captures[index - 1].azimuth, capture.azimuth),
    elapsedMs: capture.timestamp - t0,
  }));

  const diffs = stats.map((s) => s.diff).filter((d): d is number => d !== null);
  const minStep = diffs.length ? Math.min(...diffs) : null;
  const maxStep = diffs.length ? Math.max(...diffs) : null;
  const avgStep = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
  const photoCoverage = stats.length ? stats[stats.length - 1].relative - stats[0].relative : 0;

  const gapLimit = captureStep * 1.6;
  const dupLimit = captureStep * 0.4;
  const missingImages = scan.captures.filter((c) => !c.imageUri).length;

  const checks: ScanCheck[] = [
    {
      label: `${targetAngle}° 커버`,
      ok: scan.scannedAngle >= targetAngle - 5 && photoCoverage >= targetAngle - captureStep,
      detail: `회전 ${scan.scannedAngle.toFixed(1)}° · 사진 범위 ${photoCoverage.toFixed(1)}°`,
    },
    {
      label: '방위각이 계속 증가',
      ok: diffs.every((d) => d > 0),
      detail: diffs.some((d) => d <= 0) ? `감소/정지 구간 ${diffs.filter((d) => d <= 0).length}곳` : '모든 간격 > 0°',
    },
    {
      label: '누락 구간 없음',
      ok: maxStep !== null && maxStep <= gapLimit,
      detail: `최대 간격 ${maxStep?.toFixed(1) ?? '-'}° (기준 ≤ ${gapLimit.toFixed(0)}°)`,
    },
    {
      label: '중복 촬영 없음',
      ok: minStep !== null && minStep >= dupLimit,
      detail: `최소 간격 ${minStep?.toFixed(1) ?? '-'}° (기준 ≥ ${dupLimit.toFixed(0)}°)`,
    },
    {
      label: '사진 ↔ 방위각 연결',
      ok: missingImages === 0 && scan.captures.length > 0,
      detail: missingImages ? `이미지 없는 capture ${missingImages}개` : `${scan.captures.length}장 모두 이미지 있음`,
    },
  ];

  return { stats, minStep, maxStep, avgStep, photoCoverage, checks };
}

export function formatDeg(v: number, digits = 1) {
  return `${v.toFixed(digits)}°`;
}

export function formatSigned(v: number, digits = 1) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}°`;
}

export function formatClock(ts: number) {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
