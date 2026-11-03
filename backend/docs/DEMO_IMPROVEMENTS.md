# 시연 및 배치 관리 개선 v0.9.0

기준: backend `6d7da82953e6dae7513c85943c8cb3e566c9eae7`, frontend 연결 점검 `7ad4b327c69f08e44259d55aaab0e34c366e1916`.

## 적용 순서 (Windows)

서버를 종료하고 기존 `.env`와 `data` 폴더를 보존한 상태로 코드를 업데이트합니다. 새 ZIP에는 개인 DB, 비밀키, 촬영 사진을 넣지 않습니다.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\init_env.py
.\.venv\Scripts\python.exe scripts\migrate_v6.py
.\.venv\Scripts\python.exe scripts\check_demo.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

`migrate_v6.py`는 기존 SQLite를 백업하고 필요한 테이블을 추가합니다. v4 이전 컬럼도 기존 마이그레이션으로 추가하며, 기존 ID·식물·달력·성장 사진을 덮어쓰지 않습니다. 이미 최신이면 재실행해도 데이터는 유지됩니다. 신규 테이블은 `job_runtime`, `job_request_keys`, `placement_rules`, `placement_plans`입니다.

`.env`에 다음 함수 설정이 필요합니다. `init_env.py`는 이미 존재하는 빈 값이나 다른 값을 덮어쓰지 않으므로 직접 확인합니다.

```dotenv
DLI_CALLABLE=grid_dli_service:compute_room_dli
DIRECTION_CALLABLE=room_geometry:compute_room_direction
RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room
```

## P0: 추천 사유와 자리 교환

기존 `POST /api/v1/rooms/{id}/recommendations`의 최상위 JSON과 `plants/current/recommended` 필드는 유지합니다. 빈 칸 부족과 광량 불일치는 `warnings`에 `PLANT_<id>_NO_FREE_CELL` 또는 `PLANT_<id>_NO_SUITABLE_CELL`로 추가합니다. `recommended=null`만으로 현재 위치가 적합하다고 판단하면 안 됩니다. 반드시 `current.status == "OK"`도 확인합니다.

새 계획 API는 안정적인 기계 판독용 사유를 별도로 제공합니다.

```http
POST /api/v1/rooms/1/recommendation-plans
Content-Type: application/json

{"dli_job_id":"완료된 DLI 작업 ID","blocked_cells":[]}
```

응답의 `result`는 기존 추천 응답이며, `decisions`는 다음 구조입니다.

```json
{
  "plan_id": "UUID",
  "expires_at": "ISO 8601 UTC",
  "geometry_version": 1,
  "result": {"room_id": 1, "date": "2026-10-01", "period": null, "plants": [], "warnings": []},
  "decisions": [{"plant_id": 1, "reason_code": "RELOCATE", "can_apply": true, "evidence": {}}]
}
```

| reason_code | 의미 | 위치 적용 |
|---|---|---|
| CURRENT_OK | 현재 위치가 요구 범위 안 | 이동하지 않음 |
| RELOCATE | 적합한 후보를 배정함 | 가능 |
| NO_FREE_CELL | 배정 가능한 칸 부족 | 불가 |
| NO_SUITABLE_CELL | 배정 후보도 요구 광량 밖 | 불가 |

기본 추천 함수에 한해 백엔드 어댑터가 이동할 식물의 기존 칸을 동시에 후보로 되돌립니다. 현재 OK인 식물과 가구 칸은 계속 제외합니다. 이에 따라 서로 자리를 바꾸는 배치도 가능합니다. 정우씨의 고정된 `algorithm/` 원본 21개 파일과 점수 공식은 수정하지 않았습니다. 어댑터는 `app/recommendation_worker.py`에 있습니다.

서버 추천의 위치 높이는 DLI 지도 `sample_height_m`와 일치해야 합니다. 불일치는 422이며, 현재 2D 시연에서는 둘 다 0을 사용합니다.

