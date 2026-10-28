"""d. 직사광(Fdirect) + 1차 산란광(Vwindow_simple) -> PPFD -> DLI (CLAUDE.md 9장 / 알고리즘 문서 4~9장).

창문 1개 + 직사각형 방: compute_light_result() (예전 방식, 그대로 유지)
창문 여러 개 + 다각형 방 + 벽 가림: compute_light_multi() (백엔드 연동용, grid_dli_service.compute_room_dli가 씀)
  - 직사광: 창문 중 하나라도 [그 창문 SKY에서 해 위치가 하늘 + Ray가 창문 통과 + 다른 벽에 안 막힘]이면 1
  - 산란광: 창문별 Vwindow(벽에 막힌 샘플 Ray 제외)를 합산
"""

import math
from dataclasses import dataclass

import pandas as pd

try:  # 패키지/평면 import 둘 다 지원 - __init__.py 참고
    from .a_grid import GridCell
    from .c_sky import lookup_sky
    from .models import Room, Window
    from .room_geometry import Wall, blocked_by_other_walls
except ImportError:
    from a_grid import GridCell
    from c_sky import lookup_sky
    from models import Room, Window
    from room_geometry import Wall, blocked_by_other_walls

K_PPFD = 2.04  # μmol/J. 순수 변환계수 4.73 x 태양광 중 PAR 비율 약 43~45%
DT_SEC = 600  # 10분 간격

Vec3 = tuple[float, float, float]


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def sun_direction(azimuth_deg: float, elevation_deg: float, x_axis_azimuth_deg: float) -> Vec3:
    """방위각·고도각(진북 기준) -> 방 좌표계 단위 방향 벡터 (격자 -> 태양 방향).

    진북 기준 방위각을 방의 X축 방위각(x_axis_azimuth_deg)만큼 빼서 "방 좌표계에서 X축으로부터
    잰 각도(rel)"로 바꾼 다음 구면좌표 공식을 적용. CLAUDE.md 3장 좌표계(X=가로, Y=높이, Z=안쪽) 기준이라
    Y성분이 sin(고도각)이 되고, X/Z성분은 수평면상 cos(고도각)을 rel로 다시 나눈 값.
    """
    rel = math.radians(azimuth_deg - x_axis_azimuth_deg)
    el = math.radians(elevation_deg)
    return (math.cos(rel) * math.cos(el), math.sin(el), math.sin(rel) * math.cos(el))


def ray_window_hit(p: Vec3, d: Vec3, window: Window) -> Vec3 | None:
    """R(u) = P + u*d 가 창문 사각형 내부를 통과하면 그 통과점 q, 아니면 None. u = ((C-P)*n) / (d*n).

    1) Ray와 창문이 놓인 평면의 교점(u)을 구함 (평면의 법선 n과 내적으로 거리 비율 계산)
    2) denom(d·n)이 0에 가까우면 Ray가 평면과 거의 평행 -> 교점 없음
    3) u<=0이면 교점이 격자 셀 뒤쪽(태양 반대 방향)에 있다는 뜻이라 통과 아님
    4) 교점 q를 창문의 가로(edge_u)/세로(edge_v) 축에 투영한 s, t가 둘 다 [0,1]이면
       사각형(창문) 내부를 실제로 지나간 것
    통과점 q는 벽 가림 검사(칸 -> q 선분이 다른 벽을 지나는지)에 쓴다.
    """
    edge_u = _sub(window.v1, window.v0)  # 가로
    edge_v = _sub(window.v3, window.v0)  # 세로
    n = _cross(edge_v, edge_u)  # 바깥 방향 법선 = (V3-V0) x (V1-V0)

    denom = _dot(d, n)
    if abs(denom) < 1e-9:
        return None

    u = _dot(_sub(window.v0, p), n) / denom
    if u <= 0:
        return None

    q = (p[0] + u * d[0], p[1] + u * d[1], p[2] + u * d[2])
    qv = _sub(q, window.v0)
    s = _dot(qv, edge_u) / _dot(edge_u, edge_u)
    t = _dot(qv, edge_v) / _dot(edge_v, edge_v)
    if 0.0 <= s <= 1.0 and 0.0 <= t <= 1.0:
        return q
    return None


def ray_window_intersect(p: Vec3, d: Vec3, window: Window) -> bool:
    """R(u) = P + u*d 가 창문 사각형 내부를 통과하면 True (판정 공식은 ray_window_hit 참고)."""
    return ray_window_hit(p, d, window) is not None


def vwindow_simple(
    cell: GridCell, window: Window, x_axis_azimuth_deg: float, az_step: int = 10, el_step: int = 10
) -> float:
    """1차 산란광 공간 계수: 상반구 샘플 Ray 중 창문을 통과한 비율 (고도 가중치 미적용).

    하늘 전체(산란광은 하늘 모든 방향에서 고르게 온다고 가정, 균일 확산 모델)를 az_step x el_step
    격자로 나눠서 각 칸의 중앙 방향으로 Ray를 쏴보고, 그중 몇 개가 창문을 통과하는지 비율로 계산.
    "이 셀에서 하늘을 올려다봤을 때 창문이 차지하는 비중"에 대한 근사치라고 보면 됨.
    """
    p = (cell.x, cell.y, cell.z)
    total = 0
    passed = 0
    for az in range(0, 360, az_step):
        for el in range(0, 90, el_step):
            d = sun_direction(az + az_step / 2, el + el_step / 2, x_axis_azimuth_deg)  # 각 칸의 중앙 방향
            total += 1
            if ray_window_intersect(p, d, window):
                passed += 1
    return passed / total if total else 0.0


