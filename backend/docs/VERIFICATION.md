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
