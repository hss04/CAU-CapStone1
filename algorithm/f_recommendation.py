"""f. 추천: 점수 기반 최적 위치 추천, 식물 여러 개일 때 위치 중복 금지 (CLAUDE.md 10장).

score 계산식 (CLAUDE.md 10장 [결정 필요] 항목, 2026-10-28 수정):
- 범위 안: 0.5 ~ 1.0. 요구 범위 중앙값이면 1.0, 경계(min/max)면 0.5
- 모자람(DLI < min): 0.5 x DLI / min   (필요량의 절반이면 0.25, DLI 0일 때만 0)
- 넘침(DLI > max): 0.5 x max / DLI     (필요량의 2배면 0.25)
범위 안은 항상 범위 밖보다 높고, 범위 밖도 가까울수록 높다. 그래서 방 전체가 범위에 못 미쳐도
"가장 덜 나쁜 자리"가 고정적으로 골라진다(예전 식은 경계와 범위 밖이 전부 0점이라 아무 칸이나 골랐음).
밖에서 비율을 쓰는 이유: DLI 차이는 "2배 많다/절반이다"처럼 비율로 의미가 있어서.
추후 바뀌면 _raw_score()만 교체하면 된다.

배치 자체는 "식물마다 그때그때 제일 좋은 빈 칸을 집는" 방식이 아니라, 추천이 필요한 식물 전체를
헝가리안 알고리즘(scipy linear_sum_assignment)으로 한 번에 배정한다. 이때 점수를 그대로 더하지 않고
sqrt(score)의 합을 최대화하는데, sqrt는 오목(concave) 함수라 "식물 하나가 아주 낮은 점수를 받는 대신
나머지가 조금씩 더 좋아지는" 배치보다 "다 같이 적당히 괜찮은" 배치를 선호하게 만들기 위함이다.
"""

import itertools
import math

import numpy as np
from scipy.optimize import linear_sum_assignment

try:  # 패키지/평면 import 둘 다 지원 - __init__.py 참고
    from .e_diagnosis import Diagnosis
    from .models import Plant
except ImportError:
    from e_diagnosis import Diagnosis
    from models import Plant

TOP_K_CANDIDATES_PER_PLANT = 8  # 식물별 상위 몇 칸까지 조합 탐색에 넣을지 (너무 크면 조합 수 폭증)


def _raw_score(total_dli: float, min_dli: float, max_dli: float) -> float:
    """반올림 전 점수 (0~1). 배정·정렬에는 이 값을 써서 작은 차이도 구분한다. 식은 모듈 docstring 참고."""
    if total_dli < min_dli:
        return 0.5 * max(total_dli, 0.0) / min_dli  # min_dli > 0 (total < min이므로)
    if total_dli > max_dli:
        return 0.5 * max_dli / total_dli  # total_dli > 0
    half_range = (max_dli - min_dli) / 2
    if half_range <= 0:  # min==max인 종: 정확히 그 값
        return 1.0
    mid = (min_dli + max_dli) / 2
    return 1.0 - 0.5 * abs(total_dli - mid) / half_range


def score(total_dli: float, min_dli: float, max_dli: float) -> float:
    """출력용 점수 (소수 2자리). 범위 안 0.5~1.0, 범위 밖 0.5 미만."""
    return round(_raw_score(total_dli, min_dli, max_dli), 2)


def in_range(total_dli: float, min_dli: float, max_dli: float) -> bool:
    return min_dli <= total_dli <= max_dli


def _assign_best_cells(
    needy_plants: list[Plant], candidates: list[tuple[int, int]], total_dli_grid: list[list[float]]
) -> dict[int, tuple[int, int]]:
    """추천이 필요한 식물 전체 vs 빈 칸 전체를 헝가리안 알고리즘으로 한 번에 배정.

    sqrt(score) 합을 최대화 -> linear_sum_assignment는 최소화만 하므로 비용은 -sqrt(score)로 둠.
    식물이 빈 칸보다 많으면(흔치 않은 경우) 일부는 배정 못 받을 수 있음(해당 식물은 추천 없음으로 처리).
    """
    if not needy_plants or not candidates:
        return {}

    cost = np.empty((len(needy_plants), len(candidates)))
    for i, plant in enumerate(needy_plants):
        for j, (r, c) in enumerate(candidates):
            s = _raw_score(total_dli_grid[r][c], plant.species.min_dli, plant.species.max_dli)
            cost[i, j] = -math.sqrt(s)

    row_idx, col_idx = linear_sum_assignment(cost)
    return {needy_plants[i].plant_id: candidates[j] for i, j in zip(row_idx, col_idx)}


