import type { DailyLightPoint, WeatherCondition } from '@/types';
import { parseISODate } from '@/utils/date';

import { isClearCondition } from '../weather/weatherCodes';

/**
 * 주간 그래프 아래 안내 문구.
 * 날씨는 '왜 그런지' 설명에만 쓰고, 부족·적정·과다 판단은 계산된 예상 DLI 상태(status)로만 한다.
 */

const DIM: WeatherCondition[] = ['cloudy', 'foggy', 'drizzle', 'rainy', 'snowy', 'stormy'];

function isWeekend(date: string): boolean {
  const day = parseISODate(date).getDay();
  return day === 0 || day === 6;
}

export function weekInsight(points: DailyLightPoint[], period: 'recent' | 'upcoming'): string | null {
  const known = points.filter((p) => p.status !== null);
  if (known.length === 0) return null;

  const low = known.filter((p) => p.status === 'low').length;
  const high = known.filter((p) => p.status === 'high').length;
  const ok = known.length - low - high;
  const dim = points.filter((p) => p.weather && DIM.includes(p.weather.condition)).length;
  const upcoming = period === 'upcoming';
  const many = (n: number) => n >= Math.ceil(known.length / 2);

  if (many(low) && dim >= 3) {
    return upcoming
      ? '이번 주는 흐린 날이 많아 자연광이 부족할 것으로 예상돼요.'
      : '지난 7일은 흐린 날이 많아 자연광이 부족했던 것으로 추정돼요.';
  }

  // 주말이 평일보다 나아지는 경우 (앞으로 7일만)
  if (upcoming) {
    const weekend = known.filter((p) => isWeekend(p.date));
    const weekday = known.filter((p) => !isWeekend(p.date));
    const weekendClear = weekend.length > 0 && weekend.every((p) => p.weather && isClearCondition(p.weather.condition));
    const weekendOk = weekend.length > 0 && weekend.every((p) => p.status === 'ok');
    const weekdayLow = weekday.some((p) => p.status === 'low');
    if (weekendClear && weekendOk && weekdayLow) {
      return '주말에는 맑은 날씨가 예상되어 광환경이 개선될 수 있어요.';
    }
  }

  if (many(high)) {
    return upcoming
      ? '빛이 요구 범위보다 강한 날이 많을 것으로 예상돼요. 한낮에는 직사광을 살짝 피해 주세요.'
      : '지난 7일은 빛이 요구 범위보다 강했던 날이 많았던 것으로 추정돼요.';
  }
  if (many(low)) {
    return upcoming
      ? '지금 자리는 앞으로 7일 동안 빛이 부족한 날이 많을 것으로 예상돼요.'
      : '지난 7일은 지금 자리의 빛이 부족했던 날이 많았던 것으로 추정돼요.';
  }
  if (ok === known.length) {
    return upcoming ? '앞으로 7일 동안 알맞은 빛이 예상돼요.' : '지난 7일은 알맞은 빛을 받은 것으로 추정돼요.';
  }
  return upcoming
    ? '날씨에 따라 빛이 들쭉날쭉할 것으로 예상돼요. 날짜를 눌러 확인해 보세요.'
    : '날씨에 따라 빛이 들쭉날쭉했던 것으로 추정돼요.';
}
