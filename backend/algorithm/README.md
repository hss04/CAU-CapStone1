# plant_algorithm_project

실내 식물 배치를 위한 "창문 광량(DLI) 계산 → 진단 → 추천" 알고리즘의 1차 구현.
규격 전체는 [CLAUDE.md](CLAUDE.md) 참고. 이 문서는 `algorithm/` 폴더의 각 파일이 뭘 하는지,
지금 어디까지가 **가짜(Mock) 데이터로 돌리는 중**인지, 실제 서비스로 가려면 뭘 더 만들어야 하는지를 정리한다.

## 백엔드 연동 가이드 (2026-10-28)

이 폴더는 혼자 실행되는 프로그램이 아니라 **백엔드 서버가 불러서 쓰는 계산 함수 모음**이다.
앱에서 사용자가 요청하면 → 서버가 DB·날씨에서 재료를 모아 → 아래 함수를 호출하고 → 결과를 저장·전달한다.

### 서버에 연결하는 법 (백엔드 `.env`)

```
DLI_CALLABLE=grid_dli_service:compute_room_dli
DIRECTION_CALLABLE=room_geometry:compute_room_direction
RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room
```

백엔드 `algorithm_worker.py`가 subprocess에서 이 폴더를 `sys.path`에 넣고 `module:function`을 import해서
`function(payload_dict)`로 부른다. 패키지 방식(`from algorithm.grid_dli_service import ...`)으로도 import 된다.

### 함수별 입력 → 출력

| 함수 | 입력 (백엔드 `integration.py`가 만드는 dict) | 출력 |
|---|---|---|
| `compute_room_dli` (하루치 DLI) | `date`, `room{corners[{order_index,x,z}], x_axis_azimuth_deg, latitude, longitude}`, `grid`(백엔드 grid_v2 그대로), `windows[{window_id, wall_index, v0..v3, sky 또는 None}]`, `dni_dhi[{time,dni,dhi}]`, `time_basis`, `mock_sky` | `{date, direct_dli, diffuse_dli, total_dli, warnings}` — 배열 `[row_z][col_x]`, 방 밖 칸 `null`, 소수 2자리 |
| `compute_room_direction` (방 방향) | `corners[{order_index,x,z}]`, `windows[{wall_index, window_azimuth_deg, (선택) v0,v1,v3}]` | `{x_axis_azimuth_deg (0≤값<360), per_window, spread_deg, warnings}` |
| `recommend_for_room` (진단·추천) | `room_id`, `dli_map`(완료된 DLI 결과), `plants[{plant_id, species_id, position{x,y,z} 또는 null, min_dli, max_dli}]`, `blocked_cells[{row,col}]` | `{room_id, date, period, plants[{plant_id, species_id, required_dli, current 또는 null, recommended 또는 null}], warnings}` (CLAUDE.md 10장 형식) |

자세한 키 설명은 각 함수 docstring에 있다. 계산 규칙 요약:

- **격자**: 백엔드 grid를 그대로 씀. 칸 중심 = `origin + (idx + 0.5) × cell_size_m`, 높이 = `sample_height_m`.
  `inside_mask`가 false인 칸은 계산하지 않고 `null`. AR 축 원점을 그대로 쓰므로 음수 좌표도 정상.
- **창문 여러 개**: 직사광은 창문 중 하나라도 [그 창문 SKY에서 해 위치가 하늘 + Ray 통과]면 1, 산란광은 창문별 합.
- **ㄱ자 벽 가림**: 평면도에서 칸 중심 → 창문 통과점 선분이 창문 벽(`wall_index`) 외의 벽과 교차하면 가림.
  직사광 Ray와 산란광 샘플 Ray 모두 적용.
- **시간**: 하루 전체 10분 구간 144개(구간 가운데 시각 00:05, 00:15, …), 고도 0° 이하 제외.
- **일사량**: `PRECEDING_HOUR_MEAN`(H시 값 = 직전 1시간 평균)을 그 1시간의 10분 구간 6개에 계단식으로 적용 →
  1시간 평균 에너지 보존. 해 떠 있는 시각의 값이 없으면 오류(조용히 0으로 채우지 않음).
