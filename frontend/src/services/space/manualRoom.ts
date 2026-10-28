import type { ApiCorner, ApiRoomInput, ApiWindowInput } from '@/types/api';

/**
 * 방 직접 입력 (ARCore를 쓸 수 없을 때) → 서버 방·창문 형식.
 *
 * 좌표: 위에서 내려다본 평면, x = 화면 오른쪽, z = 화면 아래쪽 (앱 지도와 같은 방향), 단위 m.
 * 모서리는 화면에서 시계 방향으로 돈다. 이 순서면 벽 A→B를 방 안에서 바라볼 때 A가 왼쪽 끝이라,
 * 창문 꼭짓점을 규격 순서(0 좌하, 1 우하, 2 우상, 3 좌상)로 만들면 바깥 법선 (V3−V0)×(V1−V0)이 방 밖을 향한다.
 * 서버 규칙: 첫 모서리 = 원점(0,0,0), 바닥 y = 0. 방 방향은 창밖 스캔 후 서버가 계산한다.
 */

export type RoomShape = 'rect' | 'L';

/** ㄱ자 방에서 직사각형이 빠진 모서리 (화면 기준) */
export type NotchCorner = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

export interface ManualWindowInput {
  key: string;
  /** 몇 번째 벽 (모서리 i → i+1) */
  wallIndex: number;
  /** 방 안에서 그 벽을 볼 때 왼쪽 끝에서 창문까지 (m) */
  offsetM: number;
  widthM: number;
  /** 바닥에서 창 아래 끝까지 (m) */
  sillM: number;
  heightM: number;
}

export interface ManualRoomInput {
  name: string;
  shape: RoomShape;
  /** 전체 가로·세로 (m) */
  widthM: number;
  depthM: number;
  notch: NotchCorner;
  /** ㄱ자에서 빠진 부분의 가로·세로 (m) */
  notchWidthM: number;
  notchDepthM: number;
  windows: ManualWindowInput[];
}

export interface Pt {
  x: number;
  z: number;
}

export type WallSide = '위쪽' | '오른쪽' | '아래쪽' | '왼쪽';

