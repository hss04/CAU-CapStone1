# LUMAP — Frontend

> 내 방을 분석해서 식물에게 가장 좋은 위치를 찾아주는 앱

방 스캔 → 공간 생성 → 식물 등록 → 현재 위치의 빛 환경 분석 → 더 적합한 위치 추천 → 물주기 / 햇빛 / 날씨 기반 관리

- React Native 0.86 + **Expo SDK 57** + TypeScript
- **Expo Router** (파일 기반 라우팅, `src/app`)
- react-native-svg (평면도·캐릭터·일러스트), Reanimated 4, lucide 아이콘
- 백엔드 연동 전까지는 **Mock 데이터**로 전체 흐름이 동작합니다.

---

## 실행 방법

```bash
npm install
npx expo start
```

- **휴대폰**: Expo Go(SDK 57 지원 버전)로 터미널의 QR 코드를 스캔
- **웹 시연**: `npx expo start --web` → 브라우저에서 휴대폰 폭(440px)으로 가운데 정렬되어 보입니다.

검사 명령

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npx expo-doctor     # SDK 호환성 점검
```

> 상태는 메모리에만 저장됩니다. 앱을 새로 고치면 온보딩부터 다시 시작합니다(시연용 의도).

---

## 화면 & 라우트

| 화면 | 파일 |
| --- | --- |
| Onboarding (4페이지) | `src/app/onboarding.tsx` |
| Home | `src/app/(tabs)/index.tsx` |
| Space (2D Grid 평면도) | `src/app/(tabs)/space.tsx` |
| Plants | `src/app/(tabs)/plants.tsx` |
| My Page | `src/app/(tabs)/my-page.tsx` |
| Bottom Navigation | `src/app/(tabs)/_layout.tsx` + `components/navigation/BottomTabBar.tsx` |
| Room Scan (Mock) | `src/app/room-scan.tsx` |
| Scan Complete | `src/app/scan-complete.tsx` |
| Add Plant | `src/app/add-plant.tsx` |
| Plant Detail | `src/app/plant/[id].tsx` |
| Placement Recommendation | `src/app/recommendation/[id].tsx` |

온보딩 완료 여부는 `Stack.Protected`로 분기합니다 (`src/app/_layout.tsx`).

---

## 폴더 구조

```
src/
  app/                 라우트(화면)만 둔다
  components/
    common/            ScreenContainer, PageHeader, SectionHeader, Card, PrimaryButton,
                       SecondaryButton, StatusChip, InfoCard, EmptyState, SettingRow,
                       BottomSheet, Toast, SegmentedControl, ScoreRing ...
    character/         PlantCharacter (healthy / happy / thirsty / veryThirsty)
    home/              CharacterCard, WateringAlert, PlacementSummaryCard
    space/             FloorPlanGrid, PlantMarker, SpacePreview, LightLegend, PlantInfoSheet ...
    plants/            PlantCard, PlantIllustration, SpeciesPicker, LocationPicker ...
    scan/              ScanViewfinder(카메라 placeholder), ScanPanel
    onboarding/        온보딩 일러스트
    navigation/        BottomTabBar
  constants/           theme.ts(디자인 토큰), labels.ts(문구), app.ts(서비스명)
  data/                Mock 데이터 (방, 식물, 사용자, 날씨, 식물 종류)
  hooks/               useRoomScan, useTween
  services/
    scan/              RoomScanner 인터페이스의 Mock 구현 + 팩토리
    space/             평면도 geometry, 빛 환경 추정(lightAnalysis)
    placement/         배치 적합도 계산 / 추천 엔진
  store/               GardenProvider(전역 상태) + selectors(파생 상태)
  types/               Room / Plant / Scan 타입
  utils/               날짜, 색상, 한글 조사, 햅틱
```

---

## 디자인 시스템

모든 색·간격·라운드·그림자·타이포는 `src/constants/theme.ts` 한 곳에서 관리합니다.

| 토큰 | 값 |
| --- | --- |
| Background | `#F7F7F1` |
| Surface | `#FFFFFF` |
| Light Green | `#EEF3E8` |
| Primary Green | `#587A5B` |
| Deep Green | `#35523A` |
| Text / Secondary | `#263229` / `#768077` |
| Sunlight / Water | `#F2B84B` / `#77AAC0` |

- 카드 radius 18–28, 부드러운 `boxShadow`
- Heading: Cormorant Garamond(영문·숫자) / Gowun Batang(한글) — `AppText`의 serif variant가 내용에 따라 자동 선택
- 본문: 시스템 sans-serif, 아이콘: lucide (stroke 1.5–1.8)

---

## 백엔드 연동 가이드 (Mock → 실제)

### 1. 방 스캔
UI는 `useRoomScan` 훅의 상태만 그리고, 실제 스캔은 `RoomScanner` 인터페이스 구현체가 담당합니다.

```ts
// src/services/scan/index.ts
export function createRoomScanner(): RoomScanner {
  return new MockRoomScanner({ durationMs: 9000 }); // ← 실제 구현체로 교체
}
```

`RoomScanner`(`src/types/scan.ts`)는 `start / pause / resume / finishNow / cancel`과
`onProgress({ progress, stage, detected })`, `onComplete(ScanResult)` 이벤트만 맞추면 됩니다.
카메라 화면은 `components/scan/ScanViewfinder.tsx`만 교체하면 됩니다.

