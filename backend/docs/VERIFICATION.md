# 2026-11-20 계산 성능 개선 검증

- Python 3.12/Linux/CPU에서 전체 테스트 **302 passed**. 기존 Starlette/httpx deprecation warning 1건은 실패가 아닙니다.
- 90일 연속 기상 자료를 요청 한 번으로 수집하고 날짜별로 저장하는 동작, ERA5/예보 경계, 캐시 적중·만료·부분 재계산, 잘못된 자료의 저장 거절을 검증했습니다.
- 상주 계산 프로세스와 모델 재사용, 동시 요청 직렬화, 시간 초과·작업 오류·프로세스 종료 후 재시작, 종료 중 예열 취소, 예열 완료 전 준비 상태 503을 검증했습니다.
- SKY 채널 단위 처리와 원래 전체 채널 확대/argmax 방식의 픽셀 일치 및 동점 규칙을 24개 회귀 테스트로 확인했습니다. 원본 해상도와 기존 DLI 계산식을 유지합니다.
- FastAPI TestClient에서 실제 SegFormer + 960×1280 합성 JPEG 13장 업로드/분석 → 방향 저장 → 실제 Open-Meteo ERA5(2025-06-01~07) 조회 → DLI 지도 → 날짜별 캐시 재조회 → 추천 계획 생성까지 완료했습니다. 기상 HTTP 요청은 한 번이고 모델 예열/스캔/DLI/추천은 같은 계산 프로세스를 사용했습니다.
- 위 실제 모델/API 연동의 계산 자식 프로세스 최대 RSS는 약 775 MiB였습니다. 웹서버·OS 메모리는 별도이며 실제 VM의 사용량을 확인해야 합니다.
- 독립 알고리즘 측정: 7일 기존 방식 7.29초 → 프로세스 재사용 2.57초, 90일 16.50초. 7일 전체 결과 해시가 일치했습니다. 모델 예열 후 합성 사진 13장 분석은 35.41초 → 13.80초입니다.
- 위 속도는 개발 환경 측정이며 기상 HTTP·DB·업로드·대기열을 제외합니다. Google Cloud VM/Android 실기기 성능·사진 정확도를 보장하지 않습니다. 적용·측정 방법은 [PERFORMANCE.md](PERFORMANCE.md)를 확인하세요.

---

> **2026-11-18 PPFD 통합:** `python -m pytest -q` **262 passed**. 실제 알고리즘 subprocess로 전체/선택 칸의 10분 PPFD, 일일 DLI 합산 일치, 작업 조회·DB 재조회·캐시 구분·소유권·변경 감지·입력/출력 오류를 검증했습니다. 외부 기상은 고정 응답으로 대체했습니다. API 사용법은 [PPFD_API.md](PPFD_API.md)를 확인하세요.

> **2026-11-03 v0.9.0:** 전체 **227 passed** (기존 198 + 신규 29). 13장 합성 JPEG를 실제 SegFormer로 분석하고 외부 기상 → DLI → 추천 계획까지 Uvicorn HTTP 검증을 통과했습니다. 실제 휴대폰 사진 및 Expo 전체 빌드는 별도 검증이 필요합니다. 범위와 실행법은 [DEMO_IMPROVEMENTS.md](DEMO_IMPROVEMENTS.md)를 확인하세요.

> 최종 backend 통합 테스트: **78 passed** (v5 75 + 기존 브랜치 회귀 3).

> v5 GitHub 통합: AR 중복 방지 및 /ready 보존. 새 알고리즘 연결과 검증 범위는 [CHANGES_V5.md](CHANGES_V5.md)를 참고하세요.

> GitHub backend 통합: 기존 AR 재시도 중복 방지와 /ready 보존. 통합 테스트 74 passed (기존 v4 71 + 회귀 3).

> v0.4.0 검증: 2026-10-27 `python -m pytest -q` 71 passed. 기존 57개 + 신규 14개. 외부 기상/알고리즘은 대체 응답으로 검증했습니다. 세부 범위는 FRONTEND_V4.md 참조. 아래는 이전 버전 검증 기록입니다.

# 보정 버전 검증 기록

- 버전: 0.2.0, Python 3.12, Linux, SQLite.
- `python -m pytest -q`: **47 passed**.
- 기존 인증·소유권·방/창문/식물 CRUD·격자·DLI 검증에 Android v3 가져오기/내보내기, 원본 측정값 보존, 회전된 AR축·음수 좌표, 6개 모서리, 잘못된 창문·잔차·날짜·원점·높이·좌표계 거절, 오류 시 일괄 저장 거절, SQLite 백업·재실행 안전성을 추가했습니다.
- 실제 Uvicorn HTTP 확인: 회원가입 → 로그인 → Android v3 방/창문 가져오기 → v3 JSON 내보내기 일치 → grid_v2 → dli_map_v2 검증. `/health`, `/openapi.json` 정상.
- OpenAPI, Android v3 JSON Schema, DLI Map v2 JSON Schema를 갱신했고 두 JSON 예제를 Pydantic으로 검증했습니다.
- Windows/Android 실기기 및 Android 네트워크 연결은 실행하지 않았습니다. DLI 계산·외부 스캔·추천은 미구현입니다.
- Starlette/httpx deprecation warning 1건이 있으며 테스트 실패는 아닙니다.
- 압축 파일에는 DB·테스트 계정·비밀키·가상환경·캐시를 포함하지 않았습니다.

## 0.3.0 추가 검증

52 passed (기존 47개 + 일사량 5개). 실제 외부 API 수신은 DNS/네트워크 제한으로 미검증. 자세한 내용은 WEATHER_API.md 참조.
