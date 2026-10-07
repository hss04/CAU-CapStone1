"""a_grid + b_solar + c_sky + d_light을 하나로 묶은 단일 진입점.

CLAUDE.md 9장 LightResult까지만 필요한 쪽(식물 진단/추천 없이 "격자별 DLI"만 필요한 팀원)에게 넘겨주는
용도. e_diagnosis/f_recommendation은 식물 종 데이터가 있어야 해서 여기 안 들어간다.

아직 FastAPI 서버가 없어서(README TODO) 팀원이 바로 import해서 쓸 수 있게 dict(JSON과 1:1 대응) 입력을
받는 함수로 만들었다 - 나중에 API 엔드포인트를 만들 때도 요청 바디를 거의 그대로 이 함수에 넘기면 된다.
Room/Window는 CLAUDE.md에 JSON 예시가 없어서(3~4장에 필드명만 있음) 아래 PAYLOAD 형태를 새로 정의했다.

입력(payload) 형태:
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
    {"time": "2026-10-05T08:00:00+09:00", "dni": 650.0, "dhi": 120.0},
    ...시간별(보통 1시간 간격)...
  ]
}

출력: CLAUDE.md 9장 LightResult 그대로 ({"room_id", "date", "grid", "unit", "direct_dli", "diffuse_dli", "total_dli"}).
"""

import pandas as pd

from a_grid import generate_grid, generate_grid_fixed_size
from b_solar import compute_solar_times
from c_sky import resolve_unscanned
from d_light import average_light_results, build_vwindow_cache, compute_light_result
from models import Room, RoomCorner, Window


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

    dates = payload["dates"] if "dates" in payload else [payload["date"]]
    results = []
    for d in dates:
        solar_df = compute_solar_times(room, d, dni_dhi=dni_dhi)
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
