import { getSpecies, PLANT_SPECIES } from '@/data/plantSpecies';
import { analyzePlacement } from '@/services/placement/placementEngine';
import { describePosition, isPlaceable, samePosition } from '@/services/space/geometry';
import type { GridPosition, Plant, PlantSpeciesId, Room } from '@/types';
import type { ApiPlant, ApiSpecies } from '@/types/api';

import { realToCell } from './roomSync';

/**
 * 서버 데이터 ↔ 앱 데이터 연결.
 *
 * 식물 종: 서버 카탈로그(PlantSpecies)와 앱의 종 정보(그림·물주기 등)를 학명으로 연결한다.
 *   학명이 없으면 한글 이름으로 연결하고, 앱에 없는 서버 종은 아직 표시하지 않는다.
 * 식물: 서버에는 종·이름·방·실제 좌표(m)·물주기(간격, 마지막 물준 날)가 저장된다.
 *   서버 방과 연결돼 있으면 실제 좌표 → 격자 칸으로 바꿔 지도에 표시하고,
 *   서버 방이 없거나 미배치 식물이면 빈 칸에 '위치 미지정'으로 임시 표시한다.
 */

export type SpeciesLinks = Partial<Record<PlantSpeciesId, ApiSpecies>>;

export const UNPLACED_LABEL = '위치 미지정';

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function linkSpecies(server: ApiSpecies[]): SpeciesLinks {
  const links: SpeciesLinks = {};
  for (const local of PLANT_SPECIES) {
    const byScientific = server.find((s) => s.scientificName && normalize(s.scientificName) === normalize(local.scientificName));
    const match = byScientific ?? server.find((s) => normalize(s.name) === normalize(local.name));
    if (match) links[local.id] = match;
  }
  return links;
}

export function localSpeciesIdFor(serverSpeciesId: number, links: SpeciesLinks): PlantSpeciesId | null {
  const entry = Object.entries(links).find(([, s]) => s?.id === serverSpeciesId);
  return entry ? (entry[0] as PlantSpeciesId) : null;
}

/** 비어 있는 첫 번째 칸 (서버에 위치가 없는 식물을 지도에 임시로 표시할 자리) */
function firstFreeSpot(room: Room, occupied: GridPosition[]): GridPosition {
  for (let y = 0; y < room.rows; y++) {
    for (let x = 0; x < room.cols; x++) {
      const pos = { x, y };
      if (isPlaceable(room, pos) && !occupied.some((o) => samePosition(o, pos))) return pos;
    }
  }
  return { x: 0, y: 0 };
}

export interface SyncResult {
  plants: Plant[];
  /** 앱에 없는 종이라 표시하지 못한 서버 식물 수 */
  skipped: number;
}

/**
 * 서버 식물 목록 → 앱 식물 목록.
 * 이미 앱에 있던 식물(serverId 일치)은 물주기·위치 같은 앱 정보를 유지하고 이름·종만 서버 값으로 맞춘다.
 */
export function plantsFromServer(
  serverPlants: ApiPlant[],
  links: SpeciesLinks,
  room: Room,
  previous: Plant[],
  today: string,
): SyncResult {
  const plants: Plant[] = [];
  let skipped = 0;

  for (const api of serverPlants) {
    const speciesId = localSpeciesIdFor(api.speciesId, links);
    if (!speciesId) {
      skipped += 1;
      continue;
    }
    const known = previous.find((p) => p.serverId === api.id);
    const occupied = plants.map((p) => p.location.position);
    // 이 방에 배치된 서버 식물이면 실제 좌표가 기준
    const placed = api.roomId !== null && api.roomId === room.server?.roomId && api.position ? realToCell(room, api.position) : null;

    // 앱에 있던 위치는 지금 방에서도 둘 수 있는 칸일 때만 유지 (방이 바뀌면 칸 좌표가 달라진다)
    const keepKnown =
      !!known && !placed && known.roomId === room.id && isPlaceable(room, known.location.position);

    const species = getSpecies(speciesId);
    const preferredLight = known?.preferredLight ?? species.preferredLight;
    const position = placed ?? (keepKnown ? known!.location.position : firstFreeSpot(room, occupied));
    const label = placed ? describePosition(room, placed) : keepKnown ? known!.location.label : UNPLACED_LABEL;
    plants.push({
      ...(known ?? {
        wateringIntervalDays: species.wateringIntervalDays,
        lastWateredAt: today,
        addedAt: today,
      }),
      // 물주기는 서버 기록이 기준 (v0.4.0). 기록이 없는 식물만 앱 값·오늘로 시작한다
      wateringIntervalDays: api.wateringIntervalDays ?? known?.wateringIntervalDays ?? species.wateringIntervalDays,
      lastWateredAt: api.lastWateredAt ?? known?.lastWateredAt ?? today,
      id: known?.id ?? `s-${api.id}`,
      serverId: api.id,
      name: api.nickname,
      speciesId,
      preferredLight,
      location: { position, label },
      roomId: room.id,
      analysis: analyzePlacement(room, { position, preferredLight, label }, occupied),
    });
  }
  return { plants, skipped };
}
