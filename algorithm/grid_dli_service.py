"""a_grid + b_solar + c_sky + d_light을 하나로 묶은 진입점 2개.

1) compute_room_dli(payload)  ← 백엔드 연동용 (DLI_CALLABLE=grid_dli_service:compute_room_dli)
   다각형 방, 창문 여러 개, ㄱ자 벽 가림, 백엔드 격자(grid_v2) 그대로 사용. 입출력은 함수 docstring 참고.

2) compute_grid_dli(payload)  ← 예전 진입점 (직사각형 방 + 창문 1개). 백엔드가 DLI_CALLABLE 없이
   기본으로 부르는 경로라 형식을 바꾸지 않고 유지한다. 아래 입력 형태 설명은 이 함수 기준.

compute_grid_dli 입력(payload) 형태:
{
  "room_id": 1,
  "date": "2026-10-05",              # 하루치. 여러 날짜 평균 내려면 "dates": [...] 로 대신 줘도 됨
  "room": {
    "corners": [                      # 바닥 모서리 4개, 시계방향(위에서 볼 때), CLAUDE.md 3장
      {"order_index": 0, "x": 0.0, "z": 0.0},
      {"order_index": 1, "x": 4.0, "z": 0.0},
      {"order_index": 2, "x": 4.0, "z": 5.0},
      {"order_index": 3, "x": 0.0, "z": 5.0}
    ],
    "height_m": 2.5,
    "x_axis_azimuth_deg": 0.0,        # X축(0->1번 모서리)이 가리키는 방위각, 진북 기준
    "latitude": 37.5665,
    "longitude": 126.978
  },
  "window": {                         # 4꼭짓점, 방 안에서 바라볼 때 좌하->우하->우상->좌상, CLAUDE.md 4장
    "v0": [3.0, 1.0, 5.0],
    "v1": [1.0, 1.0, 5.0],
    "v2": [1.0, 2.2, 5.0],
    "v3": [3.0, 2.2, 5.0]
  },
  "sky": {                            # 창밖 스캔 원본(resolve_unscanned 넘기기 전), CLAUDE.md 7장
    "sky": [[...]],                   # [elevation][azimuth], 91x360, 1/0/-1
    "max_captured_elevation_deg": [...]  # 360개
  },
  "grid": {"cell_size_m": 0.2},       # 생략 가능(기본 0.2). {"rows":20,"cols":20}처럼 칸 개수 고정도 가능
  "dni_dhi": [                        # 생략 가능 - 없으면 맑은 하늘 모델로 대체(b_solar.py 참고)
    {"time": "2026-10-05T01:00:00+09:00", "dni": 0.0, "dhi": 0.0},
    ...시간별 1시간 간격, 여러 날짜 섞여도 됨...
  ],
  "time_basis": "PRECEDING_HOUR_MEAN" # 생략 가능(기본값). 순간값이면 "INSTANTANEOUS"
}

출력: CLAUDE.md 9장 LightResult 그대로 ({"room_id", "date", "grid", "unit", "direct_dli", "diffuse_dli", "total_dli"}).
"""

import math

import pandas as pd

try:  # 패키지/평면 import 둘 다 지원 - __init__.py 참고
    from .a_grid import GridCell, generate_grid, generate_grid_fixed_size
    from .b_solar import TIME_BASIS_PRECEDING_HOUR_MEAN, compute_solar_times
    from .c_sky import generate_mock_scan, resolve_unscanned
    from .d_light import (
        WindowSource,
        average_light_results,
        build_vwindow_cache,
        compute_light_multi,
        compute_light_result,
    )
    from .models import Room, RoomCorner, Window
    from .room_geometry import (
        corners_to_points,
        normal_angle_deg,
        walls_from_points,
        window_outward_normal_xz,
    )
except ImportError:
    from a_grid import GridCell, generate_grid, generate_grid_fixed_size
    from b_solar import TIME_BASIS_PRECEDING_HOUR_MEAN, compute_solar_times
    from c_sky import generate_mock_scan, resolve_unscanned
    from d_light import (
        WindowSource,
        average_light_results,
        build_vwindow_cache,
        compute_light_multi,
        compute_light_result,
    )
    from models import Room, RoomCorner, Window
    from room_geometry import (
        corners_to_points,
        normal_angle_deg,
        walls_from_points,
        window_outward_normal_xz,
    )


def _parse_room(room_payload: dict) -> Room:
    corners = [RoomCorner(**c) for c in room_payload["corners"]]
    return Room(
        corners=corners,
        height_m=room_payload["height_m"],
        x_axis_azimuth_deg=room_payload["x_axis_azimuth_deg"],
        latitude=room_payload["latitude"],
        longitude=room_payload["longitude"],
    )


