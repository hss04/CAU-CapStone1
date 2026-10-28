"""d_light.py를 "가상의 센서/스캔 정보" 20종으로 기하->irradiance->DLI 전체 파이프라인 검증.

실제 PPFD 미터/조도계 측정은 아직 없어서(추후 진행), 코드(교차곱 기반 ray_window_intersect)와는 완전히
다른 방식으로 다시 유도한 "평면-레이 교차 공식"을 reference_hit()에 따로 구현해 손 계산 정답을 만들고,
그걸 d_light.py 실제 계산 결과와 비교한다. DNI/DHI 20종도 실측값이 아니라 "이 정도면 흐린/맑은 날이겠다"
수준의 가상값이며(CLAUDE.md 6.1절: 실제로는 프론트가 외부 API에서 받아 보내주는 값), 목적은 수치 자체의
현실성이 아니라 "입력이 이렇게 주어졌을 때 d_light.py가 공식대로 정확히 계산하는지"만 확인하는 것이다.

사용법: python verify_d_light_virtual_cases.py
"""

import math

import pandas as pd

from a_grid import GridCell
from c_sky import AZ_STEPS, EL_STEPS
from d_light import DT_SEC, K_PPFD, build_vwindow_cache, compute_light_result, ray_window_intersect, sun_direction
from models import build_mock_room, build_mock_window

PASS = "OK"
FAIL = "!! FAIL !!"
DLI_TOL = 0.02  # DLI는 소수점 2자리로 반올림되므로 이 정도 오차는 허용


