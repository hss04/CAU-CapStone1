import type { GridPosition, LightLevel } from './room';

export type LightPreference = 'direct' | 'brightIndirect' | 'partialShade' | 'shade';

export type PlantSpeciesId =
  | 'monstera'
  | 'pothos'
  | 'olive'
  | 'sansevieria'
  | 'fiddleLeaf'
  | 'pilea';

export interface PlantSpecies {
  id: PlantSpeciesId;
  name: string;
  englishName: string;
  scientificName: string;
  preferredLight: LightPreference;
  wateringIntervalDays: number;
  temperature: string;
  humidity: string;
  difficulty: '쉬움' | '보통' | '까다로움';
  summary: string;
}

export interface PlantLocation {
  position: GridPosition;
  label: string;
}

export interface PlacementSpot {
  position: GridPosition;
  label: string;
  /** 0~100 적합도 */
  score: number;
  lightLevel: LightLevel;
  /** 0~100 상대 광량 지수 */
  lightValue: number;
  expectedSunHours: number;
}

export interface PlacementRecommendation extends PlacementSpot {
  /** 'Good Light' 같은 짧은 영문 라벨 */
  lightLabel: string;
  reasons: string[];
  distanceFromWindowM: number;
}

export interface PlacementAnalysis {
  current: PlacementSpot;
  /** 현재 위치가 이미 최적이면 null */
  recommended: PlacementRecommendation | null;
  message: string;
}

export interface Plant {
  id: string;
  /** 사용자가 붙인 이름 (예: 몬스테라, 초록이) */
  name: string;
  speciesId: PlantSpeciesId;
  preferredLight: LightPreference;
  wateringIntervalDays: number;
  /** YYYY-MM-DD */
  lastWateredAt: string;
  location: PlantLocation;
  analysis: PlacementAnalysis;
  roomId: string;
  addedAt: string;
}
