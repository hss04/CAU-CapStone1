"""grid_dli_service.compute_grid_dli()를 임의의 payload로 돌려보고 직접 계산한 값과 대조.

verify_d_light_virtual_cases.py는 d_light.py 내부 함수를 직접 호출해서 검증했는데, 이건 한 단계 위
"팀원에게 넘기는 진입점"(payload dict -> Room/Window 파싱 -> 격자 생성 -> SKY 해상 -> DNI/DHI 파싱 ->
LightResult)이 전부 맞물려 돌아가는지를 본다. 즉 여기서 새로 검증하는 건 d_light 공식 자체가 아니라
"payload를 제대로 풀어서 d_light에 넘기는가"이다.

태양 방위각/고도각(pvlib NREL SPA) 자체는 재구현하지 않고 "신뢰할 수 있는 외부 라이브러리가 주는 값"으로
그대로 쓴다(b_solar.compute_solar_times()를 직접 호출해서 얻음, dni_dhi 없이 호출하면 맑은 하늘 모델이라
네트워크 없이도 결정적으로 재현됨). 레이-창문 교차 판정만 verify_d_light_virtual_cases.py와 같은, d_light와
무관하게 다시 유도한 reference_hit() 공식으로 독립 검증한다.

사용법: python verify_grid_dli_service.py
"""

import math

import pandas as pd

from a_grid import GridCell
from b_solar import compute_solar_times
from d_light import DT_SEC, K_PPFD, build_vwindow_cache
from grid_dli_service import compute_grid_dli
from models import Room, RoomCorner, Window

PASS = "OK"
FAIL = "!! FAIL !!"
DLI_TOL = 0.02


