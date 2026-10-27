import { CHARACTER_COPY, WATERED_MESSAGE } from '@/constants/labels';
import type { CharacterState, DliStatus, Plant } from '@/types';
import { addDays, diffInDays, parseISODate } from '@/utils/date';
import { withEunNeun } from '@/utils/korean';

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
  /** 주 상태와 함께 알려줄 빛 상태 (예: 물이 급한데 빛도 부족) */
  secondary: Extract<CharacterState, 'lowLight' | 'tooBright'> | null;
}

/** 식물 하나의 최근 예상 광량 상태 (null = 아직 값 없음) */
export interface PlantLightState {
  plant: Plant;
  status: DliStatus | null;
}

const LIGHT_HINT = {
  lowLight: '햇빛도 조금 부족한 것 같아요.',
  tooBright: '햇빛도 강할 수 있어요.',
} as const;

/** 식물이 여러 개면 어느 식물 이야기인지 이름을 붙인다 */
function lightMessage(kind: 'lowLight' | 'tooBright', targets: Plant[], total: number): string {
  const base = CHARACTER_COPY[kind].message;
  if (total <= 1 || targets.length !== 1) return base;
  const name = withEunNeun(targets[0].name);
  return kind === 'lowLight' ? `${name} 요즘 햇빛이 조금 부족한 것 같아요.` : `${name} 햇빛이 너무 강할 수 있어요!`;
}

/**
 * 식물 캐릭터 상태 결정 규칙 (위에서부터 먼저 맞는 것)
 *  1) 물주기가 2일 이상 지난 식물 → veryThirsty
 *  2) 오늘 물 줄 식물 → thirsty
 *     (1·2에서 빛도 좋지 않으면 secondary로 함께 알려준다 — 물은 바로 할 수 있는 일이라 먼저)
 *  3) 방금 물을 줬다면 → healthy (감사 메시지)
 *  4) 최근 7일 예상 광량이 요구 범위보다 많은 식물 → tooBright
 *  5) 최근 7일 예상 광량이 요구 범위보다 적은 식물 → lowLight
 *  6) 모든 식물의 예상 광량이 적정 → happy
 *  7) 광량 값이 아직 없으면 → healthy
 * 광량 상태는 예상치 기반 안내이며, 실제 생육 상태를 판단하지 않는다.
 */
export function getCharacterMood(params: {
  plants: Plant[];
  light: PlantLightState[];
  today: Date;
  recentlyWatered: boolean;
  override: CharacterState | null;
}): CharacterMood {
  const { plants, light, today, recentlyWatered, override } = params;
  if (override) return { state: override, message: CHARACTER_COPY[override].message, secondary: null };
  if (plants.length === 0) return { state: 'healthy', message: '새로운 초록 친구를 기다리고 있어요 🌱', secondary: null };

  const tooBright = light.filter((l) => l.status === 'high').map((l) => l.plant);
  const lowLight = light.filter((l) => l.status === 'low').map((l) => l.plant);
  const lightIssue = tooBright.length > 0 ? 'tooBright' : lowLight.length > 0 ? 'lowLight' : null;

  const minDaysLeft = Math.min(...plants.map((p) => getWateringInfo(p, today).daysLeft));
  const water: CharacterState | null = minDaysLeft <= -2 ? 'veryThirsty' : minDaysLeft <= 0 ? 'thirsty' : null;
  if (water) {
    const base = CHARACTER_COPY[water].message;
    // 두 문장은 줄을 나눠 보여준다 (말풍선 안에서 단어 중간에 줄이 바뀌지 않게)
    return { state: water, message: lightIssue ? `${base}\n${LIGHT_HINT[lightIssue]}` : base, secondary: lightIssue };
  }
  if (recentlyWatered) return { state: 'healthy', message: WATERED_MESSAGE, secondary: null };
  if (lightIssue) {
    const targets = lightIssue === 'tooBright' ? tooBright : lowLight;
    return { state: lightIssue, message: lightMessage(lightIssue, targets, plants.length), secondary: null };
  }

  const known = light.filter((l) => l.status !== null);
  if (known.length > 0 && known.length === light.length) {
    return { state: 'happy', message: CHARACTER_COPY.happy.message, secondary: null };
  }
  return { state: 'healthy', message: CHARACTER_COPY.healthy.message, secondary: null };
}
