/**
 * 주간 광환경 서비스 진입점.
 *
 *  serverSource  — 서버 DLI 계산 작업 결과 (실제 계산)
 *  mockSource    — 예시 데이터 (서버 계산을 쓸 수 없을 때, 화면에 '예시' 표시)
 *  series        — 날짜별 DLI 지도 → 식물 자리 시계열 (두 출처 공통)
 *  dliStatus     — 요구 범위 비교 (LOW / OK / HIGH)
 *  insights      — 그래프 안내 문구
 */
export { forecastDates, RECENT_DAYS, UPCOMING_DAYS } from './dates';
export { classifyDli, formatDli, meanDli, periodStatus } from './dliStatus';
export { weekInsight } from './insights';
export { buildMockLightDays } from './mockSource';
export { buildPlantSeries, dliRangeFor, recentStatusOf, todayPointOf } from './series';
export {
  describeServerError,
  loadServerLightDays,
  runPeriodDliJob,
  type PeriodDliResult,
  type ServerLightResult,
} from './serverSource';
