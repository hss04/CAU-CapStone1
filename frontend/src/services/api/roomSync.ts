import { FACING_KO } from '@/constants/labels';
import type { CompassDirection, GridPosition, Room, RoomWindow } from '@/types';
import type { ApiCorner, ApiGrid, ApiPosition, ApiRoom, ApiWindow } from '@/types/api';

/**
 * 서버 방(ARCore 측정, m 단위) → 앱 Room(grid 셀 단위).
 *
 * 서버 좌표계는 첫 모서리가 원점이고 AR 수평축을 회전하지 않는다(음수 x, z 가능, 벽이 기울어져 있을 수 있음).
 * 격자는 서버 grid_v2를 그대로 쓴다: 원점 = 방 x, z 최솟값, col = +x, row = +z, 한 칸 cellSizeM.
 *   grid x = (x − origin.x) / cellSizeM,  grid y = (z − origin.z) / cellSizeM
 * 위에서 내려다볼 때 오른손 좌표계(y 위)라 +x가 화면 오른쪽이면 +z는 화면 아래쪽이 된다 (좌우 반전 없음).
 */

const COMPASS: CompassDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const RAD = 180 / Math.PI;

export function compassOf(azimuthDeg: number): CompassDirection {
  const a = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS[Math.round(a / 45) % 8];
}

function byOrder(corners: ApiCorner[]) {
  return [...corners].sort((a, b) => a.orderIndex - b.orderIndex);
}

function toGridPoint(x: number, z: number, grid: ApiGrid) {
  return { x: (x - grid.origin.x) / grid.cellSizeM, y: (z - grid.origin.z) / grid.cellSizeM };
}

/**
 * 창문 바깥 법선의 방위각 (진북 기준).
 * 규격: 바깥 법선 = (V3 − V0) × (V1 − V0). 방위각 az인 수평 방향은 방 좌표에서
 * (x, z) = (cos(az − X축방위), sin(az − X축방위)) 이므로 az = X축방위 + atan2(n_z, n_x).
 */
export function windowOutwardAzimuth(corners: ApiCorner[], xAxisAzimuthDeg: number): number {
  const { nx, nz } = outwardHorizontal(corners);
  return (((xAxisAzimuthDeg + Math.atan2(nz, nx) * RAD) % 360) + 360) % 360;
}

function outwardHorizontal(corners: ApiCorner[]) {
  const [v0, v1, , v3] = byOrder(corners);
  const a = { x: v3.x - v0.x, y: v3.y - v0.y, z: v3.z - v0.z };
  const b = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
  // (a × b)의 x, z 성분만
  const nx = a.y * b.z - a.z * b.y;
  const nz = a.x * b.y - a.y * b.x;
  const len = Math.hypot(nx, nz) || 1;
  return { nx: nx / len, nz: nz / len };
}

function windowFromServer(w: ApiWindow, grid: ApiGrid, xAxisAzimuthDeg: number | null): RoomWindow {
  const [v0, v1] = byOrder(w.corners);
  const p1 = toGridPoint(v0.x, v0.z, grid);
  const p2 = toGridPoint(v1.x, v1.z, grid);
  const { nx, nz } = outwardHorizontal(w.corners);
  const facing = xAxisAzimuthDeg === null ? null : compassOf(windowOutwardAzimuth(w.corners, xAxisAzimuthDeg));
  return {
    id: `server-window-${w.id}`,
    serverId: w.id,
    label: w.name,
    // segment 창문은 wall/offset을 쓰지 않는다 (WallOpening 호환용 값)
    wall: 'top',
    offset: 0,
    length: Math.hypot(p2.x - p1.x, p2.y - p1.y),
    segment: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
    inward: { x: -nx, y: -nz },
    facing: facing ?? 'S',
    facingUnknown: facing === null ? true : undefined,
  };
}

export function roomFromServer(api: ApiRoom, windows: ApiWindow[], grid: ApiGrid): Room {
  const roomWindows = windows.map((w) => windowFromServer(w, grid, api.xAxisAzimuthDeg));
  // 방 대표 방향 = 가장 넓은 창문이 바라보는 방향
  const main = [...roomWindows].sort((a, b) => b.length - a.length)[0];
  const known = main && !main.facingUnknown;

  return {
    id: `server-room-${api.id}`,
    name: api.name,
    orientation: known ? main.facing : 'S',
    orientationLabel: known ? `${FACING_KO[main.facing]}향` : '방향 미측정',
    orientationUnknown: known ? undefined : true,
    cols: grid.cols,
    rows: grid.rows,
    cellSizeM: grid.cellSizeM,
    windows: roomWindows,
    doors: [],
    furniture: [],
    spots: [],
    outline: byOrder(api.corners).map((c) => toGridPoint(c.x, c.z, grid)),
    insideMask: grid.insideMask,
    server: {
      roomId: api.id,
      geometryVersion: grid.geometryVersion,
      originX: grid.origin.x,
      originZ: grid.origin.z,
      xAxisAzimuthDeg: api.xAxisAzimuthDeg,
    },
    location:
      api.latitude !== null && api.longitude !== null
        ? { latitude: api.latitude, longitude: api.longitude, label: api.locationName ?? undefined }
        : undefined,
  };
}

/** 서버 실좌표(m) → 셀. 경계값은 마지막 행/열로 맞춘다 (backend DATA_CONTRACT 4장) */
export function realToCell(room: Room, pos: ApiPosition): GridPosition | null {
  const ref = room.server;
  if (!ref) return null;
  const col = Math.floor((pos.x - ref.originX) / room.cellSizeM);
  const row = Math.floor((pos.z - ref.originZ) / room.cellSizeM);
  return {
    x: Math.min(Math.max(col, 0), room.cols - 1),
    y: Math.min(Math.max(row, 0), room.rows - 1),
  };
}

/** 배치 불가 칸 → 추천 요청 형식 blocked_cells [[row, col], ...] (row = grid y, col = grid x) */
export function blockedCellsForServer(room: Room): [number, number][] {
  return (room.blockedCells ?? []).map((c) => [c.y, c.x]);
}

/** 셀 중심 → 서버 실좌표(m, 소수 3자리). 1차는 식물 높이를 고려하지 않아 y = 0 */
export function cellToReal(room: Room, pos: GridPosition): ApiPosition | null {
  const ref = room.server;
  if (!ref) return null;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    x: round3(ref.originX + (pos.x + 0.5) * room.cellSizeM),
    y: 0,
    z: round3(ref.originZ + (pos.y + 0.5) * room.cellSizeM),
  };
}
