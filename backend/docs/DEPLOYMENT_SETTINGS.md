# 알고리즘 연결과 웹 CORS 설정

## 알고리즘 함수

세 API는 이미 아래 알고리즘에 연결할 수 있도록 구현되어 있습니다. 실제 배포에서 사용할 값은 `.env` 또는 프로세스 환경에 설정합니다.

| 설정 | 기본 연결 함수 | 역할 |
| --- | --- | --- |
| DLI_CALLABLE | grid_dli_service:compute_room_dli | 방의 일조량·DLI 계산 |
| DIRECTION_CALLABLE | room_geometry:compute_room_direction | 스캔 방향으로 방 방향 계산 |
| RECOMMENDATION_CALLABLE | recommend_service:recommend_for_room | 식물 배치 추천 |

backend 폴더에서 `.venv/bin/python scripts/check_demo.py`를 실행하면 DB 연결과 세 함수의 import 가능 여부를 검사합니다. `status`가 `ready`이고 `checks.callables`의 세 항목이 모두 `ok`이면 연결 확인이 끝난 것입니다. 실제 계산 결과는 방·스캔·식물을 사용하는 앱/API 흐름에서 확인합니다.

## 웹 개발 화면 허용

`app/main.py`의 CORS 미들웨어는 `CORS_ORIGINS`에 값이 있을 때 활성화됩니다. 기본값 `[]`는 웹 출처를 허용하지 않습니다. 네이티브 앱은 CORS 설정을 요구하지 않습니다.

VM의 SSH에서 아래 순서로 실행합니다. 현재 `backend` 브랜치가 선택된 배포 checkout을 전제로 합니다.

```bash
cd "$(systemctl show plantlight -p WorkingDirectory --value)"
git pull --ff-only origin backend
.venv/bin/python scripts/init_env.py --web-origin http://localhost:8082 --web-origin http://127.0.0.1:8082
sudo systemctl restart plantlight
.venv/bin/python scripts/check_demo.py --check-cors
```

명령이 실패하면 다음 단계로 진행하기 전에 원인을 확인합니다. 기존 작업이 끝난 뒤 서비스를 재시작하세요.

`--web-origin`은 기존 허용 목록에 주소를 중복 없이 추가합니다. 기존 JWT 비밀키·DB 주소·사용자 지정 함수 값은 보존합니다. 누락된 알고리즘 설정 키는 기존 초기화 동작대로 기본값을 추가하며, 이미 있는 빈 함수 값은 임의로 변경하지 않습니다. 파일 업데이트가 완료된 후 서비스 재시작이 필요합니다.

위 등록 명령으로 다음 두 출처를 허용합니다. 서버 API 주소가 아니라 브라우저의 웹 화면 주소를 등록합니다.

```dotenv
CORS_ORIGINS=["http://localhost:8082","http://127.0.0.1:8082"]
```

다른 웹 주소·포트를 사용할 때는 `--web-origin`으로 해당 출처를 추가합니다. 경로나 인증정보 또는 와일드카드를 넣은 새 주소는 거절합니다. 새 주소 끝의 `/`는 제거합니다.

## 실제 실행 중인 서버 확인

`--check-cors`는 기본적으로 `http://127.0.0.1:8000`의 실행 중인 API에 OPTIONS 요청을 보냅니다. 허용 출처, POST 메서드와 Authorization·Content-Type·Idempotency-Key 헤더가 실제로 허용되는지 확인합니다. 요청은 스캔이나 DB 데이터를 생성하지 않으며 로그인 토큰을 보내지 않습니다.

정상 출력에는 다음 항목이 포함됩니다.

```json
{
  "cors": {
    "http://localhost:8082": "ok",
    "http://127.0.0.1:8082": "ok"
  }
}
```

Nginx·HTTPS 경로도 확인하려면 같은 검사에 `--base-url https://현재고정IP`를 지정합니다. 기본 주소는 `/api/v1`을 제외한 API 서버 루트입니다. 인증서 검증은 유지합니다.

기존 `/ready`의 정상 응답만으로는 함수 세 개와 CORS가 모두 검증되지 않습니다. `check_demo.py --check-cors`와 실제 웹 화면의 API 요청을 함께 확인하세요. 프로세스 환경에 같은 이름의 설정이 있으면 `.env`보다 우선하므로, 설정 후 검사에 실패하면 서비스 환경과 로그도 확인합니다.
