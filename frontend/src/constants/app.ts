/** 앱 전역 상수 — 서비스명이 확정되면 여기만 바꾸면 된다. */
export const APP_NAME = '초록자리';
export const APP_NAME_EN = 'Chorok Jari';
export const APP_TAGLINE = '내 방을 분석해 식물에게 가장 좋은 자리를 찾아드려요';
export const APP_VERSION = '1.0.0 (capstone demo)';

/**
 * 개발 확인용 화면(창밖 스캔 Debug Result 등) 노출 여부.
 * Expo Go / 개발 빌드에서는 true, 배포 빌드에서는 false.
 * 배포 빌드에서도 보고 싶다면 EXPO_PUBLIC_DEV_TOOLS=1 로 빌드한다.
 */
export const DEV_TOOLS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';
