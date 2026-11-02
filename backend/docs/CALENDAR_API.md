# 식물 관리 캘린더 API — v0.6.0

기존 식물·방·JWT·DLI API를 유지하면서 물주기 및 기타 관리 일정을 추가했습니다. 모든 경로는 `/api/v1` 기준이며 기존 `Authorization: Bearer ...` 토큰이 필요합니다.

## 적용 방법

기존 서버를 중지하고 `backend` 폴더에서 실행합니다. 추가 필수 패키지는 없습니다.

```powershell
.\.venv\Scripts\python.exe scripts\migrate_v4.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

마이그레이션은 SQLite DB를 `.bak`으로 백업하고 필요한 컬럼·테이블을 추가합니다. 기존 사용자·방·식물 ID와 물주기 설정을 유지합니다. 새 테이블은 `watering_records`, `care_schedules`, `care_occurrences`입니다. v4 이상 DB는 서버 재시작만으로 새 테이블을 추가할 수도 있습니다. 기존 `last_watered_at`은 확인된 이력 한 건으로 보존하며, 저장되지 않았던 과거 이력을 만들지는 않습니다. 반복 적용해도 기록이 중복되지 않습니다.

## 화면과 API 연결

| 화면 요소 | 데이터 / API |
| --- | --- |
| 월간·주간 달력 | `GET /calendar?start_date=2026-11-01&end_date=2026-11-30` |
| 날짜별 점 | 응답의 `days[].total_count > 0` |
| 미완료 일정이 있는 날짜 | `days[].pending_count > 0` |
| 선택 날짜의 식물 목록 | 응답의 `events` 중 `date`가 선택한 날짜인 항목 |
| 물주기·분갈이 등 그룹 | `task_type`, `title` |
| 식물 이름·종류 | `plant_id`, `plant_nickname`, `species_name`, `scientific_name` |
| 완료·건너뛰기·지연 표시 | `status`, `completed_on`, `is_overdue` |

캘린더 UI, 사진 표시·업로드, OS 푸시 알림 발송은 포함하지 않습니다. 백엔드는 화면에 필요한 일정 데이터를 저장·조회합니다. 별도 서버 타이머 없이 조회 시 반복 일정을 계산합니다.

## 캘린더 조회 규격

`start_date`, `end_date`는 필수이며 `YYYY-MM-DD`, 양끝 포함입니다. 하루 조회는 두 날짜를 같게 보냅니다. 선택 필터는 `plant_id`, `room_id`, `task_type`, `status`입니다. 방에 배치하지 않은 식물도 기본 조회에 포함됩니다.

- `task_type`: `WATERING`, `FERTILIZING`, `REPOTTING`, `PRUNING`, `MISTING`, `OTHER`
- `status`: `PENDING`, `COMPLETED`, `SKIPPED`
- 최대 366일·10,000개 이벤트입니다. 초과하면 일부를 잘라 반환하지 않고 422이므로 기간이나 식물·방 필터를 좁힙니다.
- 응답 최상위: `timezone`, `today`, `start_date`, `end_date`, `days`, `events`. 시간대는 모두 `Asia/Seoul`입니다.
- `days`: 기간 내 빈 날짜도 포함하며 각 항목은 `date`, `total_count`, `pending_count`, `completed_count`, `skipped_count`, `overdue_count`, `task_types`를 가집니다. 카운트는 적용된 필터 기준입니다.
- `events`: 날짜 → 종류 → 식물 ID 순서입니다. 각 항목에 `event_id`, `date`, 식물·종류 정보, `room_id`, `schedule_id`, `task_type`, `title`, `status`, `is_overdue`, `completed_on`, `interval_days`, `note`가 있습니다.
- 물주기는 `schedule_id: null`이며, 기타 일정은 실제 일정 ID를 반환합니다. 기타 일정의 완료·건너뛰기 이력은 과거 주기를 추정하지 않으므로 `interval_days: null`입니다.

프론트는 한 달을 한 번 조회하고 날짜 클릭 시 받은 목록에서 걸러낼 수 있습니다. 아래 예시는 일반 `fetch`의 원본 snake_case 응답 기준입니다. 기존 프론트의 camelCase 변환을 거치면 `pendingCount`, `plantId`, `taskType`, `scheduleId`, `completedOn`처럼 접근합니다.

```javascript
const response = await fetch(
  `${baseUrl}/api/v1/calendar?start_date=2026-11-01&end_date=2026-11-30`,
  { headers: { Authorization: `Bearer ${token}` } }
);
if (!response.ok) throw new Error(`Calendar failed: ${response.status}`);
const calendar = await response.json();
const datesWithDots = calendar.days.filter(day => day.total_count > 0);
const selectedEvents = calendar.events.filter(event => event.date === selectedDate);
const wateringCards = selectedEvents.filter(event => event.task_type === 'WATERING');
```

## 물주기

식물 등록은 기존 `POST /plants`를 사용합니다. `watering_interval_days`는 1~3650의 정수, 기본 7이며 `last_watered_at`은 실제 마지막 물준 날짜 또는 `null`입니다. 기본 7일은 앱의 초기 설정이며 종별 자동 재배 권장값은 아닙니다.

```json
{"species_id":1,"nickname":"거실 몬스테라","watering_interval_days":7,"last_watered_at":"2026-11-01"}
```

위 식물의 다음 예정일은 11월 8일입니다. 마지막 날짜가 없으면 한국시간 등록일 + 주기가 첫 예정일입니다. `species_id`는 실제 존재하는 ID로 바꿉니다.

| 동작 | 요청 | 응답 |
| --- | --- | --- |
| 주기만 수정 | `PUT /plants/{id}/watering-schedule` + `{"watering_interval_days":10}` | 기존 `PlantOut`, 200 |
| 물주기 완료 | 기존 `POST /plants/{id}/waterings` + `{"watered_at":"2026-11-02"}` | 기존 `PlantOut`, 200 |
| 실제 물주기 이력 | `GET /plants/{id}/waterings?start_date=2026-11-01&end_date=2026-11-30` | `[{id,plant_id,watered_at}]`, 최신순 |

주기만 수정하는 API는 이름·종류·방·좌표·마지막 물준 날짜를 유지합니다. 이력 조회의 날짜 필터는 각각 생략할 수 있으며 `limit` 기본 50·최대 100, `offset` 기본 0을 지원합니다.

완료 버튼은 지난 예정일을 자동으로 보내지 말고 **실제로 물준 날짜**를 보냅니다. 다음 일정은 최신 실제 날짜 + 주기로 계산합니다. 실제 이력은 실제 날짜에 표시합니다. 같은 식물·날짜 재전송은 중복 기록하지 않으며, 늦게 도착한 과거 기록이 최신 기준일을 뒤로 되돌리지 않습니다. 미래 실제 날짜는 422입니다.

물주기 예정일은 현재 설정에 따른 예상값으로, 완료나 주기 수정 후 재계산됩니다. 확정된 과거 계획표로 보관하는 방식은 아닙니다. 기존 `PUT /plants/{id}`에 `last_watered_at`을 명시하면 기준일을 정정하거나 `null`로 초기화할 수 있으며, 저장한 실제 이력은 유지됩니다. 물주기 이력 삭제·건너뛰기는 포함하지 않습니다.

## 기타 관리 일정

`POST /plants/{plant_id}/care-schedules`에 아래 본문을 보내면 201과 생성된 일정 ID를 반환합니다.

```json
{
  "task_type":"FERTILIZING",
  "title":"액체 비료 주기",
  "start_date":"2026-11-05",
  "interval_days":14,
  "end_date":"2027-02-28",
  "active":true,
  "note":"제품 사용량 확인"
}
```

종류는 비료 `FERTILIZING`, 분갈이 `REPOTTING`, 가지치기 `PRUNING`, 분무 `MISTING`, 기타 `OTHER`입니다. 물주기는 기존 식물 설정을 사용하므로 `WATERING`을 중복 등록하지 않습니다. 제목 생략 시 종류별 한글 제목을 사용합니다.

`interval_days`가 `null` 또는 생략이면 시작일 한 번만 표시합니다. 정수이면 시작일부터 해당 일수 간격입니다. 매월 같은 날짜 반복은 포함하지 않습니다. `end_date`는 선택이며 양끝 포함입니다. `active: false`는 새 미완료 일정을 숨기고 기존 기록을 유지합니다.

| 동작 | API |
| --- | --- |
| 식물의 일정 목록 | `GET /plants/{plant_id}/care-schedules` (`limit`, `offset` 지원) |
| 일정 조회 | `GET /care-schedules/{schedule_id}` |
| 일정 수정 | `PUT /care-schedules/{schedule_id}` — 생성과 동일한 본문으로 전체 설정 교체 |
| 일정 삭제 | `DELETE /care-schedules/{schedule_id}` — 일정과 연결된 이력 삭제, 204 |
| 회차 완료·건너뛰기 | `PUT /care-schedules/{schedule_id}/occurrences/{scheduled_date}` |
| 회차 완료·건너뛰기 취소 | `DELETE /care-schedules/{schedule_id}/occurrences/{scheduled_date}` — 204 |

완료 본문은 `{"status":"COMPLETED","completed_on":"2026-11-06","note":"관리 완료"}`입니다. URL 날짜는 **원래 예정일**, 본문 날짜는 **실제 완료일**입니다. 미래 실제 완료일은 422입니다. 날짜 생략 시 첫 완료에는 한국시간 오늘, 재요청에는 기존 완료일을 유지합니다. 미리 관리한 경우도 기록할 수 있습니다. 캘린더에는 원래 예정일에 완료 상태를 표시하며, 기타 반복 일정의 다음 회차는 시작일 기준의 고정 간격을 유지합니다.

건너뛰기는 같은 주소에 `{"status":"SKIPPED"}`를 보내고 `completed_on`은 넣지 않습니다. 같은 회차에 PUT하면 이력 한 개를 갱신하며 상태 변경도 가능합니다. 동시 생성 충돌은 409이므로 다시 조회하고 재시도합니다. 현재 규칙에 없는 날짜나 비활성 일정의 새 회차는 422입니다. 이전 기록은 규칙 수정 후에도 조회·수정할 수 있으며, 기록 당시 제목·종류를 보존합니다.

회차 취소 후 현재 활성 규칙에 여전히 해당하면 다시 `PENDING`으로 표시합니다. 이미 기록이 없어도 DELETE는 204입니다. 일정 삭제는 이력도 삭제하므로 이력을 유지하고 예정 일정만 숨길 때는 `active: false`를 사용합니다.

## 접근 권한·검증

타인의 식물·방·일정은 404입니다. 식물 삭제 시 관련 일정·이력을 삭제하고, 방 삭제 시 식물과 관리 일정은 유지하면서 미배치로 바꿉니다. DB를 유지하면 서버 재시작 후에도 이력이 보존됩니다.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

`tests/test_calendar.py`는 월간·일간 데이터 일치, 물주기 재계산·중복·지연 전송, 한국시간, 반복/일회성/종료/비활성 규칙, 완료·건너뛰기·취소, 이력 보존, 사용자 격리, 삭제, 조회 제한, 윤년·최대 날짜, 트랜잭션 롤백, 기존 DB 업그레이드를 검증합니다.