프론트의 기존 오표시는 `frontend-integration/recommendation-null-fix.patch`로 수정할 수 있습니다. 이 패치는 위 frontend 기준 커밋에 맞춰 준비했습니다. 패치 대신 `frontend-integration/updated-files/frontend/src/app/recommendation/[id].tsx`의 수정본을 같은 프론트 경로에 복사할 수도 있습니다. TypeScript 연결 예제는 `frontend-integration/backend-v6.ts`입니다. 화면 수정본만으로 일괄 적용·달력·사진 UI가 새로 추가되는 것은 아니며, 해당 버튼/화면은 프론트 담당자가 새 API에 연결해야 합니다.

## P0: 계산 중복 방지와 진행 상태

`POST /rooms/{id}/dli-map`, `POST /rooms/{id}/dli-series`, `POST /windows/{id}/scans`에 `Idempotency-Key`를 지원합니다. 경로는 모두 `/api/v1` 아래입니다.

- 같은 사용자의 같은 입력이 PENDING/RUNNING이면 기존 job ID를 돌려줍니다.
- 같은 키·같은 입력은 완료 후에도 같은 작업을 돌려줍니다. 같은 키로 다른 입력을 보내면 409입니다.
- 실패한 작업을 새로 실행하려면 새로운 키를 사용합니다.
- 키는 사용자의 계산/스캔 요청 전체에서 유일하게 만드세요. AR 가져오기·성장 사진의 기존 키 처리는 별개입니다.
- 사용자당 진행 중 작업 5개, 전체 20개가 상한입니다. 초과하면 429와 Retry-After를 반환합니다.
- 무거운 작업은 한 프로세스에서 순차 실행하고 알고리즘 subprocess 동시 실행도 1개로 제한합니다. 여러 Uvicorn worker/여러 서버 인스턴스를 지원하는 분산 큐가 아닙니다.
- 202 응답에는 `reused`가 추가됩니다. 응답의 `status=PENDING`은 기존 계약이며, 실제 상태는 `status_url`을 조회합니다.

`GET /jobs/{job_id}`에는 `progress={stage,completed_steps,total_steps}`와 `error_code`가 추가됩니다. DLI는 날짜 단위로 진행하고, 스캔은 분석 작업 전체가 1단계입니다. 추론 내부 프레임별 진행률을 꾸며서 제공하지 않습니다. 재시작된 실행 중 작업은 FAILED/SERVER_RESTARTED이며 다시 요청해야 합니다.

예보 캐시가 만료되거나 계산 버전·방향·위치·스캔·구조가 바뀌면 과거 지도를 새 추천에 재사용하지 않습니다.

## P1: 여러 식물 위치를 한 번에 적용

```http
POST /api/v1/rooms/1/recommendation-plans/계획ID/apply
Content-Type: application/json

{}
```

빈 객체는 `can_apply=true`인 식물을 모두 적용합니다. `{"plant_ids":[1,2]}`로 일부만 선택할 수도 있습니다. 서로 자리 교환이 필요한데 한 식물만 선택하면 409이며, 어떤 위치도 저장하지 않습니다.

계획의 유효 시간은 30분입니다. 방 구조, 계산 입력, 예보 유효성, 식물 위치/목록, 종별 요구 DLI, 저장된 금지 칸 중 하나라도 바뀌면 409입니다. 서버가 격자 중심을 실제 m 좌표로 변환하고 동일 트랜잭션에서 저장합니다. 동일한 계획을 같은 선택으로 재요청하면 최초 성공 응답을 재사용합니다. 적용 후 앱은 방의 식물 목록과 추천 캐시를 갱신해야 합니다. 기존 개별 `PUT /plants/{id}`는 계속 사용할 수 있습니다.

## P1: 금지 칸, 최근 결과, 물주기 수정

