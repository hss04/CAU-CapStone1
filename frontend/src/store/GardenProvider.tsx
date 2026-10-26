import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';

import { createMockPlants } from '@/data/mockPlants';
import { MOCK_ROOM } from '@/data/mockRoom';
import { createMockUser, MOCK_WEATHER } from '@/data/mockUser';
import { ApiError } from '@/services/api/client';
import * as api from '@/services/api/endpoints';
import { linkSpecies, plantsFromServer, type SpeciesLinks } from '@/services/api/plantSync';
import { cellToReal, roomFromServer } from '@/services/api/roomSync';
import { analyzePlacement } from '@/services/placement/placementEngine';
import { buildMockDliMap } from '@/services/space/dliMap';
import { useAuth } from '@/store/AuthProvider';
import type {
  CharacterState,
  GridPosition,
  LightPreference,
  NotificationSettings,
  Plant,
  PlantSpeciesId,
  Room,
  UserProfile,
  WeatherSnapshot,
  WindowScan,
} from '@/types';
import type { ApiDliMap } from '@/types/api';
import { parseISODate, toISODate } from '@/utils/date';

/**
 * 앱 전역 상태.
 * 로그인하지 않으면 데모(Mock) 데이터, 로그인하면 식물·식물 종을 서버에서 받아온다.
 * 서버를 쓰는 action은 API를 먼저 호출하고, 성공한 응답으로 state를 갱신한다.
 */

/** demo: 로그인 안 함(Mock) · loading: 서버에서 받는 중 · synced: 서버 데이터 · error: 받기 실패 */
export type SyncStatus = 'demo' | 'loading' | 'synced' | 'error';

export interface SyncState {
  status: SyncStatus;
  message: string | null;
  /** 앱에 없는 종이라 표시하지 못한 서버 식물 수 */
  skipped: number;
}

export interface GardenState {
  hasOnboarded: boolean;
  today: string;
  user: UserProfile;
  room: Room;
  plants: Plant[];
  weather: WeatherSnapshot;
  notifications: NotificationSettings;
  /** 마지막으로 [물 줬어요]를 누른 시각 (캐릭터 감사 메시지용) */
  lastWateredEventAt: number | null;
  /** 시연용: 캐릭터 상태 강제 지정 */
  characterOverride: CharacterState | null;
  /** 창문별 창밖 180° 스캔 결과 (로컬 저장, 서버 업로드 전) */
  windowScans: Record<string, WindowScan>;
  /** 앱 종 ↔ 서버 종 연결 (로그인 상태에서만 채워짐) */
  serverSpecies: SpeciesLinks;
  sync: SyncState;
  /** 서버 방의 DLI 지도 (dli_map_v2). 없으면 화면에서 데모용 예시 지도를 만든다 */
  dliMap: ApiDliMap | null;
  /** DLI 지도가 서버 규격 검증(POST /dli-map/validate)을 통과했는지 */
  dliCheck: DliCheck;
}

export interface DliCheck {
  status: 'idle' | 'checking' | 'ok' | 'error';
  message: string | null;
}

const IDLE_CHECK: DliCheck = { status: 'idle', message: null };

export interface NewPlantInput {
  id: string;
  serverId?: number;
  name: string;
  speciesId: PlantSpeciesId;
  preferredLight: LightPreference;
  wateringIntervalDays: number;
  position: GridPosition;
  locationLabel: string;
}

type Action =
  | { type: 'completeOnboarding' }
  | { type: 'restartOnboarding' }
  | { type: 'waterPlants'; plantIds: string[]; at: number }
  | { type: 'addPlant'; input: NewPlantInput }
  | { type: 'applyRecommendation'; plantId: string }
  | { type: 'setRoom'; room: Room }
  | { type: 'toggleNotification'; key: keyof NotificationSettings }
  | { type: 'cycleCharacter' }
  | { type: 'removePlant'; plantId: string }
  | { type: 'clearPlants' }
  | { type: 'resetDemo' }
  | { type: 'saveWindowScan'; scan: WindowScan }
  | { type: 'syncStart' }
  | { type: 'syncSuccess'; links: SpeciesLinks; plants: Plant[]; skipped: number; room: Room; dliMap: ApiDliMap | null }
  | { type: 'syncError'; message: string }
  | { type: 'dliCheck'; check: DliCheck }
  | { type: 'enterDemo' };

