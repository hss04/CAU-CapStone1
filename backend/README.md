# PlantLight FastAPI 백엔드

로그인, 방/창문 좌표, 식물 종류와 사용자 식물 위치를 관리하는 백엔드입니다. 제공된 AR 방·창문 앱의 저장 규격 v3에 맞춘 보정 버전(0.2.0)입니다. Python 3.11 이상이 필요하며 Python 3.12에서 테스트했습니다. Android 프로젝트와 별도로 PC에서 실행합니다.

## 1. Windows에서 실행

ZIP을 압축 해제한 뒤 **README.md, app, scripts가 있는 plantlight-backend 폴더**에서 PowerShell을 엽니다.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\init_env.py
.\.venv\Scripts\python.exe scripts\import_species.py examples\species-demo.json
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Python 3.12가 설치되어 있지 않으면 먼저 설치하거나, 설치된 3.11 이상 버전으로 첫 명령을 바꿉니다. 가상환경 활성화가 필요 없어서 PowerShell 실행 정책을 변경할 필요도 없습니다.

브라우저에서 **http://127.0.0.1:8000/docs**를 열면 API를 직접 시험할 수 있습니다. DB는 첫 실행에 `data/plantlight.db`로 생성됩니다. 서버를 껐다 켜도 데이터는 유지됩니다. `init_env.py`는 개별 JWT 비밀키를 생성하며 기존 `.env`를 덮어쓰지 않습니다.

Linux/macOS에서는 다음을 사용합니다.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/init_env.py
.venv/bin/python scripts/import_species.py examples/species-demo.json
.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

항상 프로젝트 폴더에서 실행하세요. `.env`와 기본 DB 경로는 현재 작업 폴더를 기준으로 읽습니다. 실행 시 JWT_SECRET 관련 오류가 나면 `scripts/init_env.py`를 먼저 실행했는지 확인합니다.

## 2. Swagger에서 기능 확인

1. `POST /api/v1/auth/register`에 이메일, 8자 이상 비밀번호, 닉네임을 넣습니다.
2. `/docs` 오른쪽 위 **Authorize**를 누릅니다. `username`에는 **이메일**, `password`에는 가입한 비밀번호를 넣습니다. 나머지는 비워 두면 됩니다.
3. `POST /api/v1/rooms`에 `examples/room.json` 내용을 넣습니다. 예제 방은 4×3 m이며 `area_square_meters`는 12입니다.
4. 반환된 방 `id`로 `POST /api/v1/rooms/{room_id}/windows`를 호출합니다. 본문은 `examples/window.json`입니다.
5. `GET /api/v1/plant-species`로 종류 ID를 확인하고 `POST /api/v1/plants`를 호출합니다. `examples/plant.json`의 방/종류 ID를 실제 ID로 바꿉니다.
6. `GET /api/v1/rooms/{room_id}/grid`로 시각화에 사용할 격자와 방 내부 마스크를 확인합니다.

Android 앱은 JSON 형식의 `POST /api/v1/auth/login`을 사용하면 됩니다.

```json
{"email":"your-email@example.com","password":"your-password"}
```

응답의 `access_token`을 이후 요청에 넣습니다.

```http
Authorization: Bearer ACCESS_TOKEN
```

토큰 유효기간은 기본 60분입니다. 이 버전에는 refresh token, 서버 토큰 폐기, 소셜 로그인은 없습니다. 만료 시 다시 로그인하고, 앱 로그아웃은 저장된 토큰을 지웁니다. 비밀번호는 Argon2 해시로 저장합니다. 사용자 응답에 비밀번호/해시는 포함되지 않습니다.

## 3. Android 연결

| 접속 위치 | 기본 서버 주소 |
|---|---|
| PC 브라우저 | `http://127.0.0.1:8000/` |
| Android Studio 기본 에뮬레이터 | `http://10.0.2.2:8000/` |
| 같은 Wi-Fi의 실제 Android 기기 | `http://PC의_로컬_IP:8000/` |