- **방 방향**: 벽 `wall_index`의 바깥 법선 각도 θ(X축 0°, Z축 90°) → `x_axis_azimuth_deg = (창문 정면 방위각 − θ) mod 360`,
  창문 여러 개면 원형 평균. 창문별 값이 15° 넘게 벌어지면 경고, 창문 꼭짓점 법선이 벽과 20° 넘게 다르면 경고.
- **추천**: `score = max(0, 1 − |DLI − 범위 중앙값| / (범위/2))`, OK가 아닌 식물 전체를 헝가리안 배정(자리 중복 없음).
  식물 실좌표 → `row = floor((z−origin.z)/cell)`, `col = floor((x−origin.x)/cell)`. 위치 없음/방 밖이면 `current: null`.

### 백엔드에 알려야 할 것

- `scipy`가 필요함(추천 배정) → backend `requirements.txt`에 추가 필요. 알고리즘 의존성 전체는 `algorithm/requirements.txt`.
- `DLI_CALLABLE`을 설정하면 기존 501 제한(직사각형·창문 1개·높이 0)과 PROVISIONAL 경고가 필요 없어짐(08~18시·보간 문제 해결).
- 계산 방식이 바뀌었으니 `.env`의 `DLI_CACHE_VERSION`을 올려야 예전 캐시가 안 쓰임.
- 기존 `compute_grid_dli`(직사각형 + 창문 1개)도 그대로 동작함. 단, 이제 하루 전체를 계산하므로 일사량이 하루치(25개) 다 있어야 함.
- **한글 경로에서 스캔 사진을 못 읽는 문제** (2026-10-28 영상 테스트 중 발견): OpenCV `cv2.imread`/`cv2.imwrite`는
  Windows에서 경로에 한글이 있으면 에러 없이 실패함(읽기는 `None` 반환). 백엔드 `app/algorithm_worker.py`가
  스캔 사진을 `cv2.imread(f['path'])`로 읽으므로, 서버를 `C:\Users\홍길동\바탕 화면\...`처럼 한글이 들어간 경로에서 돌리면
  사진을 못 읽어 `Invalid frame dimensions`로 스캔 작업이 전부 FAILED가 됨. 해결 방법(백엔드 쪽):
  - **A (추천)**: `cv2.imread(path)` → `cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)` 한 줄 교체. 결과는 같은 BGR 배열
  - B: Pillow `Image.open(path)`로 읽기. 단 RGB 순서라 `c_sky.ScanFrame.image`(BGR 기준)와 색 순서를 맞춰야 함
  - C: 서버 실행 폴더와 `UPLOAD_ROOT`를 영문 경로로. 코드 수정은 없지만 다른 PC에서 재발 가능

### 알고리즘 쪽 남은 정리

- `c_sky.py`가 맨 위에서 `import cv2`를 해서, 사진과 무관한 DLI 계산(`d_light`가 `c_sky.lookup_sky`를 import)만
  해도 OpenCV 설치가 필요함. 실제로 cv2를 쓰는 곳은 `classify_sky_mask_segformer`의 BGR→RGB 변환 한 줄뿐이라
  numpy(`image[:, :, ::-1]`)로 바꾸면 알고리즘 쪽 OpenCV 의존성을 없앨 수 있음. 동작에는 지장 없어서 보류 중.
  (위 한글 경로 문제는 백엔드가 사진을 읽는 코드라 이걸 고쳐도 해결 안 됨)

### 혼자 확인하는 법 (서버 없이)

```powershell
cd algorithm
pip install -r requirements.txt
python verify_integration.py      # 연동용 변경 검증 (방향, 시간/일사량, 회귀, 음수 좌표, ㄱ자 방, 창문 여러 개, 추천)
python verify_grid_dli_service.py # 기존 진입점 검증
python main.py                    # Mock 데이터로 a→f 전체 데모
```

## 역할 경계 (팀 분담)

