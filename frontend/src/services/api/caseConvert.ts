/**
 * API 경계의 키 이름 변환.
 * 서버(Python)는 snake_case, 앱(TypeScript)은 camelCase를 쓰므로 요청·응답 때 한 번에 바꾼다.
 *   x_axis_azimuth_deg ↔ xAxisAzimuthDeg, min_dli ↔ minDli
 */

type KeyFn = (key: string) => string;

const toCamelKey: KeyFn = (key) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const toSnakeKey: KeyFn = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function convertKeys(value: unknown, fn: KeyFn): unknown {
  if (Array.isArray(value)) return value.map((v) => convertKeys(v, fn));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[fn(k)] = convertKeys(v, fn);
  return out;
}

export function camelize<T>(value: unknown): T {
  return convertKeys(value, toCamelKey) as T;
}

export function snakify(value: unknown): unknown {
  return convertKeys(value, toSnakeKey);
}
