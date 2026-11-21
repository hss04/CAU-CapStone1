> v5 현재 설정/응답 계약은 [CHANGES_V5.md](docs/CHANGES_V5.md)를 우선 참고하세요. 아래 구형 fallback 설명은 DLI_CALLABLE을 비웠을 때만 적용됩니다.

> v0.4.0 변경 규격은 [docs/FRONTEND_V4.md](docs/FRONTEND_V4.md)가 우선합니다. `/dli-map`의 기존 형식은 유지됩니다.

# 연동 구현 및 실행 안내

## 이번 변경
- POST /api/v1/rooms/{id}/dli-map: 비동기 계산, 202 + job_id 반환
- GET /api/v1/jobs/{job_id}: PENDING/RUNNING/COMPLETED/FAILED/STALE, 결과·오류·stale 반환
- PUT /api/v1/rooms/{id}/location: 위경도 또는 `{"city_id":1838519}`로 한국 도시 위치 설정
- GET /api/v1/locations/cities: 한국 85개 도시와 대표 위경도 목록. q/admin1로 검색 가능
- GET /api/v1/locations/search?q=서울: 한국 도시 우선 검색, 사용자가 후보 선택 후 location 호출

한국 도시 목록, 광주 동명 지역 구분, 좌표 기준과 요청 예시는 [docs/KOREAN_CITIES.md](docs/KOREAN_CITIES.md)를 참고하세요.
- POST /api/v1/windows/{id}/scans: metadata JSON 문자열과 files N장 multipart (120°=9장, 기존 180°=13장)
- POST /api/v1/rooms/{id}/direction: 외부 방향 계산 함수 연결점
- POST /api/v1/rooms/{id}/recommendations: 외부 추천 함수 연결점
- 기본 격자 0.2m, 기간별 일평균 DLI, 사진 파일·메타데이터·작업 상태 저장
- 기존 데이터 테이블 수정 없이 integration_jobs 및 idempotency_records 테이블을 서버 시작 때 추가
- GET /health는 생존 확인, GET /ready는 DB와 알고리즘 폴더 준비 상태 확인
- POST /api/v1/rooms/import-ar는 선택적 Idempotency-Key 헤더로 재시도 중복 생성을 방지

## 실행
Python 3.12 기준. ZIP을 풀고 backend 루트(app, requirements.txt가 있는 위치)에서:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/init_env.py
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

기존 .env와 DB는 그대로 사용하세요. 구버전 DB에 saved_at/measurement가 없으면 기존 scripts/migrate_v3.py를 먼저 실행합니다. ZIP에는 개인 .env·DB·가상환경을 포함하지 않았습니다.

이 구현은 단일 프로세스 개발/연동용입니다. 작업은 DB에 기록하되 FastAPI BackgroundTasks로 실행합니다. 서버 재시작 시 진행 중 작업은 FAILED로 바뀌므로 다시 요청해야 합니다. 여러 worker나 여러 서버 인스턴스로 동시에 실행하지 마세요. 큰 기간·촬영 작업을 운영 서비스에 적용할 때는 별도 작업 큐가 필요합니다.

algorithm 폴더는 저장소 algorithm 브랜치 320622063cc465f669b2548ad33f9f487adf51de의 원본입니다. 기본적으로 backend 내부의 고정 버전 algorithm 폴더를 사용합니다. 형제 algorithm 폴더는 자동 선택하지 않습니다. ALGORITHM_DIR 환경변수로 명시할 수도 있습니다. import가 서버의 models와 충돌하지 않도록 subprocess에서 실행합니다. 한 번의 알고리즘 호출 제한은 15분입니다.

## DLI 테스트 요청
로그인 토큰을 Authorization: Bearer 헤더에 넣습니다. 먼저 방·창문과 위경도를 저장합니다.

```json
{
  "start_date": "2026-10-05",
  "end_date": "2026-10-05",
  "cell_size_m": 0.2,
  "sample_height_m": 0,
  "mock_sky": true,
  "temporary_x_axis_azimuth_deg": 0,
  "accept_provisional_algorithm": true
}
```

응답 status_url을 조회하면 result에 dli_map_v2가 들어갑니다. period에는 start_date/end_date/day_count/aggregation=DAILY_MEAN이 들어가고 date는 시작일입니다. 종료일을 포함한 모든 날을 각각 계산해 평균합니다(최대 93일). 기간 총량이 아닙니다. mock_sky와 temporary_direction은 결과에 명시됩니다. 실제 모드에서는 두 임시 입력을 끄고 실제 방향과 창문별 완료 스캔이 필요합니다.

