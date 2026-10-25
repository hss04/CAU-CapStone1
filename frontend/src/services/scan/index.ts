import type { RoomScanner, ScanResult } from '@/types';

import { MockRoomScanner } from './mockRoomScanner';

/**
 * 스캐너 팩토리 — UI는 이 함수만 알고 있다.
 * 백엔드 스캔 기능이 준비되면 여기서 실제 구현체를 반환하도록 바꾸기만 하면 된다.
 *
 * 예) return new ApiRoomScanner({ endpoint: '/api/rooms/scan' });
 */
export function createRoomScanner(): RoomScanner {
  return new MockRoomScanner({ durationMs: 9000 });
}

/** 스캔 완료 화면으로 결과를 넘기기 위한 임시 저장소 (라우트 파라미터로 큰 객체를 넘기지 않기 위함) */
let lastResult: ScanResult | null = null;

export function setLastScanResult(result: ScanResult | null) {
  lastResult = result;
}

export function getLastScanResult(): ScanResult | null {
  return lastResult;
}

export const SCAN_STAGE_MESSAGE = {
  idle: '스캔을 준비하고 있어요.',
  walls: '벽과 모서리를 찾고 있어요.',
  windows: '창문 위치를 확인하고 있어요.',
  objects: '공간을 확인하고 있어요.',
  light: '빛이 들어오는 방향을 분석하고 있어요.',
  complete: '스캔이 완료됐어요!',
} as const;
