# Android 프로젝트 저장 규격과 백엔드 계약 v2

기준 파일은 제공된 Android 프로젝트의 `RoomCoordinates.kt`, `RoomMeasurementStore.kt`, `WindowMeasurementCalculator.kt`, `RoomAreaCalculator.kt`, `docs/window-data.md`입니다. 앱의 실제 저장 규격을 우선 적용했습니다. DLI 격자는 Android 파일에 정의되어 있지 않아 이 문서의 별도 확장 규격으로 제공합니다.

## 1. 좌표·단위·시간

| 항목 | 규격 |
| --- | --- |
| Android 저장 버전 | `schema_version: 3` (정수) |
| 좌표계 키·값 | `coordinate_system: FIRST_CORNER_ORIGIN_AR_HORIZONTAL` |
| 원점 | 첫 번째 방 모서리의 바닥 투영점 `(0,0,0)` |
| +x / +z | ARCore 세션의 수평축 방향을 그대로 유지 |
| +y | 바닥에서 수직 위쪽 |
| 방 모서리 높이 | 모든 점 `y=0` |
| 창문·식물 높이 | 바닥 기준 실제 높이 유지 |
| 길이 | `m`, HALF_UP 방식으로 소수점 3자리 반올림 |
| 면적 | `area_square_meters`, m², 3자리 |
| 둘레 | `perimeter_meters`, m, 3자리 |
| 시간 | ISO 8601, 한국시간 `+09:00`; DB 가입 시각은 UTC 보관 후 응답 시 KST 변환 |
| 날짜 | `YYYY-MM-DD` |
| JSON 키 | `snake_case` |
| 측정 상태 | `COMPLETE` |

JSON 숫자는 `1.000`과 `1.0`이 같은 숫자입니다. 고정 3자리 표시는 화면에서 포맷팅합니다. 수치를 문자열로 저장하지 않습니다.

**첫 번째 벽 방향으로 축을 회전하지 않습니다.** 두 번째 모서리의 z가 0이 아닐 수 있으며, 음수 x,z도 정상입니다. ARCore 월드 좌표 `(X,Y,Z)`와 첫 방 모서리 `(X0,Y0,Z0)`에서 방 바닥 좌표는 `x=X-X0`, `y=0`, `z=Z-Z0`입니다. 창문 높이는 앱이 별도로 선택한 실제 바닥의 `Yfloor`를 사용하므로 `y=Y-Yfloor`입니다. 첫 번째 방 앵커의 높이를 창문 바닥 높이로 사용하지 않습니다.

진북은 ARCore 수평축에 자동 포함되지 않습니다. 선택 필드 `x_axis_azimuth_deg`는 +x가 향하는 진북 기준 시계방향 각도(0 이상 360 미만)이며, 첨부 앱에는 측정 기능이 없어 기본 null입니다. +z의 방위각은 측정된 +x 방위각에 90°를 더한 값입니다. 자북을 보낼 경우 앱에서 위치·날짜에 따른 자기편차를 적용해야 하며 고정 8~9°를 서버가 임의 적용하지 않습니다. 고도각은 수평선 0°, 천정 90°입니다.

AR 세션을 재시작한 좌표를 기존 좌표와 자동 정합하지 않습니다. 재측정은 새 방으로 가져와야 합니다. 식물 위치도 해당 방 프레임을 사용해야 합니다.

## 2. 방과 창문

방 모서리는 둘레 순서로 4개 이상 저장하며, 첫 점을 마지막에 중복 저장하지 않습니다. `order_index`는 0부터 연속이고, 시계/반시계 모두 지원합니다. 앱과 동일하게 점 간 최소 거리 0.05m, 최소 면적 0.01m², 자기 교차·연속 세 점의 일직선을 검사합니다. 서버 자원 제한으로 방 모서리는 최대 256개입니다.

창문은 **방 안에서 바라본** 다음 순서입니다.

| order_index | 위치 |
| --- | --- |
| 0 | 좌하 |
| 1 | 우하 |
| 2 | 우상 |
| 3 | 좌상 |

