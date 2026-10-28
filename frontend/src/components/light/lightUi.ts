import type { AnalysisStep } from '@/components/common/AnalysisSteps';
import { ANALYSIS_STEP_LABEL } from '@/constants/labels';
import type { LightForecastValue } from '@/store/LightForecastProvider';
import type { LightStage } from '@/types';

/** 주간 광환경 계산의 실제 단계 → 화면 단계 목록 */
export function lightAnalysisSteps(forecast: Pick<LightForecastValue, 'source' | 'progress'>): AnalysisStep[] {
  // 서버 동기화 중 (아직 계산 요청 전)
  if (forecast.source === null) {
    return [
      { key: 'sync', label: ANALYSIS_STEP_LABEL.sync, status: 'active' },
      { key: 'dli', label: ANALYSIS_STEP_LABEL.dli, status: 'pending' },
      { key: 'plants', label: ANALYSIS_STEP_LABEL.plants, status: 'pending' },
    ];
  }
  const order: LightStage[] = ['request', 'dli', 'plants'];
  const current = order.indexOf(forecast.progress?.stage ?? 'request');
  return order.map((stage, i) => {
    const status: AnalysisStep['status'] = i < current ? 'done' : i === current ? 'active' : 'pending';
    const p = forecast.progress;
    // 서버가 한 번에 계산해서, 계산 전에 이미 저장돼 있던 날짜 수만 정확히 알 수 있다
    const detail = stage === 'dli' && p?.stage === 'dli' && p.total ? `저장된 결과 ${p.done ?? 0}/${p.total}일` : undefined;
    return { key: stage, label: ANALYSIS_STEP_LABEL[stage], status, detail };
  });
}

/** 데이터 출처 표시 문구 */
export function lightSourceLabel(forecast: Pick<LightForecastValue, 'source' | 'provisional'>): string | null {
  if (forecast.source === 'mock') return '예시 데이터';
  if (forecast.source === 'calculated') return forecast.provisional ? '임시 계산' : 'LUMAP 계산';
  return null;
}
