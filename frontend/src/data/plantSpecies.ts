import type { PlantSpecies, PlantSpeciesId } from '@/types';

/*
 * exampleDliRange는 데모 화면을 위한 예시 범위다 (검증된 요구량 아님).
 * 로그인하면 서버 식물 종 카탈로그(plant_species.min_dli/max_dli) 값을 쓰고,
 * 화면에는 출처(예시/서버)를 함께 표시한다.
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
    exampleDliRange: { min: 6, max: 12 },
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
    exampleDliRange: { min: 3, max: 9 },
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
    exampleDliRange: { min: 12, max: 30 },
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
    exampleDliRange: { min: 2, max: 10 },
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
    exampleDliRange: { min: 8, max: 16 },
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
    exampleDliRange: { min: 5, max: 12 },
  },
];

const SPECIES_BY_ID = Object.fromEntries(PLANT_SPECIES.map((s) => [s.id, s])) as Record<
  PlantSpeciesId,
  PlantSpecies
>;

export function getSpecies(id: PlantSpeciesId): PlantSpecies {
  return SPECIES_BY_ID[id];
}