창문 `wall_index`는 방 `corners[i] → corners[(i+1)%n]`의 0부터 시작하는 인덱스입니다. 창문 `window_id` 문자열 UUID는 앱에서 발급하며 서버 숫자 `Window.id`와 별도로 보존합니다. 서버 ID는 API 경로용입니다.

| 창문 필드 | 저장 의미 |
| --- | --- |
| `status` | `COMPLETE` |
| `floor_reference` | 선택한 바닥점을 벽에 투영한 좌표, y=0 |
| `sill_height_m` | 바닥에서 창문 하단까지 높이 |
| `width_m`, `height_m` | 창문 자체 폭·높이 |
| `top_height_m` | 바닥에서 창문 상단까지 높이 |
| `area_square_meters` | 폭 × 높이 |
| `corners` | 벽에 투영하고 정렬·보정한 네 모서리 |
| `measured_corners` | 보정 전 네 선택점의 로컬 좌표; order_index 없음 |
| `floor_measurement_method` | `ARCORE_SURFACE_HIT` |
| `window_measurement_method` | `MEASURED_WALL_RAY_INTERSECTION` |
| `max_plane_residual_m` | 보정 전 측정점의 벽 수직 평면 편차 최대값 |
| `saved_at` | ISO 8601, +09:00 |

가져오기 검증은 앱의 원본점 편차 0.35m, 정렬 오차 0.15m, 벽 끝 허용 0.03m를 기준으로 반올림 여유를 적용합니다. 보정된 점은 벽에 붙은 직사각형인지 별도로 검사합니다. 원본점과 보정점·폭·높이·면적이 일치해야 합니다. 잔차는 센서 정확도가 아닙니다. 원래 바닥 hit는 내보내기 전에 벽에 투영되므로 그 원래 편차를 JSON만으로 복원할 수 없습니다. 서버는 잔차 상한과 원본 창문점 편차의 하한을 검사하고 앱 값 자체를 보존합니다.

수동 `/windows` API는 네 점만 받아 3cm 평면·5cm 벽 거리 검증을 적용하며 Android 원본 측정 메타데이터를 만들지 않습니다. 측정 데이터 보존은 아래 가져오기 API를 사용하세요.

## 3. 앱 JSON 가져오기·내보내기

`POST /api/v1/rooms/import-ar?name=내방`에 앱이 저장한 JSON 전체를 **변환 없이** 보냅니다. Bearer 인증이 필요합니다. `examples/ar-room-v3.json`에 모든 필드가 있습니다. 본문 구조:

```json
{
  "schema_version": 3,
  "unit": "m",
  "coordinate_system": "FIRST_CORNER_ORIGIN_AR_HORIZONTAL",
  "saved_at": "2026-10-05T19:31:00+09:00",
  "corners": [],
  "area_square_meters": 12.000,
  "perimeter_meters": 14.000,
  "windows": []
}
```

위 빈 corners는 구조 설명용입니다. 실제 요청에는 예제 파일처럼 4개 이상 점을 넣어야 합니다. 좌표 목록은 Android처럼 order_index 순서여야 합니다. 방·모든 창문을 하나의 트랜잭션으로 저장하며 오류가 있으면 전체를 거절합니다. 반복 호출하면 새 방이 생성됩니다. 자동 중복 병합은 하지 않습니다.

`GET /api/v1/rooms/{room_id}/ar-measurement`는 같은 v3 구조로 내보냅니다. 원본 창문 측정 JSON을 보존하고 방 면적·둘레는 저장 좌표에서 다시 계산합니다. 앱은 반올림 전 방 좌표에서 요약을 계산하므로 서버의 재계산값과 소량 차이가 날 수 있습니다. 이 범위의 반올림 오차를 가져오기 시 허용합니다. 수동 창문이나 이전 좌표계 방은 필요한 메타데이터가 없어 내보내기 409를 반환합니다.

`POST /rooms`의 일반 요청은 `coordinate_system`, `corners`, 이름, 위치 등을 받습니다. 첫 점 원점·모든 y=0 조건은 같으며 점을 order_index로 정렬합니다. 방 응답의 `coordinate_frame`은 이전 클라이언트용 읽기 별칭이며 `coordinate_system`과 같은 값입니다. `floor_area_m2`도 `area_square_meters`의 읽기 별칭입니다.

