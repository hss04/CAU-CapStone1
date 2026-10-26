import type { CameraCapturedPicture, CameraView } from 'expo-camera';
import { useCallback, useRef, useState } from 'react';

import type { CapturedPhoto, PhotoShot } from '@/services/windowScan/scanController';

const SAVE_TIMEOUT_MS = 10000;

/**
 * 스캔용 카메라 촬영 훅 (카메라 로직만 담당).
 * onPictureSaved를 사용해 셔터 직후 바로 다음 촬영이 가능하게 하고,
 * 파일 저장(URI)은 별도 Promise로 기다린다.
 */
export function useScanCamera() {
  const cameraRef = useRef<CameraView>(null);
  const [isReady, setReady] = useState(false);

  const onCameraReady = useCallback(() => setReady(true), []);

  const shoot = useCallback((): PhotoShot | null => {
    const camera = cameraRef.current;
    if (!camera || !isReady) return null;

    let settle: ((photo: CapturedPhoto) => void) | null = null;
    let fail: ((e: unknown) => void) | null = null;
    const photo = new Promise<CapturedPhoto>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const timeout = setTimeout(() => fail?.(new Error('picture save timeout')), SAVE_TIMEOUT_MS);
    const done = (picture: CameraCapturedPicture) => {
      clearTimeout(timeout);
      settle?.({
        uri: picture.uri,
        width: picture.width,
        height: picture.height,
        // 화각 계산에 쓸 초점거리(35mm 환산)를 얻기 위해 EXIF를 함께 받는다
        exif: picture.exif && typeof picture.exif === 'object' ? picture.exif : undefined,
      });
    };

    const captured = camera
      .takePictureAsync({
        quality: 0.5,
        exif: true,
        shutterSound: false,
        onPictureSaved: done,
      })
      .then((picture) => {
        // onPictureSaved를 지원하지 않는 환경에서는 결과가 바로 온다
        if (picture?.uri) done(picture);
      })
      .catch((e) => {
        clearTimeout(timeout);
        fail?.(e);
        throw e;
      });

    return { captured, photo };
  }, [isReady]);

  return { cameraRef, isReady, onCameraReady, shoot };
}

/** 카메라 없이 흐름만 확인하는 개발용 셔터 (이미지 URI는 비어 있음) */
export const mockShooter = (): PhotoShot => ({
  captured: new Promise((resolve) => setTimeout(resolve, 60)),
  photo: Promise.resolve({ uri: '', width: 0, height: 0 }),
});
