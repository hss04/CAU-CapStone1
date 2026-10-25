import type { ScanCapture, WindowScan, WindowScanDebug } from '@/types';

import { DEFAULT_DECLINATION, magneticToTrue } from '../orientation/declination';
import { normalizeDeg } from '../orientation/headingMath';
import type { HeadingSample, HeadingSource } from '../orientation/headingSource';
import { DEFAULT_SCAN_CONFIG, isPitchOff, ScanTracker, type ScanTrackerConfig, type ScanTrackerSnapshot, type ScanWarning } from './scanTracker';

/**
 * 창밖 스캔 컨트롤러.
 * 진행 추적(ScanTracker)은 센서 원본(자북)으로 하고, 결과(WindowScan / marks)의 방위각은 진북으로 보정해 내보낸다.
 * 방향 센서(HeadingSource)와 카메라(PhotoShooter)를 조합하지만 둘의 구현은 모른다.
 *   - 센서 로직: services/orientation
 *   - 카메라 로직: hooks/useScanCamera
 */

/** 카메라 한 번 촬영 결과 */
export interface PhotoShot {
  /** 셔터가 끝난 시점 (다음 촬영 가능) */
  captured: Promise<void>;
  /** 파일 저장이 끝난 뒤의 이미지 URI */
  uri: Promise<string>;
}

/** 촬영할 수 없으면 null */
export type PhotoShooter = () => PhotoShot | null;

export type ScanPhase = 'waitingSensor' | 'ready' | 'scanning' | 'finishing' | 'done';

export type ScanHint = ScanWarning | 'tilt' | 'interference';

export interface ScanMark {
  relative: number;
  /** 진북 기준 */
  azimuth: number;
}

export interface ScanControllerState {
  phase: ScanPhase;
  sample: HeadingSample | null;
  tracker: ScanTrackerSnapshot | null;
  hint: ScanHint | null;
  marks: ScanMark[];
  captureCount: number;
  lastCaptureAt: number | null;
}

interface PendingCapture {
  /** 자북 기준 (센서 원본) */
  azimuth: number;
  pitch: number;
  timestamp: number;
  relative: number;
  uri: Promise<string>;
}

export interface ScanControllerOptions {
  windowId: string;
  source: HeadingSource;
  shooter: PhotoShooter;
  onChange: (state: ScanControllerState) => void;
  onComplete: (scan: WindowScan) => void;
  config?: ScanTrackerConfig;
}

const FIELD_MIN = 20;
const FIELD_MAX = 75;

export class WindowScanController {
  private readonly tracker: ScanTracker;
  private state: ScanControllerState = {
    phase: 'waitingSensor',
    sample: null,
    tracker: null,
    hint: null,
    marks: [],
    captureCount: 0,
    lastCaptureAt: null,
  };
  private shooter: PhotoShooter;
  private pending: PendingCapture[] = [];
  private inFlight: Promise<void> | null = null;
  private startedAt = 0;
  private failed = 0;
  private fieldSum = 0;
  private fieldCount = 0;
  private warnings = { reverse: 0, tooFast: 0, tilt: 0, interference: 0 };
  private completion: { endAzimuth: number; scannedAngle: number } | null = null;
  private disposed = false;

  constructor(private readonly opts: ScanControllerOptions) {
    this.tracker = new ScanTracker(opts.config ?? DEFAULT_SCAN_CONFIG);
    this.shooter = opts.shooter;
  }

  get config() {
    return this.tracker.config;
  }

  /** 센서 구독 시작 (스캔 전에도 현재 방위각을 보여주기 위해) */
  begin() {
    this.opts.source.start(this.handleSample);
  }

  setShooter(shooter: PhotoShooter) {
    this.shooter = shooter;
  }

  startScan() {
    const s = this.state.sample;
    if (!s || this.state.phase !== 'ready') return;
    this.tracker.start(s.azimuth, s.timestamp);
    this.startedAt = Date.now();
    this.pending = [];
    this.failed = 0;
    this.completion = null;
    this.warnings = { reverse: 0, tooFast: 0, tilt: 0, interference: 0 };
    this.set({ phase: 'scanning', tracker: this.tracker.snapshot(), marks: [], captureCount: 0, hint: null });
    this.capture(); // 시작 지점(0°) 촬영
  }

  dispose() {
    this.disposed = true;
    this.opts.source.stop();
  }

  private set(patch: Partial<ScanControllerState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.opts.onChange(this.state);
  }

