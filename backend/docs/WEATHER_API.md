# 일사량 API 추가 (0.3.0)

## 선택: Open-Meteo
당일 및 가까운 미래의 배치를 안내하고 과거 날짜를 재평가해야 하므로, 같은 응답 형식으로 예보와 과거 DNI/DHI를 제공하는 Open-Meteo를 사용합니다. NASA POWER는 과거 분석의 별도 후보이나 이번 버전에 혼합하지 않습니다. 서로 다른 데이터셋을 자동 대체하면 계산의 출처와 의미가 달라지기 때문입니다.
자료는 지역 격자의 기상 모델/재분석 값이며 실내 조도 측정값이 아닙니다. 실내 투과·창문·그림자·PPFD/DLI 계산은 C의 책임입니다.

공식 자료:
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/docs/historical-weather-api
- https://open-meteo.com/en/terms
- https://power.larc.nasa.gov/docs/services/api/temporal/hourly/
교육용 비상업 프로젝트를 전제로 공개 엔드포인트를 사용합니다. 상용화 시 이용약관/요금 및 출처 표시 요구를 확인하세요.

## 기존 프로젝트에 적용
1. 서버를 중지하고 기존 폴더와 data/plantlight.db를 백업합니다.
2. 새 ZIP의 app, docs, tests, requirements.txt 등을 기존 프로젝트에 덮어씁니다.
3. 기존 .env와 data 폴더를 유지합니다. 새 ZIP에는 이 파일들이 없습니다.
4. PowerShell에서 실행:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```
weather_cache는 시작 시 자동 생성됩니다. 기존 테이블 컬럼은 변경하지 않습니다. 이전 v3 마이그레이션이 필요한 DB는 기존 scripts/migrate_v3.py 안내를 먼저 따르세요.

## Swagger 확인
http://127.0.0.1:8000/docs 에서 회원가입 후 Authorize(이메일/비밀번호)합니다.
Weather 그룹 → GET /api/v1/weather/irradiance → Try it out:
- latitude: 37.5665
- longitude: 126.9780
- date: 실행하는 날의 한국 날짜(YYYY-MM-DD)
Execute하면 values가 25개이며 time은 +09:00, unit은 W/m²입니다.
첫 조회 cache_hit=false, 같은 요청 재조회 cache_hit=true인지 확인합니다.
GET /api/v1/rooms/{room_id}/irradiance 는 자신의 방에 저장된 latitude/longitude를 사용합니다. 좌표가 없으면 422, 다른 사용자 방은 404입니다.

## 날짜와 캐시
- 한국 오늘 기준 7일 이상 지난 날짜: archive API, models=era5, TTL 30일.
- 그 이후부터 오늘+14일까지: forecast API, best match, TTL 1시간.
- 1940-01-01 이전이나 오늘+14일 이후: 422.
- 다음 날 00시 경계값을 확보하기 위해 외부 API는 목표 날짜부터 다음 날짜까지 조회합니다.
- 캐시 키: 정확한 위도·경도, 날짜, 데이터셋, 시간대, 계약 버전. 사용자 간 동일 위치 데이터는 공유 캐시입니다.
- 원본 JSON과 정규화 JSON, 조회/만료 시각은 기존 DB의 weather_cache에 저장합니다.
- 만료된 캐시는 새 데이터를 가져온 뒤 갱신합니다. 누락값을 0으로 바꾸거나 맑은 하늘 추정값으로 자동 대체하지 않습니다.

## C 전달 계약
source=OPEN_METEO, dataset=ERA5 또는 BEST_MATCH_FORECAST,
timezone=Asia/Seoul, unit=W/m², interval_minutes=60,
time_basis=PRECEDING_HOUR_MEAN,
values=[{time: ISO 8601 +09:00, dni: number, dhi: number}].
목표 날짜 00:00부터 다음 날 00:00까지 25개입니다. 09:00의 값은 08:00~09:00 평균입니다. 00:00 값은 전날 마지막 시간의 평균입니다.
하루 누적 에너지는 목표 날짜 01:00부터 다음 날 00:00까지 24개 평균을 사용합니다.
시간별 평균을 순간값으로 간주해 선형 보간하면 오차가 생길 수 있습니다. C는 평균 구간을 보존하는 분배 또는 별도 보간 정책을 정해야 합니다.
10분 간격 61개 시점은 10시간 구간일 때만 성립합니다. 전체 24시간을 양끝 포함 10분 간격으로 표현하면 145개입니다. 분석 시작/끝은 C와 별도로 확정하세요.

C가 같은 파이썬 서버에 있다면 기존 분석 함수에서:
```python
from datetime import date
from app.weather import get_irradiance
weather = get_irradiance(db, room.latitude, room.longitude, date(2026, 10, 6))
# result = calculate_sunlight(room=room, windows=room.windows, weather=weather)
```
C 계산 함수가 이 ZIP에 없으므로 호출 예시만 제공합니다. 실제 분석 엔드포인트나 DLI 결과를 임의로 생성하지 않습니다.

## 실패 처리
연결/읽기 타임아웃 및 외부 429/5xx에 최대 3회 시도합니다. 연결 실패 503, 외부 HTTP 오류/누락값/형식 오류 502입니다. 요청의 잘못된 날짜/좌표는 422입니다.
오류 응답은 캐시에 저장하지 않습니다. 만료된 캐시를 최신값으로 반환하지 않습니다.

## 검증
기존 47개 + 새 5개 = 52개 통과. 캐시 재사용/만료 갱신, 원본 저장, 한국시간과 25개 경계값, 누락값 거절, 방 소유권/인증, 날짜 라우팅, 타임아웃 재시도를 검증했습니다.
외부 API 실제 수신은 실행 환경의 DNS/네트워크 제한으로 검증하지 못했습니다. Windows에서 Swagger 호출로 확인하세요.