실기기는 `ipconfig`에서 PC IPv4 주소를 확인하고, 개발용 로컬 네트워크에서 방화벽의 8000 포트 접속을 허용합니다. Android 앱에는 INTERNET 권한이 필요하며 로컬 HTTP를 쓸 때는 **debug 전용 설정**에서 cleartext를 허용합니다. 앱의 기존 Retrofit/OkHttp 연결에 위 URL과 Bearer 헤더를 적용하세요. 이 ZIP은 백엔드이며 기존 Android 앱의 네트워크 연결을 변경하지는 않습니다.

앱의 저장 JSON을 가져오려면 **`POST /api/v1/rooms/import-ar?name=내방`**에 JSON 전체를 보냅니다. `examples/ar-room-v3.json`으로 시험할 수 있습니다. 방·창문·원본 측정값이 함께 저장됩니다. **`GET /api/v1/rooms/{room_id}/ar-measurement`**로 같은 v3 형식을 내보냅니다. 첨부 앱의 네트워크 전송 기능은 별도로 연결해야 합니다.

이번 보정은 첫 방 모서리를 원점으로 삼되 **ARCore 수평축을 회전하지 않는** 규격입니다. 방 모서리는 4개 이상이며 모두 y=0, 창문 높이·원본 측정 좌표는 유지합니다. 미터 수치는 소수점 3자리 반올림, 저장·응답 시각은 한국시간 +09:00입니다. 진북 방향은 첨부 앱에 측정 기능이 없어 미입력으로 유지합니다.

ARCore는 Android에서 좌표를 측정합니다. 서버는 전달받은 좌표를 검증·저장하고 바닥 면적/격자를 만듭니다. 좌표 변환과 창문 순서는 [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)에 설명했습니다.

## 4. 구현 범위

| 기능 | 제공 내용 |
|---|---|
| User | 이메일 회원가입, JSON 로그인, Swagger 로그인, JWT, 내 정보 |
| Room / RoomCorner | 모서리 일괄 저장, 조회/전체 수정/삭제, x-z 바닥 면적 |
| Window / WindowCorner | 창문 4점 저장, 조회/전체 수정/삭제, 방 벽·평면·순서 검증 |
| PlantSpecies | 로그인 사용자에게 공통 카탈로그 조회, 서버 운영자용 JSON import |
| Plant | 등록/조회/전체 수정/삭제, 종류 연결, 방 안 실제 좌표 또는 미배치 상태 |
| 격자 | 방 내부 마스크, 격자 좌표 형식, 최대 40,000개 셀 |
| DLI JSON | 배열 크기·합계·단위·방·기하 버전·격자 일치 검증, 시각화 예제 |

Room/Plant는 JWT 사용자 ID로 제한합니다. Window는 Room 소유권을 따라갑니다. 클라이언트가 `user_id`를 지정할 수 없습니다. 다른 사용자의 ID를 요청하면 404가 반환됩니다. PlantSpecies는 사용자 데이터가 아니라 공통 기준 데이터라 일반 사용자에게 수정 API를 열지 않았습니다.

`PUT`은 **전체 교체**입니다. 방 모서리/창문 모서리는 각각 하나의 요청과 트랜잭션으로 저장하여 점 일부만 저장되는 상태를 피합니다. 목록에는 `limit`(기본 50, 최대 100), `offset`이 있습니다.

방 수정으로 기존 화분이 방 밖에 놓이거나 창문이 벽에서 벗어나면 409로 거절합니다. 먼저 화분을 미배치 상태로 바꾸거나 창문을 수정/삭제하세요. **방 삭제 시 창문/모서리는 삭제되고, 등록한 식물은 유지되며 위치가 미배치로 초기화됩니다.**

현재 방과 창문 변경 시 `geometry_version`을 올립니다. 변경 전 격자를 사용하는 DLI 결과는 409로 거절하여 오래된 지도 표시를 막습니다.

## 5. 식물 종류의 DLI 범위 입력

`examples/species-demo.json`은 **가상의 테스트 식물**입니다. 2~6 수치는 연동 테스트용이며 실제 재배 기준이 아닙니다. 실제 서비스에서는 조사한 식물별 DLI와 출처를 다음 형식으로 저장한 뒤 import합니다.

