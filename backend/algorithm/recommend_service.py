"""진단(e) + 추천(f)을 백엔드 입력 형식에 맞춰 부르는 래퍼.

백엔드 연결점: RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room

판정·점수·배치 규칙 자체는 e_diagnosis.py / f_recommendation.py 그대로다.
- 판정: total_dli < min_dli -> LOW, > max_dli -> HIGH, 그 사이 OK (CLAUDE.md 10장)
- score: 요구 범위 중앙값이면 1.0, 범위 끝(min 또는 max)이면 0.5, 범위 절반만큼 더 벗어나면 0.0
         = max(0, 1 - |DLI - 중앙값| / (범위/2))  (f_recommendation.score)
- 배치: OK가 아닌 식물 전체를 한 번에 배정(헝가리안), sqrt(score) 합 최대 -> 자리 중복 없음
- 후보 제외: 방 밖 칸, blocked_cells(가구 등), 다른 식물이 이미 있는 칸

이 래퍼가 하는 일은 형식 변환뿐이다:
- 식물 위치: 백엔드는 실좌표(x, y, z) -> 칸 번호 row=floor((z-origin.z)/cell), col=floor((x-origin.x)/cell)
  (백엔드 FRONTEND_V4.md ⑦과 같은 규칙, 바깥쪽 방 경계는 마지막 칸으로)
- 위치가 없거나(미배치) 방 밖 칸이면 current=None으로 두고 추천 자리만 찾아준다.
"""

import math

try:  # 패키지/평면 import 둘 다 지원 - __init__.py 참고
    from .e_diagnosis import Diagnosis, diagnose
    from .f_recommendation import recommend_all
    from .models import Plant, PlantSpecies
except ImportError:
    from e_diagnosis import Diagnosis, diagnose
    from f_recommendation import recommend_all
    from models import Plant, PlantSpecies

STATUS_UNPLACED = "UNPLACED"  # 내부 표시용. 출력에는 current=None으로 나감


def position_to_cell(position: dict | None, grid: dict) -> tuple[int, int] | None:
    """실좌표 {x, y, z} -> (row, col). 위치가 없거나 격자 범위 밖이면 None."""
    if not position or position.get("x") is None or position.get("z") is None:
        return None
    size = float(grid["cell_size_m"])
    rows, cols = int(grid["rows"]), int(grid["cols"])
    col = math.floor((float(position["x"]) - float(grid["origin"]["x"])) / size)
    row = math.floor((float(position["z"]) - float(grid["origin"]["z"])) / size)
    # 방 바깥쪽 경계(x = origin + cols*size)에 딱 놓인 경우는 마지막 칸으로
    if col == cols:
        col = cols - 1
    if row == rows:
        row = rows - 1
    if not (0 <= row < rows and 0 <= col < cols):
        return None
    return row, col


def recommend_for_room(payload: dict) -> dict:
    """백엔드 RECOMMENDATION_CALLABLE 진입점.

    입력:
      room_id
      dli_map: 완료된 DLI 결과(dli_map_v2) {grid{origin, cell_size_m, rows, cols, inside_mask},
               total_dli [row_z][col_x] (방 밖 None), date, period?, ...}
      plants: [{plant_id, species_id, position: {x, y, z} 또는 None, min_dli, max_dli}]
      blocked_cells: [{row, col}]  가구 등 식물을 놓을 수 없는 칸
    출력 (CLAUDE.md 10장 Recommendation 형식):
      {room_id, date, period,
       plants: [{plant_id, species_id, required_dli{min,max},
                 current: {row, col, total_dli, status(OK/LOW/HIGH)} 또는 None(미배치/방 밖),
                 recommended: {row, col, total_dli, score} 또는 None(현재 OK면 유지)}],
       warnings: [...]}
    """
    dli_map = payload["dli_map"]
    grid = dli_map["grid"]
    total = dli_map["total_dli"]
    rows, cols = int(grid["rows"]), int(grid["cols"])
    mask = grid["inside_mask"]
    warnings: list[str] = []

    # 방 밖이거나 값이 없는 칸은 후보에서 빼야 하므로 blocked에 합친다
    blocked = {(int(b["row"]), int(b["col"])) for b in payload.get("blocked_cells") or []}
    unusable = {(r, c) for r in range(rows) for c in range(cols) if not mask[r][c] or total[r][c] is None}

    plants: list[Plant] = []
    diagnoses: list[Diagnosis] = []
    for p in payload.get("plants") or []:
        species = PlantSpecies(
            species_id=p["species_id"],
            name_ko="",
            name_en="",
            scientific_name="",
            min_dli=float(p["min_dli"]),
            max_dli=float(p["max_dli"]),
        )
        cell = position_to_cell(p.get("position"), grid)
        if cell is not None and cell in unusable:
            warnings.append(f"plant {p['plant_id']}: position is outside the room grid; treated as unplaced")
            cell = None
        if cell is not None and cell in blocked:
            warnings.append(f"plant {p['plant_id']}: current cell is in blocked_cells")

        plant = Plant(plant_id=p["plant_id"], species=species, row=None, col=None)
        if cell is None:
            diagnoses.append(Diagnosis(p["plant_id"], None, None, None, STATUS_UNPLACED))
        else:
            plant.row, plant.col = cell
            diagnoses.append(diagnose(plant, dli_map))
        plants.append(plant)

    results = recommend_all(plants, diagnoses, dli_map, blocked_cells=sorted(blocked | unusable))

    for entry in results:
        if entry["current"]["status"] == STATUS_UNPLACED:
            entry["current"] = None
        if entry["recommended"] is None and entry["current"] is None:
            warnings.append(f"plant {entry['plant_id']}: no free cell available for recommendation")

    return {
        "room_id": payload.get("room_id"),
        "date": dli_map.get("date"),
        "period": dli_map.get("period"),
        "plants": results,
        "warnings": warnings,
    }
