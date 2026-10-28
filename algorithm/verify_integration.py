"""백엔드 연동용 변경(팀원 요청 ①~⑧) 검증.

1) ④ 방 방향: 손계산 정답 + sun_direction()과 같은 기준인지 + 원형 평균
2) ⑤⑥⑦ 시간/일사량: 144 구간, 계단식(1시간 평균 보존), 여러 날짜 섞인 입력
3) ① 회귀: 직사각형+창문 1개에서 새 진입점(compute_room_dli) == 예전 진입점(compute_grid_dli)
4) ① 음수 좌표: 방 전체를 평행이동해도 결과 동일 (AR 축 원점 그대로 쓰는 경우)
5) ③ ㄱ자 벽 가림: 안쪽 모서리 뒤 칸은 창문 빛 0, 창문 앞 칸은 벽 검사 유무와 무관
6) ② 창문 여러 개: 산란광 = 창문별 합, 직사광 >= 창문별 최대
7) ⑧ 추천 래퍼: 미배치/방 밖/가구 칸/자리 중복 처리
8) import: 패키지(from algorithm.x) 방식도 동작

사용법: python verify_integration.py   (네트워크 불필요, 맑은 하늘 모델 사용)
"""

import math
import os
import subprocess
import sys
import time

import pandas as pd

from b_solar import compute_solar_times
from c_sky import generate_mock_scan, resolve_unscanned
from d_light import WindowSource, compute_light_multi, sun_direction
from grid_dli_service import _cells_from_backend_grid, _parse_window, compute_grid_dli, compute_room_dli
from models import Room, RoomCorner
from recommend_service import recommend_for_room
from room_geometry import compute_room_direction, corners_to_points, outward_wall_normal, walls_from_points

PASS = "OK"
FAIL = "!! FAIL !!"
failures = 0

DATE = "2026-10-05"
LAT, LON = 37.5665, 126.978


def check(label: str, condition: bool, detail: str = "") -> None:
    global failures
    if not condition:
        failures += 1
    status = PASS if condition else FAIL
    print(f"  [{status}] {label}" + (f" ({detail})" if detail else ""))


def corners(*pts):
    return [{"order_index": i, "x": x, "z": z} for i, (x, z) in enumerate(pts)]


def backend_grid(pts, cell=0.2, height=0.0):
    """백엔드 geometry.grid()와 같은 규칙으로 grid_v2 생성 (테스트용 재현)."""
    from room_geometry import point_in_polygon

    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    ox, oz = min(xs), min(zs)
    cols = math.ceil((max(xs) - ox) / cell)
    rows = math.ceil((max(zs) - oz) / cell)
    mask = [[point_in_polygon(list(pts), ox + (c + 0.5) * cell, oz + (r + 0.5) * cell) for c in range(cols)] for r in range(rows)]
    return {"origin": {"x": ox, "y": 0, "z": oz}, "cell_size_m": cell, "sample_height_m": height,
            "rows": rows, "cols": cols, "inside_mask": mask}


def room_payload(pts, x_az):
    return {"corners": corners(*pts), "height_m": 2.5, "x_axis_azimuth_deg": x_az, "latitude": LAT, "longitude": LON}


# ---------------------------------------------------------------------------
print("\n[1] 방 방향 (④)")
rect = [(0, 0), (4, 0), (4, 5), (0, 5)]
# 벽 2 = (4,5)->(0,5), z=5 벽 -> 바깥 법선 +Z (θ=90). 창문이 남쪽(180)을 보면 X축 = 180-90 = 90(동)
r = compute_room_direction({"corners": corners(*rect), "windows": [{"wall_index": 2, "window_azimuth_deg": 180.0}]})
check("손계산: +Z 벽 창문이 남향이면 X축 90도", abs(r["x_axis_azimuth_deg"] - 90.0) < 1e-6, f"{r['x_axis_azimuth_deg']}")