const DEMO_SYNC: SyncState = { status: 'demo', message: null, skipped: 0 };

const CHARACTER_CYCLE: (CharacterState | null)[] = ['happy', 'healthy', 'thirsty', 'veryThirsty', null];

function createInitialState(hasOnboarded = false): GardenState {
  const today = new Date();
  return {
    hasOnboarded,
    today: toISODate(today),
    user: createMockUser(today),
    room: MOCK_ROOM,
    plants: createMockPlants(today),
    weather: MOCK_WEATHER,
    notifications: { watering: true, environment: true },
    lastWateredEventAt: null,
    characterOverride: null,
    windowScans: {},
    serverSpecies: {},
    sync: DEMO_SYNC,
    dliMap: null,
    dliCheck: IDLE_CHECK,
  };
}

function reducer(state: GardenState, action: Action): GardenState {
  switch (action.type) {
    case 'completeOnboarding':
      return { ...state, hasOnboarded: true };
    case 'restartOnboarding':
      return { ...state, hasOnboarded: false };
    case 'waterPlants':
      return {
        ...state,
        plants: state.plants.map((p) =>
          action.plantIds.includes(p.id) ? { ...p, lastWateredAt: state.today } : p,
        ),
        lastWateredEventAt: action.at,
        characterOverride: null,
      };
    case 'addPlant': {
      const { input } = action;
      const occupied = state.plants.map((p) => p.location.position);
      const plant: Plant = {
        id: input.id,
        serverId: input.serverId,
        name: input.name,
        speciesId: input.speciesId,
        preferredLight: input.preferredLight,
        wateringIntervalDays: input.wateringIntervalDays,
        lastWateredAt: state.today,
        location: { position: input.position, label: input.locationLabel },
        roomId: state.room.id,
        addedAt: state.today,
        analysis: analyzePlacement(
          state.room,
          { position: input.position, preferredLight: input.preferredLight, label: input.locationLabel },
          occupied,
        ),
      };
      return { ...state, plants: [...state.plants, plant] };
    }
    case 'applyRecommendation':
      return {
        ...state,
        plants: state.plants.map((p) => {
          const rec = p.analysis.recommended;
          if (p.id !== action.plantId || !rec) return p;
          return {
            ...p,
            location: { position: rec.position, label: rec.label },
            analysis: {
              current: {
                position: rec.position,
                label: rec.label,
                score: rec.score,
                lightLevel: rec.lightLevel,
                lightValue: rec.lightValue,
                expectedSunHours: rec.expectedSunHours,
              },
              recommended: null,
              message: '지금 위치가 가장 잘 맞아요.',
            },
          };
        }),
      };
    case 'setRoom':
      return { ...state, room: action.room };
    case 'toggleNotification':
      return {
        ...state,
        notifications: { ...state.notifications, [action.key]: !state.notifications[action.key] },
      };
    case 'cycleCharacter': {
      const index = CHARACTER_CYCLE.indexOf(state.characterOverride);
      return { ...state, characterOverride: CHARACTER_CYCLE[(index + 1) % CHARACTER_CYCLE.length] };
    }
    case 'saveWindowScan':
      return { ...state, windowScans: { ...state.windowScans, [action.scan.windowId]: action.scan } };
    case 'removePlant':
      return { ...state, plants: state.plants.filter((p) => p.id !== action.plantId) };
    case 'clearPlants':
      return { ...state, plants: [] };
    case 'resetDemo':
      return createInitialState(true);
    case 'syncStart':
      return { ...state, sync: { ...state.sync, status: 'loading', message: null } };
    case 'syncSuccess':
      return {
        ...state,
        serverSpecies: action.links,
        plants: action.plants,
        room: action.room,
        dliMap: action.dliMap,
        dliCheck: IDLE_CHECK,
        sync: { status: 'synced', message: null, skipped: action.skipped },
      };
    case 'syncError':
      return { ...state, sync: { ...state.sync, status: 'error', message: action.message } };
    case 'dliCheck':
      return { ...state, dliCheck: action.check };
    case 'enterDemo':
      return {
        ...state,
        room: MOCK_ROOM,
        plants: createMockPlants(parseISODate(state.today)),
        serverSpecies: {},
        sync: DEMO_SYNC,
        dliMap: null,
        dliCheck: IDLE_CHECK,
      };
    default:
      return state;
  }
}

