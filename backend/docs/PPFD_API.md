# 10분 단위 PPFD 조회

`POST /api/v1/rooms/{room_id}/dli-series`에 `timeseries: true`를 추가하면 날짜별 DLI와
10분 구간별 직사·산란 PPFD를 함께 계산하고 저장합니다. 옵션을 생략하거나 `false`로 보내면
기존 DLI 응답만 반환합니다. 모든 요청에는 기존 로그인 토큰이 필요합니다.

PPFD는 기상 DNI/DHI와 방·창문·SKY 스캔으로 구한 **계산값**입니다.
기상 입력은 시간별 평균이며, 알고리즘이 평균 구간을 유지하면서 10분 구간에 적용합니다.
실제 센서 측정값이나 서버가 10분마다 자동 전송하는 기능은 아닙니다.

## 계산 요청

방 위치·방향·창문을 저장하고 창문별 SKY 스캔을 완료한 뒤 요청합니다.
스캔 없이 시연할 때만 `mock_sky: true`를 사용하고, 방향을 아직 저장하지 않았다면
`temporary_x_axis_azimuth_deg`를 명시합니다.

```http
POST /api/v1/rooms/1/dli-series
Content-Type: application/json
Authorization: Bearer ACCESS_TOKEN
```

```json
{
  "start_date": "2026-11-18",
  "end_date": "2026-11-18",
  "cell_size_m": 0.2,
  "sample_height_m": 0,
  "timeseries": true,
  "cells": [[0, 0], [1, 2]]
}
```

`cells`는 선택한 격자의 `[row, col]` 목록이며 인덱스는 0부터 시작합니다.
`GET /api/v1/rooms/{room_id}/grid`와 같은 해상도·높이를 사용하세요.
중복 칸은 제거하고 행·열 순서로 정렬합니다. `cells`를 생략하거나 `null`로 보내면
방 안 전체 칸이 대상입니다. 빈 배열, 방 밖 칸, 음수·실수·불리언 인덱스는 422로 거절합니다.
`cells`를 지정할 때는 `timeseries: true`가 필요합니다.

응답은 기존과 같은 202 작업 정보입니다. 반환된 `status_url`을 조회하고
`status == "COMPLETED"`가 되면 `result.days`를 읽습니다.

```json
{
  "job_id": "작업 ID",
  "status": "PENDING",
  "status_url": "/api/v1/jobs/작업 ID",
  "reused": false
}
```

## 결과 구조

각 `result.days[]`의 기존 `date`, `dataset`, `direct_dli`, `diffuse_dli`, `total_dli`에
`ppfd`가 추가됩니다. 여러 날짜는 날짜별로 따로 저장합니다.
PPFD를 요청하지 않은 응답에는 `ppfd` 필드가 없습니다.

| 필드 | 의미 |
|---|---|
| `days[].ppfd.times` | 구간 가운데 시각 목록, ISO 8601 한국시간 `+09:00` |
| `days[].ppfd.interval_minutes` | `10` |
| `days[].ppfd.ppfd_unit` | `umol/m2/s` (μmol/m²/s) |
| `days[].ppfd.cell_series` | `cells` 지정 시 칸별 시계열 |
| `days[].ppfd.direct_ppfd` | 전체 칸 요청 시 `[시각][row][col]` 직사 PPFD |
| `days[].ppfd.diffuse_ppfd` | 전체 칸 요청 시 `[시각][row][col]` 산란 PPFD |

해가 떠 있는 구간만 반환하며 밤 구간은 없습니다.
시각은 `…:05`, `…:15`, `…:25`처럼 10분 구간의 가운데입니다.
값은 소수점 1자리이며, 전체 격자 응답에서 방 밖 칸은 `null`입니다.

선택 칸 응답의 `ppfd` 구조는 다음과 같습니다. 아래 수치는 구조 설명용 예시입니다.

