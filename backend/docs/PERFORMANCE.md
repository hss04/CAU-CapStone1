# 계산 프로세스 재사용과 기간별 기상 조회

## 변경 내용

- 한 날짜마다 Python과 NumPy/pandas/pvlib 등을 새로 실행하던 경로를 상주 계산 프로세스 하나로 변경했습니다. 여러 날짜와 후속 요청이 같은 프로세스의 import와 SegFormer 모델을 재사용합니다.
- FastAPI와 알고리즘의 `models` 이름 충돌을 피하는 프로세스 격리는 유지합니다. 날짜별 요청/결과는 작은 JSON 프로토콜로 교환하므로 날짜별 검증·캐시·진행 상태를 그대로 유지할 수 있습니다.
- DLI 캐시에 없는 날짜에 필요한 기상 자료를 한 번에 준비합니다. 이미 유효한 날은 재조회하지 않고, 누락된 연속 구간과 자료 제공자(ERA5/예보)별로 묶어 요청합니다. 한 기간이 모두 과거이고 캐시가 비어 있다면 90일도 HTTP 요청 한 번입니다.
- 기상 자료는 날짜별로 검증한 25개 시각(다음 날 00시 포함)과 기존 만료 정책으로 저장합니다. 긴 원본 응답을 날짜마다 통째로 중복 저장하지 않습니다.
- 모델 예열은 실제 스캔을 처리할 계산 프로세스에서 수행합니다. 모델 로딩뿐 아니라 작은 영상으로 첫 추론도 실행합니다. `/health`는 예열 중에도 응답하고, `/ready`는 예열 완료 전 503을 반환합니다.
- 사진 분류는 원본 해상도에서 채널 4개씩 비교합니다. 150개 채널 전체를 동시에 확대한 뒤 argmax 하던 방식과 하늘 판정·동점 규칙을 유지하며, 큰 임시 텐서의 메모리와 처리 시간을 줄입니다.
- 시간 초과/계산 실패/프로세스 종료 시 현재 작업을 명시적으로 실패시키고 계산 프로세스를 정리합니다. 다음 요청은 새 프로세스를 실행합니다. 실패한 요청을 몰래 재실행하지 않습니다.
- API 요청·응답, 날짜별 DLI/PPFD, 사용자 격리, 금지 칸, 추천과 DB 스키마는 기존 계약을 사용합니다. DLI 계산 공식과 SKY 판정 기준을 유지합니다.

## 서버 적용

`backend` 브랜치를 업데이트한 뒤 기존 `.env`와 `data/`를 보존합니다. 이 변경 자체의 DB 마이그레이션은 없습니다. 이전 버전 설치는 기존 마이그레이션도 먼저 완료해야 합니다.

```bash
git pull --ff-only origin backend
cd backend
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/init_env.py
sudo systemctl restart plantlight
curl -i http://127.0.0.1:8000/ready
```

설치 경로/가상환경 이름은 실제 서비스 설정에 맞춥니다. 기존 HTTPS 설정은 유지됩니다. 서비스는 `--workers 1`로 운영합니다.

새 기본 설정은 다음과 같습니다. `init_env.py`는 기존 설정을 덮어쓰지 않고 없는 키만 추가합니다.

```dotenv
ALGORITHM_PERSISTENT=true
ALGORITHM_TIMEOUT_SECONDS=900
ALGORITHM_NUM_THREADS=1
SKY_MODEL_PRELOAD=true
```

최초 서버 실행은 Hugging Face 모델 다운로드와 예열에 시간이 걸립니다. 파일이 디스크에 있어도 재부팅 후 메모리 로딩은 다시 필요합니다. 발표 전에 서버를 시작하고 `checks.sky_model=ready`와 HTTP 200을 확인하세요. 예열 실패 시 `/ready`가 503이며 서버 로그에서 의존성·네트워크·모델 캐시를 확인합니다. 작은 VM에서는 모델 상주 메모리를 포함해 실제 사용량을 점검합니다. 개발 환경의 실제 모델/API 연동에서 계산 자식 프로세스 최대 RSS는 약 775 MiB였으며 웹서버·OS 메모리는 별도입니다.

모델을 사용하지 않는 서버/개발 테스트는 `SKY_MODEL_PRELOAD=false`로 시작할 수 있습니다. 이때 준비 상태는 `lazy`이며 첫 스캔이 모델을 로딩합니다. `ALGORITHM_PERSISTENT=false`는 기존 실행 방식으로 돌아가는 비교/복구용 설정입니다. 프로세스 재사용을 끄면 예열 모델도 재사용되지 않습니다.

