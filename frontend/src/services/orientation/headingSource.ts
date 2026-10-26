import { Accelerometer, Magnetometer } from 'expo-sensors';
import { Platform } from 'react-native';

import type { HeadingSourceKind } from '@/types';

import { CircularSmoother, computeOrientation, length, lowPass, normalizeDeg, type Vec3 } from './headingMath';

/**
 * 방위각 스트림.
 * UI / 스캔 로직은 HeadingSource 인터페이스만 알고, 실제 센서인지 시뮬레이션인지 모른다.
 */

export interface HeadingSample {
  /** smoothing 적용된 카메라 방위각 (자북 기준, 0~360) — 진북 변환은 declination.ts */
  azimuth: number;
  /** 카메라 상하 기울기 (°) */
  pitch: number;
  /** 카메라 좌우 기울기 (°, 시계 방향 +) */
  roll: number;
  /** 자기장 세기 (μT) */
  fieldStrength: number;
  timestamp: number;
}

export interface HeadingSource {
  readonly kind: HeadingSourceKind;
  start(listener: (sample: HeadingSample) => void): void;
  stop(): void;
}

export const SENSOR_INTERVAL_MS = 40;

/** 센서 smoothing 강도 (0~1, 클수록 반응이 빠르고 노이즈가 많음) */
const ACCEL_ALPHA = 0.25;
const MAG_ALPHA = 0.3;
const HEADING_ALPHA = 0.35;

/**
 * Accelerometer 부호 규칙이 플랫폼마다 다르다 (expo-sensors 네이티브 코드 기준).
 *  - Android: 휴대폰을 눕혔을 때 z = +1  → 측정값이 "위쪽"
 *  - iOS:     휴대폰을 눕혔을 때 z = -1  → 측정값이 "중력(아래쪽)"
 */
const UP_SIGN = Platform.OS === 'ios' ? -1 : 1;

export async function isHeadingSensorAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const [mag, acc] = await Promise.all([Magnetometer.isAvailableAsync(), Accelerometer.isAvailableAsync()]);
    return mag && acc;
  } catch {
    return false;
  }
}

/** Magnetometer + Accelerometer 기반 tilt-compensated compass */
export class SensorHeadingSource implements HeadingSource {
  readonly kind = 'sensors' as const;
  private accel: Vec3 | null = null;
  private mag: Vec3 | null = null;
  private smoother = new CircularSmoother(HEADING_ALPHA);
  private subs: { remove: () => void }[] = [];

  start(listener: (sample: HeadingSample) => void) {
    this.stop();
    this.smoother.reset();
    Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
    Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);

    this.subs.push(
      Accelerometer.addListener(({ x, y, z }) => {
        this.accel = lowPass(this.accel, { x: x * UP_SIGN, y: y * UP_SIGN, z: z * UP_SIGN }, ACCEL_ALPHA);
      }),
    );
    // 방위각은 자력계 업데이트마다 한 번 계산한다
    this.subs.push(
      Magnetometer.addListener(({ x, y, z }) => {
        this.mag = lowPass(this.mag, { x, y, z }, MAG_ALPHA);
        if (!this.accel) return;
        const o = computeOrientation(this.accel, this.mag);
        if (!o) return;
        listener({
          azimuth: this.smoother.push(o.azimuth),
          pitch: o.pitch,
          roll: o.roll,
          fieldStrength: length(this.mag),
          timestamp: Date.now(),
        });
      }),
    );
  }

  stop() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.accel = null;
    this.mag = null;
  }
}

/**
 * 개발용 시뮬레이션 (웹 / 에뮬레이터처럼 센서가 없는 환경에서 전체 플로우 확인용).
 * 임의의 시작 방향에서 초당 약 18°씩 시계 방향으로 돈다.
 */
export class SimulatedHeadingSource implements HeadingSource {
  readonly kind = 'simulated' as const;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly degPerSecond = 18) {}

  start(listener: (sample: HeadingSample) => void) {
    this.stop();
    let azimuth = 60 + Math.random() * 60;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      azimuth = normalizeDeg(azimuth + this.degPerSecond * dt + (Math.random() - 0.5) * 0.6);
      // 창밖 스캔 목표 자세(약 30° 위로 든 상태)를 흉내 낸다
      listener({
        azimuth,
        pitch: 30 + (Math.random() - 0.5) * 2,
        roll: (Math.random() - 0.5) * 2,
        fieldStrength: 48,
        timestamp: now,
      });
    }, SENSOR_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function createHeadingSource(kind: HeadingSourceKind): HeadingSource {
  return kind === 'sensors' ? new SensorHeadingSource() : new SimulatedHeadingSource();
}