def build_vwindow_cache(
    grid: list[list[GridCell]], window: Window, x_axis_azimuth_deg: float
) -> list[list[float]]:
    """방 구조/창문이 바뀌지 않는 한 1회 계산해서 재사용하는 격자별 Vwindow_simple."""
    return [
        [vwindow_simple(cell, window, x_axis_azimuth_deg) for cell in row]
        for row in grid
    ]


def compute_light_result(
    room_id: int,
    date: str,
    room: Room,
    window: Window,
    grid: list[list[GridCell]],
    solar_df: pd.DataFrame,
    resolved_sky: list[list[int]],
    vwindow_cache: list[list[float]],
    rows: int,
    cols: int,
) -> dict:
    direct_dli = [[0.0] * cols for _ in range(rows)]
    diffuse_dli = [[0.0] * cols for _ in range(rows)]

    for row in range(rows):
        for col in range(cols):
            cell = grid[row][col]
            p = (cell.x, cell.y, cell.z)
            vwin = vwindow_cache[row][col]
            acc_direct = 0.0
            acc_diffuse = 0.0

            for _, t in solar_df.iterrows():
                az, el = t["azimuth_deg"], t["elevation_deg"]
                dni, dhi = t["dni"], t["dhi"]

                # 이 시각에 태양이 있는 방향이 SKY(뚫려있음)인지 먼저 확인 -> NON-SKY면(건물 등에 가림)
                # 창문 Ray 검사할 필요도 없이 바로 직사광 0
                s_sky = lookup_sky(resolved_sky, az, el)
                if s_sky == 1:
                    d = sun_direction(az, el, room.x_axis_azimuth_deg)
                    fdirect = 1 if ray_window_intersect(p, d, window) else 0
                else:
                    fdirect = 0

                # DNI는 "태양 광선에 수직인 면" 기준 세기라서, 격자 셀이 놓인 수평면(y=0) 기준으로
                # 바꾸려면 sin(고도각)을 곱해야 함 (고도각이 낮을수록, 즉 해가 비스듬할수록 수평면에
                # 닿는 실질 에너지가 줄어듦 - 람베르트 코사인 법칙)
                i_direct = dni * math.sin(math.radians(el)) * fdirect
                # 산란광은 방향성이 없다고 가정 -> DHI에 "하늘 중 창문이 차지하는 비중(vwin)"만 곱함
                i_diffuse = dhi * vwin

                # W/m^2(=J/s/m^2) -> PPFD(μmol/s/m^2)로 K_PPFD를 곱하고, DT_SEC(600초)를 곱해서
                # 이 10분 구간 동안 쌓인 광량(μmol/m^2)을 누적
                acc_direct += i_direct * K_PPFD * DT_SEC
                acc_diffuse += i_diffuse * K_PPFD * DT_SEC

            # μmol/m^2 -> mol/m^2(DLI 단위)로 바꾸려고 1,000,000으로 나눔
            direct_dli[row][col] = round(acc_direct / 1_000_000, 2)
            diffuse_dli[row][col] = round(acc_diffuse / 1_000_000, 2)

    total_dli = [
        [round(direct_dli[r][c] + diffuse_dli[r][c], 2) for c in range(cols)]
        for r in range(rows)
    ]

    return {
        "room_id": room_id,
        "date": date,
        "grid": {
            "rows": rows,
            "cols": cols,
            "cell_w_m": round(room.width_m / cols, 3),
            "cell_d_m": round(room.depth_m / rows, 3),
        },
        "unit": "mol/m2/day",
        "direct_dli": direct_dli,
        "diffuse_dli": diffuse_dli,
        "total_dli": total_dli,
    }


# ---------------------------------------------------------------------------
# 창문 여러 개 + 다각형 방 + 벽 가림 (백엔드 연동용)
# ---------------------------------------------------------------------------


@dataclass
class WindowSource:
    """계산에 쓰는 창문 하나: 꼭짓점 + 붙어 있는 벽 번호 + 그 창문에서 찍은 SKY 지도(-1 처리 끝난 것)."""

    window: Window
    wall_index: int | None
    resolved_sky: list[list[int]]


def _passes_window(p: Vec3, d: Vec3, source: WindowSource, walls: list[Wall]) -> bool:
    """칸 p에서 방향 d로 쏜 Ray가 이 창문을 통과하고, 그 사이를 다른 벽이 막지 않으면 True."""
    q = ray_window_hit(p, d, source.window)
    if q is None:
        return False
    return not blocked_by_other_walls((p[0], p[2]), (q[0], q[2]), walls, source.wall_index)