# 같은 방을 반대 순서(반시계)로 줘도 같은 벽이면 같은 답 - 벽 0 = (0,5)->(4,5)
r2 = compute_room_direction({"corners": corners((0, 5), (4, 5), (4, 0), (0, 0)), "windows": [{"wall_index": 0, "window_azimuth_deg": 180.0}]})
check("모서리 순서가 반대여도 같은 결과", abs(r2["x_axis_azimuth_deg"] - 90.0) < 1e-6, f"{r2['x_axis_azimuth_deg']}")

# sun_direction과 같은 기준인지: 창문 정면 방위각, 고도 0의 태양 방향 == 그 벽의 바깥 법선
for wall, W in [(0, 37.0), (1, 200.0), (2, 315.5), (3, 5.0)]:
    res = compute_room_direction({"corners": corners(*rect), "windows": [{"wall_index": wall, "window_azimuth_deg": W}]})
    d = sun_direction(W, 0.0, res["x_axis_azimuth_deg"])
    n = outward_wall_normal(rect, wall)
    check(f"벽 {wall}, 창 방위 {W}: sun_direction(창 방위) == 바깥 법선", abs(d[0] - n[0]) < 1e-9 and abs(d[2] - n[1]) < 1e-9,
          f"d=({d[0]:.3f},{d[2]:.3f}) n=({n[0]:.3f},{n[1]:.3f})")

# 창문 두 개: 359도와 1도(원형 평균 0도), 벽 2(θ=90)와 벽 1(θ=0)
two = compute_room_direction({"corners": corners(*rect), "windows": [
    {"wall_index": 2, "window_azimuth_deg": 89.0},   # -> 359
    {"wall_index": 1, "window_azimuth_deg": 1.0},    # -> 1
]})
check("원형 평균 359/1 -> 0", two["x_axis_azimuth_deg"] < 1e-6 or two["x_axis_azimuth_deg"] > 359.999, f"{two['x_axis_azimuth_deg']}")
check("값이 비슷하면 경고 없음", not two["warnings"], f"{two['warnings']}")
bad = compute_room_direction({"corners": corners(*rect), "windows": [
    {"wall_index": 2, "window_azimuth_deg": 180.0}, {"wall_index": 1, "window_azimuth_deg": 130.0}]})
check("창문별 값이 40도 벌어지면 경고", any("disagree" in w for w in bad["warnings"]), f"spread={bad['spread_deg']}")
win_ok = {"v0": [3, 1, 5], "v1": [1, 1, 5], "v2": [1, 2.2, 5], "v3": [3, 2.2, 5]}
win_flipped = {"v0": [1, 1, 5], "v1": [3, 1, 5], "v2": [3, 2.2, 5], "v3": [1, 2.2, 5]}
ok = compute_room_direction({"corners": corners(*rect), "windows": [{"wall_index": 2, "window_azimuth_deg": 180.0, **win_ok}]})
flip = compute_room_direction({"corners": corners(*rect), "windows": [{"wall_index": 2, "window_azimuth_deg": 180.0, **win_flipped}]})
check("창문 꼭짓점이 벽과 맞으면 경고 없음", not ok["warnings"])
check("창문 좌우가 뒤집히면 경고", len(flip["warnings"]) == 1, f"{flip['warnings']}")

# ---------------------------------------------------------------------------
print("\n[2] 시간 범위 / 일사량 (⑤⑥⑦)")
room = Room([RoomCorner(i, x, z) for i, (x, z) in enumerate(rect)], 2.5, 0.0, LAT, LON)


def hourly(date, base):
    """00:00 ~ 다음날 00:00, 25개. 값 = base + 시(hour)*10 으로 시각마다 다르게."""
    start = pd.Timestamp(f"{date} 00:00", tz="Asia/Seoul")
    idx = [start + pd.Timedelta(hours=h) for h in range(25)]
    return pd.DataFrame({"dni": [base + h * 10.0 for h in range(25)], "dhi": [base / 2 + h for h in range(25)]}, index=idx)


