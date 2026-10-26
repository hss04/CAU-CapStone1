/**
 * 방위각(azimuth) 계산용 순수 함수 모음.
 * Magnetometer + Accelerometer 만 사용한다 (Gyroscope 미사용).
 *
 * 좌표계 (iOS / Android 공통 device frame)
 *   x: 화면 오른쪽, y: 화면 위쪽, z: 화면 밖(사용자 쪽)
 *   후면 카메라는 -z 방향을 바라본다.
 */

export type Vec3 = { x: number; y: number; z: number };

const RAD = 180 / Math.PI;

export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

export function normalize(v: Vec3): Vec3 | null {
  const len = length(v);
  if (len < 1e-6) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** 벡터 low-pass filter (센서 노이즈 완화) */
export function lowPass(prev: Vec3 | null, next: Vec3, alpha: number): Vec3 {
  if (!prev) return next;
  return {
    x: prev.x + alpha * (next.x - prev.x),
    y: prev.y + alpha * (next.y - prev.y),
    z: prev.z + alpha * (next.z - prev.z),
  };
}

/** 0 ≤ deg < 360 */
export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * from → to 로 가는 가장 짧은 부호 있는 각도 (-180, 180].
 * 0° / 360° 경계를 넘는 경우(예: 350° → 10° = +20°)를 처리한다.
 */
export function signedDelta(from: number, to: number): number {
  let d = normalizeDeg(to) - normalizeDeg(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** 시작 방위각 기준 시계 방향 상대 각도. 시작보다 살짝 왼쪽이면 음수로 표현한다. (-90, 270] */
export function relativeAngle(start: number, azimuth: number): number {
  const d = normalizeDeg(azimuth - start);
  return d > 270 ? d - 360 : d;
}

export function compassLabel(azimuth: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(normalizeDeg(azimuth) / 45) % 8];
}

export interface Orientation {
  /** 카메라가 바라보는 방향의 방위각 (0~360, 자북 기준) */
  azimuth: number;
  /** 카메라 방향의 상하 각도 (수평 0°, 하늘 쪽 +) */
  pitch: number;
  /**
   * 카메라 광축 둘레의 좌우 기울기 (수평 0°).
   * 화면을 보는 사용자 기준으로 휴대폰을 시계 방향으로 기울이면(화면 오른쪽이 내려가면) +.
   */
  roll: number;
  /** 어느 축을 기준으로 방위각을 계산했는지 (휴대폰을 눕히면 top) */
  axis: 'camera' | 'top';
}

const CAMERA: Vec3 = { x: 0, y: 0, z: -1 };

/**
 * Tilt-compensated compass.
 * @param up 기기 좌표계에서 "위쪽" 단위 벡터 (중력 반대 방향)
 * @param mag 자기장 벡터 (μT)
 *
 * East  = normalize(mag × up)
 * North = up × East
 * 카메라 축(-z)을 수평면에 투영해 atan2(east, north)로 방위각을 구한다.
 */
export function computeOrientation(up: Vec3, mag: Vec3): Orientation | null {
  const u = normalize(up);
  if (!u) return null;
  const east = normalize(cross(mag, u));
  if (!east) return null;
  const north = cross(u, east);

  const camUp = dot(CAMERA, u);
  const pitch = Math.asin(Math.max(-1, Math.min(1, camUp))) * RAD;
  // 시계 방향으로 기울면 화면 오른쪽(x)이 아래로 내려가 위쪽 벡터의 x 성분이 음수가 된다
  const roll = Math.atan2(-u.x, u.y) * RAD;

  // 휴대폰을 거의 눕힌 경우 카메라 축의 수평 성분이 사라지므로 화면 위쪽(y) 축을 사용
  if (Math.abs(camUp) < 0.85) {
    const azimuth = normalizeDeg(Math.atan2(dot(CAMERA, east), dot(CAMERA, north)) * RAD);
    return { azimuth, pitch, roll, axis: 'camera' };
  }
  const azimuth = normalizeDeg(Math.atan2(east.y, north.y) * RAD);
  return { azimuth, pitch, roll, axis: 'top' };
}

/**
 * 원형(circular) 지수 이동 평균.
 * 각도를 단위 벡터로 평균내므로 359° ↔ 1° 경계에서도 튀지 않는다.
 */
export class CircularSmoother {
  private c = 0;
  private s = 0;
  private initialized = false;

  constructor(private readonly alpha: number) {}

  push(deg: number): number {
    const r = deg / RAD;
    if (!this.initialized) {
      this.c = Math.cos(r);
      this.s = Math.sin(r);
      this.initialized = true;
    } else {
      this.c += this.alpha * (Math.cos(r) - this.c);
      this.s += this.alpha * (Math.sin(r) - this.s);
    }
    return normalizeDeg(Math.atan2(this.s, this.c) * RAD);
  }

  reset() {
    this.initialized = false;
  }
}

/**
 * 원형 평균 + 원형 표준편차 (°).
 * 359°와 1°의 평균이 180°가 아니라 0°가 되도록 각도를 단위 벡터로 평균낸다.
 */
export function circularStats(degs: number[]): { mean: number; spread: number } | null {
  if (!degs.length) return null;
  let c = 0;
  let s = 0;
  for (const d of degs) {
    c += Math.cos(d / RAD);
    s += Math.sin(d / RAD);
  }
  c /= degs.length;
  s /= degs.length;
  const r = Math.min(1, Math.hypot(c, s));
  const spread = r > 0 ? Math.sqrt(-2 * Math.log(r)) * RAD : 180;
  return { mean: normalizeDeg(Math.atan2(s, c) * RAD), spread };
}
