import type { ScanCamera, ScanCapture, WindowFacing, WindowScan, WindowScanDebug } from '@/types';

import { DEFAULT_DECLINATION, magneticToTrue } from '../orientation/declination';
import { circularStats, normalizeDeg } from '../orientation/headingMath';
import type { HeadingSample, HeadingSource } from '../orientation/headingSource';
import { estimateFov } from './cameraFov';
import { DEFAULT_SCAN_CONFIG, isPitchOff, ScanTracker, type ScanTrackerConfig, type ScanTrackerSnapshot, type ScanWarning } from './scanTracker';

/**
 * 창밖 스캔 컨트롤러.
 * 진행 추적(ScanTracker)은 센서 원본(자북)으로 하고, 결과(WindowScan / marks)의 방위각은 진북으로 보정해 내보낸다.
 * 방향 센서(HeadingSource)와 카메라(PhotoShooter)를 조합하지만 둘의 구현은 모른다.
 *   - 센서 로직: services/orientation
 *   - 카메라 로직: hooks/useScanCamera
 */

/** 저장이 끝난 사진 (카메라 시뮬레이션이면 uri가 비어 있고 크기는 0) */
export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
  /** 화각 계산용 EXIF (초점거리 등) */
  exif?: Record<string, unknown>;
}

/** 카메라 한 번 촬영 결과 */
export interface PhotoShot {
  /** 셔터가 끝난 시점 (다음 촬영 가능) */
  captured: Promise<void>;
  /** 파일 저장이 끝난 뒤의 사진 */
  photo: Promise<CapturedPhoto>;
}

/** 촬영할 수 없으면 null */
export type PhotoShooter = () => PhotoShot | null;

/** 스캔이 끝난 뒤 사진 후처리 (예: 업로드 규격 크기로 축소) */
export type PhotoProcessor = (photo: CapturedPhoto) => Promise<CapturedPhoto>;

export type FacingResult = 'ok' | 'notReady' | 'unsteady';

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
  /** 기록한 창문 정면 방위각 (스캔 시작 전 필수) */
  facing: WindowFacing | null;
}

interface PendingCapture {
  /** 자북 기준 (센서 원본) */
  azimuth: number;
  pitch: number;
  roll: number;
  timestamp: number;
  relative: number;
  photo: Promise<CapturedPhoto>;
}

export interface ScanControllerOptions {
  windowId: string;
  source: HeadingSource;
  shooter: PhotoShooter;
  /** 없으면 촬영한 사진을 그대로 쓴다 */
  processPhoto?: PhotoProcessor;
  onChange: (state: ScanControllerState) => void;
  onComplete: (scan: WindowScan) => void;
  config?: ScanTrackerConfig;
}

const FIELD_MIN = 20;
const FIELD_MAX = 75;

/** 정면 방위각은 버튼을 누르기 직전 이 시간 동안의 센서 값을 원형 평균한다 */
const FACING_WINDOW_MS = 600;
const FACING_MIN_SAMPLES = 8;
/** 기록 구간 방위각의 원형 표준편차가 이보다 크면 휴대폰이 흔들린 것으로 보고 다시 기록하게 한다 */
const FACING_MAX_SPREAD_DEG = 5;

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
    facing: null,
  };
  private shooter: PhotoShooter;
  /** 스캔 전(ready) 최근 센서 샘플 — 정면 방위각 기록용 */
  private recent: HeadingSample[] = [];
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

  /**
   * 창문 정면 방위각 기록.
   * 버튼을 누르기 직전 FACING_WINDOW_MS 동안의 방위각을 원형 평균하고, 흔들림이 크면 거절한다.
   */
  recordFacing(): FacingResult {
    if (this.state.phase !== 'ready') return 'notReady';
    const now = this.state.sample?.timestamp ?? Date.now();
    const window = this.recent.filter((s) => now - s.timestamp <= FACING_WINDOW_MS);
    if (window.length < FACING_MIN_SAMPLES) return 'notReady';

    const stats = circularStats(window.map((s) => s.azimuth));
    if (!stats) return 'notReady';
    if (stats.spread > FACING_MAX_SPREAD_DEG) return 'unsteady';

    const avgField = window.reduce((sum, s) => sum + s.fieldStrength, 0) / window.length;
    this.set({
      facing: {
        azimuth: toTrue(stats.mean),
        magneticAzimuth: roundAzimuth(stats.mean),
        spreadDeg: round1(stats.spread),
        sampleCount: window.length,
        avgFieldStrength: round1(avgField),
        timestamp: Date.now(),
      },
    });
    return 'ok';
  }

  startScan() {
    const s = this.state.sample;
    if (!s || this.state.phase !== 'ready' || !this.state.facing) return;
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

    if (this.state.phase === 'waitingSensor' || this.state.phase === 'ready') {
      this.recent.push(sample);
      this.recent = this.recent.filter((s) => sample.timestamp - s.timestamp <= FACING_WINDOW_MS * 2);
    }
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
      roll: sample.roll,
      timestamp: Date.now(),
      relative,
      photo: shot.photo,
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

    const results = await Promise.allSettled(this.pending.map((p) => p.photo));
    const captures: ScanCapture[] = [];
    let camera: ScanCamera | undefined;
    // 후처리(축소)는 메모리를 아끼려고 한 장씩 순서대로 한다
    for (const [i, r] of results.entries()) {
      if (r.status !== 'fulfilled') {
        this.failed += 1;
        continue;
      }
      let photo = r.value;
      try {
        if (this.opts.processPhoto) photo = await this.opts.processPhoto(photo);
      } catch {
        // 축소에 실패하면 원본을 쓴다 (업로드 크기만 커지고 데이터는 유효)
      }
      // 화각은 기종에 따라 정해지므로 첫 사진 기준 (EXIF가 있는 사진을 우선)
      if (!camera || (camera.fovSource === 'default' && photo.exif)) {
        camera = estimateFov(photo.exif, photo.width, photo.height);
      }
      const p = this.pending[i];
      captures.push({
        imageUri: photo.uri,
        azimuth: toTrue(p.azimuth),
        magneticAzimuth: roundAzimuth(p.azimuth),
        pitch: round1(p.pitch),
        roll: round1(p.roll),
        width: photo.width || undefined,
        height: photo.height || undefined,
        timestamp: p.timestamp,
      });
    }

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
      facing: this.state.facing ?? undefined,
      camera,
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
