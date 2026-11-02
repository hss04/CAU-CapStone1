# 개별 식물 생장 사진 API — v0.7.0

개별 식물을 선택한 화면에서 사진과 촬영일·메모를 등록하고 날짜순으로 생장 과정을 볼 수 있도록 백엔드를 추가했습니다. 모든 경로 앞에 `/api/v1`을 붙이고 기존 JWT의 `Authorization: Bearer ...` 헤더를 사용합니다. 기존 캘린더·물주기·DLI API를 함께 사용할 수 있습니다.

## 적용과 저장

기존 서버를 중지하고 `backend` 폴더에서 실행합니다. 기존 의존성인 Pillow와 python-multipart를 사용하므로 새 패키지나 외부 사진 저장 서비스 설정이 필요하지 않습니다.

```powershell
.\.venv\Scripts\python.exe scripts\migrate_v4.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

기존 마이그레이션은 DB를 백업하고 `growth_photos` 테이블을 추가합니다. v4 이상 DB에서는 서버 재시작으로도 새 테이블을 추가할 수 있습니다. 기존 식물·일정·이력을 유지합니다.

현재 소규모 프로젝트 구성에서는 사진·썸네일과 메타데이터를 **현재 DB 안에 함께 저장**합니다. 사진 등록·삭제와 DB 백업을 하나로 관리할 수 있으며 파일 경로나 외부 URL을 클라이언트가 지정하지 않습니다. DB 파일을 유지하면 서버 재시작 뒤에도 사진이 유지됩니다. 사진이 늘면 DB 용량도 증가하므로 큰 규모의 서비스로 확장할 때는 이미지 저장소 분리를 검토합니다.

## API 목록

| 기능 | 요청 |
| --- | --- |
| 선택한 식물에 사진 추가 | `POST /plants/{plant_id}/growth-photos` |
| 선택한 식물의 생장 사진 목록 | `GET /plants/{plant_id}/growth-photos` |
| 사진 한 건의 정보 | `GET /growth-photos/{photo_id}` |
| 촬영일·메모 수정 | `PATCH /growth-photos/{photo_id}` |
| 저장 이미지 조회 | `GET /growth-photos/{photo_id}/image` |
| 목록용 썸네일 조회 | `GET /growth-photos/{photo_id}/thumbnail` |
| 사진과 메타데이터 삭제 | `DELETE /growth-photos/{photo_id}` |

사진 URL을 포함한 모든 API에 인증이 필요합니다. 본인 식물과 사진만 접근 가능하며 타인 또는 없는 ID는 404, 미로그인은 401입니다. 식물을 삭제하면 관련 사진도 삭제되고, 방 삭제 시에는 기존 동작대로 식물과 사진을 유지합니다.

## 1. 사진 업로드

본문은 JSON이 아닌 **multipart/form-data**입니다. 사진 한 장씩 등록하며 같은 날 여러 장을 올릴 수 있습니다.

| 항목 | 설명 |
| --- | --- |
| `file` | 필수. 실제 이미지 파일 |
| `taken_at` | 선택. 시간대가 포함된 촬영 시각. 예: `2026-11-01T14:30:00+09:00` |
| `note` | 선택. 최대 2,000자 메모 |
| `Idempotency-Key` 헤더 | 선택. 업로드 재시도 중복 방지용 키, 1~128자 |

`taken_at`을 생략하면 서버 업로드 시각을 사용합니다. EXIF의 촬영 시각을 자동으로 추정하지 않습니다. 과거 사진은 촬영 시각을 전달하거나 나중에 수정합니다. 시간대 없는 날짜·시각과 한국시간 기준 미래 날짜는 422입니다. 응답 시각은 모두 `+09:00`입니다.

지원 파일은 정지 **JPEG·PNG·WebP**, 한 장당 최대 **10 MiB**, 해상도 최대 **2,500만 픽셀**입니다. 실제 파일을 디코딩하여 형식을 확인합니다. 애니메이션은 받지 않습니다. 저장 시 카메라 회전 정보를 반영하고 긴 변 최대 2,048px의 JPEG와 긴 변 최대 320px의 썸네일을 만듭니다. 비율을 유지하고 작은 이미지를 확대하지 않습니다. 투명 배경은 흰색으로 합성하고 EXIF/GPS 메타데이터는 보존하지 않습니다. 저장 이미지와 썸네일은 원본 바이트를 그대로 보관하는 방식이 아닙니다.

성공하면 HTTP 201과 아래 정보를 반환합니다. ID·크기·용량·시각은 예시입니다.

```json
{
  "id": 5,
  "plant_id": 12,
  "taken_at": "2026-11-01T14:30:00+09:00",
  "taken_on": "2026-11-01",
  "note": "새 잎이 나왔음",
  "width": 1536,
  "height": 2048,
  "byte_size": 320000,
  "created_at": "2026-11-02T16:00:00+09:00",
  "content_type": "image/jpeg",
  "image_url": "/api/v1/growth-photos/5/image",
  "thumbnail_url": "/api/v1/growth-photos/5/thumbnail"
}
```

URL은 서버 기준 상대 경로이므로 기존 서버 주소를 앞에 붙입니다. 이미지 자체를 Base64로 JSON에 넣지 않습니다.

### 웹에서 전송 예시

```javascript
const form = new FormData();
form.append('file', selectedFile); // 브라우저 File 객체
form.append('taken_at', '2026-11-01T14:30:00+09:00');
form.append('note', '새 잎이 나왔음');

