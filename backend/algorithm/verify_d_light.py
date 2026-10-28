"""d_light.py 검증 도구. 장비(센서) 없이 지금 바로 할 수 있는 두 단계만 다룬다.

1) 손으로 계산한 정답과 코드 결과를 비교하는 단순 기하학 케이스 (ray_window_intersect, sun_direction)
2) 상식적으로 당연히 성립해야 하는 상대적/범위 체크 (창가 vs 구석, 전부 막힘 등)

사용법: python verify_d_light.py
"""

import math

from a_grid import generate_grid
from b_solar import compute_solar_times
from c_sky import AZ_STEPS, EL_STEPS, resolve_unscanned
from d_light import build_vwindow_cache, compute_light_result, ray_window_intersect, sun_direction
from models import build_mock_room, build_mock_window

PASS = "OK"
FAIL = "!! FAIL !!"


def check(label: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {label}" + (f" ({detail})" if detail else ""))


# ---------------------------------------------------------------------------
# 1) 손으로 계산한 정답과 비교하는 단순 기하학 케이스
# ---------------------------------------------------------------------------
def test_hand_calculated_geometry() -> None:
    print("[1] 단순 기하학 케이스 (손 계산 vs 코드)")
    room = build_mock_room()  # x_axis_azimuth=0 (진북), 창문은 z=5 벽(동쪽)
    window = build_mock_window()  # x:[1,3], y:[1,2.2], z=5
    p = (2.0, 0.0, 2.5)  # 방 중앙 바닥 칸, 창문 x범위 한가운데(x=2)

    # 케이스 A: 태양 방위각 90(동, 창문 방향), 고도각 30도
    # -> 손 계산: ray를 z=5까지 보내면 u=2.5/cos(30)=2.887, 그때 y=u*sin(30)=1.443
    #    y=1.443은 창문 y범위 [1, 2.2] 안 -> 통과해야 함(True)
    d = sun_direction(90, 30, room.x_axis_azimuth_deg)
    hit = ray_window_intersect(p, d, window)
    expected_y = 2.5 * math.tan(math.radians(30))
    check(
        "케이스 A: 태양 az=90(동)/el=30 -> 창문 통과 (손계산 y=1.443, 범위[1,2.2] 안)",
        hit is True,
        f"코드 결과={hit}, 손계산 y={expected_y:.3f}",
    )

    # 케이스 B: 같은 방위각(90), 고도각만 10도로 낮춤
    # -> 손 계산: y=2.5*tan(10)=0.441 -> 창문 y범위[1,2.2] 밖(아래) -> 통과 못 해야 함(False)
    d = sun_direction(90, 10, room.x_axis_azimuth_deg)
    hit = ray_window_intersect(p, d, window)
    expected_y = 2.5 * math.tan(math.radians(10))
    check(
        "케이스 B: 태양 az=90(동)/el=10 -> 창문 통과 못함 (손계산 y=0.441, 범위[1,2.2] 밖)",
        hit is False,
        f"코드 결과={hit}, 손계산 y={expected_y:.3f}",
    )

    # 케이스 C: 태양 방위각 180(남, 창문 반대쪽 방향), 고도각 30도
    # -> 손 계산: 방향벡터의 z성분이 sin(180-0)*cos(30)=0 -> z가 전혀 안 바뀌어서
    #    z=5(창문 평면)에 영영 안 닿음 -> 통과 못 해야 함(False)
    d = sun_direction(180, 30, room.x_axis_azimuth_deg)
    hit = ray_window_intersect(p, d, window)
    check(
        "케이스 C: 태양 az=180(남, 창문 반대쪽)/el=30 -> 창문 통과 못함 (방향벡터 z성분=0)",
        hit is False,
        f"코드 결과={hit}, 방향벡터={tuple(round(v, 4) for v in d)}",
    )


# ---------------------------------------------------------------------------
# 2) 상식적 범위/상대 비교 체크
# ---------------------------------------------------------------------------
def test_sanity_checks() -> None:
    print("[2] 상식적 범위/상대 비교 체크")
    room = build_mock_room()
    window = build_mock_window()
    rows, cols = 20, 20
    grid = generate_grid(room, rows, cols)
    vwindow_cache = build_vwindow_cache(grid, window, room.x_axis_azimuth_deg)

    # 2-1. 창가 칸 vs 구석 칸의 Vwindow_simple (순수 기하학, 날씨/태양 무관)
    near_window_cell = vwindow_cache[rows - 1][cols // 2]  # 창문(z=5) 바로 앞, x 한가운데
    far_corner_cell = vwindow_cache[0][0]  # 창문에서 제일 먼 구석
    check(
        "창가 칸의 Vwindow_simple > 구석 칸의 Vwindow_simple",
        near_window_cell > far_corner_cell,
        f"창가={near_window_cell:.3f}, 구석={far_corner_cell:.3f}",
    )

    # 2-2. 전부 SKY인 경우 vs 전부 NON-SKY인 경우의 하루 DLI 비교
    solar_df = compute_solar_times(room, "2026-06-21")  # 하지 근처, 고도 높은 날로 테스트
    all_sky = [[1 for _ in range(AZ_STEPS)] for _ in range(EL_STEPS)]
    all_non_sky = [[0 for _ in range(AZ_STEPS)] for _ in range(EL_STEPS)]

    result_sky = compute_light_result(
        room_id=1, date="test", room=room, window=window, grid=grid, solar_df=solar_df,
        resolved_sky=all_sky, vwindow_cache=vwindow_cache, rows=rows, cols=cols,
    )
    result_blocked = compute_light_result(
        room_id=1, date="test", room=room, window=window, grid=grid, solar_df=solar_df,
        resolved_sky=all_non_sky, vwindow_cache=vwindow_cache, rows=rows, cols=cols,
    )

    r, c = rows - 1, cols // 2
    check(
        "전부 SKY일 때 direct_dli > 전부 NON-SKY일 때 direct_dli (창가 칸 기준)",
        result_sky["direct_dli"][r][c] > result_blocked["direct_dli"][r][c],
        f"SKY={result_sky['direct_dli'][r][c]}, NON-SKY={result_blocked['direct_dli'][r][c]}",
    )
    check(
        "전부 NON-SKY일 때 direct_dli == 0 (모든 칸)",
        all(result_blocked["direct_dli"][rr][cc] == 0 for rr in range(rows) for cc in range(cols)),
    )

    # 2-3. (알려진 한계 재확인) 전부 NON-SKY인데도 diffuse_dli는 0이 아님
    # -> Vwindow_simple(1차 모델)이 외부 SKY/NON-SKY를 전혀 안 보기 때문. 버그 아니라 README에 적어둔
    #    "SVF_weighted 미구현" 한계가 실제로 이렇게 드러난다는 걸 보여주는 용도.
    diffuse_nonzero = result_blocked["diffuse_dli"][r][c] > 0
    print(
        f"  [참고] 전부 NON-SKY인데 diffuse_dli={result_blocked['diffuse_dli'][r][c]} "
        f"({'0 아님 - 알려진 1차 모델 한계(SVF_weighted 미구현)' if diffuse_nonzero else '0'})"
    )

    # 2-4. 현실적인 범위인지 (완전 노출 실외 하지 기준 대략 40~60 mol/m2/day보다는 작아야 정상)
    max_total = max(result_sky["total_dli"][rr][cc] for rr in range(rows) for cc in range(cols))
    check(
        "방 안 최댓값이 완전 노출 실외 한여름 DLI(약 60 mol/m2/day)보다 작음",
        max_total < 60,
        f"격자 내 최댓값={max_total}",
    )
    check(
        "모든 칸의 total_dli >= 0",
        all(result_sky["total_dli"][rr][cc] >= 0 for rr in range(rows) for cc in range(cols)),
    )


if __name__ == "__main__":
    test_hand_calculated_geometry()
    print()
    test_sanity_checks()
