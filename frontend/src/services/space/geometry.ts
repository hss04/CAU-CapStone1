import type { Furniture, GridPosition, GridSegment, Room, RoomWindow, WallOpening } from '@/types';

/** 벽 개구부를 grid 좌표계의 선분으로 변환 (다각형 방 창문은 segment를 그대로 쓴다) */
export function openingSegment(room: Room, o: WallOpening & { segment?: GridSegment }): GridSegment {
  if (o.segment) return o.segment;
  switch (o.wall) {
    case 'top':
      return { x1: o.offset, y1: 0, x2: o.offset + o.length, y2: 0 };
    case 'bottom':
      return { x1: o.offset, y1: room.rows, x2: o.offset + o.length, y2: room.rows };
    case 'left':
      return { x1: 0, y1: o.offset, x2: 0, y2: o.offset + o.length };
    case 'right':
      return { x1: room.cols, y1: o.offset, x2: room.cols, y2: o.offset + o.length };
  }
}

/** 셀 중심에서 창문 선분까지의 거리 (셀 단위) */
export function distanceToWindow(room: Room, w: RoomWindow, pos: GridPosition): number {
  const cx = pos.x + 0.5;
  const cy = pos.y + 0.5;
  const s = openingSegment(room, w);
  const px = Math.min(Math.max(cx, Math.min(s.x1, s.x2)), Math.max(s.x1, s.x2));
  const py = Math.min(Math.max(cy, Math.min(s.y1, s.y2)), Math.max(s.y1, s.y2));
  return Math.hypot(cx - px, cy - py);
}

export function nearestWindowDistance(room: Room, pos: GridPosition): number {
  if (room.windows.length === 0) return Infinity;
  return Math.min(...room.windows.map((w) => distanceToWindow(room, w, pos)));
}

export function furnitureAt(room: Room, pos: GridPosition): Furniture | undefined {
  return room.furniture.find(
    (f) => pos.x >= f.x && pos.x < f.x + f.w && pos.y >= f.y && pos.y < f.y + f.h,
  );
}

export function isAdjacentTo(f: Furniture, pos: GridPosition): boolean {
  const inside = pos.x >= f.x && pos.x < f.x + f.w && pos.y >= f.y && pos.y < f.y + f.h;
  if (inside) return false;
  const dx = Math.max(f.x - pos.x, 0, pos.x - (f.x + f.w - 1));
  const dy = Math.max(f.y - pos.y, 0, pos.y - (f.y + f.h - 1));
  return dx <= 1 && dy <= 1 && dx + dy <= 1;
}

/** 문이 열리는 영역(문 폭 x 문 폭 정사각형) 안의 셀인지 */
export function isInDoorSwing(room: Room, pos: GridPosition): boolean {
  return room.doors.some((d) => {
    const inSpan = (v: number) => v >= d.offset && v < d.offset + d.length;
    switch (d.wall) {
      case 'top':
        return inSpan(pos.x) && pos.y < d.length;
      case 'bottom':
        return inSpan(pos.x) && pos.y >= room.rows - d.length;
      case 'left':
        return inSpan(pos.y) && pos.x < d.length;
      case 'right':
        return inSpan(pos.y) && pos.x >= room.cols - d.length;
    }
  });
}

function distanceToDoor(room: Room, pos: GridPosition): number {
  if (room.doors.length === 0) return Infinity;
  return Math.min(
    ...room.doors.map((d) => {
      const s = openingSegment(room, d);
      const cx = pos.x + 0.5;
      const cy = pos.y + 0.5;
      const px = Math.min(Math.max(cx, Math.min(s.x1, s.x2)), Math.max(s.x1, s.x2));
      const py = Math.min(Math.max(cy, Math.min(s.y1, s.y2)), Math.max(s.y1, s.y2));
      return Math.hypot(cx - px, cy - py);
    }),
  );
}

export function touchesWallOrFurniture(room: Room, pos: GridPosition): boolean {
  if (room.insideMask) {
    // 다각형 방: 벽은 격자 테두리가 아니라 방 밖 칸과 맞닿은 곳
    const neighbors = [
      { x: pos.x - 1, y: pos.y },
      { x: pos.x + 1, y: pos.y },
      { x: pos.x, y: pos.y - 1 },
      { x: pos.x, y: pos.y + 1 },
    ];
    if (neighbors.some((n) => !isInsideRoom(room, n))) return true;
  } else if (pos.x === 0 || pos.y === 0 || pos.x === room.cols - 1 || pos.y === room.rows - 1) {
    return true;
  }
  return room.furniture.some((f) => isAdjacentTo(f, pos));
}

/** 방 크기 표시 — 직사각형은 "4.0 × 5.0m", 다각형 방은 가로×세로가 의미 없어 면적 "12.0m²" */
export function roomSizeLabel(room: Room): string {
  if (room.outline && room.outline.length >= 3) {
    const pts = room.outline;
    let twice = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      twice += a.x * b.y - b.x * a.y;
    }
    const areaM2 = (Math.abs(twice) / 2) * room.cellSizeM * room.cellSizeM;
    return `${areaM2.toFixed(1)}m²`;
  }
  return `${(room.cols * room.cellSizeM).toFixed(1)} × ${(room.rows * room.cellSizeM).toFixed(1)}m`;
}

export function isInsideRoom(room: Room, pos: GridPosition): boolean {
  if (!(pos.x >= 0 && pos.y >= 0 && pos.x < room.cols && pos.y < room.rows)) return false;
  // 다각형 방: 셀 중심이 방 밖인 칸(grid_v2 inside_mask = false)은 방 밖
  return room.insideMask ? !!room.insideMask[pos.y]?.[pos.x] : true;
}

/** 사용자가 배치 불가로 지정한 칸 */
export function isBlocked(room: Room, pos: GridPosition): boolean {
  return !!room.blockedCells?.some((c) => c.x === pos.x && c.y === pos.y);
}

/** 식물을 둘 수 있는 셀인지 (바닥 또는 surface 가구 위, 배치 불가 칸 제외) */
export function isPlaceable(room: Room, pos: GridPosition): boolean {
  if (!isInsideRoom(room, pos)) return false;
  if (isBlocked(room, pos)) return false;
  if (isInDoorSwing(room, pos)) return false;
  const f = furnitureAt(room, pos);
  return !f || !!f.surface;
}

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

/** 셀 위치를 사람이 이해하기 쉬운 이름으로. 거리 기준은 m (칸 크기가 방마다 달라서) */
export function describePosition(room: Room, pos: GridPosition): string {
  const on = furnitureAt(room, pos);
  if (on) return on.surface ? `${on.label} 위` : `${on.label} 자리`;

  const windowDistM = nearestWindowDistance(room, pos) * room.cellSizeM;
  if (windowDistM <= 0.45) return '창가';

  const adjacent = room.furniture.find((f) => f.type !== 'chair' && isAdjacentTo(f, pos));
  if (adjacent) return `${adjacent.label} 옆`;

  if (windowDistM <= 1.44) return '창문 근처';
  if (distanceToDoor(room, pos) * room.cellSizeM <= 1.17) return '방 입구';
  return '방 가운데';
}
