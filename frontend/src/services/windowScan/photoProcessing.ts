import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { CapturedPhoto } from './scanController';

/**
 * 스캔 사진 후처리 — 업로드 규격(긴 변 1280px, JPEG, portrait)에 맞춰 축소한다.
 * 촬영 중에는 카메라가 바쁘므로 스캔이 끝난 뒤(finishing 단계)에 한 장씩 처리한다.
 */

export const UPLOAD_LONG_SIDE_PX = 1280;
const JPEG_COMPRESS = 0.8;

export async function resizeForUpload(photo: CapturedPhoto): Promise<CapturedPhoto> {
  // 카메라 시뮬레이션(이미지 없음)이거나 이미 충분히 작으면 그대로
  if (!photo.uri || Math.max(photo.width, photo.height) <= UPLOAD_LONG_SIDE_PX) return photo;

  const size = photo.height >= photo.width ? { height: UPLOAD_LONG_SIDE_PX } : { width: UPLOAD_LONG_SIDE_PX };
  const rendered = await ImageManipulator.manipulate(photo.uri).resize(size).renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_COMPRESS, format: SaveFormat.JPEG });
  // 화각 계산은 축소 전 EXIF(초점거리)로 하므로 exif는 원본 것을 유지한다
  return { uri: saved.uri, width: saved.width, height: saved.height, exif: photo.exif };
}