## 현재 알고리즘에서 반드시 확인할 제한
현재 upstream compute_grid_dli는 축에 정렬된 (0,0),(w,0),(w,d),(0,d) 직사각형, 창문 하나, 높이 0만 지원합니다. 다른 다각형·회전된 방·다중 창문은 501을 반환합니다. 서버는 이를 직사각형으로 잘못 바꿔 계산하지 않습니다.

또한 upstream의 일사량 보간은 PRECEDING_HOUR_MEAN 처리와 불일치하고 계산 시간이 08~18시로 제한되어 있습니다. 따라서 원본 알고리즘 실행은 accept_provisional_algorithm=true가 필요하며 결과에 경고가 포함됩니다. 이 두 문제는 계산 담당자 검토가 필요합니다. 이 ZIP의 서버 연결 작업으로 계산 모델이 검증된 것은 아닙니다.

다각형 지원 계산 함수가 준비되면 DLI_CALLABLE=module:function을 지정합니다(algorithm 경로 내 모듈). 입력은 dict 하나이며 room_id, room, date, grid(서버의 정확한 원점·inside_mask·높이·행열), windows(각 window_id, wall_index, v0..v3, sky), dni_dhi, time_basis, mock_sky를 전달합니다. 반환은 같은 격자의 direct_dli, diffuse_dli 배열입니다. 외부 셀은 무시하고 null 처리하며 내부는 유한한 음수 아닌 값이어야 합니다. 서버가 total=direct+diffuse를 다시 구성합니다. v5에서는 정우씨 grid_dli_service:compute_room_dli 래퍼를 그대로 지정합니다.

방 방향 함수 DIRECTION_CALLABLE=module:function은 corners와 windows[{wall_index,window_azimuth_deg}]를 받아 {x_axis_azimuth_deg:숫자}를 반환하는 제안 계약입니다. 창문별 방향 계산·원형 평균은 이 함수가 담당합니다. v5에서는 room_geometry:compute_room_direction을 연결합니다.

추천 함수 RECOMMENDATION_CALLABLE=module:function은 room_id,dli_map,plants[{plant_id,species_id,position,min_dli,max_dli}],blocked_cells[{row,col}]를 받습니다. 서버 요청의 blocked_cells는 [[row,col],...] 형식입니다. v5에서는 recommend_service:recommend_for_room을 연결하고 plants 구조를 그대로 반환합니다. OpenAPI 응답 모델도 추가했습니다.

## 창밖 스캔
metadata: 아래 JSON을 문자열로 전달. files: JPEG N장(파일명과 frames.file 일치).
사진 수로 스캔 범위를 계산하므로 별도의 범위 필드는 필요 없습니다. 15° 간격으로 2~13장을 받으며, 촬영 중심 방향은 창문 정면입니다.

| 범위 | 장수 N | index | 창문 정면 기준 방향 |
| --- | --- | --- | --- |
| 90° | 7 | 0~6 | −45°~+45° |
| 120° (현재 앱) | 9 | 0~8 | −60°~+60° |
| 180° (기존 앱) | 13 | 0~12 | −90°~+90° |

아래 예시는 120° 스캔의 첫 프레임만 표시한 것으로, 실제 요청에는 나머지 8개 프레임도 포함합니다.

```json
{
  "window_id": 1,
  "captured_at": "2026-10-25T14:30:00+09:00",
  "declination_deg": -8.7,
  "window_azimuth_deg": 180,
  "window_azimuth_mag_deg": 188.7,
  "camera": {"hfov_deg":55,"vfov_deg":70,"width":960,"height":1280},
  "frames": [
    {"index":0,"file":"frame_00.jpg","azimuth_deg":120,"azimuth_mag_deg":128.7,"pitch_deg":30,"roll_deg":0}
  ]
}
```

실제 frames에는 0..N−1의 고유한 index와 중복 없는 파일명을 넣습니다. 사진 i의 예상 방위각은 `(window_azimuth_deg − (N−1)×7.5 + 15×i) % 360`이며 허용 오차는 5°입니다. 배열 순서는 자유지만 index·방위각·파일의 대응은 유지해야 합니다. files도 정확히 N개여야 하며 파일명 집합이 frames.file과 일치해야 합니다. 시작·끝 촬영 방향 사이의 범위는 최대 180°이며, 사진 자체 화각은 이 범위에 더해집니다.

진북=(자북+편각)%360, 오차 1도 이내. EXIF 회전을 적용한 세로 JPEG, 높이1280, camera 크기와 일치, 각 파일 최대5MiB입니다. 파일명은 저장 경로로 사용하지 않고 서버가 UUID/인덱스로 생성합니다. 파일은 data/scans, DB에는 경로·메타데이터 저장. UPLOAD_ROOT로 변경 가능. API 경로·작업 응답·DB 구조는 동일하며 기존 13장 요청과 호환됩니다.

