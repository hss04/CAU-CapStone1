import { FACING_AZIMUTH, FACING_KO } from '@/constants/labels';
import type { Room, RoomWindow, WallSide } from '@/types';

const WALL_KO: Record<WallSide, string> = {
  top: '위쪽 벽',
  right: '오른쪽 벽',
  bottom: '아래쪽 벽',
  left: '왼쪽 벽',
};

/** '남쪽 창문', '동쪽 창문' */
export function windowName(w: RoomWindow): string {
  return `${FACING_KO[w.facing]}쪽 창문`;
}

export function windowWidthM(room: Room, w: RoomWindow): number {
  return Math.round(w.length * room.cellSizeM * 10) / 10;
}

export function windowWallLabel(w: RoomWindow): string {
  return WALL_KO[w.wall];
}

/** 창문 정면 방위각 — 180° 스캔이면 대략 (정면 - 90°) ~ (정면 + 90°)를 보게 된다 */
export function windowFacingAzimuth(w: RoomWindow): number {
  return FACING_AZIMUTH[w.facing];
}

export function findWindow(room: Room, windowId: string | undefined): RoomWindow | undefined {
  return room.windows.find((w) => w.id === windowId);
}