| 단계 | 담당 | 비고 |
|---|---|---|
| Room/Window | 백/프론트가 제공 | `d_light.py` 등은 파라미터로만 받아서, 그대로 꽂으면 됨 (Mock 함수는 테스트용) |
| 태양 위치(NREL SPA) | algorithm | `b_solar.py` |
| DNI/DHI | 백엔드가 제공 (Open-Meteo 수집·캐시) | 값이 없으면 `b_solar.py`가 맑은 하늘 모델로 대체(테스트용) |
| 창밖 SKY/NON-SKY(180도 사진 판정) | algorithm | `c_sky.py` |
| 그 판정을 반영한 격자별 일조량(DLI) | algorithm | `d_light.py` — `lookup_sky()`로 SKY 판정을 직사광 계산에 이미 반영함 |
| 진단/추천 | algorithm | `e_diagnosis.py`, `f_recommendation.py` |

## ⚠️ 지금 가짜(Mock) 값인 것들 — 실제 서비스엔 교체/실제 입력 필요

| 항목 | 지금 어떻게 돼있나 | 실제로는 어떻게 받아야 하나 |
|---|---|---|
| Room (좌표/높이/방위각/위경도) | `models.py`의 `build_mock_room()`에 4m×5m×2.5m, 동향 방이 하드코딩돼 있음 (위경도도 서울시청 좌표 고정) | 앱의 ARCore 스캔 결과 + 사용자가 입력한 지역을 백엔드가 위경도로 변환해서 받아야 함 |
| Window (4꼭짓점 좌표) | `build_mock_window()`에 동쪽 벽 창문 1개가 하드코딩돼 있음 | 앱 스캔 결과로 받아야 함 |
| 식물 종 데이터 (min/max DLI) | `build_mock_species()`에 3종(산세베리아/몬스테라/다육)뿐이고, 수치도 Mock 방에서 OK/LOW/HIGH가 다 나오게 **테스트용으로 임의 조정한 값** | Plant Light Database에서 실제 값 가져와야 함 (CLAUDE.md 10-1) |
| 식물 배치 위치 | `build_mock_plants()`에 row/col이 임의로 지정돼 있음 | 사용자가 앱에서 직접 지정 |
| 창밖 SKY/NON-SKY 마스크 | `c_sky.generate_mock_scan()`은 가짜 장애물 구간으로 흉낸 것 (`main.py` 데모에서만 씀) | 사용자가 찍은 사진 13장을 `build_scan_from_frames()`에 넣어서 판정 — 파이프라인은 만들어뒀지만 실제 사진으로 정확도 검증은 아직 안 함 |

## 전체 흐름

```
a_grid → b_solar → c_sky → d_light → e_diagnosis → f_recommendation
```

`main.py`가 이 순서대로 전부 호출해서 한 번에 실행하는 End-to-End 스크립트다.
현재는 Room/Window/식물 데이터를 DB 없이 `models.py`의 Mock 함수로 만들어서 쓴다.

## 파일별 설명

### `models.py`
Room / Window / PlantSpecies / Plant 데이터 클래스 정의 + `build_mock_*()` 함수들.
- `Room`: 바닥 모서리 4개(시계방향), 높이, X축 방위각, 위경도. CLAUDE.md 3장 좌표계 규격 그대로.
- `Window`: 창문 4꼭짓점(좌하→우하→우상→좌상), 방 좌표계.
- **가상 데이터**: `build_mock_room()`(4m×5m×2.5m 방, 동향), `build_mock_window()`(동쪽 벽 창문 1개),
  `build_mock_species()`(산세베리아/몬스테라/다육 3종, min/max DLI는 이 Mock 방의 DLI 범위(~0~5)에
  OK/LOW/HIGH가 다 나오게 **임의로 맞춘 값**), `build_mock_plants()`(식물 3개, 각각 LOW/HIGH/OK 유도용 배치).
  → 실제 종 데이터는 Plant Light Database 값으로 교체 필요 (CLAUDE.md 10-1).

