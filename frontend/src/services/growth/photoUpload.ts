import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

/**
 * 성장 사진 업로드 본문 (POST /plants/{id}/growth-photos, multipart).
 * 서버도 긴 변 2048px JPEG로 다시 저장하므로, 보내기 전에 같은 크기로 줄여 업로드 시간을 줄인다.
 * 다시 인코딩하면 EXIF(위치 등)가 빠지고 회전이 픽셀에 반영된다.
 */

const MAX_SIDE = 2048;

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** 'YYYY-MM-DD' → 촬영 시각 (오늘이면 지금, 지난 날이면 그날 정오, 한국 시간) */
export function takenAtFor(date: string, today: string): string {
  if (date === today) {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    return `${kst.toISOString().slice(0, 19)}+09:00`;
  }
  return `${date}T12:00:00+09:00`;
}

export async function buildGrowthPhotoForm(photo: PickedPhoto, takenAt: string, note: string): Promise<FormData> {
  let context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > MAX_SIDE) {
    context = photo.width >= photo.height ? context.resize({ width: MAX_SIDE }) : context.resize({ height: MAX_SIDE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG, base64: Platform.OS !== 'web' });

  const form = new FormData();
  const name = `growth-${Date.now()}.jpg`;
  if (Platform.OS === 'web') {
    const blob = await (await fetch(saved.uri)).blob();
    form.append('file', blob, name);
  } else {
    if (!saved.base64) throw new Error('사진을 읽지 못했어요. 다시 골라 주세요.');
    // SDK 58 expo/fetch는 RN식 { uri } 첨부 대신 bytes()가 있는 파트를 받는다 (창밖 스캔 업로드와 같은 방식)
    const bytes = base64ToBytes(saved.base64);
    form.append('file', { name, type: 'image/jpeg', bytes: async () => bytes } as unknown as Blob);
  }
  form.append('taken_at', takenAt);
  if (note.trim()) form.append('note', note.trim());
  return form;
}