clear = compute_solar_times(room, DATE)
sun_up_hours = sorted({t.hour for t in clear.index})
check("하루 전체 계산 (08시 이전/18시 이후 해 뜬 시점 포함)", min(sun_up_hours) < 8 and max(sun_up_hours) >= 17,
      f"해 뜬 시간대 {min(sun_up_hours)}시~{max(sun_up_hours)}시, 시점 {len(clear)}개")
check("시점은 구간 가운데(분 = 5, 15, ..., 55)", all(t.minute % 10 == 5 for t in clear.index))

df = hourly(DATE, 100.0)
step = compute_solar_times(room, DATE, dni_dhi=df)
s13 = step[(step.index.hour == 13)]
check("13:05~13:55 구간은 모두 14:00 값(직전 1시간 평균)", len(s13) == 6 and (s13["dni"] == 100.0 + 14 * 10).all(),
      f"{sorted(set(s13['dni']))}")
hour_means = step.groupby(step.index.hour)["dni"].mean()
check("1시간 평균 보존 (12시대 6개 평균 == 13:00 값)", abs(hour_means[12] - (100 + 13 * 10)) < 1e-9)

mixed = pd.concat([hourly("2026-10-04", 500.0).iloc[:-1], df])  # 10/4와 10/5가 섞인 입력
step_mixed = compute_solar_times(room, DATE, dni_dhi=mixed)
check("여러 날짜 섞인 입력에서 그 날짜 값만 사용 (⑦)", step_mixed["dni"].equals(step["dni"]))
try:
    compute_solar_times(room, "2026-10-06", dni_dhi=df)
    check("없는 날짜는 오류 (조용히 엉뚱한 값 안 씀)", False)
except ValueError:
    check("없는 날짜는 오류 (조용히 엉뚱한 값 안 씀)", True)
lin = compute_solar_times(room, DATE, dni_dhi=df, time_basis="INSTANTANEOUS")
check("INSTANTANEOUS는 선형보간 (13:05 = 13:00과 14:00 사이)", 230.0 < lin.loc[lin.index.hour == 13, "dni"].iloc[0] < 240.0)

# ---------------------------------------------------------------------------
print("\n[3] 회귀: 새 진입점 == 예전 진입점 (직사각형 + 창문 1개)")
window = {"v0": [3.0, 1.0, 5.0], "v1": [1.0, 1.0, 5.0], "v2": [1.0, 2.2, 5.0], "v3": [3.0, 2.2, 5.0]}
X_AZ = 90.0  # +Z(창문 바깥) = 180 남향
scan = generate_mock_scan(180.0, obstructions=[(150, 170, 25)])
t0 = time.time()
old = compute_grid_dli({"room_id": 1, "date": DATE, "room": room_payload(rect, X_AZ), "window": window, "sky": scan,
                        "grid": {"cell_size_m": 0.2}})
t_old = time.time() - t0
t0 = time.time()
new = compute_room_dli({"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect),
                        "windows": [{"window_id": 1, "wall_index": 2, **window, "sky": scan}], "mock_sky": False})
t_new = time.time() - t0
diff = max(abs(a - b) for key in ("direct_dli", "diffuse_dli") for ra, rb in zip(old[key], new[key]) for a, b in zip(ra, rb))
check("격자 크기 동일", len(old["total_dli"]) == len(new["total_dli"]) and len(old["total_dli"][0]) == len(new["total_dli"][0]))
check("모든 칸 direct/diffuse 차이 <= 0.01 (반올림 오차)", diff <= 0.01, f"최대 차이 {diff:.3f}")
check("창가 칸에 직사광이 실제로 들어옴", max(max(r) for r in new["direct_dli"]) > 0.5, f"최대 direct {max(max(r) for r in new['direct_dli'])}")
print(f"  (계산 시간: 예전 {t_old:.1f}s, 새 진입점 {t_new:.1f}s, 500칸)")

