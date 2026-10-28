# frontend f4c9c50 연결 안내

확인한 원본: hss04/CAU-CapStone1, f4c9c5099598111880c3476e43a53c2f101bc855.
이 폴더는 타입/연결 안내이며, 프론트 전체 프로젝트나 완성된 추천 화면은 아닙니다.

1. recommendation.ts를 frontend/src/types/recommendation.ts로 복사합니다.
2. src/services/api/endpoints.ts에 다음 import를 추가합니다.
   `import type { ApiRecommendationResponse } from '@/types/recommendation';`
3. requestRecommendations 함수의 `apiRequest<unknown>`을
   `apiRequest<ApiRecommendationResponse>`로 바꿉니다. 기존 요청 본문은 그대로 사용합니다.
4. 실제 HTTP 응답은 snake_case입니다. client.ts의 camelize를 거친 후에는
   plantId, speciesId, requiredDli, totalDli로 접근합니다.
5. 추천 화면은 현재 plant.analysis(로컬 PlacementAnalysis)를 읽습니다.
   API 결과를 받은 후 plants.find(p => p.plantId === 실제_서버_식물_ID)로 선택하고
   current/recommended 및 warnings를 표시하도록 화면/상태 관리 변경이 필요합니다.
   기존 expectedSunHours, distanceFromWindowM, reasons는 서버 응답에 없습니다.
   DLI에서 일조시간을 임의로 계산하거나 기존 가짜 값을 섞으면 안 됩니다.
6. recommended.score는 0~1입니다. 퍼센트 UI에는 score*100을 표시합니다.
   current에는 score가 없습니다. current=null은 미배치/격자 밖입니다.
   recommended=null은 current.status=OK일 때 유지, 그 외에는 추천 불가일 수 있으므로
   모든 null을 '현재 위치가 가장 좋음'으로 표시하지 않습니다.
7. 좌표 적용은 완료된 DLI job.result.grid를 기준으로 계산합니다.
   x = grid.origin.x + (col+0.5)*grid.cellSizeM
   z = grid.origin.z + (row+0.5)*grid.cellSizeM
   y = grid.sampleHeightM
   추천 API 자체는 위치를 저장하지 않습니다. 사용자가 적용할 때 기존 updatePlant로 저장하세요.
8. 가구 칸 요청은 blockedCells: [[row,col], ...]입니다. client.ts가 dliJobId를
   dli_job_id로 바꿉니다. 알고리즘 내부의 [{row,col}] 형식은 서버가 변환합니다.

## 수동 dev 통합 검증

이번 조회에서 원격 dev 브랜치는 404였습니다. 브랜치 생성/병합/푸시는 수행하지 않았습니다.
팀 통합 브랜치를 준비한 후 backend는 이 ZIP, algorithm은 동봉본 또는 명시한 ALGORITHM_DIR,
frontend는 위 커밋을 사용하세요. 옛 형제 algorithm 폴더를 자동 선택하지 않습니다.

- backend: requirements 설치 → scripts/init_env.py → 기존 DB는 scripts/migrate_v4.py → uvicorn.
- frontend: EXPO_PUBLIC_API_URL에 PC 주소 지정. 웹은 backend CORS_ORIGINS에 실제 Expo 웹 origin 추가.
- 가입/로그인 → AR 방 가져오기 → 위치 저장 → 각 창문 스캔 업로드 → job 완료 확인.
- direction 요청 → dli-map 요청 → job COMPLETED 확인 → recommendations 요청.
- 여러 식물의 추천 칸 중복/가구 칸 제외/적정 위치 유지/추천 불가 메시지 확인.
- 추천 적용 후 새로고침하여 저장 여부 확인. 방/위치/스캔 변경 후 이전 DLI의 409도 확인.
- 실카메라/SegFormer 추론, 외부 날씨 응답, Expo 화면 렌더링과 추천 적용까지는 별도 실기기 검증 필요.

자동화된 백엔드/실제 알고리즘 검증: `python -m pytest -q tests/test_algorithm_v5.py`.
테스트는 외부 날씨를 고정 데이터로 대체하며 mock_sky를 사용합니다.
따라서 이 테스트 통과는 프론트 전체 E2E 통과를 의미하지 않습니다.