### `a_grid.py`
방을 격자로 나눠 각 셀 중심 좌표 `(x, y=0, z)` 계산. 순수 좌표 변환이라 Mock 아님.
- `generate_grid(room, rows=20, cols=20)`: CLAUDE.md 5장 원 규격대로 칸 "개수" 고정(기본 20×20), 칸
  크기는 방마다 다름.
- `generate_grid_fixed_size(room, cell_size_m=0.2)`: 칸 "크기"를 20cm×20cm로 고정하고, 칸 개수(rows,
  cols)는 방 크기에 맞춰 올림 계산해서 같이 반환함. **`main.py`가 실제로 쓰는 건 이 함수**.
- 백엔드 연동(`compute_room_dli`)에서는 이 두 함수 대신 **백엔드 grid를 그대로** 쓴다
  (`grid_dli_service._cells_from_backend_grid`). 두 함수는 예전 진입점·데모용으로 유지.

### `b_solar.py`
pvlib로 태양 위치 계산(NREL SPA, 진짜 계산). DNI/DHI는 **백엔드가 Open-Meteo에서 받아 넘겨준 값**
(`compute_solar_times(..., dni_dhi=..., time_basis=...)`)을 쓴다.
**하루 전체 10분 구간 144개**(구간 가운데 시각), 고도각>0만. 일사량은 `PRECEDING_HOUR_MEAN` 계단식 배정
(자세한 내용은 맨 위 "백엔드 연동 가이드"). `dni_dhi`를 안 주면(Mock/테스트용) pvlib "맑은 하늘 가정" 모델로 대체.
- `season_sample_dates(reference_date, samples)`: 기준 날짜가 속한 계절 이름(봄/여름/가을/겨울)과,
  그 계절의 **작년** 대표일 N개(기본 6개, 균등 간격)를 돌려줌.
  **[TODO]** 대표일들의 DNI/DHI는 백엔드에서 받아야 함(과거 날짜는 ERA5). 백엔드 연동 경로에서
  이 계절 평균을 어떻게 요청할지는 아직 정해지지 않음 — 없으면 `dni_dhi=None`(맑은 하늘 모델)으로 계산됨.

### `c_sky.py`
창밖 스캔 SKY(1)/NON-SKY(0)/미촬영(-1) 격자 생성 + `-1` 보정(`resolve_unscanned`) + 조회(`lookup_sky`).
- **실제 사진 파이프라인 구현됨**: `build_scan_from_frames(frames, camera)` — 사진 N장(+ 촬영 당시
  방위각/피치/롤, CLAUDE.md 6장 스캔 업로드 규격과 동일)을 받아서 실제로 SKY/NON-SKY 판정까지 끝낸 뒤
  `generate_mock_scan()`과 같은 형식으로 돌려줌 (그대로 `resolve_unscanned()`에 넘기면 됨).
  - `classify_sky_mask_segformer()`: SegFormer(`nvidia/segformer-b0-finetuned-ade-512-512`, ADE20K
    사전학습)로 픽셀별 SKY 판정. `build_scan_from_frames()`의 `classify_fn` 기본값.
    (HSV 색상 규칙 방식과 실제 사진 3장으로 비교했을 때, 색상 규칙은 먼 건물을 하늘로 오판해서
    SegFormer를 채택함)
  - `pixel_to_azimuth_elevation()`: 픽셀 좌표 + 카메라 FOV/해상도 + 촬영 당시 방위각/피치/롤 →
    (방위각, 고도각). 합성 이미지로 보어사이트 불변식(roll=0일 때 사진 중앙이 촬영 방위각/피치와
    일치, roll이 광축 자체는 안 바꾸는지) 검증 완료.
  - 겹치는 사진 영역은 SKY 비율 0.5 이상이면 SKY로(다수결) 합침.
- **가상 데이터로 남아있는 부분**: `generate_mock_scan()`은 사진 없이 d/e/f단계만 단독 테스트할 때 쓰는
  가짜 스캔(임의 장애물 구간)이라 여전히 Mock. `main.py` 데모도 실제 사진이 없어서 아직 이걸 씀.
