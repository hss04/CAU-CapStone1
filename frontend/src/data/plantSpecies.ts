import type { LightPreference, LocalSpeciesId, PlantSpecies, PlantSpeciesId } from '@/types';
import type { ApiSpecies } from '@/types/api';

/*
 * exampleDliRange는 로그인 전 데모 화면용 범위다. 서버 종 카탈로그(backend species_seed, 2026-10-27)와 같은 값:
 *   Photone Plant Light Database 참고값(속·일반명 단위를 종에 적용), 필레아는 근거 없는 추정값(ESTIMATED).
 * 종별로 검증된 최적값이 아니라서 화면에는 '예시 범위'로 표시한다. 로그인하면 서버 값을 쓴다.
 */

export const PLANT_SPECIES: PlantSpecies[] = [
  {
    id: 'monstera',
    name: '몬스테라',
    englishName: 'Monstera',
    scientificName: 'Monstera deliciosa',
    preferredLight: 'brightIndirect',
    wateringIntervalDays: 7,
    temperature: '18–27°C',
    humidity: '보통 ~ 높음',
    difficulty: '쉬움',
    summary: '찢어진 잎이 매력적인 열대 관엽식물. 밝은 간접광에서 잎이 크고 건강하게 자라요.',
    exampleDliRange: { min: 4, max: 12 },
    source: 'app',
  },
  {
    id: 'pothos',
    name: '스킨답서스',
    englishName: 'Golden Pothos',
    scientificName: 'Epipremnum aureum',
    preferredLight: 'partialShade',
    wateringIntervalDays: 5,
    temperature: '16–28°C',
    humidity: '보통',
    difficulty: '쉬움',
    summary: '어두운 곳에서도 잘 버티는 덩굴식물. 은은한 빛에서 잎 무늬가 예쁘게 유지돼요.',
    exampleDliRange: { min: 4, max: 14 },
    source: 'app',
  },
  {
    id: 'olive',
    name: '올리브나무',
    englishName: 'Olive Tree',
    scientificName: 'Olea europaea',
    preferredLight: 'direct',
    wateringIntervalDays: 10,
    temperature: '10–30°C',
    humidity: '낮음 ~ 보통',
    difficulty: '보통',
    summary: '햇빛을 아주 좋아하는 지중해 나무. 하루 4시간 이상의 직사광이 필요해요.',
    exampleDliRange: { min: 18, max: 40 },
    source: 'app',
  },
  {
    id: 'sansevieria',
    name: '산세베리아',
    englishName: 'Snake Plant',
    scientificName: 'Dracaena trifasciata',
    preferredLight: 'partialShade',
    wateringIntervalDays: 14,
    temperature: '15–30°C',
    humidity: '낮음',
    difficulty: '쉬움',
    summary: '건조에 강하고 빛 적응력이 좋아요. 물은 흙이 완전히 마른 뒤 가끔만 주세요.',
    exampleDliRange: { min: 4, max: 14 },
    source: 'app',
  },
  {
    id: 'fiddleLeaf',
    name: '떡갈고무나무',
    englishName: 'Fiddle Leaf Fig',
    scientificName: 'Ficus lyrata',
    preferredLight: 'brightIndirect',
    wateringIntervalDays: 7,
    temperature: '16–27°C',
    humidity: '보통',
    difficulty: '보통',
    summary: '큼직한 잎의 인테리어 식물. 자리를 자주 옮기면 잎을 떨구니 한 번에 좋은 자리를 찾아주세요.',
    exampleDliRange: { min: 6, max: 12 },
    source: 'app',
  },
  {
    id: 'pilea',
    name: '필레아',
    englishName: 'Chinese Money Plant',
    scientificName: 'Pilea peperomioides',
    preferredLight: 'brightIndirect',
    wateringIntervalDays: 6,
    temperature: '13–27°C',
    humidity: '보통',
    difficulty: '쉬움',
    summary: '동글동글한 잎이 귀여운 식물. 빛 쪽으로 기울어지니 가끔 화분을 돌려주세요.',
    exampleDliRange: { min: 6, max: 12 },
    source: 'app',
  },
];

const SPECIES_BY_ID = Object.fromEntries(PLANT_SPECIES.map((s) => [s.id, s])) as Record<LocalSpeciesId, PlantSpecies>;

export function isLocalSpecies(id: PlantSpeciesId): id is LocalSpeciesId {
  return id in SPECIES_BY_ID;
}

/* ---------------- 서버 카탈로그 종 (로그인 후 107종) ---------------- */

/** 서버 종 ID → 앱 종 ID (앱 6종과 연결되지 않은 종) */
export function serverSpeciesKey(serverId: number): PlantSpeciesId {
  return `srv-${serverId}`;
}

/**
 * 요구 DLI 범위 가운데 값으로 선호 광량을 정한다 (서버 카탈로그에는 선호 광량 항목이 없다).
 * 공간 화면의 앱 예시 분석·라벨에만 쓰고, 서버 계산·추천은 요구 DLI 범위를 그대로 쓴다.
 */
function lightFromDli(min: number, max: number): LightPreference {
  const mid = (min + max) / 2;
  if (mid >= 12) return 'direct';
  if (mid >= 6) return 'brightIndirect';
  if (mid >= 3) return 'partialShade';
  return 'shade';
}

const serverProfiles = new Map<PlantSpeciesId, PlantSpecies>();

/** 서버 카탈로그에서 앱 6종과 연결되지 않은 종을 등록한다 (식물 목록·추가 화면에서 쓴다) */
export function registerServerSpecies(list: ApiSpecies[]) {
  serverProfiles.clear();
  for (const s of list) {
    const id = serverSpeciesKey(s.id);
    serverProfiles.set(id, {
      id,
      name: s.name,
      englishName: s.name,
      scientificName: s.scientificName ?? '',
      preferredLight: lightFromDli(s.minDli, s.maxDli),
      // 서버 기본 물주기 간격 (종별 권장값 아님)
      wateringIntervalDays: 7,
      temperature: '정보 없음',
      humidity: '정보 없음',
      difficulty: '정보 없음',
      summary: `LUMAP 식물 카탈로그 종이에요. 요구 DLI ${s.minDli}–${s.maxDli} mol/m²/day(참고 범위)로 자리를 계산해요. 온도·습도 같은 관리 정보는 아직 없어요. 물주기는 등록할 때 정한 간격을 써요.`,
      exampleDliRange: { min: s.minDli, max: s.maxDli },
      source: 'server',
    });
  }
}

/** 카탈로그를 받기 전이거나 없어진 종 — 화면이 깨지지 않게 하는 기본값 */
function unknownSpecies(id: PlantSpeciesId): PlantSpecies {
  return {
    id,
    name: '식물',
    englishName: 'Plant',
    scientificName: '',
    preferredLight: 'brightIndirect',
    wateringIntervalDays: 7,
    temperature: '정보 없음',
    humidity: '정보 없음',
    difficulty: '정보 없음',
    summary: '식물 정보를 불러오는 중이에요.',
    exampleDliRange: { min: 4, max: 12 },
    source: 'server',
  };
}

export function getSpecies(id: PlantSpeciesId): PlantSpecies {
  if (isLocalSpecies(id)) return SPECIES_BY_ID[id];
  return serverProfiles.get(id) ?? unknownSpecies(id);
}
