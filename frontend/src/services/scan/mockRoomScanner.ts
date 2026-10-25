import { MOCK_ROOM } from '@/data/mockRoom';
import type {
  Room,
  RoomScanner,
  ScanDetections,
  ScanHandlers,
  ScanProgressEvent,
  ScanStage,
} from '@/types';

interface MockScannerOptions {
  /** 0 → 100% 까지 걸리는 시간 */
  durationMs?: number;
  tickMs?: number;
  resultRoom?: Room;
}

function stageFor(progress: number): ScanStage {
  if (progress >= 100) return 'complete';
  if (progress < 22) return 'walls';
  if (progress < 45) return 'windows';
  if (progress < 78) return 'objects';
  return 'light';
}

function detectionsFor(progress: number, room: Room): ScanDetections {
  return {
    walls: Math.min(4, Math.floor(progress / 5.5)),
    windows: Math.min(room.windows.length, progress >= 40 ? 2 : progress >= 28 ? 1 : 0),
    objects: Math.min(room.furniture.length, Math.max(0, Math.floor((progress - 46) / 6))),
  };
}

/**
 * 시연용 Mock 스캐너.
 * 실제 스캔(카메라/LiDAR/백엔드 분석)이 준비되면 RoomScanner 인터페이스를 구현한 클래스로 교체한다.
 */
export class MockRoomScanner implements RoomScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private progress = 0;
  private paused = false;
  private startedAt = 0;
  private handlers: ScanHandlers | null = null;
  private readonly durationMs: number;
  private readonly tickMs: number;
  private readonly room: Room;

  constructor(options: MockScannerOptions = {}) {
    this.durationMs = options.durationMs ?? 9000;
    this.tickMs = options.tickMs ?? 100;
    this.room = options.resultRoom ?? MOCK_ROOM;
  }

  start(handlers: ScanHandlers) {
    this.cancel();
    this.handlers = handlers;
    this.progress = 0;
    this.paused = false;
    this.startedAt = Date.now();
    // 첫 이벤트도 비동기로 보낸다 (실제 스캐너처럼 start()는 즉시 반환)
    this.timer = setInterval(this.tick, this.tickMs);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  finishNow() {
    this.progress = 100;
    this.emit();
    this.complete();
  }

  cancel() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick = () => {
    if (this.paused) return;
    const base = (100 / this.durationMs) * this.tickMs;
    // 실제 스캔처럼 구간마다 속도가 조금씩 달라지게
    const jitter = 0.55 + Math.random() * 0.9;
    const slowDown = this.progress > 60 && this.progress < 70 ? 0.6 : 1;
    this.progress = Math.min(100, this.progress + base * jitter * slowDown);
    this.emit();
    if (this.progress >= 100) this.complete();
  };

  private emit() {
    const event: ScanProgressEvent = {
      progress: Math.floor(this.progress),
      stage: stageFor(this.progress),
      detected: detectionsFor(this.progress, this.room),
    };
    this.handlers?.onProgress(event);
  }

  private complete() {
    this.cancel();
    const room: Room = { ...this.room, scannedAt: new Date().toISOString() };
    this.handlers?.onComplete({
      room,
      windowCount: room.windows.length,
      objectCount: room.furniture.length,
      roomCount: 1,
      areaM2: Math.round(room.cols * room.rows * room.cellSizeM * room.cellSizeM * 10) / 10,
      durationSec: Math.max(1, Math.round((Date.now() - this.startedAt) / 1000)),
    });
  }
}
