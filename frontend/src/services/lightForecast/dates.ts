import type { LightBasis } from '@/types';
import { addDays, parseISODate, toISODate } from '@/utils/date';

/** 지난 7일 (오늘 제외) */
export const RECENT_DAYS = 7;
/** 오늘 포함 앞으로 7일 */
export const UPCOMING_DAYS = 7;

/** 주간 광환경 날짜 범위: 오늘 −7일 ~ 오늘 +6일 (Open-Meteo 예보 past_days=7, forecast_days=7과 같은 범위) */
export function forecastDates(today: string): { date: string; basis: LightBasis }[] {
  const base = parseISODate(today);
  return Array.from({ length: RECENT_DAYS + UPCOMING_DAYS }, (_, i) => {
    const offset = i - RECENT_DAYS;
    return { date: toISODate(addDays(base, offset)), basis: offset < 0 ? 'historical' : 'forecast' };
  });
}