def recommend_top_k_combinations(
    plants: list[Plant],
    diagnoses: list[Diagnosis],
    light_result: dict,
    k: int = 3,
    blocked_cells: list[tuple[int, int]] | None = None,
) -> list[dict]:
    """"식물1은 A자리, 식물2는 B자리" 처럼 전체 배치 세트를 여러 개(최대 k개) 점수순으로 보여줌.

    recommend_all()은 CLAUDE.md 10장 규격대로 식물마다 칸 하나씩만 돌려주는데, 이 함수는 그거랑 별개로
    "완전히 다른 전체 조합"을 여러 개 비교해서 사용자가 고를 수 있게 하는 용도. 식물별로 개별 점수가
    높은 상위 TOP_K_CANDIDATES_PER_PLANT칸만 후보로 추려서 전수 조합을 따져보고(식물 수가 적어서
    이렇게 해도 충분히 빠름), 칸이 겹치는 조합은 제외한 뒤 sqrt(score) 합이 높은 순으로 최대 k개 반환.

    blocked_cells: 가구 등으로 식물을 놓을 수 없는 칸 (프론트가 보내줌, CLAUDE.md 10장).
    """
    rows = light_result["grid"]["rows"]
    cols = light_result["grid"]["cols"]
    total_dli_grid = light_result["total_dli"]
    diag_by_id = {d.plant_id: d for d in diagnoses}

    occupied = {(p.row, p.col) for p in plants} | set(blocked_cells or [])
    candidates = [(r, c) for r in range(rows) for c in range(cols) if (r, c) not in occupied]
    needy_plants = [p for p in plants if diag_by_id[p.plant_id].status != "OK"]

    if not needy_plants or not candidates:
        return []

    # 식물별로 개별 점수 상위 N칸만 후보로 추려서 조합 탐색 범위를 줄임
    per_plant_candidates = []
    for plant in needy_plants:
        scored = [
            (_raw_score(total_dli_grid[r][c], plant.species.min_dli, plant.species.max_dli), (r, c))
            for (r, c) in candidates
        ]
        scored.sort(key=lambda x: -x[0])
        per_plant_candidates.append(scored[:TOP_K_CANDIDATES_PER_PLANT])

    combos = []
    for combo in itertools.product(*per_plant_candidates):
        cells = [cell for _, cell in combo]
        if len(set(cells)) != len(cells):  # 같은 조합 안에서 칸이 겹치면 무효
            continue
        total_score = round(sum(math.sqrt(s) for s, _ in combo), 2)
        combos.append((total_score, combo))

    combos.sort(key=lambda x: -x[0])

    results = []
    for total_score, combo in combos[:k]:
        placements = []
        for plant, (s, (r, c)) in zip(needy_plants, combo):
            placements.append(
                {
                    "plant_id": plant.plant_id,
                    "row": r,
                    "col": c,
                    "total_dli": total_dli_grid[r][c],
                    "score": round(s, 2),
                }
            )
        results.append({"total_score": total_score, "placements": placements})

    return results


def recommend_all(
    plants: list[Plant],
    diagnoses: list[Diagnosis],
    light_result: dict,
    blocked_cells: list[tuple[int, int]] | None = None,
) -> list[dict]:
    """blocked_cells: 가구 등으로 식물을 놓을 수 없는 칸 (프론트가 보내줌, CLAUDE.md 10장)."""
    rows = light_result["grid"]["rows"]
    cols = light_result["grid"]["cols"]
    total_dli_grid = light_result["total_dli"]
    diag_by_id = {d.plant_id: d for d in diagnoses}

    # 다른 식물이 이미 차지한 칸(현재 자리 포함) + 가구 등 불가 칸은 추천 후보에서 제외
    occupied = {(p.row, p.col) for p in plants} | set(blocked_cells or [])
    candidates = [(r, c) for r in range(rows) for c in range(cols) if (r, c) not in occupied]

    # 이미 적정(OK)이면 추천 안 함 (현재 자리 유지, CLAUDE.md 10장)
    needy_plants = [p for p in plants if diag_by_id[p.plant_id].status != "OK"]
    assignment = _assign_best_cells(needy_plants, candidates, total_dli_grid)

    results = []
    for plant in plants:
        diag = diag_by_id[plant.plant_id]
        entry = {
            "plant_id": plant.plant_id,
            "species_id": plant.species.species_id,
            "required_dli": {"min": plant.species.min_dli, "max": plant.species.max_dli},
            "current": {
                "row": plant.row,
                "col": plant.col,
                "total_dli": diag.total_dli,
                "status": diag.status,
            },
            "recommended": None,
        }

        if plant.plant_id in assignment:
            r, c = assignment[plant.plant_id]
            entry["recommended"] = {
                "row": r,
                "col": c,
                "total_dli": total_dli_grid[r][c],
                "score": score(total_dli_grid[r][c], plant.species.min_dli, plant.species.max_dli),
            }

        results.append(entry)

    return results