export interface Wall {
  index: number;
  from: Pt;
  to: Pt;
  lengthM: number;
  side: WallSide;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 바닥 모서리 (화면 시계 방향, 첫 모서리가 원점) */
export function roomPolygon(input: Pick<ManualRoomInput, 'shape' | 'widthM' | 'depthM' | 'notch' | 'notchWidthM' | 'notchDepthM'>): Pt[] {
  const W = input.widthM;
  const D = input.depthM;
  if (input.shape === 'rect') {
    return [
      { x: 0, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D },
      { x: 0, z: D },
    ];
  }
  const cw = input.notchWidthM;
  const cd = input.notchDepthM;
  const shapes: Record<NotchCorner, Pt[]> = {
    topRight: [
      { x: 0, z: 0 },
      { x: W - cw, z: 0 },
      { x: W - cw, z: cd },
      { x: W, z: cd },
      { x: W, z: D },
      { x: 0, z: D },
    ],
    bottomRight: [
      { x: 0, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D - cd },
      { x: W - cw, z: D - cd },
      { x: W - cw, z: D },
      { x: 0, z: D },
    ],
    bottomLeft: [
      { x: 0, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D },
      { x: cw, z: D },
      { x: cw, z: D - cd },
      { x: 0, z: D - cd },
    ],
    topLeft: [
      { x: cw, z: 0 },
      { x: W, z: 0 },
      { x: W, z: D },
      { x: 0, z: D },
      { x: 0, z: cd },
      { x: cw, z: cd },
    ],
  };
  // 첫 모서리를 원점으로 옮긴다 (서버 규칙). 음수 좌표는 허용된다
  const pts = shapes[input.notch];
  return pts.map((p) => ({ x: round3(p.x - pts[0].x), z: round3(p.z - pts[0].z) }));
}

function sideOf(from: Pt, to: Pt): WallSide {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? '위쪽' : '아래쪽';
  return dz > 0 ? '오른쪽' : '왼쪽';
}

export function wallsOf(polygon: Pt[]): Wall[] {
  return polygon.map((from, i) => {
    const to = polygon[(i + 1) % polygon.length];
    return { index: i, from, to, lengthM: round3(Math.hypot(to.x - from.x, to.z - from.z)), side: sideOf(from, to) };
  });
}

const valid = (v: number) => Number.isFinite(v);

/** 방 모양(크기)만 확인 — 미리보기를 그릴 수 있는지 */
export function validateRoomShape(
  input: Pick<ManualRoomInput, 'shape' | 'widthM' | 'depthM' | 'notchWidthM' | 'notchDepthM'>,
): string | null {
  if (!valid(input.widthM) || !valid(input.depthM) || input.widthM < 0.5 || input.depthM < 0.5) {
    return '가로·세로는 0.5m 이상으로 입력해 주세요.';
  }
  if (input.widthM > 30 || input.depthM > 30) return '가로·세로는 30m 이하로 입력해 주세요.';
  if (input.shape === 'L') {
    const { notchWidthM: cw, notchDepthM: cd } = input;
    if (!valid(cw) || !valid(cd) || cw < 0.2 || cd < 0.2) return 'ㄱ자로 빠진 부분은 0.2m 이상으로 입력해 주세요.';
    if (cw > input.widthM - 0.3 || cd > input.depthM - 0.3) return 'ㄱ자로 빠진 부분은 전체 가로·세로보다 0.3m 이상 작아야 해요.';
  }
  return null;
}

/** 입력 확인 — 문제가 있으면 안내 문장, 없으면 null (서버 검사 전에 먼저 막는다) */
export function validateManualRoom(input: ManualRoomInput): string | null {
  if (!input.name.trim()) return '방 이름을 입력해 주세요.';
  const shapeError = validateRoomShape(input);
  if (shapeError) return shapeError;
  if (input.windows.length === 0) return '창문을 하나 이상 추가해 주세요.';
  const walls = wallsOf(roomPolygon(input));
  for (const [i, w] of input.windows.entries()) {
    const wall = walls[w.wallIndex];
    const label = `창문 ${i + 1}`;
    if (!wall) return `${label}의 벽을 다시 골라 주세요.`;
    if (![w.offsetM, w.widthM, w.sillM, w.heightM].every(valid)) return `${label}의 숫자를 모두 입력해 주세요.`;
    if (w.widthM < 0.2 || w.heightM < 0.2) return `${label}의 폭·높이는 0.2m 이상이어야 해요.`;
    if (w.offsetM < 0 || w.sillM < 0) return `${label}의 거리·높이는 0 이상이어야 해요.`;
    if (w.offsetM + w.widthM > wall.lengthM + 1e-6) {
      return `${label}이 벽(${wall.lengthM}m) 밖으로 나가요. 왼쪽 끝 거리 + 폭이 벽 길이 이하여야 해요.`;
    }
    if (w.sillM + w.heightM > 5) return `${label}의 위 끝이 바닥에서 5m를 넘어요.`;
  }
  return null;
}

const corner = (x: number, y: number, z: number, orderIndex: number): ApiCorner => ({
  x: round3(x),
  y: round3(y),
  z: round3(z),
  orderIndex,
});

/** 창문 꼭짓점 — 방 안에서 볼 때 0 좌하, 1 우하, 2 우상, 3 좌상 */
export function windowCorners(wall: Wall, w: ManualWindowInput): ApiCorner[] {
  const ux = (wall.to.x - wall.from.x) / wall.lengthM;
  const uz = (wall.to.z - wall.from.z) / wall.lengthM;
  const left = { x: wall.from.x + ux * w.offsetM, z: wall.from.z + uz * w.offsetM };
  const right = { x: left.x + ux * w.widthM, z: left.z + uz * w.widthM };
  const bottom = w.sillM;
  const top = w.sillM + w.heightM;
  return [
    corner(left.x, bottom, left.z, 0),
    corner(right.x, bottom, right.z, 1),
    corner(right.x, top, right.z, 2),
    corner(left.x, top, left.z, 3),
  ];
}

export function toApiRoom(input: ManualRoomInput): { room: ApiRoomInput; windows: ApiWindowInput[] } {
  const polygon = roomPolygon(input);
  const walls = wallsOf(polygon);
  return {
    room: { name: input.name.trim(), corners: polygon.map((p, i) => corner(p.x, 0, p.z, i)) },
    windows: input.windows.map((w, i) => ({ name: `창문 ${i + 1}`, corners: windowCorners(walls[w.wallIndex], w) })),
  };
}
