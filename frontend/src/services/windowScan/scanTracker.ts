import { signedDelta } from '../orientation/headingMath';

/**
 * 180° 창밖 스캔 진행 추적기 (React / 센서 / 카메라와 무관한 순수 로직).
 *
 * - 시작 순간의 방위각을 기준(0°)으로 잡는다.
 * - 매 샘플마다 직전 방위각과의 부호 있는 차이를 누적해 0°/360° 경계를 넘어도 연속적으로 추적한다.
 * - 왼쪽 → 오른쪽(시계 방향, 방위각 증가) 이동만 진행으로 인정한다.
 * - 가장 멀리 촬영한 지점보다 captureStep 이상 나아갔을 때만 촬영 → 같은 각도 중복 촬영 방지.
 */

export interface ScanTrackerConfig {
  /** 완료 각도 */
  targetAngle: number;
  /** 촬영 간격 (°) */
  captureStep: number;
  /** 이만큼 되돌아가면 "반대 방향" 경고 (°) */
  reverseThreshold: number;
  /** 이 속도(°/s)를 넘으면 "너무 빠름" 경고 */
  maxSpeed: number;
  /** 촬영 시 휴대폰을 위로 드는 목표 각도 (°, 수평 0 · 위쪽 +). 세로 화각 ≈70° 기준 고도 약 −5°~65°를 촬영 */
  targetPitch: number;
  /** 목표 각도에서 이만큼 벗어나면 "기울기" 경고 (°) */
  pitchTolerance: number;
}

export const DEFAULT_SCAN_CONFIG: ScanTrackerConfig = {
  targetAngle: 180,
  captureStep: 15,
  reverseThreshold: 6,
  maxSpeed: 32,
  targetPitch: 30,
  pitchTolerance: 5,
};

/** 현재 피치가 목표 각도 허용 범위를 벗어났는지 */
export function isPitchOff(pitch: number, config: ScanTrackerConfig = DEFAULT_SCAN_CONFIG): boolean {
  return Math.abs(pitch - config.targetPitch) > config.pitchTolerance;
}

export type ScanWarning = 'reverse' | 'tooFast' | null;

export interface ScanTrackerSnapshot {
  startAzimuth: number;
  currentAzimuth: number;
  /** 누적 회전 각도 (음수 가능) */
  unwrapped: number;
  /** 화면 표시용 진행 각도 (0 ~ target) */
  progress: number;
  /** 지금까지 도달한 최대 진행 각도 */
  maxProgress: number;
  /** 각속도 (°/s, smoothing 적용) */
  speed: number;
  warning: ScanWarning;
  completed: boolean;
}

export class ScanTracker {
  private startAzimuth = 0;
  private lastAzimuth = 0;
  private lastTimestamp = 0;
  private unwrapped = 0;
  private maxProgress = 0;
  private speed = 0;
  private lastCaptureProgress: number | null = null;

  constructor(readonly config: ScanTrackerConfig = DEFAULT_SCAN_CONFIG) {}

  start(azimuth: number, timestamp: number) {
    this.startAzimuth = azimuth;
    this.lastAzimuth = azimuth;
    this.lastTimestamp = timestamp;
    this.unwrapped = 0;
    this.maxProgress = 0;
    this.speed = 0;
    this.lastCaptureProgress = null;
  }

  update(azimuth: number, timestamp: number): ScanTrackerSnapshot {
    const delta = signedDelta(this.lastAzimuth, azimuth);
    const dt = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
    this.lastAzimuth = azimuth;
    this.lastTimestamp = timestamp;
    this.unwrapped += delta;

    const instant = Math.abs(delta) / dt;
    this.speed = this.speed + 0.3 * (instant - this.speed);

    const progress = Math.max(0, this.unwrapped);
    this.maxProgress = Math.max(this.maxProgress, progress);

    let warning: ScanWarning = null;
    if (this.unwrapped < this.maxProgress - this.config.reverseThreshold || this.unwrapped < -this.config.reverseThreshold) {
      warning = 'reverse';
    } else if (this.speed > this.config.maxSpeed) {
      warning = 'tooFast';
    }

    return this.snapshot(warning);
  }

  snapshot(warning: ScanWarning = null): ScanTrackerSnapshot {
    const progress = Math.max(0, this.unwrapped);
    return {
      startAzimuth: this.startAzimuth,
      currentAzimuth: this.lastAzimuth,
      unwrapped: this.unwrapped,
      progress: Math.min(progress, this.config.targetAngle),
      maxProgress: this.maxProgress,
      speed: this.speed,
      warning,
      completed: progress >= this.config.targetAngle,
    };
  }

  /** 지금 촬영해야 하는지 (첫 장이거나 마지막 촬영 지점보다 step 이상 전진) */
  shouldCapture(): boolean {
    const progress = Math.max(0, this.unwrapped);
    if (this.lastCaptureProgress === null) return true;
    return progress >= this.lastCaptureProgress + this.config.captureStep;
  }

  /** 완료 시점에 마지막 촬영 지점이 끝에서 충분히 떨어져 있으면 한 장 더 */
  needsFinalCapture(): boolean {
    if (this.lastCaptureProgress === null) return true;
    return this.unwrapped - this.lastCaptureProgress >= this.config.captureStep / 2;
  }

  markCaptured() {
    this.lastCaptureProgress = Math.max(0, this.unwrapped);
  }

  get currentProgress() {
    return Math.max(0, this.unwrapped);
  }

  get scannedAngle() {
    return this.unwrapped;
  }
}