### 2. 공간 데이터 → 평면도
`FloorPlanGrid`는 `Room` 데이터만으로 그립니다 (`src/types/room.ts`).

- `cols`, `rows`, `cellSizeM` : 격자 크기
- `windows` / `doors` : 벽(`top/right/bottom/left`) + 셀 단위 `offset`, `length`
- `furniture` : `type`, `x`, `y`, `w`, `h` (셀 단위)
- `lightMaps` : 백엔드에서 분석한 광량(0–100) 2차원 배열. 없으면 창문 위치·방향으로 추정

스캔 결과를 이 형태로 변환해 `actions.setRoom(room)`에 넣으면 Space / 추천 화면이 그대로 동작합니다.

### 3. 배치 추천
식물의 `analysis`(`PlacementAnalysis`)가 API 응답 자리입니다.
현재는 Mock 식물은 고정값(62% → 87%), 새로 등록한 식물은 `services/placement/placementEngine.ts`의 로컬 추정 엔진으로 계산합니다.

### 4. 날씨
`src/data/mockUser.ts`의 `MOCK_WEATHER`를 날씨 API 응답으로 교체합니다.

---

## 창밖 180° 스캔 (Window Outside Scan)

Space → 평면도에서 **창문 탭**(또는 "창밖 환경" 목록) → 창문 상세 → **창밖 스캔하기** → 카메라 스캔 → 180° 완료 → (Dev) Scan Result

| 역할 | 파일 |
| --- | --- |
| 방위각 계산 (tilt-compensated compass, wrap-around, smoothing) | `src/services/orientation/headingMath.ts` |
| 센서 구독 (Magnetometer + Accelerometer, Gyroscope 미사용) / 시뮬레이션 | `src/services/orientation/headingSource.ts` |
| 진행 각도·촬영 시점·역방향/과속 판정 (순수 로직) | `src/services/windowScan/scanTracker.ts` |
| 센서 + 카메라 조합, `WindowScan` 생성 | `src/services/windowScan/scanController.ts` |
| 카메라 촬영 (expo-camera) | `src/hooks/useScanCamera.ts` |
| 스캔 화면 / Dev 결과 화면 | `src/app/window-scan/[windowId]/index.tsx`, `result.tsx` |
| 결과 검증(간격·누락·중복) | `src/services/windowScan/scanAnalysis.ts` |

- **방위각**: 가속도계로 "위쪽" 벡터, 자력계로 자기장을 구해 `East = mag × up`, `North = up × East`를 만들고 후면 카메라 축(-z)을 수평면에 투영해 계산합니다. 자북 기준입니다(진북 보정 없음).
  - 가속도계 부호: Android는 측정값이 "위쪽", iOS는 "중력" 방향이라 플랫폼별로 반전합니다.
- **진행 각도**: 시작 순간 방위각을 0°로 두고, 샘플마다 부호 있는 최단 차이(`signedDelta`)를 누적해 0°/360° 경계를 넘어도 연속으로 추적합니다. 왼쪽 → 오른쪽(방위각 증가)만 진행으로 인정합니다.
- **촬영**: 지금까지 가장 멀리 촬영한 지점보다 15° 이상 나아갔을 때만 촬영(중복 방지), 180° 도달 시 마지막 한 장 후 자동 완료. 각 사진에는 셔터 순간의 방위각·pitch·timestamp가 저장됩니다.
- **경고**: 역방향(6° 이상 되돌아감), 과속(32°/s 초과), 기울기(pitch < -25° 또는 > 45°), 자기장 이상(20~75μT 밖).
- **저장**: 서버 업로드 없이 `GardenProvider`의 `windowScans[windowId]`에 저장합니다. 이미지 URI는 카메라 캐시 경로라 앱 재설치/캐시 정리 시 사라질 수 있습니다.
- **Dev 결과 화면**: `DEV_TOOLS_ENABLED`(`src/constants/app.ts`, 기본 `__DEV__`)일 때만 노출됩니다.
- **웹/에뮬레이터**: 자력계·카메라가 없으면 Dev 전용 "시뮬레이션" 버튼으로 전체 흐름만 확인할 수 있습니다(이미지 없음).

설정값(촬영 간격 15°, 목표 180°, 경고 기준)은 `DEFAULT_SCAN_CONFIG`에서, smoothing 강도는 `headingSource.ts` 상단 상수에서 조정합니다.

---

## 시연 팁

- **HOME 캐릭터를 길게 누르면** 캐릭터 상태가 happy → healthy → thirsty → veryThirsty → 자동 순으로 바뀝니다.
- 첫 화면에서는 스킨답서스가 물 줄 날이라 캐릭터가 thirsty 상태입니다. **[물 줬어요]** → 감사 메시지 → 잠시 후 happy.
- **My Page → Demo tools**: 캐릭터 상태 변경, 온보딩 다시 보기, 빈 식물 목록(Empty State), 데모 데이터 초기화
- 스캔 화면의 **[Mock 완료]** 버튼으로 스캔을 바로 끝낼 수 있습니다.
- Space 화면에서 **바닥 칸을 누르면** 그 위치의 빛 환경(High/Medium/Low, 예상 일조 시간)이 표시됩니다.
