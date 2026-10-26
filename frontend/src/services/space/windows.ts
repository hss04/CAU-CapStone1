import { FACING_AZIMUTH, FACING_KO } from '@/constants/labels';
import type { Room, RoomWindow, WallSide } from '@/types';

const WALL_KO: Record<WallSide, string> = {
  top: '위쪽 벽',
  right: '오른쪽 벽',
  bottom: '아래쪽 벽',
  left: '왼쪽 벽',
};

/** '남쪽 창문', '동쪽 창문' — 방향을 모르는 서버 창문은 서버 이름 그대로 ('창문 1') */
export function windowName(w: RoomWindow): string {
  if (w.facingUnknown) return w.label ?? '창문';
  return `${FACING_KO[w.facing]}쪽 창문`;
}

/** 'S', 'SE' 같은 짧은 방향 표시 (모르면 '방향 미측정') */
export function windowFacingLabel(w: RoomWindow): string {
  return w.facingUnknown ? '방향 미측정' : w.facing;
}

export function windowWidthM(room: Room, w: RoomWindow): number {
  return Math.round(w.length * room.cellSizeM * 10) / 10;
}

export function windowWallLabel(w: RoomWindow): string {
  // 다각형 방 창문은 위/아래/좌/우 벽으로 나눌 수 없다
  return w.segment ? '측정한 벽' : WALL_KO[w.wall];
}

/** 창문 정면 방위각 — 180° 스캔이면 대략 (정면 - 90°) ~ (정면 + 90°)를 보게 된다. 모르면 null */
export function windowFacingAzimuth(w: RoomWindow): number | null {
  return w.facingUnknown ? null : FACING_AZIMUTH[w.facing];
}

export function findWindow(room: Room, windowId: string | undefined): RoomWindow | undefined {
  return room.windows.find((w) => w.id === windowId);
}
