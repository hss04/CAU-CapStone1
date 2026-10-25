import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';

import { createMockPlants } from '@/data/mockPlants';
import { MOCK_ROOM } from '@/data/mockRoom';
import { createMockUser, MOCK_WEATHER } from '@/data/mockUser';
import { analyzePlacement } from '@/services/placement/placementEngine';
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
import { parseISODate, toISODate } from '@/utils/date';

/**
 * 앱 전역 상태 (Mock).
 * 백엔드가 연결되면 각 action 안에서 API를 호출하고 응답으로 state를 갱신하는 구조로 확장한다.
 */

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
}

export interface NewPlantInput {
  id: string;
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
  | { type: 'clearPlants' }
  | { type: 'resetDemo' }
  | { type: 'saveWindowScan'; scan: WindowScan };

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
    case 'clearPlants':
      return { ...state, plants: [] };
    case 'resetDemo':
      return createInitialState(true);
    default:
      return state;
  }
}

interface GardenActions {
  completeOnboarding: () => void;
  restartOnboarding: () => void;
  waterPlants: (plantIds: string[]) => void;
  addPlant: (input: Omit<NewPlantInput, 'id'>) => string;
  applyRecommendation: (plantId: string) => void;
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

  const actions = useMemo<GardenActions>(
    () => ({
      completeOnboarding: () => dispatch({ type: 'completeOnboarding' }),
      restartOnboarding: () => dispatch({ type: 'restartOnboarding' }),
      waterPlants: (plantIds) => dispatch({ type: 'waterPlants', plantIds, at: Date.now() }),
      addPlant: (input) => {
        const id = `p-${Date.now().toString(36)}`;
        dispatch({ type: 'addPlant', input: { ...input, id } });
        return id;
      },
      applyRecommendation: (plantId) => dispatch({ type: 'applyRecommendation', plantId }),
      setRoom: (room) => dispatch({ type: 'setRoom', room }),
      toggleNotification: (key) => dispatch({ type: 'toggleNotification', key }),
      cycleCharacter: () => dispatch({ type: 'cycleCharacter' }),
      clearPlants: () => dispatch({ type: 'clearPlants' }),
      resetDemo: () => dispatch({ type: 'resetDemo' }),
      saveWindowScan: (scan) => dispatch({ type: 'saveWindowScan', scan }),
    }),
    [],
  );

  const today = useMemo(() => parseISODate(state.today), [state.today]);
  const value = useMemo(() => ({ state, today, actions }), [state, today, actions]);

  return <GardenContext.Provider value={value}>{children}</GardenContext.Provider>;
}

export function useGarden(): GardenContextValue {
  const ctx = useContext(GardenContext);
  if (!ctx) throw new Error('useGarden must be used inside <GardenProvider>');
  return ctx;
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