실제 SegFormer는 최초 실행 시 Hugging Face에서 모델을 내려받습니다. 서버의 네트워크와 torch/transformers 설치가 필요합니다. 다운로드·분석 실패는 FAILED로 기록됩니다. 실제 사진 분석은 전달받은 N개 프레임을 처리합니다. 촬영되지 않은 방향의 기존 차폐 처리 규칙은 유지되므로, 좁아진 범위의 DLI 결과는 실제 공간에서 확인하세요.

### 로컬·배포 서버 적용

로컬과 VM의 `backend` 브랜치 checkout에 같은 수정본을 받습니다. 이번 스캔 변경에는 DB 마이그레이션이나 새 의존성이 필요하지 않습니다. VM에서는 진행 중인 계산이 끝난 뒤 기존 `plantlight` 서비스를 재시작합니다.

```bash
# backend 브랜치를 사용 중인 저장소 폴더에서 실행
git pull --ff-only origin backend
# VM에서 실행. 로컬 개발 서버는 기존 실행 방식으로 재시작
sudo systemctl restart plantlight
curl --fail http://127.0.0.1:8000/ready
```

모델 준비 중이면 `/ready`가 일시적으로 503을 반환합니다. `ready`가 된 후 현재 앱의 9장 업로드와 작업 완료를 확인합니다. 위 저장소 변경만으로 외부 IP 유형이나 VM의 `.env` 설정이 변경되지는 않습니다.

알고리즘 설정 확인은 backend 폴더에서 기존 `python scripts/check_demo.py`를 실행합니다. `DLI_CALLABLE=grid_dli_service:compute_room_dli`, `DIRECTION_CALLABLE=room_geometry:compute_room_direction`, `RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room` 연결을 검사하며, 비밀 설정값을 출력하지 않습니다.

웹 개발 화면도 배포 서버에 연결할 경우 VM의 `.env`에 `CORS_ORIGINS=["http://localhost:8082","http://127.0.0.1:8082"]`를 설정하고 서비스를 재시작합니다. 네이티브 앱만 사용하는 경우에는 필요하지 않습니다. HTTPS 및 IP 인증서 확인은 [HTTPS_GCP.md](docs/HTTPS_GCP.md)를 참고하세요.

## AR 앱
홈 화면에 '저장한 방 서버 전송' 버튼 추가. 서버 주소, 이미 등록된 이메일/비밀번호, 방 이름을 입력하면 로그인 후 저장된 JSON을 import-ar에 보냅니다. 비밀번호·토큰은 저장하지 않습니다. 기본 자동 AR 진입을 해제하여 홈에서 업로드에 접근할 수 있습니다. 측정 후 뒤로 가기로 홈에 돌아오면 됩니다.

폰에서 PC 서버에 연결할 때 localhost가 아닌 PC의 LAN IP를 사용하세요. HTTP는 debug 빌드에서만 허용되며 release는 HTTPS를 사용합니다. 서버는 0.0.0.0 바인딩과 방화벽 허용이 필요합니다. 각 전송에 고유한 `Idempotency-Key`를 만들고 같은 전송을 재시도할 때 그 키를 재사용하면 같은 방 응답을 받습니다. 내용이 다른 요청에 이미 사용한 키를 재사용하면 409가 반환됩니다. 헤더를 보내지 않는 기존 클라이언트 동작은 유지됩니다.

## dev 협업
원격 브랜치는 변경하지 않았습니다. backend 변경은 backend/에, algorithm은 담당자의 기존 브랜치에서 dev로 합치세요. ZIP에 포함한 algorithm 원본을 별도 수정본으로 덮어쓸 필요가 없습니다. main에서 dev를 생성하고 backend/algorithm/frontend의 변경을 PR로 합쳐 테스트합니다. main 병합은 팀 3명 확인 이후 진행합니다.

## 검증
기존 52개 테스트와 추가 통합 테스트를 실행했습니다. 추가 테스트는 인증·소유권, 날짜 범위, 기간 평균, wall_index 전달, stale 결과, 업로드·SKY 결과 저장, 실패 상태, 미제공 함수 명시 응답을 검사합니다. 실제 upstream DLI subprocess 실행에서 5x4 격자 수치 반환을 확인했습니다. 실제 SKY 투영 함수는 가짜 분류기를 넣어 91x360 결과를 확인했습니다.

Android SDK가 없어 앱 빌드·실기기 전송은 미검증입니다. 실제 SegFormer 추론과 실시간 Open-Meteo 네트워크 연동은 이번 환경에서 실행하지 않았습니다.

