import type { Room } from '@/types';

/**
 * Mock 공간 데이터 — "내 방 / 남동향 / 창문 2개"
 *
 * 9 x 11 grid, 1칸 = 0.45m → 약 4.0m x 5.0m
 * 평면도 위쪽 = 동쪽 (북쪽은 왼쪽) → 위쪽 벽은 동쪽, 오른쪽 벽은 남쪽을 본다
 *
 *   ┌──[ 창문(동) ]──┐
 *   │서랍장           │
 *   │              창문(남)
 *   │                 │
 *   │책상 🌿           │
 *   │책상 의자     침대 │
 *   │책상          침대 │
 *   │옷장          침대 │
 *   └────[ 문 ]───────┘
 *
 * 실제 스캔 결과가 들어오면 같은 구조로 변환해 교체한다.
 */
export const MOCK_ROOM: Room = {
  id: 'room-1',
  name: '내 방',
  orientation: 'SE',
  orientationLabel: '남동향',
  cols: 9,
  rows: 11,
  cellSizeM: 0.45,
  windows: [
    { id: 'window-east', wall: 'top', offset: 2, length: 4, facing: 'E' },
    { id: 'window-south', wall: 'right', offset: 2, length: 3, facing: 'S' },
  ],
  doors: [{ id: 'door-main', wall: 'bottom', offset: 3, length: 2, hinge: 'start' }],
  furniture: [
    { id: 'f-drawer', type: 'drawer', label: '서랍장', x: 0, y: 0, w: 2, h: 1, surface: true },
    { id: 'f-desk', type: 'desk', label: '책상', x: 0, y: 5, w: 2, h: 3, surface: true },
    { id: 'f-chair', type: 'chair', label: '의자', x: 2, y: 6, w: 1, h: 1 },
    { id: 'f-bed', type: 'bed', label: '침대', x: 6, y: 6, w: 3, h: 5 },
    { id: 'f-wardrobe', type: 'wardrobe', label: '옷장', x: 0, y: 9, w: 2, h: 2 },
  ],
  spots: [
    { id: 'spot-window', label: '창가', position: { x: 5, y: 0 } },
    { id: 'spot-near-window', label: '창문 근처', position: { x: 3, y: 2 } },
    { id: 'spot-desk-side', label: '책상 옆', position: { x: 2, y: 5 } },
    { id: 'spot-desk-top', label: '책상 위', position: { x: 1, y: 5 } },
    { id: 'spot-drawer-top', label: '서랍장 위', position: { x: 1, y: 0 } },
    { id: 'spot-bed-side', label: '침대 옆', position: { x: 5, y: 6 } },
    { id: 'spot-wardrobe-side', label: '옷장 옆', position: { x: 2, y: 9 } },
    { id: 'spot-center', label: '방 가운데', position: { x: 4, y: 5 } },
  ],
  // 하루 평균 광량 지수(0~100, ×0.08 = 예시 DLI). 추정식 값은 평면도의 빛줄기(창문 앞 크림색 덧칠) 바깥인
  // 창문 사이 모서리(오른쪽 위)가 가장 진하게 보여서, 예시 방은 직접 잡은 값을 쓴다.
  // 직사광은 빛줄기 안에만 주고 그 밖은 산란광만 둔다. (5,6)은 스킨답서스가 '잘 맞는' 자리(4 이상)로 맞춘 값.
  lightMaps: {
    average: [
      [29, 35, 99, 99, 99, 99, 35, 29, 29],
      [27, 29, 81, 81, 81, 81, 29, 29, 35],
      [24, 25, 62, 62, 64, 81, 59, 77, 94],
      [21, 22, 42, 42, 44, 62, 80, 77, 94],
      [19, 20, 22, 22, 23, 43, 61, 77, 94],
      [18, 18, 18, 18, 23, 47, 26, 29, 35],
      [17, 17, 17, 18, 25, 54, 30, 27, 29],
      [16, 16, 17, 18, 20, 26, 23, 24, 25],
      [16, 16, 17, 17, 18, 19, 20, 21, 22],
      [16, 16, 16, 17, 17, 18, 19, 19, 20],
      [16, 16, 16, 16, 17, 17, 18, 18, 18],
    ],
  },
  // 예시 위치 — 날씨는 이 위치의 실제 예보를 보여주고, 화면에 '예시 방'으로 표시한다
  location: { latitude: 37.5663, longitude: 126.9019, label: '서울 마포구', demo: true },
};
