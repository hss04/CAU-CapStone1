# 식물 카탈로그 107종 — v0.8.0

기존 6종을 유지하고 관엽·야자·고사리·다육·선인장·허브·개화·열매 식물 100종과 채소인 적상추를 추가했습니다. 국내 가정의 화분·원예 유통에서 접할 수 있는 대상을 선별한 목록이며 이용자 수에 따른 인기 순위나 관리 난이도 순위는 아닙니다.

## 적용 방법

기존 서버를 중지하고 `backend` 폴더에서 아래 명령을 실행합니다. DB 전체를 백업하고 빠진 식물 종류를 추가합니다.

```powershell
.\.venv\Scripts\python.exe scripts\migrate_v4.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

현재 DB가 v4 이상이면 업데이트 후 서버 재시작만으로도 새 카탈로그를 등록합니다. 별도 외부 API 키는 필요하지 않습니다. 실행 중 외부 사이트를 조회하지 않습니다.

- 기존 학명 또는 알려진 동의어가 있으면 해당 행을 재사용합니다. 기존 ID·표시 이름·운영자가 수정한 광량·출처는 덮어쓰지 않습니다.
- 기존 사용자 식물의 `species_id`, 물주기 설정, 사진과 일정은 유지합니다.
- 여러 번 실행해도 같은 종류를 다시 추가하지 않습니다. 옛 학명의 홍콩야자·아레카야자 등도 중복 등록하지 않습니다.
- 이름만 같은 별도 기존 행은 바꾸지 않고, 새 항목의 표시 이름에 학명을 사용합니다.
- 기본 카탈로그가 107종이며 기존에 직접 등록한 종류가 있으면 DB 전체 건수는 그보다 많을 수 있습니다. 기존 중복 행을 자동 병합하지 않습니다.

## 등록 정보와 검색

기존 `PlantSpecies` 형식인 `name`, `scientific_name`, `min_dli`, `max_dli`, `source_note`를 사용합니다. 주기적으로 물주는 날짜는 기존처럼 개별 `Plant`의 설정을 사용하며 종별 고정 일수를 새로 추정해서 입력하지 않습니다.

조회 API와 배열 응답 형식은 그대로입니다.

```http
GET /api/v1/plant-species?q=적상추
GET /api/v1/plant-species?q=Red%20leaf%20lettuce
GET /api/v1/plant-species?q=홍콩야자
GET /api/v1/plant-species?q=쉐플레라
GET /api/v1/plant-species?q=Schefflera%20arboricola
```

표시 이름·학명·한글/영문 별칭·옛 학명을 검색합니다. 별칭 검색은 공백·영문 대소문자 차이를 처리합니다. 예를 들어 `미니몬스테라`는 히메몬스테라, `Dypsis lutescens`는 아레카야자, `로즈메리`는 로즈마리 항목을 찾습니다. 기존 동의어 행이 있으면 해당 기존 ID를 반환합니다.

핑크프린세스·루비고무나무·트리오스타 등 품종 유통명은 해당 종의 검색 별칭으로 묶습니다. 품종을 별도 종으로 늘려 세거나 무늬별 DLI를 검증한 것으로 취급하지 않습니다. 스투키와 실린드리카는 서로 다른 종으로 구분합니다. 적상추는 `Lactuca sativa`의 붉은 잎 재배 그룹 표시명이며 별도 종을 뜻하지 않습니다. `붉은상추`, `적잎상추`, `Red leaf lettuce`, `Red lettuce`로도 검색할 수 있습니다.

기존 페이지 처리는 기본 50·최대 100개입니다. 107종 전체를 표시하려면 다음 페이지도 조회합니다.

```http
GET /api/v1/plant-species?limit=100&offset=0
GET /api/v1/plant-species?limit=100&offset=100
```

종류를 선택한 뒤 반환된 실제 `id`를 기존 `POST /plants`의 `species_id`에 사용합니다. 번호를 코드에 고정하지 않습니다.

## DLI 근거와 한계

단위는 `mol/m²/day`이며 **모든 값은 재배 시작용 참고 범위**입니다. 종별 실험으로 확정된 최적값·생존 한계·손상 임계값으로 제시하지 않습니다. 기존 6종의 범위와 출처 메모는 이전 값 그대로 유지합니다.

| 근거 코드 | 의미 |
| --- | --- |
| `REFERENCE_SPECIES` | 참고 자료의 해당 종 항목 적용. 종별 실험 검증을 의미하지 않음 |
| `REFERENCE_GENUS` | 참고 자료의 속 단위 값을 해당 종에 적용 |
| `REFERENCE_GROUP` | 일반명·과·재배 그룹 범위를 해당 종에 적용 |
| `ESTIMATED` | 광 환경 분류를 바탕으로 카탈로그에서 배정한 추정값 |

`source_note`에는 `PROVISIONAL` 또는 `ESTIMATED` 표시와 적용 항목·출처·확인일을 저장합니다. 기존 운영자 수정값은 보존하므로 서버 응답이 아래 기본값과 다를 수 있습니다.

- 기존 106종 수치 참고: [Photone Plant Light Database](https://growlightmeter.com/light-requirements-for-plants/).
- 추정 범주: [Iowa State University Extension의 실내 식물 DLI 분류](https://yardandgarden.extension.iastate.edu/how-to/growing-indoor-plants-under-supplemental-lights/important-considerations-providing-supplemental-light-indoor-plants). 이 대학 자료가 각 종의 수치를 측정했다고 주장하지 않습니다. 저광·중광·고광·매우 고광 범주를 해당 식물에 배정한 것은 카탈로그의 추론입니다.
- 정성적 광 환경 교차 확인: [University of Minnesota Extension](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/lighting-for-indoor-plants).
- 식물별 학명·동의어·재배 설명: NC State Plant Toolbox, Singapore NParks, RHS 및 Kew. 아래 표의 식물 출처 링크와 [확인 기록](plant-catalog-sources.json)을 참고합니다. 105건은 직접 HTTP 조회, 스투키 Kew 1건은 직접 접근 403에 따라 웹 검색으로 확인했습니다. 추가된 적상추 1건은 NC State 원문을 웹 열기로 확인했으며 조회 방식 차이도 기록했습니다.

Lux나 직사광 시간만으로 DLI를 임의 환산하지 않았습니다. 속·그룹 범위는 품종·계절·성장 단계·환경에 따라 달라질 수 있으므로 실측과 생장 기록으로 보정하는 기준 데이터입니다.

## 적상추 추가 (2026-11-03)

- 표시 이름: **적상추**, 학명: `Lactuca sativa`, 분류: 채소(`VEGETABLE`).
- 기본 DLI 참고 범위: **12~17 mol/m²/day**, 근거: `PROVISIONAL REFERENCE_GROUP`.
- [Cornell Hydroponic Lettuce Handbook](https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf)의 상추 재배 사례(공기 흐름 조건에 따른 12와 17)를 바탕으로 앱의 시작용 범위를 정했습니다. 이 간격을 적상추 전 품종의 최적값이나 손상 한계로 실험 검증한 것은 아닙니다.
- 실내 수확을 연구한 [Paz 외(2019)](https://doi.org/10.2134/urbanag2019.03.0001)는 `Red Salad Bowl` 적상추에 최소 6.5, 더 나은 생장·품질을 위해 9.7 mol/m²/day를 제시했습니다. 따라서 12 미만을 생존 불가로 해석하지 않습니다. 품종·재배 목적·환기와 생장 기록에 따라 운영자가 범위를 보정할 수 있습니다.
- 기존 106종의 ID·광량·출처와 사용자가 등록한 식물·사진·일정은 기존 추가 등록 처리로 보존합니다. 업데이트 후 서버를 재시작하면 빠진 적상추만 추가됩니다. 이미 `Lactuca sativa`로 등록한 행이 있으면 그 행과 수정값을 재사용합니다.
- 개별 식물 등록 시 조회 API가 반환한 실제 `id`를 사용합니다. 카탈로그 표의 107은 순번이며 고정 `species_id`가 아닙니다. 물주기 간격은 다른 식물과 같이 개별 설정을 사용합니다.

## 파일과 검증

- `app/catalogues/plant_species.json`: 별칭·동의어·광량 프로필·식물 출처를 포함한 기준 파일.
- `app/species_catalog.py`, `app/species_seed.py`: 검증·검색·기존 데이터를 보존하는 추가 등록 처리.
- [species-107.json](../examples/species-107.json): 적상추를 포함하는 최신 107종 내보내기. 이전 [species-106.json](../examples/species-106.json)은 기존 자료로 보존합니다. 운영자 import는 기존 값을 갱신하는 도구이므로, 기존 값을 보존해서 추가할 때는 위 서버 시작/마이그레이션 절차를 사용합니다.
- `examples/species-six.json`: 이전 버전의 최초 6종 자료를 보존한 파일.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

`tests/test_species_catalog.py`는 101종 추가·기존 6종 보존, 학명/동의어 중복 방지, 운영자 수정값·식물 외래키 보존, 별칭 검색, 페이지 처리, 새 식물 등록, 서버 재시작과 출처 확인 기록을 검증합니다.

## 전체 목록

아래 표는 기본 카탈로그 값이며, 실제 서버의 ID를 뜻하지 않습니다. 1~6번은 기존 항목입니다. `분류 추정`은 종별 수치가 확인되지 않은 항목입니다.

| 번호 | 이름 | 학명 | 분류 | DLI 참고 범위 | 근거 | 식물 출처 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 몬스테라 | Monstera deliciosa | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/monstera-deliciosa/) |
| 2 | 스킨답서스 | Epipremnum aureum | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/epipremnum-aureum/) |
| 3 | 올리브 | Olea europaea | 열매 | 18~40 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/olea-europaea/) |
| 4 | 산세베리아 | Dracaena trifasciata | 관엽 | 4~14 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/dracaena-trifasciata/) |
| 5 | 떡갈고무나무 | Ficus lyrata | 관엽 | 6~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/ficus-lyrata/) |
| 6 | 필레아 페페로미오이데스 | Pilea peperomioides | 관엽 | 6~12 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/pilea-peperomioides/) |
| 7 | 몬스테라 아단소니 | Monstera adansonii | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/monstera-adansonii/) |
| 8 | 히메몬스테라 | Rhaphidophora tetrasperma | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/rhaphidophora-tetrasperma/) |
| 9 | 실버 스킨답서스 | Scindapsus pictus | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/scindapsus-pictus/) |
| 10 | 드래곤테일 | Epipremnum pinnatum | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/epipremnum-pinnatum/) |
| 11 | 하트리프 필로덴드론 | Philodendron hederaceum | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/philodendron-hederaceum/) |
| 12 | 필로덴드론 에루베스켄스 | Philodendron erubescens | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/philodendron-erubescens/) |
| 13 | 스투키 | Dracaena stuckyi | 다육 | 4~14 | 그룹 범위 적용 | [확인](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A77183329-1) |
| 14 | 극락조화 | Strelitzia reginae | 관엽 | 12~16 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/strelitzia-reginae/) |
| 15 | 셀렘 | Thaumatophyllum bipinnatifidum | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/thaumatophyllum-bipinnatifidum/) |
| 16 | 제나두 | Thaumatophyllum xanadu | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/thaumatophyllum-xanadu/) |
| 17 | 인도고무나무 | Ficus elastica | 관엽 | 6~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/ficus-elastica/) |
| 18 | 벤자민고무나무 | Ficus benjamina | 관엽 | 6~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/ficus-benjamina/) |
| 19 | 인삼벤자민 | Ficus microcarpa | 관엽 | 6~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/ficus-microcarpa/) |
| 20 | 벵갈고무나무 | Ficus benghalensis | 관엽 | 6~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/ficus-benghalensis/) |
| 21 | 파키라 | Pachira aquatica | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/pachira-aquatica/) |
| 22 | 금전수 | Zamioculcas zamiifolia | 관엽 | 2~10 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/zamioculcas-zamiifolia/) |
| 23 | 행운목 | Dracaena fragrans | 관엽 | 3~8 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/dracaena-fragrans/) |
| 24 | 송오브인디아 | Dracaena reflexa | 관엽 | 3~8 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/dracaena-reflexa-var-reflexa/) |
| 25 | 개운죽 | Dracaena sanderiana | 관엽 | 3~8 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/dracaena-sanderiana/) |
| 26 | 산세베리아 실린드리카 | Dracaena angolensis | 다육 | 4~14 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/dracaena-angolensis/) |
| 27 | 코르딜리네 | Cordyline fruticosa | 관엽 | 12~16 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/cordyline-fruticosa/) |
| 28 | 덕구리난 | Beaucarnea recurvata | 관엽 | 12~16 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/beaucarnea-recurvata/) |
| 29 | 유카 | Yucca gigantea | 관엽 | 12~16 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/yucca-gigantea/) |
| 30 | 홍콩야자 | Heptapleurum arboricola | 관엽 | 7~30 | 속 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/2/4/2432) |
| 31 | 커피나무 | Coffea arabica | 열매 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/coffea-arabica/) |
| 32 | 테이블야자 | Chamaedorea elegans | 야자 | 3~6 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/chamaedorea-elegans/) |
| 33 | 아레카야자 | Chrysalidocarpus lutescens | 야자 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/dypsis-lutescens/) |
| 34 | 켄차야자 | Howea forsteriana | 야자 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/howea-forsteriana/) |
| 35 | 관음죽 | Rhapis excelsa | 야자 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/rhapis-excelsa/) |
| 36 | 아라우카리아 | Araucaria heterophylla | 침엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/araucaria-heterophylla/) |
| 37 | 스파티필름 | Spathiphyllum wallisii | 관엽 | 3~8 | 속 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/2/4/2465) |
| 38 | 안스리움 | Anthurium andraeanum | 개화 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/anthurium-andraeanum/) |
| 39 | 아글라오네마 | Aglaonema commutatum | 관엽 | 3~8 | 속 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/1/6/1611) |
| 40 | 디펜바키아 | Dieffenbachia seguine | 관엽 | 3~6 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/dieffenbachia-seguine/) |
| 41 | 싱고니움 | Syngonium podophyllum | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/syngonium-podophyllum/) |
| 42 | 알로카시아 | Alocasia macrorrhizos | 관엽 | 4~14 | 속 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/1/6/1636) |
| 43 | 알로카시아 제브리나 | Alocasia zebrina | 관엽 | 4~14 | 속 범위 적용 | [확인](https://www.rhs.org.uk/plants/136827/alocasia-zebrina/details) |
| 44 | 알로카시아 프라이덱 | Alocasia micholitziana | 관엽 | 4~14 | 속 범위 적용 | [확인](https://www.rhs.org.uk/plants/131678/alocasia-micholitziana/details) |
| 45 | 칼라데아 오르비폴리아 | Goeppertia orbifolia | 관엽 | 4~15 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/goeppertia-orbifolia/) |
| 46 | 칼라데아 마코야나 | Goeppertia makoyana | 관엽 | 4~15 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/goeppertia-makoyana/) |
| 47 | 칼라데아 란시폴리아 | Goeppertia insignis | 관엽 | 4~15 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/goeppertia-insignis/) |
| 48 | 칼라데아 로세오픽타 | Goeppertia roseopicta | 관엽 | 4~15 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/goeppertia-roseopicta/) |
| 49 | 마란타 | Maranta leuconeura | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/maranta-leuconeura/) |
| 50 | 크테난테 | Ctenanthe burle-marxii | 관엽 | 6~10 | 분류 추정 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/6/1/6101) |
| 51 | 스트로만테 트리오스타 | Stromanthe thalia | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/stromanthe-thalia/) |
| 52 | 청페페 | Peperomia obtusifolia | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/peperomia-obtusifolia/) |
| 53 | 수박페페 | Peperomia argyraea | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/peperomia-argyreia/) |
| 54 | 페페로미아 카페라타 | Peperomia caperata | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/peperomia-caperata/) |
| 55 | 페페로미아 프로스트라타 | Peperomia prostrata | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/peperomia-prostrata/) |
| 56 | 접란 | Chlorophytum comosum | 관엽 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/chlorophytum-comosum/) |
| 57 | 아이비 | Hedera helix | 관엽 | 4~8 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/hedera-helix/) |
| 58 | 팔손이 | Fatsia japonica | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/fatsia-japonica/) |
| 59 | 엽란 | Aspidistra elatior | 관엽 | 4~18 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/aspidistra-elatior/) |
| 60 | 달개비 제브리나 | Tradescantia zebrina | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/tradescantia-zebrina/) |
| 61 | 크로톤 | Codiaeum variegatum | 관엽 | 4~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/codiaeum-variegatum/) |
| 62 | 칼리시아 | Callisia repens | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/callisia-repens/) |
| 63 | 호야 | Hoya carnosa | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/hoya-carnosa/) |
| 64 | 하트호야 | Hoya kerrii | 관엽 | 4~12 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/hoya-kerrii/) |
| 65 | 디시디아 | Dischidia nummularia | 관엽 | 6~10 | 분류 추정 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/1/3/1385) |
| 66 | 아스파라거스 | Asparagus setaceus | 관엽 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/asparagus-setaceus/) |
| 67 | 보스턴고사리 | Nephrolepis exaltata | 고사리 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/nephrolepis-exaltata/) |
| 68 | 아스플레니움 | Asplenium nidus | 고사리 | 3~8 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/asplenium-nidus/) |
| 69 | 아디안텀 | Adiantum raddianum | 고사리 | 4~6 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/adiantum-raddianum/) |
| 70 | 박쥐란 | Platycerium bifurcatum | 고사리 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/platycerium-bifurcatum/) |
| 71 | 틸란드시아 이오난사 | Tillandsia ionantha | 브로멜리아 | 4~14 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/tillandsia-ionantha/) |
| 72 | 구즈마니아 | Guzmania lingulata | 브로멜리아 | 4~14 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/guzmania-lingulata/) |
| 73 | 에크메아 | Aechmea fasciata | 브로멜리아 | 4~14 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/aechmea-fasciata/) |
| 74 | 레몬나무 | Citrus × limon | 열매 | 21~28 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/citrus-x-limon/) |
| 75 | 알로에베라 | Aloe vera | 다육 | 4~14 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/aloe-vera/) |
| 76 | 십이지권 | Haworthiopsis attenuata | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/haworthiopsis-attenuata/) |
| 77 | 하월시아 쿠페리 | Haworthia cooperi | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/4/2/4248) |
| 78 | 에케베리아 엘레강스 | Echeveria elegans | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/echeveria-elegans/) |
| 79 | 에케베리아 아가보이데스 | Echeveria agavoides | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/7/4/7411) |
| 80 | 염좌 | Crassula ovata | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/crassula-ovata/) |
| 81 | 십자성 | Crassula perforata | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/crassula-perforata/) |
| 82 | 칼랑코에 | Kalanchoe blossfeldiana | 개화 | 8~16 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/kalanchoe-blossfeldiana/) |
| 83 | 월토이 | Kalanchoe tomentosa | 다육 | 8~16 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/kalanchoe-tomentosa/) |
| 84 | 청옥 | Sedum morganianum | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/sedum-morganianum/) |
| 85 | 홍옥 | Sedum × rubrotinctum | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/2/4/2447) |
| 86 | 용월 | Graptopetalum paraguayense | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/graptopetalum-paraguayense/) |
| 87 | 아악무 | Portulacaria afra | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/2/3/2361) |
| 88 | 녹영 | Curio rowleyanus | 다육 | 8~16 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/curio-rowleyanus/) |
| 89 | 게발선인장 | Schlumbergera truncata | 선인장 | 6~10 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/schlumbergera-truncata/) |
| 90 | 백도선 | Opuntia microdasys | 선인장 | 12~30 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/opuntia-microdasys/) |
| 91 | 율마 | Hesperocyparis macrocarpa | 침엽 | 18~30 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/hesperocyparis-macrocarpa/) |
| 92 | 금호선인장 | Kroenleinia grusonii | 선인장 | 12~30 | 그룹 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/1/9/1981) |
| 93 | 호접란 | Phalaenopsis amabilis | 개화 | 4~6 | 그룹 범위 적용 | [확인](https://www.nparks.gov.sg/florafaunaweb/flora/5/8/5881) |
| 94 | 아프리칸바이올렛 | Streptocarpus ionanthus | 개화 | 4~14 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/streptocarpus-ionanthus/) |
| 95 | 렉스베고니아 | Begonia rex | 개화 | 6~10 | 분류 추정 | [확인](https://www.rhs.org.uk/plants/101666/begonia-rex-r/details) |
| 96 | 시클라멘 | Cyclamen persicum | 개화 | 6~8 | 그룹 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/cyclamen-persicum/) |
| 97 | 제라늄 | Pelargonium zonale | 개화 | 12~16 | 분류 추정 | [확인](https://www.rhs.org.uk/plants/12407/pelargonium-zonale/details) |
| 98 | 치자나무 | Gardenia jasminoides | 개화 | 12~16 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/gardenia-jasminoides/) |
| 99 | 바질 | Ocimum basilicum | 허브 | 12~26 | 종 항목 적용 | [확인](https://plants.ces.ncsu.edu/plants/ocimum-basilicum/) |
| 100 | 로즈마리 | Salvia rosmarinus | 허브 | 20~28 | 종 항목 적용 | [확인](https://plants.ces.ncsu.edu/plants/salvia-rosmarinus/) |
| 101 | 라벤더 | Lavandula angustifolia | 허브 | 18~30 | 분류 추정 | [확인](https://plants.ces.ncsu.edu/plants/lavandula-angustifolia/) |
| 102 | 스피어민트 | Mentha spicata | 허브 | 10~20 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/mentha-spicata/) |
| 103 | 페퍼민트 | Mentha × piperita | 허브 | 10~20 | 속 범위 적용 | [확인](https://plants.ces.ncsu.edu/plants/mentha-x-piperita/) |
| 104 | 타임 | Thymus vulgaris | 허브 | 20~28 | 종 항목 적용 | [확인](https://plants.ces.ncsu.edu/plants/thymus-vulgaris/) |
| 105 | 오레가노 | Origanum vulgare | 허브 | 20~28 | 종 항목 적용 | [확인](https://plants.ces.ncsu.edu/plants/origanum-vulgare/) |
| 106 | 파슬리 | Petroselinum crispum | 허브 | 10~20 | 종 항목 적용 | [확인](https://plants.ces.ncsu.edu/plants/petroselinum-crispum/) |
| 107 | 적상추 | Lactuca sativa | 채소 | 12~17 | 상추 그룹 참고 범위 | [확인](https://plants.ces.ncsu.edu/plants/lactuca-sativa/) |
