> v0.4.0 변경 규격은 [docs/FRONTEND_V4.md](docs/FRONTEND_V4.md)가 우선합니다. `/dli-map`의 기존 형식은 유지됩니다.

# 연동 구현 및 실행 안내

## 이번 변경
- POST /api/v1/rooms/{id}/dli-map: 비동기 계산, 202 + job_id 반환
- GET /api/v1/jobs/{job_id}: PENDING/RUNNING/COMPLETED/FAILED/STALE, 결과·오류·stale 반환
- PUT /api/v1/rooms/{id}/location: 위경도 설정
- GET /api/v1/locations/search?q=서울: 지역명 검색, 사용자가 후보 선택 후 location 호출
- POST /api/v1/windows/{id}/scans: metadata JSON 문자열과 files 13장 multipart
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

algorithm 폴더는 저장소 algorithm 브랜치 7a44874bf50e88a5dff4ee5f39cfcf106738ff36의 원본입니다. ZIP에서는 backend 내부 algorithm 폴더를 사용하고, 팀 저장소에서는 backend와 형제 폴더 algorithm을 우선 사용합니다. ALGORITHM_DIR 환경변수로 명시할 수도 있습니다. import가 서버의 models와 충돌하지 않도록 subprocess에서 실행합니다. 한 번의 알고리즘 호출 제한은 15분입니다.

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

다각형 지원 계산 함수가 준비되면 DLI_CALLABLE=module:function을 지정합니다(algorithm 경로 내 모듈). 입력은 dict 하나이며 room_id, room, date, grid(서버의 정확한 원점·inside_mask·높이·행열), windows(각 window_id, wall_index, v0..v3, sky), dni_dhi, time_basis, mock_sky를 전달합니다. 반환은 같은 격자의 direct_dli, diffuse_dli 배열입니다. 외부 셀은 무시하고 null 처리하며 내부는 유한한 음수 아닌 값이어야 합니다. 서버가 total=direct+diffuse를 다시 구성합니다. 이 연결점은 제안 계약이므로 정우씨 최종 함수에 맞는 얇은 래퍼를 만들어 지정하세요.

방 방향 함수 DIRECTION_CALLABLE=module:function은 corners와 windows[{wall_index,window_azimuth_deg}]를 받아 {x_axis_azimuth_deg:숫자}를 반환하는 제안 계약입니다. 창문별 방향 계산·원형 평균은 이 함수가 담당합니다. 아직 원본 브랜치에 함수가 없어 기본 응답은 501입니다.

추천 함수 RECOMMENDATION_CALLABLE=module:function은 room_id,dli_map,plants[{plant_id,species_id,position,min_dli,max_dli}],blocked_cells[{row,col}]를 받습니다. 서버 요청의 blocked_cells는 [[row,col],...] 형식입니다. 원본 브랜치에 추천 함수가 없어 기본 응답은 501입니다. 추천 결과 계약 확정 후 응답 스키마도 추가해야 합니다.

## 창밖 스캔
metadata: 아래 JSON을 문자열로 전달. files: JPEG 13장(파일명과 frames.file 일치).

```json
{
  "window_id": 1,
  "captured_at": "2026-10-25T14:30:00+09:00",
  "declination_deg": -8.7,
  "window_azimuth_deg": 180,
  "window_azimuth_mag_deg": 188.7,
  "camera": {"hfov_deg":55,"vfov_deg":70,"width":960,"height":1280},
  "frames": [
    {"index":0,"file":"frame_00.jpg","azimuth_deg":90,"azimuth_mag_deg":98.7,"pitch_deg":30,"roll_deg":0}
  ]
}
```

실제 frames에는 0..12의 13개를 넣어야 합니다. 정면-90도부터 +90도까지 15도 간격(허용 오차 5도). 진북=(자북+편각)%360, 오차 1도 이내. EXIF 회전을 적용한 세로 JPEG, 높이1280, camera 크기와 일치, 각 파일 최대5MiB입니다. 파일명은 저장 경로로 사용하지 않고 서버가 UUID/인덱스로 생성합니다. 파일은 data/scans, DB에는 경로·메타데이터 저장. UPLOAD_ROOT로 변경 가능.

실제 SegFormer는 최초 실행 시 Hugging Face에서 모델을 내려받습니다. 서버의 네트워크와 torch/transformers 설치가 필요합니다. 다운로드·분석 실패는 FAILED로 기록됩니다. 프론트의 13장 촬영 UI는 이 변경 범위에 포함하지 않았습니다. 업로드 API는 준비되어 있습니다.

## AR 앱
홈 화면에 '저장한 방 서버 전송' 버튼 추가. 서버 주소, 이미 등록된 이메일/비밀번호, 방 이름을 입력하면 로그인 후 저장된 JSON을 import-ar에 보냅니다. 비밀번호·토큰은 저장하지 않습니다. 기본 자동 AR 진입을 해제하여 홈에서 업로드에 접근할 수 있습니다. 측정 후 뒤로 가기로 홈에 돌아오면 됩니다.

폰에서 PC 서버에 연결할 때 localhost가 아닌 PC의 LAN IP를 사용하세요. HTTP는 debug 빌드에서만 허용되며 release는 HTTPS를 사용합니다. 서버는 0.0.0.0 바인딩과 방화벽 허용이 필요합니다. 각 전송에 고유한 `Idempotency-Key`를 만들고 같은 전송을 재시도할 때 그 키를 재사용하면 같은 방 응답을 받습니다. 내용이 다른 요청에 이미 사용한 키를 재사용하면 409가 반환됩니다. 헤더를 보내지 않는 기존 클라이언트 동작은 유지됩니다.

## dev 협업
원격 브랜치는 변경하지 않았습니다. backend 변경은 backend/에, algorithm은 담당자의 기존 브랜치에서 dev로 합치세요. ZIP에 포함한 algorithm 원본을 별도 수정본으로 덮어쓸 필요가 없습니다. main에서 dev를 생성하고 backend/algorithm/frontend의 변경을 PR로 합쳐 테스트합니다. main 병합은 팀 3명 확인 이후 진행합니다.

## 검증
기존 52개 테스트와 추가 통합 테스트를 실행했습니다. 추가 테스트는 인증·소유권, 날짜 범위, 기간 평균, wall_index 전달, stale 결과, 업로드·SKY 결과 저장, 실패 상태, 미제공 함수 명시 응답을 검사합니다. 실제 upstream DLI subprocess 실행에서 5x4 격자 수치 반환을 확인했습니다. 실제 SKY 투영 함수는 가짜 분류기를 넣어 91x360 결과를 확인했습니다.

Android SDK가 없어 앱 빌드·실기기 전송은 미검증입니다. 실제 SegFormer 추론과 실시간 Open-Meteo 네트워크 연동은 이번 환경에서 실행하지 않았습니다.
