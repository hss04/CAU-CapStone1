# v5 변경 내역과 적용 방법

## 1. 새 함수 연결

algorithm/을 hss04/CAU-CapStone1의 algorithm 커밋
`320622063cc465f669b2548ad33f9f487adf51de`의 21개 원본 파일로 교체했습니다.
.env.example에 아래 설정을 추가했습니다. `python scripts/init_env.py`로 .env를 생성합니다.

```dotenv
DLI_CALLABLE=grid_dli_service:compute_room_dli
DIRECTION_CALLABLE=room_geometry:compute_room_direction
RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room
DLI_CACHE_VERSION=3206220-v5
```

- 기존 .env에서는 비밀키와 기존 값은 보존하고 누락된 설정만 추가합니다.
  이미 있는 비어 있는/다른 CALLABLE 값은 위 값으로 직접 바꾸세요.
  기존 DLI_CACHE_VERSION도 3206220-v5로 변경하고 서버를 재시작하세요.
- 기존 함수 설정/캐시 버전은 os.environ만 읽어 .env가 무시될 수 있었습니다.
  app/config.py의 AlgorithmSettings에서 .env와 환경변수를 모두 읽도록 수정했습니다.
  실제 환경변수가 .env보다 우선합니다.
- 기본 알고리즘 경로는 backend 내부 algorithm/입니다. 옛 형제 폴더가 자동 선택되지 않습니다.
  외부 폴더를 쓰려면 `ALGORITHM_DIR=../algorithm`을 명시하세요. 상대 경로는 backend 기준입니다.
- requirements.txt에 `scipy>=1.13,<2`를 추가했습니다. 다수 식물의 헝가리안 배정에 필요합니다.
- 새 DLI 함수가 연결되면 직사각형/창문 1개/높이 0 제한 501 및 PROVISIONAL 경로를 사용하지 않습니다.
  설정을 비운 경우에는 기존 fallback 보호 로직이 유지됩니다.
- API 버전 0.5.0. 이번 변경의 추가 DB 마이그레이션은 없습니다. v4 이전 DB는 migrate_v4.py가 필요합니다.

## 2. 추천 응답 확정: 원본 구조 그대로 반환

`POST /api/v1/rooms/{room_id}/recommendations`

요청:
```json
{"dli_job_id":"완료된-DLI-job-id","blocked_cells":[[0,0],[1,2]]}
```

응답 형태 예시(설명용 값):
```json
{
  "room_id": 1,
  "date": "2026-10-01",
  "period": null,
  "plants": [{
    "plant_id": 3,
    "species_id": 1,
    "required_dli": {"min": 2.0, "max": 6.0},
    "current": {"row": 0, "col": 1, "total_dli": 1.0, "status": "LOW"},
    "recommended": {"row": 1, "col": 2, "total_dli": 4.0, "score": 1.0}
  }],
  "warnings": []
}
```

- plants를 바꾸거나 data/result로 감싸지 않고 원본 JSON을 반환합니다.
- app/recommendation_schema.py 응답 모델 및 OpenAPI를 추가했습니다. 잘못된 구조는 502로 처리합니다.
- current=null은 미배치/격자 밖입니다. 현재 백엔드는 room_id와 position을 함께 요구하므로
  일반 생성 API에서 방에 속한 미배치 식물을 만들 수는 없습니다.
- recommended=null은 현재 OK여서 유지하거나 배정 가능한 자리가 없는 경우입니다.
  current.status와 warnings를 함께 확인하세요.
- score는 0~1이며 current에는 score가 없습니다. DLI 단위는 mol/m²/day입니다.
- f4c9c50의 client.ts는 JSON 키를 camelCase로 변환합니다. 서버는 required_dli/total_dli,
  프론트 코드는 requiredDli/totalDli로 접근합니다.
- frontend-integration/에 TypeScript 타입과 적용 절차를 추가했습니다.
  기존 화면의 expectedSunHours/reasons 등은 서버에서 임의 생성하지 않습니다.
- 추천 API는 위치를 저장하지 않습니다. 사용자가 적용하면 기존 식물 수정 API로 저장하세요.

## 3. 검증 및 남은 작업

- 자동 테스트: `python -m pytest -q` → **75 passed**, 비기능적 TestClient deprecation warning 1건.
- .env 생성 후에도 전체 테스트 통과. 기존 .env 값 보존/누락 키 보충/2회 실행 중복 없음 확인.
- algorithm 21개 파일의 Git blob SHA가 지정 커밋 원본과 모두 일치함을 확인했습니다.
- 새 테스트는 .env 우선순위, 실제 subprocess 방향 계산/DLI/추천,
  칸 중복 방지, 가구 칸 제외, OK 유지, 후보 없음, 소유자 격리, 오래된 DLI 거부,
  ㄱ자 방·창문 2개·높이 0.5m의 계산 완료와 PROVISIONAL 없음 등을 확인합니다.
- 날씨는 고정 시간별 데이터로 대체했고 SKY는 mock입니다. 사진 업로드 기존 테스트도 추론을 mock합니다.
- 정우씨 원본 `algorithm/verify_integration.py`에서는 음수 좌표 평행이동 후 산란광 검증 1건 실패:
  500칸 중 7칸 차이, 최대 0.04 (원본 허용치 0.02).
  원본 계산 모델/허용치를 변경하지 않았으며 algorithm 담당자의 수치 검토가 필요합니다.
- frontend f4c9c50 원본을 확인했습니다. 응답 타입은 unknown, 추천 화면은 로컬 plant.analysis를
  사용하므로 실제 화면/상태 연결 작업이 남습니다. 이 ZIP은 백엔드 수정본이며 프론트 전체는 아닙니다.
- 원격 dev 브랜치 조회는 404였습니다. 브랜치 생성·병합·푸시는 수행하지 않았습니다.
- 따라서 backend+실제 algorithm 자동 테스트와 프론트 계약 검토 범위이며,
  dev 전체 병합/Expo 실기기 E2E 완료는 아닙니다. 수동 절차는 frontend-integration/README.md에 있습니다.

## 실행

backend 루트에서 가상환경 Python으로 실행하세요.

```bash
python -m pip install -r requirements.txt
python scripts/init_env.py
python scripts/migrate_v4.py
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

비밀키가 포함된 .env는 ZIP에 넣지 않았습니다. init_env.py가 사용자 환경에서 생성합니다.
웹 프론트는 CORS_ORIGINS에 실제 origin을 지정하세요. 예: `CORS_ORIGINS=["http://localhost:8081"]`.

## GitHub backend 브랜치 통합

backend 기존 AR Idempotency-Key 중복 방지 및 /ready 상태 확인 기능을 보존했습니다.
/ready도 새 ALGORITHM_DIR 설정을 사용합니다. 프론트/algorithm 독립 브랜치는 변경하지 않습니다.
이전 ZIP 생성 시 수행하지 않았던 backend 업로드는 이번 통합 커밋으로 진행합니다.

최종 통합 검증: `python -m pytest -q` → **78 passed**, deprecation warning 1건.