# ---------------------------------------------------------------------------
print("\n[4] 음수 좌표: 방을 (-3, -2) 평행이동해도 같은 결과 (①)")
shift = [(x - 3, z - 2) for x, z in rect]
win_shift = {k: [v[0] - 3, v[1], v[2] - 2] for k, v in window.items()}
moved = compute_room_dli({"date": DATE, "room": room_payload(shift, X_AZ), "grid": backend_grid(shift),
                          "windows": [{"window_id": 1, "wall_index": 2, **win_shift, "sky": scan}]})
check("origin 음수", backend_grid(shift)["origin"]["x"] < 0)
check("평행이동 전후 direct_dli 완전히 동일", moved["direct_dli"] == new["direct_dli"])
# 산란광은 상반구 샘플 Ray 324개(10도 간격) 중 통과 비율이라, 창문 테두리에 정확히 걸치는 Ray 하나가
# 좌표 소수점 끝자리 차이로 통과/불통과가 갈릴 수 있다. 그 1개 몫(이 방/날짜에서 약 0.02)까지는 허용.
moved_diff = [abs(a - b) for ra, rb in zip(moved["diffuse_dli"], new["diffuse_dli"]) for a, b in zip(ra, rb)]
check("평행이동 전후 diffuse_dli 차이 <= 샘플 Ray 1개 몫(0.02)", max(moved_diff) <= 0.02 + 1e-9,
      f"다른 칸 {sum(d > 0 for d in moved_diff)}/{len(moved_diff)}개, 최대 {max(moved_diff):.2f}")

# ---------------------------------------------------------------------------
print("\n[5] ㄱ자 방 벽 가림 (③)")
L = [(0, 0), (6, 0), (6, 3), (3, 3), (3, 6), (0, 6)]
# 벽 1 = (6,0)->(6,3), x=6 벽. 바깥 +X. 방 안에서 +X를 보면 왼쪽이 z 작은 쪽 -> v0 z=1, v1 z=2
lwin = {"v0": [6.0, 0.8, 1.0], "v1": [6.0, 0.8, 2.0], "v2": [6.0, 2.2, 2.0], "v3": [6.0, 2.2, 1.0]}
L_AZ = 180.0  # +X = 남쪽
lgrid = backend_grid(L, cell=0.5)
cells = _cells_from_backend_grid(lgrid)
lscan = generate_mock_scan(180.0)
src = [WindowSource(_parse_window(lwin), 1, resolve_unscanned(lscan))]
lroom = Room([RoomCorner(i, x, z) for i, (x, z) in enumerate(L)], 2.5, L_AZ, LAT, LON)
solar = compute_solar_times(lroom, DATE)
walls = walls_from_points(L)
d_wall, f_wall = compute_light_multi(cells, L_AZ, src, walls, solar)
d_free, f_free = compute_light_multi(cells, L_AZ, src, [], solar)
r_hidden, c_hidden = 10, 2   # (x=1.25, z=5.25): 세로 팔 안쪽, 안쪽 모서리(3,3) 뒤
r_front, c_front = 3, 10     # (x=5.25, z=1.75): 창문 바로 앞
check("가려진 칸 위치가 방 안", cells[r_hidden][c_hidden] is not None and cells[r_front][c_front] is not None)
check("방 밖 칸은 None", d_wall[10][10] is None, f"inside_mask[10][10]={lgrid['inside_mask'][10][10]}")
check("벽 검사 없으면 가려진 칸에도 빛이 들어옴(검사 의미 확인)", f_free[r_hidden][c_hidden] > 0, f"diffuse={f_free[r_hidden][c_hidden]}")
check("벽 검사하면 가려진 칸 direct=0, diffuse=0", d_wall[r_hidden][c_hidden] == 0 and f_wall[r_hidden][c_hidden] == 0,
      f"direct={d_wall[r_hidden][c_hidden]}, diffuse={f_wall[r_hidden][c_hidden]}")
