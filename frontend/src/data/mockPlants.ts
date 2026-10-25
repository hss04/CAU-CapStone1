import type { Plant } from '@/types';
import { addDays, toISODate } from '@/utils/date';

/**
 * Mock 식물 데이터.
 * analysis 값은 백엔드 배치 분석 API가 내려준다고 가정한 결과이다.
 * (새로 등록하는 식물은 services/placement 의 로컬 추정 엔진으로 계산)
 */
export function createMockPlants(today: Date): Plant[] {
  const daysAgo = (n: number) => toISODate(addDays(today, -n));

  return [
    {
      id: 'p-monstera',
      name: '몬스테라',
      speciesId: 'monstera',
      preferredLight: 'brightIndirect',
      wateringIntervalDays: 7,
      lastWateredAt: daysAgo(6),
      location: { position: { x: 2, y: 5 }, label: '책상 옆' },
      roomId: 'room-1',
      addedAt: daysAgo(40),
      analysis: {
        current: {
          position: { x: 2, y: 5 },
          label: '책상 옆',
          score: 62,
          lightLevel: 'medium',
          lightValue: 49,
          expectedSunHours: 3.5,
        },
        recommended: {
          position: { x: 3, y: 2 },
          label: '창문 근처',
          score: 87,
          lightLevel: 'high',
          lightValue: 71,
          expectedSunHours: 5.1,
          lightLabel: 'Good Light',
          distanceFromWindowM: 1.2,
          reasons: [
            '밝은 간접광을 받을 수 있어요.',
            '현재 위치보다 예상 일조량이 높아요.',
            '강한 직사광선을 피할 수 있어요.',
            '창문에서 약 1.2m 떨어져 있어요.',
          ],
        },
        message: '조금 더 밝은 위치를 추천해요.',
      },
    },
    {
      id: 'p-pothos',
      name: '스킨답서스',
      speciesId: 'pothos',
      preferredLight: 'partialShade',
      wateringIntervalDays: 5,
      lastWateredAt: daysAgo(5),
      location: { position: { x: 5, y: 6 }, label: '침대 옆' },
      roomId: 'room-1',
      addedAt: daysAgo(31),
      analysis: {
        current: {
          position: { x: 5, y: 6 },
          label: '침대 옆',
          score: 84,
          lightLevel: 'medium',
          lightValue: 52,
          expectedSunHours: 3.7,
        },
        recommended: null,
        message: '지금 위치가 잘 맞아요.',
      },
    },
    {
      id: 'p-olive',
      name: '올리브나무',
      speciesId: 'olive',
      preferredLight: 'direct',
      wateringIntervalDays: 10,
      lastWateredAt: daysAgo(3),
      location: { position: { x: 2, y: 9 }, label: '옷장 옆' },
      roomId: 'room-1',
      addedAt: daysAgo(12),
      analysis: {
        current: {
          position: { x: 2, y: 9 },
          label: '옷장 옆',
          score: 38,
          lightLevel: 'low',
          lightValue: 28,
          expectedSunHours: 2.0,
        },
        recommended: {
          position: { x: 5, y: 0 },
          label: '창가',
          score: 91,
          lightLevel: 'high',
          lightValue: 87,
          expectedSunHours: 6.3,
          lightLabel: 'Full Sun',
          distanceFromWindowM: 0.2,
          reasons: [
            '올리브나무가 좋아하는 직사광을 충분히 받을 수 있어요.',
            '현재 위치보다 예상 일조량이 2배 이상 높아요.',
            '오전부터 오후까지 햇빛이 오래 머무는 자리예요.',
            '창문 바로 앞이라 통풍도 좋아요.',
          ],
        },
        message: '햇빛이 훨씬 많이 필요해요.',
      },
    },
  ];
}
