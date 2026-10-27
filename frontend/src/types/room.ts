/**
 * 방(공간) 데이터 모델.
 *
 * 모든 좌표는 grid cell 단위이다. (0, 0)은 평면도의 좌상단 셀.
 * 백엔드의 실제 스캔 결과를 이 형태로 변환하기만 하면
 * FloorPlanGrid / 배치 추천 로직이 그대로 동작한다.
 */

export type GridPosition = { x: number; y: number };

export type WallSide = 'top' | 'right' | 'bottom' | 'left';

export type CompassDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** 벽 위의 개구부(창문, 문). offset/length는 셀 단위. top/bottom은 왼쪽부터, left/right는 위쪽부터 잰다. */
export interface WallOpening {
  id: string;
  wall: WallSide;
  offset: number;
  length: number;
}

/** grid 좌표계 선분 (셀 단위, 소수 가능) */
export interface GridSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RoomWindow extends WallOpening {
  /** 창문이 바라보는 방향 — 시간대별 일조량 추정에 사용 */
  facing: CompassDirection;
  /** 방 방향(x_axis_azimuth_deg)을 아직 몰라 facing이 임시값인 창문 */
  facingUnknown?: boolean;
  /** 서버 창문 이름 (예: "창문 1") */
  label?: string;
  /** 서버(백엔드) 창문 ID — 서버 방의 창문만 있다 (창밖 스캔 업로드용) */
  serverId?: number;
  /**
   * 다각형 방(서버 방)의 창문: 벽이 기울어져 있을 수 있어 wall/offset 대신 바닥 선분으로 위치를 준다.
   * 있으면 wall/offset/length보다 우선한다.
   */
  segment?: GridSegment;
  /** segment 창문의 방 안쪽 단위 법선 (grid 좌표) */
  inward?: { x: number; y: number };
}

export interface RoomDoor extends WallOpening {
  /** 문 경첩 위치 (개구부의 시작/끝) */
  hinge: 'start' | 'end';
}

export type FurnitureType =
  | 'bed'
  | 'desk'
  | 'chair'
  | 'drawer'
  | 'wardrobe'
  | 'sofa'
  | 'shelf'
  | 'table';

export interface Furniture {
  id: string;
  type: FurnitureType;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 위에 화분을 올려둘 수 있는 가구인지 (책상, 서랍장 등) */
  surface?: boolean;
}

export type LightLevel = 'high' | 'medium' | 'low';

export type TimeOfDay = 'average' | 'morning' | 'noon' | 'afternoon';

/** 사용자가 고르기 쉬운 이름 붙은 위치 (식물 등록 시 사용) */
export interface RoomSpot {
  id: string;
  label: string;
  position: GridPosition;
}

/** 방이 있는 지역 (날씨·일사량 조회용). 서버 Room.latitude/longitude */
export interface RoomLocation {
  latitude: number;
  longitude: number;
  /** 지역 이름 (예: 서울 마포구). 서버 방에는 아직 이름이 없어 비어 있을 수 있다 */
  label?: string;
  /** 데모 방의 예시 위치 */
  demo?: boolean;
}

/** rows x cols 크기의 2차원 배열. 값은 0~100의 상대 광량 지수. */
export type LightMap = number[][];

export interface Room {
  id: string;
  name: string;
  orientation: CompassDirection;
  orientationLabel: string;
  /** 방 방향을 아직 측정하지 않아 orientation이 임시값 */
  orientationUnknown?: boolean;
  cols: number;
  rows: number;
  /** 셀 한 칸의 실제 길이 (m) */
  cellSizeM: number;
  windows: RoomWindow[];
  doors: RoomDoor[];
  furniture: Furniture[];
  spots: RoomSpot[];
  /** 백엔드에서 분석된 광량 맵이 있으면 사용, 없으면 창문 정보로 추정한다. */
  lightMaps?: Partial<Record<TimeOfDay, LightMap>>;
  scannedAt?: string;
  /** 다각형 방의 바닥 외곽선 (grid 좌표, 꼭짓점 순서대로). 없으면 cols × rows 직사각형 */
  outline?: { x: number; y: number }[];
  /** [row][col] 셀 중심이 방 안인지 (서버 grid_v2 inside_mask). 없으면 모든 셀이 방 안 */
  insideMask?: boolean[][];
  /** 서버(백엔드) 방과 연결된 경우 좌표 변환 정보 */
  server?: ServerRoomRef;
  /** 위경도가 저장된 방만 있다 */
  location?: RoomLocation;
  /** 사용자가 지정한 배치 불가 칸 (가구 등). 서버에는 추천 요청 때 blocked_cells로만 보낸다 */
  blockedCells?: GridPosition[];
}

/** DLI 지도 계산 기간 — 오늘까지 최근 N일 평균 (백엔드 최대 93일) */
export type DliPeriod = 'week' | 'month' | 'season';

/** 서버 방 좌표(m) ↔ 앱 grid 셀 변환에 필요한 값 (grid_v2 기준) */
export interface ServerRoomRef {
  roomId: number;
  geometryVersion: number;
  /** grid 원점 = 방 x, z 최솟값 (m) */
  originX: number;
  originZ: number;
  /** X축이 가리키는 방위각 (진북 기준). 아직 측정 전이면 null */
  xAxisAzimuthDeg: number | null;
}
