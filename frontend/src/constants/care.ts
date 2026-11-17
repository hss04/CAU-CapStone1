import { Droplet, type LucideIcon, NotebookPen, Scissors, Shovel, SprayCan, Sprout } from 'lucide-react-native';

import type { ChipTone } from '@/components/common/StatusChip';
import type { ApiCareType, ApiCalendarEvent, ApiTaskType } from '@/types/api';

/** 관리 일정 종류 (백엔드 calendar task_type) */
export const TASK_TYPE: Record<ApiTaskType, { label: string; icon: LucideIcon; tone: ChipTone }> = {
  WATERING: { label: '물주기', icon: Droplet, tone: 'water' },
  FERTILIZING: { label: '비료', icon: Sprout, tone: 'green' },
  REPOTTING: { label: '분갈이', icon: Shovel, tone: 'clay' },
  PRUNING: { label: '가지치기', icon: Scissors, tone: 'green' },
  MISTING: { label: '분무', icon: SprayCan, tone: 'water' },
  OTHER: { label: '기타', icon: NotebookPen, tone: 'neutral' },
};

/** 직접 추가할 수 있는 종류 (물주기는 식물의 물주기 간격으로 자동) */
export const CARE_TYPES: ApiCareType[] = ['FERTILIZING', 'REPOTTING', 'PRUNING', 'MISTING', 'OTHER'];

export function eventStatusChip(e: Pick<ApiCalendarEvent, 'status' | 'isOverdue' | 'completedOn'>): { label: string; tone: ChipTone } {
  if (e.status === 'COMPLETED') return { label: e.completedOn ? `완료 ${e.completedOn.slice(5).replace('-', '/')}` : '완료', tone: 'green' };
  if (e.status === 'SKIPPED') return { label: '건너뜀', tone: 'neutral' };
  if (e.isOverdue) return { label: '지남', tone: 'clay' };
  return { label: '예정', tone: 'sun' };
}
