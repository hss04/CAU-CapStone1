import { camelize, snakify } from './caseConvert';
import { API_BASE_URL, API_PREFIX, API_TIMEOUT_MS } from './config';
import { clearSession, getAccessToken } from './session';

/**
 * 백엔드 공통 요청 함수.
 * - 요청 body는 snake_case로, 응답은 camelCase로 바꾼다.
 * - auth가 true면 Authorization: Bearer 토큰을 붙인다.
 * - 에러는 ApiError 하나로 통일한다 (서버 에러 형식: {"detail": "..."}).
 */

export class ApiError extends Error {
  constructor(
    /** HTTP 상태 코드. 서버에 연결하지 못했으면 0 */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork() {
    return this.status === 0;
  }
}

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

/** 토큰이 없거나 만료돼 401을 받았을 때 (AuthProvider가 로그아웃 처리) */
export function setUnauthorizedListener(listener: UnauthorizedListener | null) {
  unauthorizedListener = listener;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** multipart 요청 (사진 업로드). 있으면 body 대신 보낸다 — 키 변환 없음 */
  form?: FormData;
  /** 기본 true */
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
  /** 기본 API_TIMEOUT_MS. 사진 업로드처럼 큰 요청만 늘린다 */
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, auth = true, query, timeoutMs = API_TIMEOUT_MS } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (auth) {
    const token = getAccessToken();
    if (!token) {
      await handleUnauthorized();
      throw new ApiError(401, '로그인이 필요해요');
    }
    headers.Authorization = `Bearer ${token}`;
  }
  // multipart는 boundary가 붙은 Content-Type을 fetch가 직접 정하게 둔다
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(snakify(body))),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, `서버에 연결할 수 없어요 (${API_BASE_URL})`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && auth) await handleUnauthorized();
    throw new ApiError(response.status, detailMessage(data) ?? `요청에 실패했어요 (${response.status})`);
  }
  return camelize<T>(data);
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const params = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${API_BASE_URL}${API_PREFIX}${path}${params ? `?${params}` : ''}`;
}

/** FastAPI 에러: {"detail": "메시지"} 또는 검증 에러 {"detail": [{"msg": ...}, ...]} */
function detailMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('detail' in data)) return null;
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : null))
      .filter((m): m is string => !!m);
    return msgs.length ? msgs.join(', ') : null;
  }
  return null;
}

async function handleUnauthorized() {
  await clearSession();
  unauthorizedListener?.();
}
