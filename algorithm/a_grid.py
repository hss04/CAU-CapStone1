"""a. 방 좌표로 실내 2D 격자 생성 (식물 높이는 고려하지 않음, y=0)."""

import math
from dataclasses import dataclass

from models import Room

DEFAULT_CELL_SIZE_M = 0.2  # 20cm


@dataclass
class GridCell:
    row: int
    col: int
    x: float
    y: float
    z: float


def generate_grid(room: Room, rows: int = 20, cols: int = 20) -> list[list[GridCell]]:
    """인덱스는 [row][col]. col은 X 방향, row는 Z 방향. 셀 중심 좌표 사용.

    칸 "개수"를 고정(기본 20x20)하는 방식이라, 칸 크기(cell_w/cell_d)는 방마다 달라짐.
    칸 "크기"를 고정하고 싶으면 generate_grid_fixed_size()를 쓸 것.
    """
    cell_w = room.width_m / cols
    cell_d = room.depth_m / rows
    grid: list[list[GridCell]] = []
    for row in range(rows):
        z = (row + 0.5) * cell_d  # +0.5: 칸 경계가 아니라 칸 "중앙" 좌표를 쓰기 위함 (CLAUDE.md 5장)
        grid_row = []
        for col in range(cols):
            x = (col + 0.5) * cell_w
            grid_row.append(GridCell(row=row, col=col, x=x, y=0.0, z=z))
        grid.append(grid_row)
    return grid


def generate_grid_fixed_size(
    room: Room, cell_size_m: float = DEFAULT_CELL_SIZE_M
) -> tuple[list[list[GridCell]], int, int]:
    """칸 "크기"를 고정(기본 20cm x 20cm)하고, 칸 개수(rows, cols)는 방 크기에 맞춰 올림 계산.

    방 크기가 cell_size_m의 배수가 아니면 벽 쪽 마지막 칸 중심이 벽 경계에 걸칠 수 있음(올림 처리의
    자연스러운 트레이드오프). generate_grid()와 달리 rows/cols를 호출부가 몰라도 되게 같이 반환함.
    """
    cols = math.ceil(room.width_m / cell_size_m)
    rows = math.ceil(room.depth_m / cell_size_m)
    grid: list[list[GridCell]] = []
    for row in range(rows):
        z = (row + 0.5) * cell_size_m
        grid_row = []
        for col in range(cols):
            x = (col + 0.5) * cell_size_m
            grid_row.append(GridCell(row=row, col=col, x=x, y=0.0, z=z))
        grid.append(grid_row)
    return grid, rows, cols