check("창문 앞 칸은 벽 검사 유무와 같음", d_wall[r_front][c_front] == d_free[r_front][c_front] and f_wall[r_front][c_front] == f_free[r_front][c_front],
      f"total={d_wall[r_front][c_front] + f_wall[r_front][c_front]:.2f}")

# ---------------------------------------------------------------------------
print("\n[6] 창문 여러 개 (②)")
win_n = {"v0": [1.0, 1.0, 0.0], "v1": [3.0, 1.0, 0.0], "v2": [3.0, 2.2, 0.0], "v3": [1.0, 2.2, 0.0]}  # z=0 벽, 바깥 -Z
scan_s = generate_mock_scan(180.0)
scan_n = generate_mock_scan(0.0)
both = compute_room_dli({"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect, 0.5), "windows": [
    {"window_id": 1, "wall_index": 2, **window, "sky": scan_s}, {"window_id": 2, "wall_index": 0, **win_n, "sky": scan_n}]})
only_s = compute_room_dli({"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect, 0.5),
                           "windows": [{"window_id": 1, "wall_index": 2, **window, "sky": scan_s}]})
only_n = compute_room_dli({"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect, 0.5),
                           "windows": [{"window_id": 2, "wall_index": 0, **win_n, "sky": scan_n}]})
diff_sum = max(abs(b - (s + n)) for rb, rs, rn in zip(both["diffuse_dli"], only_s["diffuse_dli"], only_n["diffuse_dli"])
               for b, s, n in zip(rb, rs, rn))
check("산란광 = 창문별 합 (반올림 오차 0.02 이내)", diff_sum <= 0.02, f"최대 차이 {diff_sum:.3f}")
direct_ok = all(b >= max(s, n) - 1e-9 for rb, rs, rn in zip(both["direct_dli"], only_s["direct_dli"], only_n["direct_dli"])
                for b, s, n in zip(rb, rs, rn))
check("직사광 >= 창문별 최대", direct_ok)
mock = compute_room_dli({"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect, 0.5), "mock_sky": True,
                         "windows": [{"window_id": 1, "wall_index": 2, **window, "sky": None}]})
check("mock_sky면 sky 없이도 계산 + 경고 표시", any("MOCK_SKY" in w for w in mock["warnings"]))
try:
    compute_room_dli({"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect, 0.5),
                      "windows": [{"window_id": 1, "wall_index": 2, **window, "sky": None}]})
    check("mock_sky 아니고 sky 없으면 오류", False)
except ValueError:
    check("mock_sky 아니고 sky 없으면 오류", True)

# ---------------------------------------------------------------------------
print("\n[7] 추천 래퍼 (⑧)")
dli_map = {
    "date": DATE, "period": {"start_date": DATE, "end_date": DATE, "day_count": 1},
    "grid": {"origin": {"x": -1.0, "y": 0, "z": 0.0}, "cell_size_m": 1.0, "rows": 2, "cols": 3,
             "inside_mask": [[True, True, True], [True, True, False]]},
    "total_dli": [[2.0, 8.0, 15.0], [5.0, 10.0, None]],
}
rec = recommend_for_room({"room_id": 1, "dli_map": dli_map, "blocked_cells": [{"row": 0, "col": 2}], "plants": [
    {"plant_id": 1, "species_id": 10, "position": {"x": -0.5, "y": 0, "z": 0.5}, "min_dli": 8.0, "max_dli": 12.0},  # (0,0) 2 -> LOW
    {"plant_id": 2, "species_id": 11, "position": None, "min_dli": 8.0, "max_dli": 12.0},                          # 미배치
    {"plant_id": 3, "species_id": 12, "position": {"x": 0.5, "y": 0, "z": 1.5}, "min_dli": 4.0, "max_dli": 12.0},  # (1,1) 10 -> OK
    {"plant_id": 4, "species_id": 13, "position": {"x": 1.5, "y": 0, "z": 1.5}, "min_dli": 4.0, "max_dli": 12.0},  # (1,2) 방 밖
]})
by_id = {p["plant_id"]: p for p in rec["plants"]}
check("실좌표 -> 칸 변환 + LOW 판정", by_id[1]["current"] == {"row": 0, "col": 0, "total_dli": 2.0, "status": "LOW"}, f"{by_id[1]['current']}")
check("OK면 추천 없음(유지)", by_id[3]["current"]["status"] == "OK" and by_id[3]["recommended"] is None)
check("미배치 식물은 current=None, 추천은 받음", by_id[2]["current"] is None and by_id[2]["recommended"] is not None)
check("방 밖 위치는 미배치 취급 + 경고", by_id[4]["current"] is None and any("plant 4" in w for w in rec["warnings"]))
recommended = [(p["recommended"]["row"], p["recommended"]["col"]) for p in rec["plants"] if p["recommended"]]
check("추천 자리 중복 없음", len(recommended) == len(set(recommended)), f"{recommended}")
check("가구 칸(0,2)/방 밖(1,2)/다른 식물 자리(1,1) 추천 안 함",
      not set(recommended) & {(0, 2), (1, 2), (1, 1), (0, 0)}, f"{recommended}")
