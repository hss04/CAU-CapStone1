"""e. 진단: 식물 요구 DLI와 비교해 적정(OK)/부족(LOW)/과다(HIGH) 판정 (CLAUDE.md 10장)."""

from dataclasses import dataclass

try:  # 패키지/평면 import 둘 다 지원 - __init__.py 참고
    from .models import Plant
except ImportError:
    from models import Plant


@dataclass
class Diagnosis:
    plant_id: int
    row: int
    col: int
    total_dli: float
    status: str  # OK / LOW / HIGH


def diagnose(plant: Plant, light_result: dict) -> Diagnosis:
    total_dli = light_result["total_dli"][plant.row][plant.col]
    min_dli = plant.species.min_dli
    max_dli = plant.species.max_dli

    if total_dli < min_dli:
        status = "LOW"
    elif total_dli > max_dli:
        status = "HIGH"
    else:
        status = "OK"

    return Diagnosis(
        plant_id=plant.plant_id,
        row=plant.row,
        col=plant.col,
        total_dli=total_dli,
        status=status,
    )


def diagnose_all(plants: list[Plant], light_result: dict) -> list[Diagnosis]:
    return [diagnose(p, light_result) for p in plants]
