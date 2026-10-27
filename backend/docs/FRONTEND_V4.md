# 프론트 요청 반영 v0.4.0 — 2026-10-27

기준: plantlight-backend-integrated.zip. API prefix는 `/api/v1`이며 모든 요청에 기존 Bearer 토큰을 사용합니다. 필수 ①~④, 추가 ⑤~⑥, 선택 ⑦~⑧ 및 위치 수정 시 스캔 무효화 버그를 반영했습니다.

## 기존 서버에 적용

1. 서버를 중지하고 기존 프로젝트의 `.env`, `data/plantlight.db`, `data/scans`를 유지합니다. ZIP에는 사용자 DB/비밀키/스캔 사진이 없습니다.
2. 소스 파일을 교체하고 프로젝트 루트에서 아래 명령을 실행합니다. DB 경로가 `.env`에 다르게 지정되어 있으면 그 DB를 사용합니다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\migrate_v4.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

새 설치는 README의 가상환경 및 `scripts/init_env.py` 생성 절차부터 진행합니다. Linux에서는 `python scripts/migrate_v4.py`를 사용합니다. 마이그레이션은 기존 SQLite DB 전체를 `.before-v4-...bak`로 백업하고, 빠진 열/테이블을 추가하며 6종을 등록합니다. 반복 실행해도 기존 식물·방·스캔 ID와 수정한 종 데이터를 유지합니다. 새 DB는 앱 시작 시에도 자동 생성/종 등록됩니다. 기존 DB에 열이 없으면 서버 시작 오류로 마이그레이션 실행을 안내합니다. PostgreSQL용 ALTER 마이그레이션은 포함하지 않았습니다.

기존 작업 방식대로 서버 worker는 1개를 사용하세요. 실행 중이던 메모리 백그라운드 작업은 재시작 시 FAILED로 전환됩니다. 완료된 날짜별 캐시는 DB에 남습니다.

## ① 날짜별 계산

`POST /rooms/{id}/dli-series`

```json
{"start_date":"2026-10-20","end_date":"2026-11-02","cell_size_m":0.2,"sample_height_m":0}
```

응답 HTTP 202:

```json
{"job_id":"UUID","status":"PENDING","status_url":"/api/v1/jobs/UUID"}
```

`GET /jobs/{job_id}`의 `status`가 COMPLETED이면 `result`에 다음 필드가 있습니다.

| 필드 | 내용 |
| --- | --- |
| room_id, geometry_version | 기존 방/구조 버전 |
| grid | 기존 grid_v2; 배열 인덱스는 `[row_z][col_x]` |
| timezone, unit | Asia/Seoul, mol/m2/day |
| mock_sky, temporary_direction, warnings | 모의 하늘/임시 방향 사용 및 계산 제한 표시 |
| days | 날짜 오름차순 결과 배열 |
| days[].date | YYYY-MM-DD |
| days[].dataset | 실제 기상 응답의 ERA5 또는 BEST_MATCH_FORECAST |
| days[].direct_dli, diffuse_dli, total_dli | 각각 2차원 배열; 방 밖은 null, total=direct+diffuse |
| missing_dates | 계산 성공 시 빈 배열; 조회 시 누락·만료 날짜 |
| plants | 아래 ⑦ 참조 |

기간은 양끝 포함 1~93일입니다. 중간 날짜 실패 시 job은 FAILED가 됩니다. 이전 날짜가 이미 DB에 commit되었다면 조회에서 재사용될 수 있지만 부분 저장을 보장하지는 않습니다. 같은 조건으로 POST를 다시 보내면 유효한 날짜는 재계산하지 않습니다. 기존 `/dli-map`도 날짜별 캐시를 저장/재사용하되 응답은 종전의 기간 평균 형식을 유지합니다.

### 기존 알고리즘 제약

실제 계산에는 위치, 방향, 현재 방 구조에 맞는 완료 스캔이 필요합니다. 없으면 기존처럼 422/409를 반환합니다. `mock_sky:true`, `temporary_x_axis_azimuth_deg`는 개발용 선택 필드이며 실제 데이터로 표시하면 안 됩니다.

내장 알고리즘은 축에 맞춘 직사각형 방, 창문 1개, 높이 0만 지원하며 08:00~18:00 계산/시간평균 보간 미해결이라는 기존 제한이 남습니다. 다른 구조는 DLI_CALLABLE 어댑터가 없으면 501입니다. 이 작업은 API·저장 계층 확장이며 계산 모델 자체의 정확도 개선 작업이 아닙니다.

새 `/dli-series`는 요청 예시 그대로 사용할 수 있도록 내장 임시 알고리즘 사용을 기본 허용하며 `warnings`에 PROVISIONAL을 반환합니다. 이를 거부하려면 `accept_provisional_algorithm:false`를 보내세요. 기존 `/dli-map`의 명시적 `accept_provisional_algorithm:true` 요구는 그대로입니다. 사용자 정의 DLI_CALLABLE에는 이 플래그가 영향을 주지 않습니다.