- **13장 합치기 동작 확인 (2026-10-28)**: 창밖을 돌려 찍은 영상에서 13프레임을 뽑아
  `build_scan_from_frames()` 전체를 실행함. 창틀·벽은 하늘로 오판하지 않았고(0%), 바깥 풍경은 건물
  윤곽을 따라 하늘을 분리함. 겹치는 칸의 판정 불일치는 약 13%이고, 대부분 건물 윤곽 ±2° 이내와
  창틀↔바깥 전환 구간에 몰림. 방향 센서값 없이 각도를 가정한 테스트라 지도의 절대 방위는 검증 안 됨.
  CPU에서 13장 약 20초.
- **남은 일**: ① 더 많은 실제 사진(라벨링 데이터)으로 정식 IoU/정확도 비교 검증, ② 앱이 보낸 실제
  방위·피치·롤로 절대 방위 검증, ③ roll 부호(CLAUDE.md "시계방향 +")가 `pixel_to_azimuth_elevation()`의
  가정과 실기기에서 일치하는지 검증.

### `d_light.py`
- 태양 방향 벡터 계산, Ray–창문 사각형 교차 판정(`ray_window_intersect`)
- 직사광: 시점마다 태양이 SKY이면서 Ray가 창문을 통과하면 `Fdirect=1`
- 1차 산란광: 상반구를 10°×10°로 샘플링해서 창문을 통과하는 비율(`Vwindow_simple`, 고도 가중치 없음) —
  방/창문이 고정이면 격자당 1회만 계산(`build_vwindow_cache`)해서 재사용
- DNI/DHI → PPFD(`k=2.04`) → DLI 적산
- 순수 계산 로직. CLAUDE.md 9장 규격대로 구현됐고 Mock 요소는 없음(입력값인 b, c가 Mock일 뿐).
- **1차 구현, 2단계 중 1단계**: `Vwindow_simple`은 알고리즘 PDF가 "1차 구현"으로 명시한 단순 모델이 맞고,
  고도각 가중치를 안 쓰는 것도 **의도된 설계**임(PDF 5.2장: "고도각에 따른 별도 가중치는 적용하지 않는다").
  TODO 아님.
  **다만 PDF가 그다음 단계로 정의한 "고도화 구현"(`SVF_weighted` — 외부 SKY/NON-SKY + 각 Ray의
  sin(h)×cos(h) 방향별 가중치 반영, PDF 5.3장)이 코드에 아예 없음.** 지금 산란광은 창문 밖이 뚫려있든
  건물로 막혀있든 구분 없이 "창문이 각도상 얼마나 열려있나"만 보는 상태라, 창밖에 큰 건물이 있어도
  산란광 계산엔 전혀 반영 안 됨 — 이건 진짜 TODO.
  **창문 유리 투과율·실내 반사는 PDF 11장("모델의 가정 및 한계")에 명시된 의도된 범위 제외**이고 TODO 아님.
- **창문 여러 개 + 다각형 방 + 벽 가림**: `compute_light_multi()` (백엔드 연동용). 기존
  `ray_window_intersect`/`vwindow_simple`/`lookup_sky`의 판정은 그대로 두고, 창문 반복과 벽 검사
  (`room_geometry.blocked_by_other_walls`)만 추가. 통과점이 필요해서 `ray_window_hit()`(통과점 반환)를
  추가하고 `ray_window_intersect()`는 그걸 감싸도록 바꿈(결과 동일).
- `average_light_results(light_results, label)`: 여러 날짜의 `light_result`를 칸별로 평균내서 하나로
  합침 (PDF 9.4장 "서비스 추천용: 월·계절별 평균 일일 DLI"). `main.py`가 `b_solar.season_sample_dates()`로
  뽑은 계절 대표일들을 각각 계산한 뒤 이 함수로 평균내서 진단/추천(e, f)에 넘김 — 하루치 날씨에 따라
  추천이 매일 바뀌는 문제를 줄이기 위함.