def check(label: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {label}" + (f" ({detail})" if detail else ""))


def close(a: float, b: float, tol: float = DLI_TOL) -> bool:
    return abs(a - b) <= tol


# ---------------------------------------------------------------------------
# Mock 방: 4m(X) x 5m(Z) x 2.5m(H), x_axis_azimuth=0, 창문은 z=5 벽(동쪽)
# verify_d_light_virtual_cases.py와 같은 기하 구조라 reference_hit() 공식도 그대로 재사용
# ---------------------------------------------------------------------------
ROOM_PAYLOAD = {
    "corners": [
        {"order_index": 0, "x": 0.0, "z": 0.0},
        {"order_index": 1, "x": 4.0, "z": 0.0},
        {"order_index": 2, "x": 4.0, "z": 5.0},
        {"order_index": 3, "x": 0.0, "z": 5.0},
    ],
    "height_m": 2.5,
    "x_axis_azimuth_deg": 0.0,
    "latitude": 37.5665,
    "longitude": 126.978,
}
WINDOW_PAYLOAD = {"v0": [3.0, 1.0, 5.0], "v1": [1.0, 1.0, 5.0], "v2": [1.0, 2.2, 5.0], "v3": [3.0, 2.2, 5.0]}
GRID_1X1_PAYLOAD = {"rows": 1, "cols": 1}  # 4x5 방에서 rows=1,cols=1 -> 셀 중심이 정확히 (2.0, 0.0, 2.5)
TEST_CELL = (2.0, 0.0, 2.5)
DATE = "2026-10-05"

WINDOW_Z = 5.0
WINDOW_X_RANGE = (1.0, 3.0)
WINDOW_Y_RANGE = (1.0, 2.2)


def reference_hit(p: tuple[float, float, float], azimuth_deg: float, elevation_deg: float) -> bool:
    """d_light.ray_window_intersect()의 교차곱 공식과 무관하게 다시 유도한 레이-창문 교차 판정."""
    rel = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    dx, dy, dz = math.cos(rel) * math.cos(el), math.sin(el), math.sin(rel) * math.cos(el)
    if abs(dz) < 1e-9:
        return False
    u = (WINDOW_Z - p[2]) / dz
    if u <= 0:
        return False
    qx, qy = p[0] + u * dx, p[1] + u * dy
    return WINDOW_X_RANGE[0] <= qx <= WINDOW_X_RANGE[1] and WINDOW_Y_RANGE[0] <= qy <= WINDOW_Y_RANGE[1]


def hand_calc_total_dli(solar_df: pd.DataFrame, sky_is_open: bool, vwin: float) -> tuple[float, float, float]:
    """CLAUDE.md 9장 공식을 손으로 다시 적용 (d_light.compute_light_result 내부 루프와 독립적으로 재작성)."""
    acc_direct = acc_diffuse = 0.0
    for _, t in solar_df.iterrows():
        az, el, dni, dhi = t["azimuth_deg"], t["elevation_deg"], t["dni"], t["dhi"]
        fdirect = 1 if (sky_is_open and reference_hit(TEST_CELL, az, el)) else 0
        i_direct = dni * math.sin(math.radians(el)) * fdirect
        i_diffuse = dhi * vwin
        acc_direct += i_direct * K_PPFD * DT_SEC
        acc_diffuse += i_diffuse * K_PPFD * DT_SEC
    direct_dli = round(acc_direct / 1_000_000, 2)
    diffuse_dli = round(acc_diffuse / 1_000_000, 2)
    return direct_dli, diffuse_dli, round(direct_dli + diffuse_dli, 2)


def all_sky_raw(open_: bool) -> dict:
    value = 1 if open_ else 0
    return {"sky": [[value] * 360 for _ in range(91)], "max_captured_elevation_deg": [90.0] * 360}


def main() -> None:
    room = Room(
        corners=[RoomCorner(**c) for c in ROOM_PAYLOAD["corners"]],
        height_m=ROOM_PAYLOAD["height_m"],
        x_axis_azimuth_deg=ROOM_PAYLOAD["x_axis_azimuth_deg"],
        latitude=ROOM_PAYLOAD["latitude"],
        longitude=ROOM_PAYLOAD["longitude"],
    )
    window = Window(
        v0=tuple(WINDOW_PAYLOAD["v0"]),
        v1=tuple(WINDOW_PAYLOAD["v1"]),
        v2=tuple(WINDOW_PAYLOAD["v2"]),
        v3=tuple(WINDOW_PAYLOAD["v3"]),
    )
    grid = [[GridCell(row=0, col=0, x=TEST_CELL[0], y=TEST_CELL[1], z=TEST_CELL[2])]]
    vwin = build_vwindow_cache(grid, window, room.x_axis_azimuth_deg)[0][0]

    # 네트워크 없이 결정적으로 재현되게 dni_dhi 없이 호출 -> 맑은 하늘 모델. compute_grid_dli 내부에서도
    # 똑같이 호출되므로, 이 solar_df를 "주어진 값"으로 두고 거기서부터는 손으로 다시 계산한다.
    solar_df = compute_solar_times(room, DATE)

    print(f"[1] 전부 SKY (날짜={DATE}, 맑은 하늘 모델)")
    payload_sky = {
        "room_id": 1, "date": DATE, "room": ROOM_PAYLOAD, "window": WINDOW_PAYLOAD,
        "sky": all_sky_raw(True), "grid": GRID_1X1_PAYLOAD,
    }
    result_sky = compute_grid_dli(payload_sky)
    expected_sky = hand_calc_total_dli(solar_df, sky_is_open=True, vwin=vwin)
    code_sky = (result_sky["direct_dli"][0][0], result_sky["diffuse_dli"][0][0], result_sky["total_dli"][0][0])
    check("direct/diffuse/total DLI 일치", all(close(c, e) for c, e in zip(code_sky, expected_sky)),
          f"코드={code_sky}, 손계산={expected_sky}")

    print("[2] 전부 NON-SKY (직사광은 0이어야 하고, 산란광은 [1]과 동일해야 함 - 알려진 1차 모델 한계)")
    payload_non_sky = dict(payload_sky, sky=all_sky_raw(False))
    result_non_sky = compute_grid_dli(payload_non_sky)
    expected_non_sky = hand_calc_total_dli(solar_df, sky_is_open=False, vwin=vwin)
    code_non_sky = (
        result_non_sky["direct_dli"][0][0], result_non_sky["diffuse_dli"][0][0], result_non_sky["total_dli"][0][0],
    )
    check("direct/diffuse/total DLI 일치", all(close(c, e) for c, e in zip(code_non_sky, expected_non_sky)),
          f"코드={code_non_sky}, 손계산={expected_non_sky}")
    check("전부 NON-SKY -> direct_dli == 0", code_non_sky[0] == 0.0, f"direct_dli={code_non_sky[0]}")

    print("[3] dni_dhi payload로 백엔드 제공 일사량 덮어쓰기 (00:00~다음날 00:00 매시 정각 25개, DNI=500/DHI=100 고정)")
    # 하루 전체(해 뜨는 시각부터) 계산하므로 백엔드 WEATHER_API와 같이 25개를 준다
    day_start = pd.Timestamp(f"{DATE} 00:00", tz="Asia/Seoul")
    dni_dhi_payload = [
        {"time": (day_start + pd.Timedelta(hours=h)).isoformat(), "dni": 500.0, "dhi": 100.0} for h in range(25)
    ]
    payload_custom = dict(payload_sky, dni_dhi=dni_dhi_payload)
    result_custom = compute_grid_dli(payload_custom)

    custom_df = pd.DataFrame(
        {"dni": [500.0] * 25, "dhi": [100.0] * 25},
        index=pd.to_datetime([t["time"] for t in dni_dhi_payload]),
    )
    solar_df_custom = compute_solar_times(room, DATE, dni_dhi=custom_df)
    expected_custom = hand_calc_total_dli(solar_df_custom, sky_is_open=True, vwin=vwin)
    code_custom = (
        result_custom["direct_dli"][0][0], result_custom["diffuse_dli"][0][0], result_custom["total_dli"][0][0],
    )
    check("direct/diffuse/total DLI 일치", all(close(c, e) for c, e in zip(code_custom, expected_custom)),
          f"코드={code_custom}, 손계산={expected_custom}")
    check("맑은 하늘 모델([1])과 다른 값이 나옴 -> dni_dhi payload가 실제로 반영됨",
          code_custom != code_sky, f"[1]={code_sky}, [3]={code_custom}")

    print("[4] grid 생략 시 기본값(cell_size_m=0.2) 칸 개수: 4m/0.2=20cols, 5m/0.2=25rows")
    payload_default_grid = {k: v for k, v in payload_sky.items() if k != "grid"}
    result_default_grid = compute_grid_dli(payload_default_grid)
    check(
        "rows=25, cols=20",
        result_default_grid["grid"]["rows"] == 25 and result_default_grid["grid"]["cols"] == 20,
        f"실제={result_default_grid['grid']}",
    )

    print("[5] 여러 날짜 평균 (dates: 2026-10-05, 2026-06-21)")
    dates = [DATE, "2026-06-21"]
    payload_multi = dict(payload_sky)
    payload_multi.pop("date")
    payload_multi["dates"] = dates
    result_multi = compute_grid_dli(payload_multi)

    per_day = [hand_calc_total_dli(compute_solar_times(room, d), sky_is_open=True, vwin=vwin) for d in dates]
    expected_direct = round(sum(d[0] for d in per_day) / len(dates), 2)
    expected_diffuse = round(sum(d[1] for d in per_day) / len(dates), 2)
    expected_total = round(expected_direct + expected_diffuse, 2)
    code_multi = (result_multi["direct_dli"][0][0], result_multi["diffuse_dli"][0][0], result_multi["total_dli"][0][0])
    check(
        "날짜별 결과 평균과 일치",
        close(code_multi[0], expected_direct) and close(code_multi[1], expected_diffuse) and close(code_multi[2], expected_total),
        f"코드={code_multi}, 손계산=({expected_direct}, {expected_diffuse}, {expected_total})",
    )


if __name__ == "__main__":
    main()
