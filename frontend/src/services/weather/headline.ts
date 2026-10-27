import type { CurrentWeather, DailyWeather } from '@/types';

/**
 * 날씨 카드의 한 줄 안내 — 바깥 날씨(오늘 예보)에 대한 설명이다.
 * 식물 자리의 광량 판단은 하지 않는다 (그건 예상 DLI 상태가 맡는다).
 */
export function weatherHeadline(today: DailyWeather | null, current: CurrentWeather): string {
  const condition = today?.condition ?? current.condition;
  const ratio =
    today && today.sunshineHours !== null && today.daylightHours ? today.sunshineHours / today.daylightHours : null;

  switch (condition) {
    case 'sunny':
    case 'partlyCloudy':
      if (ratio !== null && ratio < 0.5) return '구름 사이로 햇빛이 드는 날이에요.';
      return '오늘은 햇빛이 잘 드는 날이에요!';
    case 'cloudy':
    case 'foggy':
      return '구름이 많아 햇빛이 은은한 날이에요.';
    case 'snowy':
      return '눈 소식이 있어 실내가 평소보다 어두울 수 있어요.';
    default:
      return '비 소식이 있어 실내가 평소보다 어두울 수 있어요.';
  }
}
