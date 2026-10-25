import { useCallback, useEffect, useRef, useState } from 'react';

import { createRoomScanner } from '@/services/scan';
import type { RoomScanner, ScanDetections, ScanResult, ScanStage, ScanStatus } from '@/types';

interface UseRoomScanOptions {
  autoStart?: boolean;
  onComplete?: (result: ScanResult) => void;
}

/**
 * 스캔 UI ↔ 스캔 로직 연결 훅.
 * 화면은 이 훅이 주는 상태만 그리며, 실제 스캔 방식은 createRoomScanner()가 결정한다.
 */
export function useRoomScan({ autoStart = true, onComplete }: UseRoomScanOptions = {}) {
  const scannerRef = useRef<RoomScanner | null>(null);
  const onCompleteRef = useRef(onComplete);
  const [status, setStatus] = useState<ScanStatus>(autoStart ? 'scanning' : 'idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<ScanStage>('idle');
  const [detected, setDetected] = useState<ScanDetections>({ walls: 0, windows: 0, objects: 0 });
  const [result, setResult] = useState<ScanResult | null>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  /** 스캐너 실행 — 상태 갱신은 모두 스캐너 이벤트 콜백에서만 일어난다 */
  const run = useCallback(() => {
    const scanner = scannerRef.current ?? createRoomScanner();
    scannerRef.current = scanner;
    scanner.start({
      onProgress: (e) => {
        setProgress(e.progress);
        setStage(e.stage);
        setDetected(e.detected);
      },
      onComplete: (r) => {
        setStatus('complete');
        setResult(r);
        onCompleteRef.current?.(r);
      },
      onError: () => setStatus('error'),
    });
  }, []);

  /** 다시 스캔하기 등 사용자 액션에서 호출 */
  const start = useCallback(() => {
    setStatus('scanning');
    setResult(null);
    run();
  }, [run]);

  const pause = useCallback(() => {
    scannerRef.current?.pause();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    scannerRef.current?.resume();
    setStatus('scanning');
  }, []);

  const finishNow = useCallback(() => {
    scannerRef.current?.finishNow();
  }, []);

  useEffect(() => {
    if (autoStart) run();
    return () => scannerRef.current?.cancel();
  }, [autoStart, run]);

  return { status, progress, stage, detected, result, start, pause, resume, finishNow };
}
