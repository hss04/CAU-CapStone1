# Google Cloud VM에 HTTPS 적용

기존 `plantlight`(127.0.0.1:8000)와 Nginx HTTP 구성을 사용하는 Debian/Ubuntu VM용이다. `scripts/setup_https.sh`는 외부 IPv4에 Let's Encrypt 인증서를 발급하고 Nginx HTTPS 및 자동 갱신을 설정한다. 유료 도메인이나 로드 밸런서를 추가하지 않는다.

2026년부터 Let's Encrypt는 공인 IP 인증서를 지원한다. Certbot 5.4 이상에서 `webroot`와 `--ip-address`를 사용할 수 있다. IP 인증서는 약 6일(160시간) 유효하므로 자동 갱신을 반드시 유지해야 한다.

## 1. Google Cloud에서 준비

1. Compute Engine → VM 인스턴스에서 기존 `plantlight-server`를 실행한다.
2. VM을 선택하고 수정 → 네트워킹/방화벽의 **HTTP 트래픽 허용**, **HTTPS 트래픽 허용**을 확인한다. VM에 적용되는 VPC 방화벽 규칙에서 TCP **80, 443**이 외부에서 접근 가능해야 한다. VM 내부 방화벽을 별도로 사용한다면 그 방화벽에서도 허용한다. 80은 인증서 갱신 때도 필요하다.
3. 앱의 주소를 고정해서 사용할 경우 현재 외부 IPv4를 고정 IP로 승격한다. 외부 IP가 바뀌면 이전 IP 인증서로는 새 주소를 인증할 수 없으므로 스크립트를 다시 실행해야 한다. 외부 IPv4 요금은 임시/고정 모두 적용되며, 고정 IP는 VM을 중지해도 예약이 유지된다.
4. VM의 **SSH** 버튼으로 터미널을 연다. 아래 명령은 개인 PC나 Cloud Shell 대신 **실제 백엔드 VM**에서 실행한다.

설정 전 점검:

```bash
sudo systemctl status plantlight nginx --no-pager
curl --fail http://127.0.0.1:8000/health
```

외부 IP는 실행 때 VM 메타데이터에서 읽는다. 이전 대화의 IP를 복사해서 고정 입력하지 않는다.

## 2. 설치

```bash
cd ~/CAU-CapStone1
git switch backend
git pull --ff-only origin backend
cd backend
sudo bash scripts/setup_https.sh
```

최초 Certbot 실행에서 이메일과 이용약관에 대한 질문이 나오면 직접 응답한다. 스크립트는 약관을 자동 수락하지 않는다. Certbot은 `/opt/plantlight-certbot`의 별도 Python 가상환경에 설치되며 앱 가상환경에는 설치하지 않는다. `venv`가 없으면 Debian/Ubuntu의 `python3-venv`를 설치한다.

메타데이터를 사용할 수 없는 경우에만 현재 공인 IPv4를 명시한다.

```bash
sudo bash scripts/setup_https.sh --ip YOUR_CURRENT_PUBLIC_IPV4
```

이 명령은 기존 `/etc/nginx/sites-available/default`를 수정하지 않고 `/etc/nginx/conf.d/plantlight-https.conf`를 추가한다. 기존 안내의 `server_name _;`, 업로드 한도 100 MB, 프록시 읽기 제한 900초에 맞춰 구성한다. 특정 IP용 HTTP 가상 호스트가 이미 다른 파일에 있으면 충돌을 감지하고 중단한다.

스크립트는 기존 API 서버를 재시작하지 않는다. Nginx 설정을 검사하고 `reload`하므로 계산 작업을 처리하는 worker 1개 구성이 유지된다. 기존 DB와 업로드 파일은 변경하지 않는다.

인증서 발급, TLS 검증 또는 갱신 시험이 실패하면 추가한 Nginx 설정을 이전 상태로 복원한다. 기존 관리 파일은 `/var/backups/plantlight-https.*`에 백업한다. 이미 발급한 인증서는 삭제하지 않으며, 재실행 시 재사용할 수 있다.