check("범위 안(8~12) 칸 (0,1)=8.0이 추천에 포함", (0, 1) in recommended, f"{recommended}")

from f_recommendation import score
check("score: 범위 중앙 1.0, 경계 0.5", score(10, 8, 12) == 1.0 and score(8, 8, 12) == 0.5 and score(12, 8, 12) == 0.5)
check("score: 모자람 0.5 x DLI/min (필요량 절반 -> 0.25)", score(4, 8, 12) == 0.25)
check("score: 넘침 0.5 x max/DLI (2배 -> 0.25)", score(24, 8, 12) == 0.25)
check("score: 범위 밖이어도 가까울수록 높음 (0점 아님)", 0 < score(1, 18, 40) < score(9, 18, 40) < score(17, 18, 40) < 0.5)
dim_map = {"date": DATE, "grid": {"origin": {"x": 0, "y": 0, "z": 0}, "cell_size_m": 1.0, "rows": 1, "cols": 4,
                                  "inside_mask": [[True] * 4]}, "total_dli": [[0.1, 3.0, 13.5, 0.04]]}
dim = recommend_for_room({"room_id": 1, "dli_map": dim_map, "blocked_cells": [], "plants": [
    {"plant_id": 9, "species_id": 3, "position": {"x": 3.5, "y": 0, "z": 0.5}, "min_dli": 18.0, "max_dli": 40.0}]})
r9 = dim["plants"][0]["recommended"]
check("방 전체가 모자라면 가장 밝은 칸 추천 (올리브 사례)", r9 is not None and r9["col"] == 2 and r9["score"] > 0, f"{r9}")
check("그때 '범위 만족 칸 없음' 경고", any("no cell in this room meets" in w for w in dim["warnings"]), f"{dim['warnings']}")

# ---------------------------------------------------------------------------
print("\n[8] import 방식")
parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pkg = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
code = (f"import sys; sys.path.insert(0, {parent!r}); "
        f"import {pkg}.grid_dli_service, {pkg}.room_geometry, {pkg}.recommend_service; print('ok')")
p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
check(f"패키지 import (from {pkg}.grid_dli_service ...)", p.returncode == 0 and "ok" in p.stdout, p.stderr.strip()[-200:])

# ---------------------------------------------------------------------------
print("\n[9] 10분 단위 PPFD 출력 (프론트 요청: timeseries / cells)")
import json as _json

from d_light import K_PPFD

base = {"date": DATE, "room": room_payload(rect, X_AZ), "grid": backend_grid(rect),
        "windows": [{"window_id": 1, "wall_index": 2, **window, "sky": scan}]}