def _parse_window(window_payload: dict) -> Window:
    return Window(
        v0=tuple(window_payload["v0"]),
        v1=tuple(window_payload["v1"]),
        v2=tuple(window_payload["v2"]),
        v3=tuple(window_payload["v3"]),
    )


def _parse_grid(room: Room, grid_payload: dict | None) -> tuple[list[list], int, int]:
    grid_payload = grid_payload or {}
    if "rows" in grid_payload and "cols" in grid_payload:
        rows, cols = grid_payload["rows"], grid_payload["cols"]
        return generate_grid(room, rows, cols), rows, cols
    cell_size_m = grid_payload.get("cell_size_m", 0.2)
    return generate_grid_fixed_size(room, cell_size_m)


def _parse_dni_dhi(dni_dhi_payload: list[dict] | None) -> pd.DataFrame | None:
    """시간별 DNI/DHI(프론트가 보내준 값) -> b_solar.compute_solar_times()가 받는 DataFrame."""
    if not dni_dhi_payload:
        return None
    return pd.DataFrame(
        {"dni": [t["dni"] for t in dni_dhi_payload], "dhi": [t["dhi"] for t in dni_dhi_payload]},
        index=pd.to_datetime([t["time"] for t in dni_dhi_payload]),
    )


def compute_grid_dli(payload: dict) -> dict:
    """payload 하나 받아서 격자별 DLI(LightResult, CLAUDE.md 9장)를 돌려주는 단일 진입점.

    "date"(하루치) 또는 "dates"(여러 날짜 평균, 계절 대표일 등) 중 하나를 넣으면 된다.
    """
    room_id = payload.get("room_id", 1)
    room = _parse_room(payload["room"])
    window = _parse_window(payload["window"])
    resolved_sky = resolve_unscanned(payload["sky"])
    grid, rows, cols = _parse_grid(room, payload.get("grid"))
    vwindow_cache = build_vwindow_cache(grid, window, room.x_axis_azimuth_deg)
    dni_dhi = _parse_dni_dhi(payload.get("dni_dhi"))
    time_basis = payload.get("time_basis") or TIME_BASIS_PRECEDING_HOUR_MEAN

    dates = payload["dates"] if "dates" in payload else [payload["date"]]
    results = []
    for d in dates:
        # dni_dhi에 여러 날짜가 섞여 있어도 compute_solar_times가 그 날짜 시각만 골라 씀 (⑦)
        solar_df = compute_solar_times(room, d, dni_dhi=dni_dhi, time_basis=time_basis)
        results.append(
            compute_light_result(
                room_id=room_id,
                date=d,
                room=room,
                window=window,
                grid=grid,
                solar_df=solar_df,
                resolved_sky=resolved_sky,
                vwindow_cache=vwindow_cache,
                rows=rows,
                cols=cols,
            )
        )

    if len(results) == 1:
        return results[0]
    label = f"{dates[0]}~{dates[-1]} 평균 ({len(dates)}일)"
    return average_light_results(results, label=label)


# ---------------------------------------------------------------------------
# 백엔드 연동용: 다각형 방 + 창문 여러 개 + 벽 가림
# ---------------------------------------------------------------------------


def _cells_from_backend_grid(grid: dict) -> list[list[GridCell | None]]:
    """백엔드 grid_v2 -> 칸 중심 좌표. 셀 중심 = origin + (idx + 0.5) x cell_size_m, 배열 [row_z][col_x].

    inside_mask가 false인 칸(방 밖)은 None. 높이(y)는 grid의 sample_height_m.
    AR 축을 회전하지 않으므로 origin이 음수일 수 있다(그대로 쓰면 됨).
    """
    ox, oz = float(grid["origin"]["x"]), float(grid["origin"]["z"])
    size = float(grid["cell_size_m"])
    y = float(grid.get("sample_height_m", 0.0))
    rows, cols = int(grid["rows"]), int(grid["cols"])
    mask = grid["inside_mask"]
    if len(mask) != rows or any(len(r) != cols for r in mask):
        raise ValueError("inside_mask dimensions must equal rows x cols")
    return [
        [
            GridCell(row=r, col=c, x=ox + (c + 0.5) * size, y=y, z=oz + (r + 0.5) * size) if mask[r][c] else None
            for c in range(cols)
        ]
        for r in range(rows)
    ]


def window_outward_azimuth_deg(window: Window, x_axis_azimuth_deg: float) -> float:
    """창문 바깥 방향의 진북 방위각 (mock SKY를 창문 방향에 맞춰 만들 때 사용)."""
    normal = window_outward_normal_xz(window.v0, window.v1, window.v3)
    return (x_axis_azimuth_deg + normal_angle_deg(*normal)) % 360.0


