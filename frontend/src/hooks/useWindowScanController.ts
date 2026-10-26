import { useEffect, useRef, useState } from 'react';

import { createHeadingSource } from '@/services/orientation/headingSource';
import { resizeForUpload } from '@/services/windowScan/photoProcessing';
import {
  WindowScanController,
  type FacingResult,
  type PhotoShooter,
  type ScanControllerState,
} from '@/services/windowScan/scanController';
import type { HeadingSourceKind, WindowScan } from '@/types';

const INITIAL: ScanControllerState = {
  phase: 'waitingSensor',
  sample: null,
  tracker: null,
  hint: null,
  marks: [],
  captureCount: 0,
  lastCaptureAt: null,
  facing: null,
};

/**
 * WindowScanController ↔ React 연결.
 * sourceKind가 정해지면(센서/시뮬레이션) 컨트롤러를 만들고 센서 구독을 시작한다.
 */
export function useWindowScanController({
  windowId,
  sourceKind,
  shooter,
  onComplete,
}: {
  windowId: string;
  sourceKind: HeadingSourceKind | null;
  shooter: PhotoShooter;
  onComplete: (scan: WindowScan) => void;
}) {
  const [state, setState] = useState<ScanControllerState>(INITIAL);
  const controllerRef = useRef<WindowScanController | null>(null);
  const shooterRef = useRef(shooter);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    shooterRef.current = shooter;
    controllerRef.current?.setShooter(shooter);
  }, [shooter]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!sourceKind) return;
    const controller = new WindowScanController({
      windowId,
      source: createHeadingSource(sourceKind),
      shooter: (...args) => shooterRef.current(...args),
      processPhoto: resizeForUpload,
      onChange: setState,
      onComplete: (scan) => onCompleteRef.current(scan),
    });
    controllerRef.current = controller;
    controller.begin();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [windowId, sourceKind]);

  return {
    state,
    recordFacing: (): FacingResult => controllerRef.current?.recordFacing() ?? 'notReady',
    startScan: () => controllerRef.current?.startScan(),
  };
}