plain = compute_room_dli(dict(base))
ts = compute_room_dli(dict(base, timeseries=True))
check("기본(timeseries 없음)은 PPFD 키 없음", "direct_ppfd" not in plain and "times" not in plain)
check("timeseries 켜도 DLI 3종은 그대로", all(ts[k] == plain[k] for k in ("direct_dli", "diffuse_dli", "total_dli")))
solar = compute_solar_times(Room([RoomCorner(i, x, z) for i, (x, z) in enumerate(rect)], 2.5, X_AZ, LAT, LON), DATE)
nt, nr, nc = len(ts["times"]), len(ts["direct_dli"]), len(ts["direct_dli"][0])
check("시점 = 해 떠 있는 10분 구간 (구간 가운데 시각)", nt == len(solar) and ts["times"][0].endswith("+09:00") and ts["times"][0][14:16] in ("05", "15", "25", "35", "45", "55"),
      f"{nt}개, 첫 {ts['times'][0]}, 끝 {ts['times'][-1]}")
check("배열 모양 [t][row][col]", len(ts["direct_ppfd"]) == nt and len(ts["direct_ppfd"][0]) == nr and len(ts["direct_ppfd"][0][0]) == nc)
sum_err = 0.0
for r in range(nr):
    for c in range(nc):
        if ts["direct_dli"][r][c] is None:
            continue
        d_sum = sum(ts["direct_ppfd"][k][r][c] for k in range(nt)) * 600 / 1e6
        f_sum = sum(ts["diffuse_ppfd"][k][r][c] for k in range(nt)) * 600 / 1e6
        sum_err = max(sum_err, abs(d_sum - ts["direct_dli"][r][c]), abs(f_sum - ts["diffuse_dli"][r][c]))
check("모든 칸: Σ(10분 PPFD x 600초)/1e6 == 그 칸 DLI (반올림 오차 0.01 이내)", sum_err <= 0.01, f"최대 차이 {sum_err:.4f}")
lit = [(k, r, c) for k in range(nt) for r in range(nr) for c in range(nc) if (ts["direct_ppfd"][k][r][c] or 0) > 0]
k, r, c = lit[len(lit) // 2]
row_t = solar.iloc[k]
expect_direct = round(row_t["dni"] * math.sin(math.radians(row_t["elevation_deg"])) * K_PPFD, 1)
check("직사 PPFD = DNI x sin(고도) x 2.04 (해가 드는 칸·시점)", ts["direct_ppfd"][k][r][c] == expect_direct,
      f"{ts['times'][k]} 칸({r},{c}) = {ts['direct_ppfd'][k][r][c]}, 계산 {expect_direct}")
pick = compute_room_dli(dict(base, timeseries=True, cells=[[24, 10], [0, 0], [99, 99]]))
got = {(s["row"], s["col"]) for s in pick.get("cell_series", [])}
check("cells 지정하면 그 칸만 cell_series로", got == {(24, 10), (0, 0)} and "direct_ppfd" not in pick, f"{sorted(got)}")
s2410 = next(s for s in pick["cell_series"] if (s["row"], s["col"]) == (24, 10))
check("cell_series 값 == 전체 출력의 같은 칸 값", s2410["direct_ppfd"] == [ts["direct_ppfd"][k][24][10] for k in range(nt)]
      and s2410["diffuse_ppfd"] == [ts["diffuse_ppfd"][k][24][10] for k in range(nt)])
check("격자 밖 칸은 건너뛰고 경고", any("[99, 99]" in w for w in pick["warnings"]))
check("cells 지정해도 DLI는 방 전체", pick["total_dli"] == plain["total_dli"])
size_all = len(_json.dumps(ts)) / 1024
size_pick = len(_json.dumps(pick)) / 1024
print(f"  (JSON 크기: 기본 {len(_json.dumps(plain)) / 1024:.0f}KB, 전체 칸 시점별 {size_all:.0f}KB, 2칸만 {size_pick:.0f}KB / {nr}x{nc} 격자, {nt}시점)")

print(f"\n결과: 실패 {failures}건")
sys.exit(1 if failures else 0)
