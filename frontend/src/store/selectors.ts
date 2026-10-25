import { CHARACTER_COPY, WATERED_MESSAGE } from '@/constants/labels';
import type { CharacterState, Plant, WeatherSnapshot } from '@/types';
import { addDays, diffInDays, parseISODate } from '@/utils/date';

export interface WateringInfo {
  nextDate: Date;
  daysLeft: number;
  /** Today / Tomorrow / In 3 days / Overdue */
  label: string;
  /** 오늘 / 내일 / 3일 후 / 2일 지남 */
  labelKo: string;
  isDue: boolean;
  wateredToday: boolean;
  daysSinceWatered: number;
}

export function getWateringInfo(plant: Plant, today: Date): WateringInfo {
  const last = parseISODate(plant.lastWateredAt);
  const nextDate = addDays(last, plant.wateringIntervalDays);
  const daysLeft = diffInDays(nextDate, today);
  const daysSinceWatered = diffInDays(today, last);

  const label =
    daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `In ${daysLeft} days`;
  const labelKo =
    daysLeft < 0 ? `${-daysLeft}일 지남` : daysLeft === 0 ? '오늘' : daysLeft === 1 ? '내일' : `${daysLeft}일 후`;

  return {
    nextDate,
    daysLeft,
    label,
    labelKo,
    isDue: daysLeft <= 0,
    wateredToday: daysSinceWatered === 0,
    daysSinceWatered,
  };
}

export type PlantStatusKey = 'healthy' | 'thirsty' | 'veryThirsty' | 'needsLight';

export interface PlantStatus {
  key: PlantStatusKey;
  label: string;
  labelKo: string;
  tone: 'green' | 'water' | 'sun' | 'clay';
}

export function getPlantStatus(plant: Plant, today: Date): PlantStatus {
  const w = getWateringInfo(plant, today);
  if (w.daysLeft <= -2) return { key: 'veryThirsty', label: 'Very thirsty', labelKo: '물이 급해요', tone: 'clay' };
  if (w.isDue) return { key: 'thirsty', label: 'Thirsty', labelKo: '물 줄 시간', tone: 'water' };
  if (plant.analysis.current.score < 50)
    return { key: 'needsLight', label: 'Needs light', labelKo: '빛이 부족해요', tone: 'sun' };
  return { key: 'healthy', label: 'Healthy', labelKo: '건강해요', tone: 'green' };
}

export function getHealthLabel(plant: Plant, today: Date): { label: string; caption: string } {
  const status = getPlantStatus(plant, today);
  if (status.key === 'healthy' && plant.analysis.current.score >= 75) return { label: 'Great', caption: '아주 건강해요' };
  if (status.key === 'healthy') return { label: 'Good', caption: '건강한 상태예요' };
  if (status.key === 'needsLight') return { label: 'Fair', caption: '빛이 조금 부족해요' };
  return { label: 'Fair', caption: '물이 필요해요' };
}

export function getDuePlants(plants: Plant[], today: Date): Plant[] {
  return plants.filter((p) => getWateringInfo(p, today).isDue);
}

/** 가장 가까운 물주기 일정 (오늘 이미 물 준 식물 포함) */
export function getNextWatering(plants: Plant[], today: Date): { plant: Plant; info: WateringInfo } | null {
  let best: { plant: Plant; info: WateringInfo } | null = null;
  for (const plant of plants) {
    const info = getWateringInfo(plant, today);
    if (!best || info.daysLeft < best.info.daysLeft) best = { plant, info };
  }
  return best;
}

/** HOME의 "오늘의 배치 추천"에 노출할 식물 */
export function getFeaturedRecommendation(plants: Plant[]): Plant | null {
  return plants.find((p) => p.analysis.recommended) ?? null;
}

export function getPlantsWithRecommendation(plants: Plant[]): Plant[] {
  return plants.filter((p) => p.analysis.recommended);
}

export interface CharacterMood {
  state: CharacterState;
  message: string;
}

/**
 * 식물 캐릭터 상태 결정 규칙
 *  1) 물주기가 2일 이상 지난 식물 → veryThirsty
 *  2) 오늘 물 줄 식물 → thirsty
 *  3) 방금 물을 줬다면 → healthy (감사 메시지)
 *  4) 오늘 햇빛이 강하면 → happy
 *  5) 그 외 → healthy
 */
export function getCharacterMood(params: {
  plants: Plant[];
  weather: WeatherSnapshot;
  today: Date;
  recentlyWatered: boolean;
  override: CharacterState | null;
}): CharacterMood {
  const { plants, weather, today, recentlyWatered, override } = params;
  if (override) return { state: override, message: CHARACTER_COPY[override].message };
  if (plants.length === 0) return { state: 'healthy', message: '새로운 초록 친구를 기다리고 있어요 🌱' };

  const minDaysLeft = Math.min(...plants.map((p) => getWateringInfo(p, today).daysLeft));
  if (minDaysLeft <= -2) return { state: 'veryThirsty', message: CHARACTER_COPY.veryThirsty.message };
  if (minDaysLeft <= 0) return { state: 'thirsty', message: CHARACTER_COPY.thirsty.message };
  if (recentlyWatered) return { state: 'healthy', message: WATERED_MESSAGE };
  if (weather.sunlight === 'high') return { state: 'happy', message: CHARACTER_COPY.happy.message };
  return { state: 'healthy', message: CHARACTER_COPY.healthy.message };
}