기존 Open-Meteo 정책도 유지합니다: 7일 이상 지난 날짜는 ERA5, 최근 과거/오늘/미래는 BEST_MATCH_FORECAST. 외부 서비스가 지원하지 않거나 완전한 자료를 반환하지 않는 날짜는 실패할 수 있습니다. 데이터셋 이름을 임의 변환하지 않습니다.

## ② 저장된 결과 조회

`GET /rooms/{id}/dli-series?start_date=2026-10-20&end_date=2026-11-02`

계산을 수행하지 않고 위 `result`와 동일한 구조를 바로 HTTP 200으로 반환합니다. 유효한 날짜는 `days`, 없는 날짜/만료 날짜는 `missing_dates`에 넣습니다. 전체 누락도 200 + 빈 days입니다. 위치/스캔/방향 미설정일 때도 유효한 grid가 있으면 누락 목록을 반환합니다.

기본 `cell_size_m=0.2`, `sample_height_m=0`, `mock_sky=false`, 임시 방향 없음입니다. POST에서 다른 값으로 계산했다면 GET에도 **동일한 옵션**을 쿼리로 전달해야 합니다. 다른 격자·높이·모의 하늘·방향 결과를 섞지 않습니다.

캐시 키는 방 구조 버전, 위치, 방향, 창문/스캔 ID와 결과, 격자, 모의/임시 방향, 알고리즘 callable 및 DLI_CACHE_VERSION을 포함합니다. 지역명과 식물 위치는 광량 계산 입력이 아니므로 캐시를 지우지 않습니다. 알고리즘 코드/모델이 바뀌면 `.env`의 `DLI_CACHE_VERSION`을 올리세요.

오늘/미래는 기상자료를 받은 시각부터 최대 1시간입니다. 오래된 기상 캐시로 재계산해도 TTL을 새로 1시간 늘리지 않습니다. 과거 날짜를 **해당 날짜 종료 후 받은 자료로 계산**했다면 시간 만료 없이 재사용합니다. 과거가 된 예보 값은 TTL 만료 후 한 번 다시 계산해야 과거 결과로 고정됩니다. 최근 과거가 나중에 ERA5로 전환되더라도 이미 고정한 결과는 자동 재계산하지 않으며 원래 dataset을 유지합니다.

기존 버전의 기간 평균 job에는 개별 날짜 배열이 없으므로 복원할 수 없습니다. 업데이트 전 결과는 최초 한 번 새 계산이 필요합니다.

앱 흐름: GET 조회 → missing_dates가 있으면 해당 기간 POST(전체 기간 재요청도 캐시 날짜는 건너뜀) → GET /jobs로 완료 확인. 재시작 후 job_id를 기억하지 않아도 됩니다. `GET /jobs` 결과는 작업 당시 스냅샷이며 최신 TTL 판단은 GET /dli-series를 사용합니다.

## ③ 물주기

Plant 생성/수정/목록/상세 응답에 다음 필드를 추가했습니다.

- watering_interval_days: 양의 정수 1~3650, 기본 7. 기본값은 앱 초기 설정이지 모든 종의 재배 권장 주기가 아닙니다.
- last_watered_at: YYYY-MM-DD 또는 null.

`POST /plants/{id}/waterings` 본문 `{"watered_at":"2026-10-27"}` → 갱신된 plant를 HTTP 200으로 반환합니다. 미래 날짜는 422. 동일 날짜 재전송은 멱등적이며 오프라인에서 늦게 도착한 과거 기록이 마지막 물주기 날짜를 뒤로 되돌리지 않습니다. 날짜를 정정하거나 초기화할 때는 PUT /plants/{id}에 last_watered_at을 명시하세요. 기존 클라이언트가 PUT에서 두 신규 필드를 생략하면 저장된 값은 유지됩니다.

요청 범위대로 마지막 날짜를 저장하며 별도의 전체 물주기 이벤트 일지 테이블은 만들지 않았습니다. 소유권은 기존과 동일하게 검사합니다.

## ④ 종 데이터

`app/species_seed.py`에서 신규 DB 시작/마이그레이션 시 다음 6종을 등록합니다. 학명이 이미 있으면 기존 행/ID/사용자 수정값을 덮어쓰지 않습니다. `GET /plant-species?q=Monstera%20deliciosa`처럼 학명 검색도 지원합니다.

| scientific_name | min_dli | max_dli | 근거 수준 |
| --- | ---: | ---: | --- |
| Monstera deliciosa | 4 | 12 | Photone Monstera 속 참고값 |
| Epipremnum aureum | 4 | 14 | Photone Pothos / Epipremnum 참고값 |
| Olea europaea | 18 | 40 | Photone Olive / Olea 참고값 |
| Dracaena trifasciata | 4 | 14 | Photone Snake Plant 항목 |
| Ficus lyrata | 6 | 12 | Photone Ficus 속 참고값; 해당 종 최적값 미검증 |
| Pilea peperomioides | 6 | 12 | 추정 초기값; 종별 정량 DLI 미확인 |

단위는 mol/m2/day입니다. 종별 실험으로 확정한 생존/손상 임계값이 아닙니다. Photone은 재배 시작 참고값을 제공합니다: https://growlightmeter.com/light-requirements-for-plants/ (확인 2026-10-27).