## 직접 시간 측정

작은 가상 방과 고정 일사량으로 프로세스/계산 비용을 측정할 수 있습니다. 서버 DB나 사용자 방은 변경하지 않습니다. 아래는 **기상 HTTP·DB·스캔 업로드·대기열을 제외한** 알고리즘 측정입니다.

```bash
.venv/bin/python scripts/benchmark_performance.py --days 7
.venv/bin/python scripts/benchmark_performance.py --days 90
.venv/bin/python scripts/benchmark_performance.py --days 7 --warm-model
```

기존 방식과 비교하려면 별도 실행에서 다음을 사용합니다.

```bash
ALGORITHM_PERSISTENT=false .venv/bin/python scripts/benchmark_performance.py --days 7 --one-shot
```

Windows PowerShell에서는 `$env:ALGORITHM_PERSISTENT='false'` 후 실행하고, 비교가 끝나면 `'true'`로 복원합니다. 기존 방식과 새 방식의 `daily_result_sha256`(날짜별 전체 결과 해시)도 일치해야 합니다.

실제 촬영 자료가 있으면 모델 예열과 스캔 추론을 분리해서 측정합니다.

```bash
.venv/bin/python scripts/benchmark_performance.py --days 7 --scan-metadata /path/to/metadata.json --scan-dir /path/to/frames
```

최종 발표 대기 시간은 휴대폰에서 업로드를 누른 시점부터 결과 표시까지 실제 VM에서 확인합니다. 노트북의 7일/90일/13장 예상 시간은 VM 속도를 보장하지 않습니다. 예열을 완료한 경우와 재부팅 직후, 기상/DLI 캐시가 있는 경우와 없는 경우를 구분합니다.

### 2026-11-20 개발 환경 측정

Python 3.12/Linux/CPU, 연산 스레드 1개. 아래 수치는 이 개발 환경의 측정이며 Google Cloud VM 성능 보장이 아닙니다.

| 작업 | 측정 시간 | 입력·범위 |
|---|---:|---|
| DLI 7일, 기존 프로세스 실행 방식 | 7.29초 | 4×3m 가상 방, 0.2m 격자, 창문 1개, 고정 일사량 |
| DLI 7일, 프로세스 재사용 | 2.57초 | 동일 입력, 첫 import 포함. 전체 결과 해시 7일 모두 일치 |
| DLI 90일, 프로세스 재사용 | 16.50초 | 같은 가상 방·고정 일사량, 첫 import 포함 |
| SegFormer 메모리 로딩·예열 | 4.99초 | 모델 파일은 다운로드된 상태, 첫 시험 추론 포함 |
| 13장 SKY 분석, 예열 후 | 13.80초 | 960×1280 합성 JPEG 13장, 실제 SegFormer와 각도 투영 |

SKY 분석은 채널별 비교 최적화 전 같은 합성 입력에서 35.41초였습니다. 실제 모델 로짓의 원본 해상도 마스크 비교에서 다른 픽셀 0개를 확인했고, 난수 로짓·동점·다양한 클래스/출력 크기는 회귀 테스트로 검증합니다. 합성 사진 검증은 실제 휴대폰 사진의 분류 정확도 검증을 대신하지 않습니다.

## 계절·과다광 데모

현재 프론트의 기간 비교 화면은 기간별 `/dli-series` 저장 후 `/dli-comparison`을 호출하므로 기존 화면으로 개선 효과를 사용할 수 있습니다. 90일 한 기간과 사계절 각 90일(약 360일)은 계산량이 다릅니다. 각 요청은 기존처럼 최대 93일이며 비교는 2~4개 기간입니다.

계절 비교는 현재 측정한 방·창밖 조건에 과거의 다른 계절 기상 자료를 적용하는 분석입니다. 현재 백엔드의 미래 날짜 제한(오늘+14일)은 유지됩니다. 과다광은 선택 기간 DLI가 해당 종의 상한을 초과하는지로 판정합니다. 계절별 이동 추천 화면까지 연결하려면 선택 기간의 DLI 지도를 추천 API에 넘겨야 합니다.

장기간 비교에는 DLI만 요청하고, 10분 PPFD는 사용자가 고른 날짜/칸에 요청하는 현재 방식이 적절합니다. 전 날짜·전 칸 PPFD에는 기존 응답 크기 제한이 적용됩니다.
