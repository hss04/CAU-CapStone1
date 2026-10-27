import type { UserProfile } from '@/types';
import { addDays, toISODate } from '@/utils/date';

export function createMockUser(today: Date): UserProfile {
  return {
    name: '지우',
    nameEn: 'Jiwoo',
    email: 'jiwoo@example.com',
    joinedAt: toISODate(addDays(today, -41)),
  };
}