```json
[
  {
    "name":"연동 테스트용 가상 식물",
    "scientific_name":null,
    "min_dli":2.0,
    "max_dli":6.0,
    "source_note":"테스트용 임의 수치"
  }
]
```

```powershell
.\.venv\Scripts\python.exe scripts\import_species.py your-species.json
```

범위 단위는 `mol/m2/day`입니다. 음수, min > max, 중복 이름은 거절합니다. 동일 이름은 기존 종류의 ID를 유지하며 갱신됩니다. 일괄 입력 전체가 성공할 때만 DB에 반영됩니다.

## 6. 후속 기능

요청한 초기 범위에 맞춰 `OutdoorScan`, `ScanFrame`, `SkyVisibility`, `LightResult`, `Recommendation` 테이블과 이미지 업로드·일조 계산·추천 알고리즘은 아직 추가하지 않았습니다. 확장 시 사용할 JSON 초안은 `docs/DATA_CONTRACT.md`에 있습니다.

`POST /rooms/{room_id}/dli-map/validate`는 외부 계산기가 만든 JSON을 **검증해서 돌려주는 API**입니다. 계산하거나 저장하지 않습니다. `examples/dli-map-demo.json`도 임의 수치이며 실제 일조 결과가 아닙니다. 이 형식은 프론트엔드와 맞출 수 있도록 정한 확장 v2 계약이며 원본 Android 파일에는 DLI 규격이 없습니다.

새 테이블은 SQLAlchemy `create_all`로 만듭니다. 이전 버전 DB가 있다면 서버를 정지한 뒤 다음 명령을 한 번 실행합니다.

```powershell
.\.venv\Scripts\python.exe scripts\migrate_v3.py
```

기존 SQLite DB를 먼저 백업하고 측정 메타데이터 컬럼만 추가합니다. 이전 `room_local_v1` 좌표를 임의 회전·변환하지 않습니다. 이전 방은 원본 Android v3 JSON을 새 방으로 가져와 사용하세요. 이전 방 좌표로 새 격자/내보내기를 요청하면 409입니다. 이후 테이블 변경에는 Alembic을 추가할 수 있습니다. PostgreSQL 전환 시에는 DB 드라이버 설치와 DATABASE_URL 변경, 별도 동작 검증이 필요합니다.

공개 서비스 배포는 이번 범위에 포함하지 않았습니다. 배포할 때는 HTTPS와 로그인 요청 제한을 적용하고 `.env`를 소스에 포함하지 마세요.

## 7. 테스트

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

로그인/비밀번호 해시, 토큰 만료·변조, 타인 데이터 접근 차단, 방 y=0·원점 검증, AR축 유지·원본 측정값 보존, 한국시간·밀리미터 반올림, 잘못된 모서리, 창문/식물 CRUD, 방 삭제 시 식물 유지, 비정형 방 격자, DLI JSON을 테스트합니다. 테스트 DB는 임시 폴더에 만들어 실제 DB와 분리됩니다. `requirements-tested.txt`에는 검증한 주요 의존성 버전을 기록했습니다.

## 파일 구성

```text
app/                  API, DB 모델, 좌표 검증, 인증, Pydantic 스키마
scripts/init_env.py    JWT 비밀키 생성
scripts/import_species.py  운영자용 식물 기준 데이터 입력
scripts/migrate_v3.py  이전 SQLite DB 백업·컬럼 추가
examples/             방·창문·식물·DLI 요청 JSON
docs/DATA_CONTRACT.md  Android/계산기/시각화 공통 좌표와 JSON 약속
docs/openapi.json     검증 시점 API 명세
docs/dli-map.schema.json  DLI Map JSON Schema
tests/                API 통합 테스트
```

참고한 공식 문서: [FastAPI JWT 인증](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/), [SQLAlchemy SQLite 외래키](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html#foreign-key-support).

## 0.3.0 일사량 조회 추가

Open-Meteo 시간별 DNI/DHI 조회와 DB 캐시를 추가했습니다. 설치·기존 DB 유지·Swagger 시험·C 입력 계약은 [docs/WEATHER_API.md](docs/WEATHER_API.md)를 확인하세요.