def compute_room_dli(payload: dict) -> dict:
    """백엔드 DLI_CALLABLE 진입점. 하루치 격자별 DLI.

    입력 (백엔드 integration.py가 만드는 dict 그대로):
      date: "YYYY-MM-DD"
      room: {corners: [{order_index, x, z}], height_m, x_axis_azimuth_deg, latitude, longitude}
      grid: 백엔드 grid_v2 {origin{x,y,z}, cell_size_m, sample_height_m, rows, cols, inside_mask}
      windows: [{window_id, wall_index, v0, v1, v2, v3 ([x,y,z]),
                 sky: {sky: 91x360, max_captured_elevation_deg: 360개, ...} 또는 None}]
      dni_dhi: [{time, dni, dhi}] 시간별 (없으면 맑은 하늘 모델)
      time_basis: "PRECEDING_HOUR_MEAN"(기본) | "INSTANTANEOUS"
      mock_sky: true면 sky가 None인 창문에 창문 방향 기준 가짜 SKY(장애물 없음)를 만들어 씀
    출력:
      {date, direct_dli, diffuse_dli, total_dli: [row_z][col_x] (방 밖 None, 소수 2자리), warnings: [...]}
      (백엔드는 direct/diffuse만 검사하고 total은 다시 계산함)
    """
    room_payload = payload["room"]
    corners = [RoomCorner(int(c["order_index"]), float(c["x"]), float(c["z"])) for c in room_payload["corners"]]
    room = Room(
        corners=sorted(corners, key=lambda c: c.order_index),
        height_m=float(room_payload.get("height_m") or 0.0),
        x_axis_azimuth_deg=float(room_payload["x_axis_azimuth_deg"]),
        latitude=float(room_payload["latitude"]),
        longitude=float(room_payload["longitude"]),
    )
    walls = walls_from_points(corners_to_points(room_payload["corners"]))
    cells = _cells_from_backend_grid(payload["grid"])
    mock_sky = bool(payload.get("mock_sky"))

    warnings: list[str] = []
    sources: list[WindowSource] = []
    for w in payload["windows"]:
        window = _parse_window(w)
        wall_index = w.get("wall_index")
        if wall_index is not None and not 0 <= int(wall_index) < len(walls):
            raise ValueError(f"window {w.get('window_id')}: wall_index {wall_index} out of range")
        scan = w.get("sky")
        if scan is None:
            if not mock_sky:
                raise ValueError(f"window {w.get('window_id')}: SKY scan is missing (set mock_sky for testing)")
            scan = generate_mock_scan(window_outward_azimuth_deg(window, room.x_axis_azimuth_deg))
            warnings.append(f"window {w.get('window_id')}: MOCK_SKY used")
        sources.append(
            WindowSource(
                window=window,
                wall_index=None if wall_index is None else int(wall_index),
                resolved_sky=resolve_unscanned(scan),
            )
        )
    if not sources:
        raise ValueError("At least one window is required")

    time_basis = payload.get("time_basis") or TIME_BASIS_PRECEDING_HOUR_MEAN
    solar_df = compute_solar_times(
        room, payload["date"], dni_dhi=_parse_dni_dhi(payload.get("dni_dhi")), time_basis=time_basis
    )
    if payload.get("dni_dhi") is None:
        warnings.append("CLEAR_SKY_MODEL: no irradiance given, used pvlib clear-sky DNI/DHI")

    direct_dli, diffuse_dli = compute_light_multi(cells, room.x_axis_azimuth_deg, sources, walls, solar_df)
    total_dli = [
        [None if d is None else round(d + f, 2) for d, f in zip(d_row, f_row)]
        for d_row, f_row in zip(direct_dli, diffuse_dli)
    ]
    for grid_rows in (direct_dli, diffuse_dli):
        for row in grid_rows:
            if any(v is not None and not math.isfinite(v) for v in row):
                raise ValueError("Non-finite DLI value produced")

    return {
        "date": payload["date"],
        "direct_dli": direct_dli,
        "diffuse_dli": diffuse_dli,
        "total_dli": total_dli,
        "warnings": warnings,
    }


if __name__ == "__main__":
    # Mock 데이터로 돌아가는지 확인하는 간단한 데모
    from c_sky import generate_mock_scan

    demo_payload = {
        "room_id": 1,
        "date": "2026-10-05",
        "room": {
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
        },
        "window": {"v0": [3.0, 1.0, 5.0], "v1": [1.0, 1.0, 5.0], "v2": [1.0, 2.2, 5.0], "v3": [3.0, 2.2, 5.0]},
        "sky": generate_mock_scan(window_outward_azimuth_deg=90.0),
        "grid": {"rows": 20, "cols": 20},
    }

    result = compute_grid_dli(demo_payload)
    print(f"grid: {result['grid']}, unit: {result['unit']}")
    r, c = result["grid"]["rows"] - 1, result["grid"]["cols"] // 2
    print(f"창가 칸 ({r},{c}) total_dli = {result['total_dli'][r][c]}")