def check(label: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {label}" + (f" ({detail})" if detail else ""))


def close(a: float, b: float, tol: float = DLI_TOL) -> bool:
    return abs(a - b) <= tol


# ---------------------------------------------------------------------------
# 독립적으로 다시 유도한 "손 계산" 레이-창문 교차 판정
#
# 이 Mock 방(room.x_axis_azimuth_deg=0, 창문이 z=5 벽에 x:[1,3], y:[1,2.2] 범위로 서 있음) 전용으로,
# 태양 방향을 따라가다 z=WINDOW_Z 평면에 닿는 지점의 (x, y)를 직접 풀어서 창문 범위 안인지 비교한다.
# ray_window_intersect()의 교차곱/내적(평면 법선 n, u=((C-P)*n)/(d*n)) 공식과는 다른 유도 경로로
# 같은 결론에 도달하는지 보는 용도 -> 같은 코드를 두 번 부르는 "자기 확인"이 아니라 독립 검증.
# ---------------------------------------------------------------------------
WINDOW_Z = 5.0
WINDOW_X_RANGE = (1.0, 3.0)
WINDOW_Y_RANGE = (1.0, 2.2)


def reference_hit(p: tuple[float, float, float], azimuth_deg: float, elevation_deg: float) -> bool:
    rel = math.radians(azimuth_deg)  # room.x_axis_azimuth_deg가 0이라 rel=azimuth 그대로
    el = math.radians(elevation_deg)
    dx, dy, dz = math.cos(rel) * math.cos(el), math.sin(el), math.sin(rel) * math.cos(el)
    if abs(dz) < 1e-9:
        return False  # 창문이 서 있는 평면(z=const)과 거의 평행 -> 영영 안 닿음
    u = (WINDOW_Z - p[2]) / dz
    if u <= 0:
        return False  # 교점이 태양 반대 방향(창문이 등 뒤) -> 통과 아님
    qx, qy = p[0] + u * dx, p[1] + u * dy
    return WINDOW_X_RANGE[0] <= qx <= WINDOW_X_RANGE[1] and WINDOW_Y_RANGE[0] <= qy <= WINDOW_Y_RANGE[1]


# ---------------------------------------------------------------------------
# 가상 정보 20종: (라벨, 방위각, 고도각, DNI, DHI, 그 방향이 SKY(1)/NON-SKY(0)인지)
# ---------------------------------------------------------------------------
CASES = [
    # DHI는 테스트 지점의 Vwindow_simple(~0.025)을 곱해도 diffuse_dli가 반올림으로 사라지지 않게
    # 다 200 이상으로 둔다 (160 미만이면 diffuse_dli가 0.00으로 찍혀서 그 공식 경로가 검증이 안 됨).
    ("정면(90)/하단 범위 밖(너무 낮음)", 90.0, 10.0, 700.0, 300.0, 1),
    ("정면(90)/하단 경계 바로 아래(미스)", 90.0, 21.7, 700.0, 300.0, 1),
    ("정면(90)/하단 경계 바로 위(히트)", 90.0, 21.9, 700.0, 300.0, 1),
    ("정면(90)/창문 중앙(히트)", 90.0, 30.0, 700.0, 300.0, 1),
    ("정면(90)/상단 경계 바로 아래(히트)", 90.0, 41.3, 700.0, 300.0, 1),
    ("정면(90)/상단 경계 바로 위(미스)", 90.0, 41.4, 700.0, 300.0, 1),
    ("정면(90)/고도 과도(거의 천정, 미스)", 90.0, 85.0, 700.0, 300.0, 1),
    ("정면(90)/고도 거의 0(수평선 근처, 미스)", 90.0, 0.5, 700.0, 300.0, 1),
    ("동남(75)/x범위 안쪽으로 치우침(히트)", 75.0, 30.0, 600.0, 350.0, 1),
    ("동북(105)/75도와 대칭(히트)", 105.0, 30.0, 600.0, 350.0, 1),
    ("60도/x범위 밖(미스)", 60.0, 30.0, 600.0, 350.0, 1),
    ("120도/x범위 밖(미스, 60도와 대칭)", 120.0, 30.0, 600.0, 350.0, 1),
    ("45도/훨씬 밖(미스)", 45.0, 30.0, 500.0, 400.0, 1),
    ("135도/훨씬 밖(미스, 대칭)", 135.0, 30.0, 500.0, 400.0, 1),
    ("10도/거의 진북, 완전히 밖(미스)", 10.0, 30.0, 500.0, 400.0, 1),
    ("200도/창문 반대쪽(u<=0, 미스)", 200.0, 30.0, 500.0, 400.0, 1),
    ("270도(정서)/반대쪽(u<=0, 미스)", 270.0, 45.0, 400.0, 450.0, 1),
    ("0도(정북)/창문 평면과 평행(미스)", 0.0, 45.0, 400.0, 450.0, 1),
    ("정면(90)/기하는 히트지만 NON-SKY로 가려짐", 90.0, 30.0, 700.0, 300.0, 0),
    ("정면(90)/DNI·DHI 모두 0(흐림 극단)", 90.0, 30.0, 0.0, 0.0, 1),
]


def test_geometry_against_independent_formula() -> None:
    """20종 각각에서 sun_direction+ray_window_intersect 결과가 독립 공식(reference_hit)과 일치하는지."""
    print("[1] 기하 판정: d_light.py vs 독립적으로 다시 유도한 손 계산 공식 (20종)")
    room = build_mock_room()
    window = build_mock_window()
    p = (2.0, 0.0, 2.5)  # 방 중앙 바닥 칸, 창문 x범위 한가운데 -> 기존 verify_d_light.py와 같은 기준점

    for label, az, el, _dni, _dhi, _sky in CASES:
        d = sun_direction(az, el, room.x_axis_azimuth_deg)
        code_hit = ray_window_intersect(p, d, window)
        expected_hit = reference_hit(p, az, el)
        check(f"az={az}, el={el}: {label}", code_hit == expected_hit, f"코드={code_hit}, 손계산={expected_hit}")


def test_full_pipeline_virtual_cases() -> None:
    """20종 각각을 '시점 1개짜리 solar_df'로 compute_light_result에 넣어 DLI 수치까지 손 계산과 대조.

    diffuse(Vwindow_simple) 쪽 공간계수는 d_light.py가 직접 계산한 값을 "주어진 값"으로 그대로 쓰고
    (그 자체는 verify_d_light.py에서 창가>구석 등 별도로 검증됨), 이 테스트는 그 값으로부터
    W/m^2 -> PPFD -> DLI로 가는 단위 변환·SKY 마스킹·fdirect 로직이 공식대로 맞는지에 집중한다.
    """
    print("\n[2] 전체 파이프라인: 가상 정보 20종 각각의 direct/diffuse/total DLI 손 계산 대조")
    room = build_mock_room()
    window = build_mock_window()
    grid = [[GridCell(row=0, col=0, x=2.0, y=0.0, z=2.5)]]
    vwindow_cache = build_vwindow_cache(grid, window, room.x_axis_azimuth_deg)
    vwin = vwindow_cache[0][0]
    p = (grid[0][0].x, grid[0][0].y, grid[0][0].z)

    all_sky = [[1] * AZ_STEPS for _ in range(EL_STEPS)]
    all_non_sky = [[0] * AZ_STEPS for _ in range(EL_STEPS)]

    for label, az, el, dni, dhi, sky_flag in CASES:
        solar_df = pd.DataFrame([{"azimuth_deg": az, "elevation_deg": el, "dni": dni, "dhi": dhi}])
        resolved_sky = all_sky if sky_flag == 1 else all_non_sky

        result = compute_light_result(
            room_id=1,
            date="virtual-case",
            room=room,
            window=window,
            grid=grid,
            solar_df=solar_df,
            resolved_sky=resolved_sky,
            vwindow_cache=vwindow_cache,
            rows=1,
            cols=1,
        )

        # 손 계산 (d_light.compute_light_result 내부 공식을 CLAUDE.md 9장 그대로 재현, 독립적으로 다시 작성)
        fdirect_expected = 1 if (sky_flag == 1 and reference_hit(p, az, el)) else 0
        i_direct = dni * math.sin(math.radians(el)) * fdirect_expected
        i_diffuse = dhi * vwin
        expected_direct = round(i_direct * K_PPFD * DT_SEC / 1_000_000, 2)
        expected_diffuse = round(i_diffuse * K_PPFD * DT_SEC / 1_000_000, 2)
        expected_total = round(expected_direct + expected_diffuse, 2)

        code_direct = result["direct_dli"][0][0]
        code_diffuse = result["diffuse_dli"][0][0]
        code_total = result["total_dli"][0][0]

        check(
            f"az={az}, el={el}, dni={dni}, dhi={dhi}, sky={sky_flag}: {label}",
            close(code_direct, expected_direct) and close(code_diffuse, expected_diffuse) and close(code_total, expected_total),
            f"코드 direct/diffuse/total={code_direct}/{code_diffuse}/{code_total}, "
            f"손계산={expected_direct}/{expected_diffuse}/{expected_total}",
        )


if __name__ == "__main__":
    test_geometry_against_independent_formula()
    test_full_pipeline_virtual_cases()
