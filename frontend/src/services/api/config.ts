import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 백엔드 서버 주소.
 *
 * 1. EXPO_PUBLIC_API_URL 이 있으면 그 값 (예: EXPO_PUBLIC_API_URL=http://192.168.0.10:8000)
 * 2. 웹: 지금 페이지를 연 호스트의 8000 포트
 * 3. Expo Go / 개발 빌드: Metro를 띄운 PC 주소(hostUri)의 8000 포트 — 같은 Wi-Fi면 따로 설정할 필요 없음
 * 4. 그 외: Android 에뮬레이터에서 PC를 가리키는 10.0.2.2
 */

export const API_PORT = 8000;

function webBaseUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:${API_PORT}`;
}

function devHostBaseUrl(): string | null {
  // 예: "192.168.0.10:8081"
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:${API_PORT}` : null;
}

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (Platform.OS === 'web') return webBaseUrl();
  return devHostBaseUrl() ?? `http://10.0.2.2:${API_PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();
export const API_PREFIX = '/api/v1';

/** 요청 제한 시간 */
export const API_TIMEOUT_MS = 15000;