  private handleSample = (sample: HeadingSample) => {
    if (this.disposed) return;

    if (this.state.phase === 'waitingSensor') {
      this.set({ phase: 'ready', sample });
      return;
    }
    if (this.state.phase !== 'scanning') {
      this.set({ sample });
      return;
    }

    const snap = this.tracker.update(sample.azimuth, sample.timestamp);
    this.fieldSum += sample.fieldStrength;
    this.fieldCount += 1;

    let hint: ScanHint | null = snap.warning;
    if (!hint && isPitchOff(sample.pitch, this.config)) hint = 'tilt';
    if (!hint && (sample.fieldStrength < FIELD_MIN || sample.fieldStrength > FIELD_MAX)) hint = 'interference';
    if (hint && hint !== this.state.hint) this.warnings[hint] += 1;

    this.set({ sample, tracker: snap, hint });

    if (snap.completed) {
      this.finish(snap);
    } else if (!this.inFlight && this.tracker.shouldCapture()) {
      this.capture();
    }
  };

  /** 현재 방향으로 한 장 촬영. 촬영 당시 방위각을 즉시 기록한다. */
  private capture(): Promise<void> {
    const sample = this.state.sample;
    if (!sample || this.inFlight) return this.inFlight ?? Promise.resolve();

    const shot = this.shooter();
    if (!shot) {
      this.failed += 1;
      return Promise.resolve();
    }

    this.tracker.markCaptured();
    const relative = this.tracker.currentProgress;
    this.pending.push({
      azimuth: sample.azimuth,
      pitch: sample.pitch,
      timestamp: Date.now(),
      relative,
      uri: shot.uri,
    });
    this.set({
      marks: [...this.state.marks, { relative, azimuth: magneticToTrue(sample.azimuth, DEFAULT_DECLINATION.declinationDeg) }],
      captureCount: this.pending.length,
      lastCaptureAt: Date.now(),
    });

    const flight = shot.captured
      .catch(() => {
        this.failed += 1;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = flight;
    return flight;
  }

  private async finish(snap: ScanTrackerSnapshot) {
    if (this.state.phase !== 'scanning') return;
    this.completion = { endAzimuth: snap.currentAzimuth, scannedAngle: this.tracker.scannedAngle };
    this.set({ phase: 'finishing', hint: null });

    // 진행 중인 촬영이 끝나길 기다린 뒤, 끝 지점(≈180°)이 비어 있으면 한 장 더
    if (this.inFlight) await this.inFlight;
    if (this.tracker.needsFinalCapture()) await this.capture();
    this.opts.source.stop();

    const results = await Promise.allSettled(this.pending.map((p) => p.uri));
    const captures: ScanCapture[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        const p = this.pending[i];
        captures.push({
          imageUri: r.value,
          azimuth: toTrue(p.azimuth),
          magneticAzimuth: roundAzimuth(p.azimuth),
          pitch: round1(p.pitch),
          timestamp: p.timestamp,
        });
      } else {
        this.failed += 1;
      }
    });

    const debug: WindowScanDebug = {
      scannedAt: this.startedAt,
      durationMs: Date.now() - this.startedAt,
      headingSource: this.opts.source.kind,
      captureStepDeg: this.config.captureStep,
      targetAngle: this.config.targetAngle,
      targetPitchDeg: this.config.targetPitch,
      pitchToleranceDeg: this.config.pitchTolerance,
      warnings: this.warnings,
      avgFieldStrength: this.fieldCount ? round1(this.fieldSum / this.fieldCount) : undefined,
      failedCaptures: this.failed,
    };

    const scan: WindowScan = {
      windowId: this.opts.windowId,
      startAzimuth: toTrue(this.tracker.snapshot().startAzimuth),
      endAzimuth: toTrue(this.completion.endAzimuth),
      ...DEFAULT_DECLINATION,
      scannedAngle: round1(this.completion.scannedAngle),
      captures,
      debug,
    };

    this.set({ phase: 'done' });
    if (!this.disposed) this.opts.onComplete(scan);
  }
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/** 자북 원본 → 진북 (반올림 포함) */
function toTrue(magnetic: number) {
  return roundAzimuth(magneticToTrue(magnetic, DEFAULT_DECLINATION.declinationDeg));
}

/** 359.96 → 0.0 처럼 반올림 후에도 0~360 범위 유지 */
function roundAzimuth(v: number) {
  return normalizeDeg(round1(v));
}