const response = await fetch(`${baseUrl}/api/v1/plants/${plantId}/growth-photos`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': uploadAttemptKey
  },
  body: form
});
if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
const photo = await response.json();
```

`Content-Type`을 직접 지정하지 않습니다. 브라우저가 multipart boundary를 붙입니다. 기존 프론트의 JSON 전용 요청 함수가 본문을 `JSON.stringify`하거나 `application/json`을 강제한다면, FormData를 그대로 전송하도록 연결합니다. API 예시는 원본 snake_case 기준이며 기존 camelize 변환 뒤에는 `takenAt`, `imageUrl`, `thumbnailUrl` 등으로 접근합니다.

React Native에서는 선택한 사진의 로컬 URI를 사용하는 파일 객체를 FormData에 넣을 수 있습니다.

```javascript
form.append('file', {
  uri: selectedAsset.uri,
  name: 'plant.jpg',
  type: 'image/jpeg'
});
```

실제 선택 파일이 PNG·WebP이면 `name`과 `type`도 실제 형식에 맞춥니다. HEIC 등은 지원 형식으로 변환해 전송합니다.

키는 **새 업로드마다 생성하고 같은 요청의 재시도에 재사용**합니다. 동일 식물·키·파일 내용·촬영 시각·메모는 사진 한 건만 저장하고 같은 사진을 반환합니다. 촬영 시각을 생략한 재시도도 최초 저장 시각을 유지합니다. 같은 키로 다른 사진·메타데이터를 보내면 409입니다. 키 없이 전송한 동일 사진은 별도 사진으로 저장할 수 있습니다.

## 2. 생장 과정 목록

```http
GET /api/v1/plants/12/growth-photos?order=asc&limit=20&offset=0
```

- 기본은 촬영 시각의 오래된 순(`asc`)이며 `desc`로 최신순 조회가 가능합니다. 시각이 같으면 사진 ID로 정렬합니다.
- `start_date`, `end_date`를 각각 선택적으로 전달하여 한국시간 날짜로 기간을 검색합니다. 양끝 포함입니다.
- `limit` 기본 50·최대 100, `offset` 기본 0입니다.
- 최신 사진 한 장은 `order=desc&limit=1`로 조회합니다.
- 사진이 없어도 200과 빈 `photos` 배열을 반환합니다.

```json
{
  "plant_id": 12,
  "plant_nickname": "거실 몬스테라",
  "timezone": "Asia/Seoul",
  "total": 0,
  "limit": 20,
  "offset": 0,
  "has_more": false,
  "photos": []
}
```

위는 사진이 없는 경우입니다. 등록 후 `photos`에는 업로드 응답과 같은 사진 메타데이터가 들어갑니다. `total`은 필터를 적용한 전체 건수이고 `has_more`로 다음 페이지 유무를 확인합니다. 목록 조회에는 이미지 바이트를 읽어 넣지 않습니다.

각 항목을 촬영일·메모·썸네일로 나열하고, 항목을 선택했을 때 `image_url`을 불러오면 생장 사진 상세 화면에 연결할 수 있습니다.

## 3. 인증된 이미지 표시

이미지·썸네일 응답은 `image/jpeg`이며 조회에도 **Authorization 헤더**가 필요합니다. 토큰을 URL 쿼리에 넣거나 사진 URL만 공개 링크로 사용하지 않습니다.

React Native Image의 source에는 `uri`와 `headers: { Authorization: ... }`를 함께 전달합니다. 웹에서는 다음과 같이 인증 후 Blob URL을 만들어 `<img>`에 연결할 수 있습니다.

```javascript
const response = await fetch(`${baseUrl}${photo.thumbnail_url}`, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!response.ok) throw new Error(`Image failed: ${response.status}`);
const imageObjectUrl = URL.createObjectURL(await response.blob());
// img.src = imageObjectUrl; 화면에서 해제할 때 URL.revokeObjectURL(imageObjectUrl).
```

## 4. 메모·촬영 시각 수정과 삭제

```http
PATCH /api/v1/growth-photos/5
Content-Type: application/json

{"note":"일주일 뒤 새 잎이 더 자랐음"}
```

보낸 필드만 바꾸고 생략한 필드는 유지합니다. `note: null`은 메모를 지웁니다. `taken_at`도 같은 형식으로 수정할 수 있으며, 날짜가 바뀌면 타임라인 위치와 기간 검색도 바뀝니다. `taken_at: null` 또는 빈 `{}` 본문은 422입니다. 이미지 내용은 그대로 유지하고 갱신된 메타데이터를 200으로 반환합니다.

`DELETE /growth-photos/5`는 사진·썸네일·메타데이터를 함께 삭제하고 204를 반환합니다. 삭제 후 사진 정보와 이미지 URL은 404입니다.

## 오류와 검증

| 상태 | 의미 |
| --- | --- |
| 401 | 로그인 필요 또는 토큰 만료 |
| 404 | 본인 식물·사진이 없거나 접근 불가 |
| 409 | 같은 업로드 키의 다른 요청 또는 DB 충돌 |
| 413 | 파일 용량·픽셀 수 초과 |
| 415 | 지원하지 않는 이미지 형식·애니메이션 또는 MIME 불일치 |
| 422 | 손상·빈 파일, 잘못된 촬영일·메모·쿼리 |

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

`tests/test_growth_photos.py`는 업로드·비공개 이미지 조회·목록·수정·삭제, 날짜/정렬/페이지 처리, 형식·용량·회전·썸네일, 중복 업로드 방지, 사용자 격리, DB 재접속·기존 DB 업그레이드, 식물/방 삭제와 이미지 수명을 검증합니다.