| API | 설명 |
|---|---|
| GET /rooms/{id}/blocked-cells?cell_size_m=0.2 | 저장된 금지 칸과 stale 여부 |
| PUT /rooms/{id}/blocked-cells | geometry_version, cell_size_m, blocked_cells 저장 |
| DELETE /rooms/{id}/blocked-cells | 금지 칸 설정 초기화 |
| GET /rooms/{id}/dli-map/latest | 방의 최근 유효한 기간 평균 지도 복원 |
| GET /rooms/{id}/jobs | 최근 작업 요약. 큰 결과 배열은 제외 |
| PATCH /plants/{id}/waterings/{record_id} | watered_at 날짜 정정 |
| DELETE /plants/{id}/waterings/{record_id} | 잘못 누른 기록 취소 |
| GET /plant-species/{id}/evidence | 참고 범위의 근거를 구조화해서 조회 |

모든 경로 앞에 `/api/v1`을 붙입니다. 모두 사용자 인증과 소유권 검사를 합니다.

금지 칸 PUT 예: `{"geometry_version":2,"cell_size_m":0.2,"blocked_cells":[[0,0],[1,2]]}`. 중복 칸은 정리하고, 방 밖 칸은 422입니다. 구조나 격자가 바뀌면 좌표를 임의로 재사용하지 않고 다시 저장하도록 409로 안내합니다. 추천 시 저장된 칸과 요청에 추가한 칸을 합칩니다.

`dli-map/latest`는 기본적으로 실제 하늘(`mock_sky=false`)의 결과만 복원합니다. 개발용 지도는 `mock_sky=true`를 명시해야 합니다. `cell_size_m`, `sample_height_m`로 결과를 좁힐 수 있습니다. 유효한 결과가 없으면 404입니다. 날짜별 조회는 기존 `dli-series`를 그대로 사용합니다.

물주기 정정/취소는 남은 기록의 가장 최근 날짜로 `last_watered_at`를 재계산하고 PlantOut을 반환합니다. 같은 날짜의 중복 기록으로 정정하면 409이고 데이터는 유지됩니다. 일반 관리 일정의 기존 완료/건너뛰기 취소 API와는 별개입니다.

evidence는 기존 카탈로그의 출처를 노출합니다. `basis`, `provisional`, `source_url`, `source_entry`, `checked_at`, `botanical_source_url`, `source_note`를 제공합니다. 운영자가 수치나 출처를 수정한 행에는 카탈로그 근거를 잘못 붙이지 않고 OPERATOR_DEFINED로 표시합니다. 기존 식물 목록 응답 필드와 107종 데이터는 유지합니다.

## P2: 저장된 데이터로 비교·추천·요약

- `POST /rooms/{id}/dli-comparison`: 2~4개 기간 비교. 요청에는 periods[{label,start_date,end_date}], cell_size_m, sample_height_m, mock_sky, temporary_x_axis_azimuth_deg를 사용합니다. 각 기간은 최대 93일입니다. 저장된 동일 조건의 날짜별 결과가 전부 있어야 평균을 계산합니다. 일부가 없으면 complete=false, missing_dates, mean_total_dli=null로 반환하며 없는 날을 0으로 채우지 않습니다. 계절 비교에 사용할 수 있지만 기상 API의 미래 예측 범위를 늘리는 기능은 아닙니다.
- `GET /rooms/{id}/suitable-species?dli_job_id=...`: 현재 지도의 빈 칸에 적합한 종을 순위로 반환합니다. 기존 식물·금지 칸은 제외하고 요구 DLI 범위, 적합 칸 수/비율, 추천 칸, 근거를 제공합니다. dli_job_id 생략 시 최근 유효한 실제 지도를 사용합니다.
- `GET /dashboard`: 오늘 할 일, 최근 30일 범위의 미완료 일정, 식물·방 수, 최근 사진 시각과 유효한 광량 상태를 요약합니다. on_date 및 overdue_window_days(0~90)를 지정할 수 있습니다. 범위를 제한한 요약이며 전체 생애 연체 건수라는 의미가 아닙니다.
- `GET /notifications/schedule?start_date=...&end_date=...`: 미완료 일정과 KST 알림 시각, 고유 식별자, schedule_version을 반환합니다. 휴대폰의 기기 알림 예약에 연결합니다. 완료·취소·주기 변경 후 다시 조회해 버전이 바뀌면 기존 예약을 갱신하세요. delivery=DEVICE_LOCAL, push_configured=false입니다. 서버 푸시 전송이나 FCM/APNs 자격증명 설정은 포함하지 않습니다.