## 3. 접속과 앱 연결

설치 마지막에 출력되는 **현재 IP**를 사용한다.

| 용도 | 주소 |
|---|---|
| 앱 API 기본 주소 | `https://현재외부IP/` |
| 준비 상태 | `https://현재외부IP/ready` |
| API 문서 | `https://현재외부IP/docs` |

팀원 기기에서 직접 HTTPS 주소를 열고 인증서 경고 없이 접속되는지 확인한다. VM 내부 검증만으로는 Google Cloud의 443번 외부 방화벽이 열렸다고 판단할 수 없다.

HTTP 요청은 HTTPS로 308 리다이렉트되지만, **앱의 기본 URL도 반드시 `https://`로 변경한다**. HTTP로 먼저 보낸 비밀번호/토큰이 리다이렉트 때문에 소급해서 암호화되는 것은 아니다. Retrofit은 기본 URL의 마지막 `/`를 포함한다. 브라우저 프론트라면 HTTPS 프론트에서 HTTPS API를 호출하고, `CORS_ORIGINS`가 설정되어 있는 경우 실제 프론트 출처와 일치하는지도 확인한다.

인증서 검증을 끄는 Android/OkHttp 설정이나 `curl -k`를 사용하지 않는다. IP SAN과 공인 인증서 체인이 검증되어야 한다.

## 4. 자동 갱신 확인

```bash
sudo systemctl list-timers plantlight-certbot-renew.timer
sudo systemctl status plantlight-certbot-renew.timer --no-pager
sudo /opt/plantlight-certbot/bin/certbot renew --cert-name plantlight-ip --dry-run --run-deploy-hooks
```

설치 과정에서도 갱신 시험을 실행한다. 타이머는 하루 두 번 갱신 필요 여부를 확인하고 실제 갱신 후 Nginx를 reload한다. 인증서가 아직 유효하면 매번 재발급하지 않는다. HTTP-01 검증용 80번 포트를 계속 열어 둔다.

```bash
sudo journalctl -u plantlight-certbot-renew.service -n 80 --no-pager
sudo openssl x509 -in /etc/letsencrypt/live/plantlight-ip/fullchain.pem -noout -dates -ext subjectAltName
```

Certbot도 정기적으로 업데이트한다.

```bash
sudo /opt/plantlight-certbot/bin/python -m pip install --upgrade certbot
```

## 문제 확인

| 증상 | 확인할 것 |
|---|---|
| 발급 시 timeout/unauthorized | 현재 IP, 외부 TCP 80, VM 내부 방화벽, `sudo nginx -T`의 challenge 경로 |
| VM 내부 검증 성공, 외부 HTTPS 접속 실패 | Google Cloud TCP 443 방화벽 규칙과 VM 네트워크 태그, VM 내부 방화벽 |
| `conflicting server name` | 다른 Nginx 파일에 같은 IP가 선언되어 있는지 확인. 자동으로 다른 사이트를 덮어쓰지 않는다 |
| 인증서 주소 불일치 | VM의 현재 IP와 인증서 IP 비교. IP 변경 후 설치 명령 재실행 |
| 인증서 만료 | 갱신 타이머·서비스 로그와 외부 TCP 80 확인 |
| `/health` 성공, `/ready` 503 | TLS와 별개로 DB/알고리즘 디렉터리 준비 상태 확인 |

## 공식 문서

- [Let's Encrypt 공인 IP 인증서 지원](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/)
- [Certbot으로 IP 인증서 발급·갱신](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/)
- [Certbot Python 가상환경 설치](https://certbot.eff.org/instructions?os=pip&ws=other)
- [Certbot 자동 갱신](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)
- [Google Cloud HTTP/HTTPS 방화벽](https://docs.cloud.google.com/compute/docs/instances/create-vm-specific-subnet)
- [Google Cloud 외부 IP 요금](https://cloud.google.com/vpc/network-pricing#ipaddress)