interface GardenActions {
  completeOnboarding: () => void;
  restartOnboarding: () => void;
  waterPlants: (plantIds: string[]) => void;
  /** 로그인 상태면 서버에 먼저 등록한다. 새 식물 id를 돌려준다 */
  createPlant: (input: Omit<NewPlantInput, 'id' | 'serverId'>) => Promise<string>;
  /** 로그인 상태면 서버에서도 삭제한다 */
  deletePlant: (plantId: string) => Promise<void>;
  /** 서버에서 식물·식물 종·방을 다시 받아온다 (로그인 상태에서만) */
  reloadFromServer: () => Promise<void>;
  /** 로그인 상태이고 서버 방이면 서버 위치도 바꾼다 */
  applyRecommendation: (plantId: string) => Promise<void>;
  setRoom: (room: Room) => void;
  toggleNotification: (key: keyof NotificationSettings) => void;
  cycleCharacter: () => void;
  clearPlants: () => void;
  resetDemo: () => void;
  saveWindowScan: (scan: WindowScan) => void;
}

interface GardenContextValue {
  state: GardenState;
  today: Date;
  actions: GardenActions;
}

const GardenContext = createContext<GardenContextValue | null>(null);

export function GardenProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, false, createInitialState);
  const { status: authStatus, user: authUser } = useAuth();

  // action은 한 번만 만들고, 최신 state·로그인 상태는 ref로 읽는다
  const stateRef = useRef(state);
  const signedInRef = useRef(authStatus === 'signedIn');
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const actions = useMemo<GardenActions>(() => {
    const reloadFromServer = async () => {
      if (!signedInRef.current) return;
      dispatch({ type: 'syncStart' });
      let dliMap: ApiDliMap | null = null;
      try {
        const [species, serverPlants, rooms] = await Promise.all([
          api.fetchAllSpecies(),
          api.fetchAllPlants(),
          api.fetchRooms(),
        ]);
        const links = linkSpecies(species);
        const { plants, today } = stateRef.current;

        // 서버에 측정한 방이 있으면 가장 최근 방을 쓰고, 없으면 데모 방을 그대로 둔다
        let room: Room = MOCK_ROOM;
        const latest = rooms.reduce<(typeof rooms)[number] | null>((a, b) => (!a || b.id > a.id ? b : a), null);
        if (latest) {
          const [windows, grid] = await Promise.all([api.fetchWindows(latest.id), api.fetchGrid(latest.id)]);
          room = roomFromServer(latest, windows, grid);
          // DLI 계산 API가 생기기 전까지는 같은 형식의 예시 지도
          dliMap = buildMockDliMap(room, grid, today);
        }

        const result = plantsFromServer(serverPlants, links, room, plants, today);
        dispatch({ type: 'syncSuccess', links, plants: result.plants, skipped: result.skipped, room, dliMap });
      } catch (e) {
        dispatch({ type: 'syncError', message: errorMessage(e) });
        return;
      }

      // DLI 지도 JSON이 서버 규격(dli_map_v2)과 맞는지 서버에 검증 요청
      if (dliMap) {
        dispatch({ type: 'dliCheck', check: { status: 'checking', message: null } });
        try {
          await api.validateDliMap(dliMap);
          dispatch({ type: 'dliCheck', check: { status: 'ok', message: null } });
        } catch (e) {
          dispatch({ type: 'dliCheck', check: { status: 'error', message: errorMessage(e) } });
        }
      }
    };

    return {
      completeOnboarding: () => dispatch({ type: 'completeOnboarding' }),
      restartOnboarding: () => dispatch({ type: 'restartOnboarding' }),
      waterPlants: (plantIds) => dispatch({ type: 'waterPlants', plantIds, at: Date.now() }),
      createPlant: async (input) => {
        if (!signedInRef.current) {
          const id = `p-${Date.now().toString(36)}`;
          dispatch({ type: 'addPlant', input: { ...input, id } });
          return id;
        }
        const species = stateRef.current.serverSpecies[input.speciesId];
        if (!species) throw new Error('서버에 없는 식물 종이에요');
        // 서버 방이면 셀 중심의 실제 좌표로, 데모 방이면 미배치(room·position 없음)로 저장한다
        const { room } = stateRef.current;
        const position = cellToReal(room, input.position);
        const created = await api.createPlant({
          speciesId: species.id,
          nickname: input.name,
          roomId: position ? room.server!.roomId : null,
          position,
        });
        const id = `s-${created.id}`;
        dispatch({ type: 'addPlant', input: { ...input, id, serverId: created.id } });
        return id;
      },
      deletePlant: async (plantId) => {
        const plant = stateRef.current.plants.find((p) => p.id === plantId);
        if (!plant) return;
        if (plant.serverId !== undefined && signedInRef.current) await api.deletePlant(plant.serverId);
        dispatch({ type: 'removePlant', plantId });
      },
      reloadFromServer,
      applyRecommendation: async (plantId) => {
        const { plants, room, serverSpecies } = stateRef.current;
        const plant = plants.find((p) => p.id === plantId);
        const rec = plant?.analysis.recommended;
        const species = plant ? serverSpecies[plant.speciesId] : undefined;
        const position = rec ? cellToReal(room, rec.position) : null;
        // 서버 방에 있는 서버 식물이면 서버 위치도 바꾼다 (PUT은 전체 교체라 모든 필드를 보낸다)
        if (signedInRef.current && plant?.serverId !== undefined && species && position) {
          await api.updatePlant(plant.serverId, { speciesId: species.id, nickname: plant.name, roomId: room.server!.roomId, position });
        }
        dispatch({ type: 'applyRecommendation', plantId });
      },
      setRoom: (room) => dispatch({ type: 'setRoom', room }),
      toggleNotification: (key) => dispatch({ type: 'toggleNotification', key }),
      cycleCharacter: () => dispatch({ type: 'cycleCharacter' }),
      clearPlants: () => dispatch({ type: 'clearPlants' }),
      resetDemo: () => {
        dispatch({ type: 'resetDemo' });
        // 로그인 상태면 데모 데이터 대신 서버 데이터를 다시 받는다
        if (signedInRef.current) reloadFromServer();
      },
      saveWindowScan: (scan) => dispatch({ type: 'saveWindowScan', scan }),
    };
  }, []);

  // 로그인하면 서버 데이터로, 로그아웃하면 데모 데이터로 바꾼다
  useEffect(() => {
    const wasSignedIn = signedInRef.current;
    signedInRef.current = authStatus === 'signedIn';
    if (authStatus === 'signedIn') actions.reloadFromServer();
    else if (authStatus === 'signedOut' && wasSignedIn) dispatch({ type: 'enterDemo' });
  }, [authStatus, actions]);

  const today = useMemo(() => parseISODate(state.today), [state.today]);
  // 로그인하면 프로필은 서버 계정 정보로 보여준다 (데모 프로필은 state에 그대로 둔다)
  const value = useMemo(() => {
    const user: UserProfile = authUser
      ? {
          ...state.user,
          name: authUser.nickname,
          nameEn: authUser.nickname,
          email: authUser.email,
          joinedAt: authUser.createdAt.slice(0, 10),
        }
      : state.user;
    return { state: user === state.user ? state : { ...state, user }, today, actions };
  }, [state, today, actions, authUser]);

  return <GardenContext.Provider value={value}>{children}</GardenContext.Provider>;
}

export function useGarden(): GardenContextValue {
  const ctx = useContext(GardenContext);
  if (!ctx) throw new Error('useGarden must be used inside <GardenProvider>');
  return ctx;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return '알 수 없는 오류가 났어요';
}

export function usePlant(id: string | undefined): Plant | undefined {
  const { state } = useGarden();
  return state.plants.find((p) => p.id === id);
}

/** timestamp로부터 durationMs 동안만 true */
export function useRecentFlag(timestamp: number | null, durationMs: number): boolean {
  // 만료된 timestamp를 기억해 두고, 새 timestamp가 들어오면 다시 true
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!timestamp) return;
    const remaining = Math.max(0, timestamp + durationMs - Date.now());
    const t = setTimeout(() => setExpired(timestamp), remaining);
    return () => clearTimeout(t);
  }, [timestamp, durationMs]);
  return !!timestamp && expired !== timestamp;
}
