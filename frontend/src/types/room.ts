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

export interface RoomWindow extends WallOpening {
  /** 창문이 바라보는 방향 — 시간대별 일조량 추정에 사용 */
  facing: CompassDirection;
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

/** rows x cols 크기의 2차원 배열. 값은 0~100의 상대 광량 지수. */
export type LightMap = number[][];

export interface Room {
  id: string;
  name: string;
  orientation: CompassDirection;
  orientationLabel: string;
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
}