필레아의 NC State 자료는 밝은 간접광을 안내하지만 정량 DLI는 제시하지 않습니다: https://plants.ces.ncsu.edu/plants/pilea-peperomioides/ . 6~12는 앱 초기 중광량 범위 가정으로 설정했으며 `source_note`에 ESTIMATED로 표시했습니다. 이를 논문에서 검증된 종별 수치로 인용하면 안 됩니다. 각 행의 source_note에 URL과 근거 수준을 저장했습니다.

`examples/species-six.json`에도 등록 데이터를 제공합니다. 검증된 값이 확보되면 운영자 `scripts/import_species.py`로 수정할 수 있습니다.

## ⑤ 위치/지역명 및 스캔 유지 수정

`PUT /rooms/{id}/location`:

```json
{"latitude":37.5665,"longitude":126.978,"location_name":"서울특별시 중구"}
```

RoomOut을 반환하며 `GET /rooms`/방 상세에도 location_name을 포함합니다. 생략하면 기존 이름 유지, null이면 지웁니다. 위치 변경은 **geometry_version을 올리지 않습니다.** 기존 완료 스캔은 유효하게 유지됩니다. 광량은 위치에 영향을 받으므로 이전 DLI job은 STALE로 표시하고 이전 위치 캐시는 현재 조건에서 조회하지 않습니다. 이름만 변경하면 광량도 그대로입니다. 실행 도중 위치가 바뀐 DLI 작업은 실패 처리합니다.

## ⑥ 창문별 스캔 상태

`GET /windows/{id}/scans?limit=20` (1~100):

- window_id, geometry_version
- scan_completed: 현재 구조에서 사용 가능한 완료 스캔 존재 여부
- latest: 가장 최근 작업 요약 또는 null
- latest_completed: 현재 구조의 완료 스캔 요약 또는 null
- scans: 최신순 작업 요약 배열

요약에는 job_id, status, error, created_at, captured_at, geometry_version, stale이 있습니다. 큰 SKY 배열/파일 경로는 반환하지 않습니다. 최신 업로드가 실패해도 기존 유효 완료 스캔이 있으면 scan_completed=true입니다. limit과 관계없이 유효 완료 스캔 여부를 확인합니다.

## ⑦ 식물 자리 일일 DLI

series POST 완료 결과 및 GET 응답에 `plants:[{plant_id,row,col,daily:[{date,total_dli}]}]`를 포함합니다. `row=floor((z-origin.z)/cell_size)`, `col=floor((x-origin.x)/cell_size)`이며 바깥쪽 방 경계는 마지막 셀로 처리합니다. 보간 없이 해당 셀 값을 사용합니다.

GET은 식물의 현재 위치를 반영하므로 식물 이동 후 광량 전체를 재계산할 필요가 없습니다. 식물 높이가 sample_height_m과 다르거나 내부 마스크가 아닌 셀에 있으면 잘못된 값을 붙이지 않고 해당 식물을 생략하고 warnings에 사유를 넣습니다. 작업 완료 응답의 plants는 완료 시점의 식물 위치입니다.

## ⑧ 날씨 프록시

`GET /rooms/{id}/weather` → room_id, location_name, latitude, longitude, timezone, source, current, daily, current_units, daily_units, fetched_at, expires_at, cache_hit.

Open-Meteo 현재 날씨와 7일 예보를 전달합니다. current: temperature_2m, relative_humidity_2m, apparent_temperature, is_day, precipitation, weather_code, wind_speed_10m. daily: weather_code, temperature_2m_max/min, sunrise/sunset, precipitation_probability_max. upstream의 daily 배열 구조를 유지합니다. 서버 DB에 위치별 1시간 캐시합니다. 위치가 없으면 422, 외부 오류는 기존 `detail` 오류로 반환합니다.

## 검증과 범위

`python -m pytest -q`로 기존 57개 + 신규 14개 = 71개 통과. 날짜별 배열/평균 호환, 기간 일부 누락, TTL, 예보→과거 경계, 조건 변경, 위치 수정 중 job, 스캔 유지, 새 스캔 후 캐시 무효화, 소유권, 물주기 영속성, 종 seed 멱등성, 기존 DB 마이그레이션 및 날씨 캐시를 확인했습니다.

외부 Open-Meteo 응답과 DLI/SKY 알고리즘 호출은 테스트에서 대체했습니다. 실제 기상 서비스와 GPU/모델 실행, 실측 광량 정확도, Android 앱 UI의 종단 간 연동은 이 테스트 결과에 포함되지 않습니다. 의존성의 TestClient deprecation 경고 1개가 있으며 테스트 실패는 없습니다. 최신 Swagger는 `/docs`, 정적 스키마는 `docs/openapi.json`입니다.

## GitHub backend 브랜치 통합 검증

기존 backend의 AR import Idempotency-Key 중복 방지, idempotency_records 테이블, /ready 준비 상태 확인 및 CORS 헤더 지원을 보존했습니다. 첨부 v4의 71개 테스트에 이 기존 기능의 회귀 테스트 3개를 추가했습니다. 통합 결과 74개 테스트 통과.
