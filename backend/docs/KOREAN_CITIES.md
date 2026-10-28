# 한국 시 단위 위치 선택

서울·부산·광주 등 한국 도시를 고르면 대표 위도·경도를 사용할 수 있습니다.
특별시·광역시·세종과 일반 시, 제주시·서귀포시를 포함한 **85개 도시 검색 항목**을 제공합니다.
군·구·읍·면·동은 이 도시 목록에 포함하지 않습니다. 모든 API는 기존 Bearer 로그인 토큰이 필요합니다.

## 1. 도시 목록과 좌표 조회

```http
GET /api/v1/locations/cities
GET /api/v1/locations/cities?q=부산
GET /api/v1/locations/cities?q=광주&admin1=경기도
```

q를 생략하면 전체 목록을 반환합니다. 부분 이름, 공백, `서울시`/`서울특별시` 같은 별칭을 지원합니다.
admin1은 선택 사항이며 `경기도`/`경기`, `강원특별자치도`/`강원도`/`강원` 같은 표기를 사용할 수 있습니다.
검색 결과가 없으면 HTTP 200과 빈 results를 반환합니다. 공백만 있는 검색어는 422입니다.
q의 최대 길이는 100자이고, 전체 목록과 검색 결과는 name/admin1 순으로 정렬됩니다.

부산 조회 응답 예시:

```json
{
  "results": [
    {
      "id": 1838519,
      "name": "부산광역시",
      "display_name": "부산광역시",
      "country": "대한민국",
      "country_code": "KR",
      "admin1": "부산광역시",
      "latitude": 35.18169,
      "longitude": 129.04047,
      "timezone": "Asia/Seoul",
      "coordinate_basis": "CITY_REPRESENTATIVE",
      "source": "GEONAMES"
    }
  ]
}
```

`광주`와 `광주시` 검색은 **광주 도시권(GeoNames 표기: 광주광역시)**과 **경기도 광주시**를 모두 반환합니다.
프런트엔드는 display_name으로 구분하고 사용자가 고른 id를 사용해야 합니다.
`광주광역시`, `경기도 광주시` 또는 `q=광주&admin1=경기도`로 범위를 좁힐 수 있습니다.
첫 번째 후보를 자동으로 선택하지 마세요.

## 2. 도시 ID로 방 위치 저장

기존 위치 저장 API에 도시 ID 입력을 추가했습니다.

```http
PUT /api/v1/rooms/1/location
Content-Type: application/json
Authorization: Bearer <access_token>

{"city_id": 1838519}
```

서버가 해당 도시의 latitude/longitude와 display_name을 방에 저장하고 기존 RoomOut을 반환합니다.
city_id는 반드시 목록 응답의 정수 id를 사용하세요. 알 수 없는 ID는 404입니다.
다른 사람의 방은 기존처럼 404이며, 도시 ID와 임의 좌표를 섞어 보내면 422입니다.

기존 `{"latitude":37.5665,"longitude":126.978,"location_name":"서울"}` 형식도 계속 지원합니다.
위치가 바뀌면 완료된 DLI/DLI_SERIES 작업을 STALE로 표시합니다. 방 구조 버전과 스캔은 유지하며,
같은 도시를 다시 저장하여 좌표가 같으면 완료된 광량 작업을 유지합니다.
DB 스키마 변경이나 마이그레이션은 필요하지 않습니다.

## 3. 기존 지역 검색 API

`GET /api/v1/locations/search?q=서울`도 도시 목록을 먼저 검색하여 최대 10개를 반환합니다.
지원되는 도시 검색은 외부 API 호출 없이 동작합니다. cities API는 1자 접두어도 허용하지만,
기존 search API의 검색어는 앞뒤 공백을 제거한 뒤 2자 이상이어야 합니다.

도시 목록에 일치하는 항목이 없으면 기존 Open-Meteo 지역 검색을 사용합니다.
이때 `countryCode=KR`을 전달하고, 응답에서도 country_code가 KR인 항목만 반환합니다.
따라서 일반 search에는 한국의 구·역 등 도시가 아닌 지역도 나올 수 있습니다.
**도시만 선택하는 UI는 `/locations/cities`를 사용하세요.**

두 검색 API 모두 기존 results 배열과 id/name/country/admin1/latitude/longitude/timezone 필드를 유지합니다.
도시 목록의 id는 GeoNames의 도시 행정구역 레코드 ID입니다. 일반 search의 외부 검색 ID는 도시 목록 ID와
다를 수 있으므로 외부 검색 결과는 기존 latitude/longitude 저장 형식을 사용하세요.

## 데이터와 정확도

- 원본: [GeoNames KR 국가별 배포 파일](https://download.geonames.org/export/dump/KR.zip)
- 원본 형식: [GeoNames 배포 문서](https://download.geonames.org/export/dump/readme.txt)
- 라이선스: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/), GeoNames에 출처 표시
- 보관 위치: `app/catalogues/korean_cities.json`; 원본 SHA-256, 수집일(2026-10-28), 레코드별 수정일을 함께 기록
- 선정 기준: GeoNames의 한국 ADM1 도시 항목 8개와, 한국어 별칭이 시로 끝나는 ADM2 항목 77개
- 좌표: 각 GeoNames ADM1/ADM2 레코드의 WGS84 대표 지점. 계산한 도형 중심이나 시청 위치를 뜻하지 않습니다.

도시 좌표는 **시 단위 일조 분석을 시작하기 위한 대표 위치**입니다. 실제 집의 GPS 위치와는 차이가 있으므로,
정확한 좌표를 확보하면 기존 latitude/longitude 입력으로 갱신할 수 있습니다.
이 목록은 지명 검색용 스냅샷으로 최신 법정주소 목록이 아닙니다. GeoNames의 기존 광주광역시·전라남도 등의
행정 표기는 검색과 구분용으로 유지합니다. 행정구역 변경이 있어도 도시 좌표를 광역 통합구역의 중심으로 바꾸지 않습니다.
데이터를 갱신할 때는 출처·수집일·원본 해시를 갱신하고, 기존 도시 ID와 동명 지역 구분을 유지하세요.
