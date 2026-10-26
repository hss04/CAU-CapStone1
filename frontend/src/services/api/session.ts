import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * 로그인 토큰 저장소.
 * 네이티브는 SecureStore(키체인/키스토어), 웹은 SecureStore가 없어서 localStorage를 쓴다.
 * 백엔드 토큰은 기본 60분 뒤 만료되며 refresh token이 없으므로, 만료되면 다시 로그인한다.
 */

const STORAGE_KEY = 'auth.session';
/** 만료 직전 요청이 실패하지 않도록 조금 일찍 만료로 본다 */
const EXPIRY_MARGIN_MS = 30 * 1000;

export interface Session {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

let current: Session | null = null;

async function readStored(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(STORAGE_KEY).catch(() => null);
}

async function writeStored(value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
      else globalThis.localStorage?.setItem(STORAGE_KEY, value);
    } catch {
      // 저장소를 못 쓰면(시크릿 창 등) 메모리에만 유지
    }
    return;
  }
  await (value === null ? SecureStore.deleteItemAsync(STORAGE_KEY) : SecureStore.setItemAsync(STORAGE_KEY, value)).catch(() => {});
}

function isValid(session: Session | null): session is Session {
  return !!session && session.expiresAt - EXPIRY_MARGIN_MS > Date.now();
}

/** 앱 시작 시 저장된 토큰 복원 (만료됐으면 지운다) */
export async function restoreSession(): Promise<Session | null> {
  const raw = await readStored();
  let session: Session | null = null;
  try {
    session = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    session = null;
  }
  if (!isValid(session)) {
    await clearSession();
    return null;
  }
  current = session;
  return session;
}

export async function saveSession(accessToken: string, expiresInSec: number): Promise<void> {
  current = { accessToken, expiresAt: Date.now() + expiresInSec * 1000 };
  await writeStored(JSON.stringify(current));
}

export async function clearSession(): Promise<void> {
  current = null;
  await writeStored(null);
}

/** 유효한 토큰이 없으면 null */
export function getAccessToken(): string | null {
  return isValid(current) ? current.accessToken : null;
}