def vwindow_with_walls(
    cell: GridCell,
    source: WindowSource,
    x_axis_azimuth_deg: float,
    walls: list[Wall],
    az_step: int = 10,
    el_step: int = 10,
) -> float:
    """vwindow_simple과 같은 샘플링(상반구 az_step x el_step)에 벽 가림만 추가한 창문 하나의 산란광 계수."""
    p = (cell.x, cell.y, cell.z)
    total = 0
    passed = 0
    for az in range(0, 360, az_step):
        for el in range(0, 90, el_step):
            d = sun_direction(az + az_step / 2, el + el_step / 2, x_axis_azimuth_deg)
            total += 1
            if _passes_window(p, d, source, walls):
                passed += 1
    return passed / total if total else 0.0


def compute_light_multi(
    cells: list[list[GridCell | None]],
    x_axis_azimuth_deg: float,
    sources: list[WindowSource],
    walls: list[Wall],
    solar_df: pd.DataFrame,
) -> tuple[list[list[float | None]], list[list[float | None]]]:
    """격자별 (direct_dli, diffuse_dli). cells[r][c]가 None(방 밖)인 칸은 결과도 None.

    직사광: 시점마다, 창문 중 하나라도 [SKY + 통과 + 벽에 안 막힘]이면 fdirect=1
            (창문 두 개를 동시에 통과하는 광선은 없으므로 "하나라도"로 충분, 중복 합산 방지)
    산란광: 창문별 Vwindow 합 x DHI. Vwindow는 시간과 무관하므로 칸마다 1번만 계산하고,
            DHI 쪽은 하루 합계(Σ DHI x K_PPFD x DT_SEC)를 미리 구해 곱한다.
    """
    # 시점별로 칸과 무관한 값(태양 방향, 창문별 SKY 여부, 수평면 직사광 세기)을 먼저 계산
    timesteps = []
    for _, t in solar_df.iterrows():
        az, el = t["azimuth_deg"], t["elevation_deg"]
        open_sources = [s for s in sources if lookup_sky(s.resolved_sky, az, el) == 1]
        direct_energy = t["dni"] * math.sin(math.radians(el)) * K_PPFD * DT_SEC  # μmol/m^2 (fdirect=1일 때)
        if open_sources and direct_energy > 0:
            timesteps.append((sun_direction(az, el, x_axis_azimuth_deg), open_sources, direct_energy))
    diffuse_energy_per_vwin = float((solar_df["dhi"] * K_PPFD * DT_SEC).sum())  # μmol/m^2 (vwin=1일 때)

    direct_dli: list[list[float | None]] = []
    diffuse_dli: list[list[float | None]] = []
    for row in cells:
        direct_row: list[float | None] = []
        diffuse_row: list[float | None] = []
        for cell in row:
            if cell is None:
                direct_row.append(None)
                diffuse_row.append(None)
                continue
            p = (cell.x, cell.y, cell.z)

            acc_direct = 0.0
            for d, open_sources, energy in timesteps:
                if any(_passes_window(p, d, s, walls) for s in open_sources):
                    acc_direct += energy

            vwin = sum(vwindow_with_walls(cell, s, x_axis_azimuth_deg, walls) for s in sources)
            vwin = min(vwin, 1.0)  # 안전장치 (정상이면 창문끼리 샘플 Ray가 겹치지 않아 1을 넘지 않음)
            acc_diffuse = diffuse_energy_per_vwin * vwin

            # μmol/m^2 -> mol/m^2(DLI)
            direct_row.append(round(acc_direct / 1_000_000, 2))
            diffuse_row.append(round(acc_diffuse / 1_000_000, 2))
        direct_dli.append(direct_row)
        diffuse_dli.append(diffuse_row)
    return direct_dli, diffuse_dli


def average_light_results(light_results: list[dict], label: str) -> dict:
    """여러 날짜의 light_result를 칸별로 평균낸 하나의 light_result로 합침 (알고리즘 PDF 9.4장).

    하루치 DLI는 그날 날씨에 따라 들쭉날쭉하므로, 실제 추천에는 여러 날짜(예: 계절 대표일들)의
    평균을 쓰는 게 더 안정적이라는 게 PDF 취지. room_id/grid는 첫 번째 결과 걸 그대로 쓰고, "date"
    자리에는 날짜 하나 대신 평균 대상(label, 예: "가을 평균(2025-09~11, 6일)")을 넣음.
    """
    rows = light_results[0]["grid"]["rows"]
    cols = light_results[0]["grid"]["cols"]
    n = len(light_results)

    def _avg(key: str) -> list[list[float]]:
        return [
            [round(sum(lr[key][r][c] for lr in light_results) / n, 2) for c in range(cols)]
            for r in range(rows)
        ]

    direct_dli = _avg("direct_dli")
    diffuse_dli = _avg("diffuse_dli")
    total_dli = [
        [round(direct_dli[r][c] + diffuse_dli[r][c], 2) for c in range(cols)] for r in range(rows)
    ]

    result = dict(light_results[0])
    result["date"] = label
    result["direct_dli"] = direct_dli
    result["diffuse_dli"] = diffuse_dli
    result["total_dli"] = total_dli
    return result