### `e_diagnosis.py`
`total_dli`를 종의 `min_dli`/`max_dli`와 비교해 OK/LOW/HIGH 판정. 규격 그대로, Mock 없음.

### `f_recommendation.py`
LOW/HIGH인 식물에 대해 빈 칸을 추천. 식물끼리 추천 칸 중복 방지.
- **score 계산식은 기본값으로 구현, 팀 확정 필요**: CLAUDE.md 10장 [결정 필요] 항목. 문서가 예시로 든
  "요구 DLI 범위 중앙값과의 차이 기반"을 기본값으로 구현함. 바뀌면 `score()` 함수만 교체하면 됨.
- **불가 칸(`blocked_cells`) 구현됨**: CLAUDE.md 10장 [결정 필요]였던 항목이 ①(요청에 `blocked_cells`
  `[{row, col}]`를 보내 제외)로 확정됨에 따라 `recommend_all(..., blocked_cells=...)`,
  `recommend_top_k_combinations(..., blocked_cells=...)`에 파라미터 추가 — 이미 식물이 있는 칸과 같은
  방식으로 추천 후보에서 제외. `main.py`에 Mock 예시(`BLOCKED_CELLS`) 있음.
- **배치 전략을 전역 최적화로 교체함**: 예전엔 식물을 리스트 순서대로 하나씩 처리하면서 그때그때 제일
  좋은 빈 칸을 집는 탐욕적(greedy) 방식이라 전체 최적이 보장 안 됐음. 지금은 추천이 필요한 식물 전체를
  헝가리안 알고리즘(`scipy.optimize.linear_sum_assignment`)으로 한 번에 배정함. 또한 점수를 그대로
  더하지 않고 `sqrt(score)` 합을 최대화하는데, 오목(concave) 함수라서 "식물 하나가 아주 낮은 점수를
  받는 대신 나머지가 조금씩 좋아지는" 배치보다 "다 같이 적당히 괜찮은" 배치를 선호하게 됨
  (`_assign_best_cells()`).
- **조합 단위 추천 추가됨**: `recommend_top_k_combinations()` — `recommend_all()`은 CLAUDE.md 10장
  규격대로 식물마다 칸 하나씩만 주는데, 이건 그거랑 별개로 "식물1은 A자리, 식물2는 B자리" 처럼
  전체 배치 세트를 점수 높은 순으로 최대 k개 비교해서 보여줌 (식물별 개별 점수 상위 몇 칸만 후보로
  추려서 조합 전수 탐색, 칸 겹치는 조합은 제외). 사용자가 여러 선택지 중 고를 수 있게 하는 용도.
  CLAUDE.md 10장엔 없는 기능이라 백엔드 추천 API에는 아직 연결 안 됨(반영 여부 팀 확인 필요).

### `room_geometry.py` (2026-10-28 추가)
다각형 방 평면도 계산: 벽 목록, 벽 바깥 법선(모서리 순서가 시계/반시계 어느 쪽이어도 동작), ㄱ자 벽 가림 판정,
방 방향 계산(`compute_room_direction`, 백엔드 DIRECTION_CALLABLE).

### `recommend_service.py` (2026-10-28 추가)
백엔드 RECOMMENDATION_CALLABLE. 판정·추천 로직은 `e_diagnosis`/`f_recommendation` 그대로 쓰고,
실좌표 → 칸 변환, 미배치·방 밖 식물 처리, 방 밖 칸 후보 제외만 담당.

### `verify_integration.py` (2026-10-28 추가)
연동용 변경 검증 41개 항목 (방향 손계산·sun_direction 기준 일치, 계단식 일사량 평균 보존, 여러 날짜 입력,
새/예전 진입점 결과 일치, 음수 좌표, ㄱ자 벽 가림, 창문 여러 개, 추천 래퍼, 패키지 import).

### `main.py`
위 6단계를 Mock 데이터로 순서대로 실행하고 중간 결과를 콘솔에 출력하는 데모 스크립트.
실제 서비스의 API 핸들러가 아니라 **알고리즘 단독 검증용**.

## 앞으로 할 일 (TODO)

