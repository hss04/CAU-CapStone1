import type { Room } from './room';

export type ScanStage = 'idle' | 'walls' | 'windows' | 'objects' | 'light' | 'complete';

export type ScanStatus = 'idle' | 'scanning' | 'paused' | 'complete' | 'error';

export interface ScanDetections {
  walls: number;
  windows: number;
  objects: number;
}

export interface ScanProgressEvent {
  /** 0 ~ 100 */
  progress: number;
  stage: ScanStage;
  detected: ScanDetections;
}

export interface ScanResult {
  room: Room;
  windowCount: number;
  objectCount: number;
  roomCount: number;
  areaM2: number;
  durationSec: number;
}

export interface ScanHandlers {
  onProgress: (event: ScanProgressEvent) => void;
  onComplete: (result: ScanResult) => void;
  onError?: (error: Error) => void;
}

/**
 * 스캔 엔진 인터페이스.
 * 현재는 MockRoomScanner가 구현하고 있으며,
 * 백엔드/네이티브 스캔이 준비되면 같은 인터페이스로 구현체만 교체하면 된다.
 */
export interface RoomScanner {
  start(handlers: ScanHandlers): void;
  pause(): void;
  resume(): void;
  /** 개발/시연용: 즉시 완료 처리 */
  finishNow(): void;
  cancel(): void;
}