## 4. 식물·DLI 시각화 확장

식물은 실제 미터 좌표 `position: {x,y,z}`로 저장합니다. x,z는 방 내부여야 하며 y는 평가 높이입니다. 미배치는 room_id와 position을 모두 null로 보냅니다.

`GET /api/v1/rooms/{id}/grid?cell_size_m=1&sample_height_m=0.5`는 `schema_version: grid_v2`를 반환합니다. 좌표계 키는 Android와 같은 `coordinate_system`입니다. 격자 원점은 방 x,z의 최솟값이며 방 첫 모서리 원점과 다를 수 있습니다. 배열 순서는 `[row_z][col_x]`; 행은 +z, 열은 +x로 증가합니다.

```text
col = floor((plant.x - origin.x) / cell_size_m)
row = floor((plant.z - origin.z) / cell_size_m)
center_x = origin.x + (col + 0.5) * cell_size_m
center_y = sample_height_m
center_z = origin.z + (row + 0.5) * cell_size_m
```

최대 경계점은 마지막 행/열로 제한합니다. 셀 중심이 방 안이면 `inside_mask=true`입니다. 가장자리에서 실제 식물은 안에 있어도 셀 중심은 밖일 수 있습니다. 이때 지도 값은 미평가로 표시하거나 실제 식물 좌표를 별도 계산해야 합니다. Plant.y와 sample_height_m가 다르면 지도 값을 그대로 식물 광량으로 해석하지 않습니다. 최대 40,000셀입니다.

DLI Map은 `schema_version: dli_map_v2`, `date`, `timezone: Asia/Seoul`, `unit: mol/m2/day`, 격자 전체와 `direct_dli`, `diffuse_dli`, `total_dli` 배열을 사용합니다. DLI 단위 표기는 물리적으로 mol/m²/day입니다. 같은 격자의 방 밖 셀은 모두 null, 방 안은 유한한 0 이상 수치입니다. `total=direct+diffuse`를 1e-5 오차로 검사합니다. 0과 미평가 null을 구분합니다.

`POST /rooms/{id}/dli-map/validate`는 배열·현재 격자·geometry_version을 검증하며 계산하거나 저장하지 않습니다. 방·창문 변경 시 geometry_version이 증가하고 이전 지도는 409로 거절됩니다. 예제는 가상 수치입니다. 이 DLI 배열 규격은 Android 원본 파일에 없는 확장안이며 시각화 담당자와 합의해야 합니다.

향후 외부 스캔의 방위각·고도각은 위 진북 기준을 사용하며 일사량 W/m², PPFD μmol/m²/s, DLI mol/m²/day를 구분합니다. SkyVisibility는 `SKY`, `NON_SKY`, `UNKNOWN`으로 분리하는 확장안이며 아직 저장 API가 없습니다. 추천 진단도 향후 구현 범위입니다.

## 5. 이전 백엔드 데이터

이전 `room_local_v1`은 첫 벽 방향으로 회전한 다른 프레임입니다. 이름만 새 프레임으로 바꾸면 좌표가 틀립니다. 서버를 정지한 뒤 `python scripts/migrate_v3.py`로 SQLite의 메타데이터 컬럼을 추가하세요. 스크립트는 먼저 DB를 백업하고 기존 좌표·사용자·식물을 유지합니다. 이전 방은 읽기·삭제가 가능하지만 새 격자·DLI·v3 내보내기는 409로 거절합니다. 기존 방의 원본 Android v3 JSON을 **새 방으로 가져와** 좌표를 맞추고 식물 위치는 해당 프레임에서 재확인하세요. 기존 DLI v1 JSON도 새 grid_v2를 받아 다시 생성해야 합니다.

## 일사량 입력 계약

0.3.0부터 [WEATHER_API.md](WEATHER_API.md)의 시간별 DNI/DHI 계약을 사용합니다. 10분 보간은 C 담당이며, PRECEDING_HOUR_MEAN 의미를 보존해야 합니다.