### 1. 알고리즘 쪽에 남은 결정/보완
- [ ] `score()` 공식을 CLAUDE.md에 공식화해서 기록하고 팀 확정받기 (현재는 기본값)
- [ ] **계절 평균 날짜 선정 방식 확인 필요**: `b_solar.season_sample_dates()`가 지금 "오늘이 속한 계절
      이름으로 봄/여름/가을/겨울 판정 → 그 계절 작년 구간에서 균등 간격 N개"로 구현돼 있음.
      CLAUDE.md는 원래 "춘분/하지/추분/동지 등 또는 월별 대표일" 중 선택하라고 `[결정 필요]`로 남겨뒀던
      항목이라, 지금 방식(계절 전체 균등 샘플링)이 팀이 원하는 방식인지 확인 필요. `main.py`/
      `f_recommendation.py`는 이미 이 평균값(`average_light_results()`)으로 진단/추천하도록 바뀜.
- [x] 여름철 일출~일몰이 08~18시 밖인 문제 → 하루 전체 144구간으로 확장 (10/8 팀 결정, 10/28 반영)
- [x] 일사량 PRECEDING_HOUR_MEAN 처리 → 계단식 배정 (10/28)
- [x] 창문 여러 개, 다각형/ㄱ자 방, 백엔드 grid 입력, 방 방향 함수, 추천 래퍼 (10/28)
- [ ] `grid_dli_bundle.py`는 10/7 기준 복사본이라 위 변경이 반영 안 됨 — 계속 쓸 거면 다시 생성, 아니면 삭제
- [ ] **`SVF_weighted`(고도화 산란광 모델) 구현** — 알고리즘 PDF 5.3/9.1장. 외부 SKY/NON-SKY 마스크와
      각 Ray의 `sin(h)×cos(h)` 방향 가중치를 반영해서 `Vwindow_simple`을 교체. PDF가 권장하는 순서는
      "먼저 1차로 End-to-End 완성 → 센서 검증 → 오차 크면 그때 고도화" (유리 투과율·실내 반사는 범위 제외로 확정됨)
- [ ] 자북→진북 변환 편각(−8.7° 고정값)을 Room 위경도 기반으로 재계산하는 보정 로직 (CLAUDE.md 2장에 "필요하면" 명시)

### 2. 다른 파트 (백엔드·프론트가 담당, 10/27 기준 대부분 구현됨)
- 백엔드 API·DB·스캔 업로드·날씨 수집은 `backend` 브랜치에 구현됨. 알고리즘은 위 "백엔드 연동 가이드"의 함수 3개로 연결.
- [ ] dev 브랜치에서 실제 연동 테스트 (algorithm + backend 합쳐서)

### 3. 테스트/검증
- [x] 자동 검증 스크립트: `verify_d_light.py`, `verify_d_light_virtual_cases.py`, `verify_grid_dli_service.py`,
      `verify_integration.py` (실행하면 항목별 OK/FAIL 출력)
- [ ] **실제 센서(PAR/Quantum) 검증**: 10분별 PPFD 예측값 vs 센서 실측값, 그리고 하루 최종 DLI 예측 vs 실측
      오차를 확인 — 알고리즘 PDF 15장 체크리스트에 명시된 항목("실제 센서 검증: 10분별 PPFD와 최종 일일
      DLI 오차를 확인하여 1차 모델의 오차 수준 기록"). 일반 조도(lux) 센서는 PPFD와 달라서 추가 오차가
      생기니 주의 (PDF 9.4장)

## 실행 방법

서비스에서는 백엔드가 함수를 호출한다(맨 위 "백엔드 연동 가이드"). 혼자 확인할 때:

```powershell
cd algorithm
pip install -r requirements.txt
python main.py                 # Mock 데이터 전체 데모
python verify_integration.py   # 연동용 검증
```

의존성은 `algorithm/requirements.txt`. 맑은 하늘 모델로 돌리면 인터넷 연결 불필요
(SegFormer 첫 실행 때만 Hugging Face에서 모델 다운로드).