```json
{
  "times": ["2026-11-18T12:05:00+09:00", "2026-11-18T12:15:00+09:00"],
  "interval_minutes": 10,
  "ppfd_unit": "umol/m2/s",
  "cell_series": [
    {"row": 0, "col": 0, "direct_ppfd": [100.0, 110.0], "diffuse_ppfd": [20.0, 21.0]},
    {"row": 1, "col": 2, "direct_ppfd": [0.0, 0.0], "diffuse_ppfd": [10.0, 10.5]}
  ]
}
```

같은 인덱스의 직사 PPFD + 산란 PPFD가 전체 PPFD입니다.
각 칸의 `PPFD × 600초`를 모두 더해 1,000,000으로 나누면 일일 DLI가 됩니다.
반올림 자리 차이 때문에 응답 PPFD를 합산한 값과 DLI에는 작은 차이가 생길 수 있습니다.
선택 칸만 PPFD를 요청해도 기존 DLI 지도는 항상 방 안 전체 칸을 반환합니다.

## 저장된 결과 재조회

`GET /api/v1/rooms/{room_id}/dli-series`에 계산할 때와 같은 날짜·해상도·높이·시연 옵션과
`timeseries=true`를 보냅니다. 선택 칸은 JSON 문자열로 전달합니다.

```text
/api/v1/rooms/1/dli-series?start_date=2026-11-18&end_date=2026-11-18&cell_size_m=0.2&sample_height_m=0&timeseries=true&cells=%5B%5B0%2C0%5D%2C%5B1%2C2%5D%5D
```

JavaScript에서는 `URLSearchParams`의 `cells` 값에 `JSON.stringify([[0,0],[1,2]])`를 넣으면 됩니다.
전체 칸으로 계산했으면 GET에서도 `cells`를 생략합니다.
GET은 새로 계산하지 않으며 미계산·만료 날짜는 `missing_dates`에 나옵니다.
기존 DLI, 전체 PPFD, 선택 칸별 PPFD 캐시는 서로 구분됩니다.
방·방향·위치·스캔 변경 시 기존 작업의 `stale`이 참이 됩니다.

## 제한 및 적용

- 기존처럼 최대 93일을 요청할 수 있습니다.
- `대상 칸 수 × 144 × 직사/산란 2개 × 날짜 수 ≤ 500,000`으로 응답 크기를 제한합니다.
  전체 격자 모드에서는 방 밖 칸도 배열 크기에 포함합니다.
  초과하면 선택 칸을 지정하거나 날짜를 줄이거나 `cell_size_m`을 키우세요.
  작업 생성 전에 422를 반환합니다.
- 기존 기간 평균 `/dli-map`은 유지합니다. PPFD는 `/dli-series`로 요청하세요.
- `DLI_CALLABLE`이 설정되어 있으면 해당 함수를 사용합니다. 별도 설정이 없으면 PPFD 요청에 한해
  동봉된 `grid_dli_service:compute_room_dli`를 사용합니다.
  별도 알고리즘 폴더·함수를 지정했다면 그 코드도 `timeseries`·`cells`와 PPFD 출력을 지원해야 합니다.
- 알고리즘이 PPFD를 누락하거나 시각·크기·단위·수치가 잘못되면 작업은 `FAILED`가 되고
  잘못된 결과를 저장하지 않습니다. 프론트는 기존 `status`, `error`, `error_code`를 확인하세요.

`backend` 브랜치를 업데이트하고 서버를 재시작하면 적용됩니다.
기존 설치가 완료된 환경에는 DB 컬럼 추가나 새 패키지 설치가 필요 없습니다.
기존 `.env`를 유지하고 시연 서버는 계속 worker 1개로 실행하세요.

PPFD 관련 `backend/algorithm/d_light.py`, `grid_dli_service.py`는
`algorithm` 브랜치의 `b65d8999e99293c1945113d975056ffff5ab7d65`에서 가져왔습니다.
나머지 동봉 알고리즘은 기존 버전이며 파일별 출처는 `algorithm-source.json`에 기록했습니다.

검증: `python -m pytest -q tests/test_ppfd.py`.