## 실제 시연 점검

```powershell
.\.venv\Scripts\python.exe scripts\check_demo.py --check-model --check-weather
.\.venv\Scripts\python.exe scripts\check_demo.py --image C:\scan\test.jpg
```

모델 검사는 인터넷으로 SegFormer 가중치를 처음 내려받을 수 있습니다. 기본 check_demo는 함수 import와 DB를 확인하고 모델 로딩은 별도 옵션에서만 수행합니다. `/health`와 `/ready`를 호출할 때 모델을 로딩하지 않습니다.

실제 앱에서 저장한 13장 JPEG와 metadata.json이 있다면 서버를 실행한 후 다음을 사용합니다. 방에는 위치와 식물이 미리 등록되어 있어야 합니다.

```powershell
.\.venv\Scripts\python.exe scripts\demo_e2e.py --room-id 1 --scan-metadata C:\scan\metadata.json --scan-dir C:\scan --start-date 2026-10-01 --end-date 2026-10-01
```

이메일·비밀번호는 프롬프트로 입력합니다. 비밀번호는 화면에 표시하지 않습니다. 또는 PLANTLIGHT_TOKEN 환경변수로 기존 토큰을 전달할 수 있습니다. 사진 분석 → 방 방향 → 실제 일사량/DLI → 추천 계획까지 실행하고, 가짜 하늘이나 임시 방향으로 자동 전환하지 않습니다. 실제 위치 저장까지 확인하려면 `--apply`를 명시합니다. 이 점검은 스캔과 계산 결과를 새로 저장합니다.

## 검증

`python -m pytest -q`로 기존 회귀와 신규 테스트를 실행합니다. 신규 테스트는 자리 교환·부분 적용 거절·상태 변경 후 거절·키 재사용·대기열 상한·높이 불일치·기록 수정 취소·결과 복원·기간 비교의 누락 데이터·출처 보존·계정 격리를 확인합니다. 실제 사진 추론과 외부 날씨는 위 명시적 점검 명령으로 별도 확인합니다.

2026-11-03 검증 결과:

- Python 3.12/Linux/SQLite에서 전체 **227 passed** (기존 198 + 신규 29). TestClient 의존성 deprecation warning 1건은 실패가 아닙니다.
- 기존 SQLite에 저장한 식물·종별 출처·사진 바이너리가 v6 마이그레이션 2회 후에도 보존됨을 확인했습니다.
- 실제 Uvicorn HTTP 서버에서 960×1280 합성 JPEG 13장 → 실제 SegFormer 추론 → 방향 계산 → Open-Meteo ERA5 조회 → DLI → 추천 계획까지 완료했습니다. mock_sky=false, temporary_direction=false이며 해당 검증의 소요 시간은 47.56초였습니다. 이는 그 입력과 검증 환경의 결과이며 실제 휴대폰 사진의 정확도나 사용자 PC의 속도를 보장하는 측정이 아닙니다.
- 별도 모델 로딩·128×128 합성 이미지 추론과 실제 외부 날씨 연결 점검도 통과했습니다.
- 프론트 오표시 수정본 및 TypeScript API 연결 예제의 TypeScript 구문 검사를 통과했습니다. 전체 Expo 앱 빌드·Android 실기기 확인은 이 검증에 포함하지 않았습니다.
- 고정된 algorithm 원본 파일의 Git blob 해시는 기준 backend의 원본과 일치합니다.
