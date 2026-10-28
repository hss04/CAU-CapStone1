"""방 평면도(다각형) 기하 계산 + 방 방향(x_axis_azimuth_deg) 계산.

- 벽 가림(③): ㄱ자처럼 오목한 방에서 "격자 칸 -> 창문" 사이를 다른 벽이 막는지 평면도(x, z)에서 검사
- 방 방향(④): 창밖 스캔 때 잰 창문 정면 방위각으로 방 X축 방위각 계산
  백엔드 연결점: DIRECTION_CALLABLE=room_geometry:compute_room_direction

좌표: 방 좌표계 x, z (y는 높이라 평면도 계산에서는 안 씀). 벽은 바닥~천장까지 막혀 있다고 가정하므로,
3D 광선이 벽을 지나는지는 평면도에 투영한 선분이 벽 선분과 교차하는지로 판정하면 된다.
벽 i = corners[i] -> corners[(i+1) % n] (백엔드 wall_index와 같은 규칙, corners는 order_index 순).
"""

import math

Point2 = tuple[float, float]  # (x, z)
Wall = tuple[Point2, Point2]

EPS = 1e-9
DIRECTION_SPREAD_WARN_DEG = 15.0  # 창문별 방 방향 값이 이만큼 넘게 벌어지면 경고
WALL_VS_WINDOW_WARN_DEG = 20.0  # 벽 법선과 창문 꼭짓점 법선이 이만큼 다르면 경고


# ---------------------------------------------------------------------------
# 다각형 기본
# ---------------------------------------------------------------------------


def corners_to_points(corners: list[dict]) -> list[Point2]:
    """백엔드 corners([{order_index, x, z}]) -> order_index 순서의 (x, z) 목록."""
    ordered = sorted(corners, key=lambda c: c["order_index"])
    return [(float(c["x"]), float(c["z"])) for c in ordered]


def walls_from_points(points: list[Point2]) -> list[Wall]:
    n = len(points)
    return [(points[i], points[(i + 1) % n]) for i in range(n)]


def point_in_polygon(points: list[Point2], x: float, z: float) -> bool:
    """짝홀 규칙(ray casting). 경계 위 점은 어느 쪽이든 될 수 있으니 경계 판정이 중요하면 따로 처리할 것."""
    inside = False
    n = len(points)
    for i in range(n):
        (ax, az), (bx, bz) = points[i], points[(i + 1) % n]
        if (az > z) != (bz > z):
            x_cross = ax + (z - az) * (bx - ax) / (bz - az)
            if x < x_cross:
                inside = not inside
    return inside


def outward_wall_normal(points: list[Point2], wall_index: int) -> Point2:
    """벽 wall_index의 바깥 방향 단위 법선 (nx, nz).

    벽 방향 e=(ex, ez)에 수직인 두 후보 (ez, -ex), (-ez, ex) 중, 벽 가운데서 살짝 밀었을 때 방 "밖"이 되는
    쪽을 고른다. corners가 시계/반시계 어느 순서로 와도 맞게 동작한다(AR 앱은 순서 방향을 보장하지 않음).
    """
    (ax, az), (bx, bz) = points[wall_index], points[(wall_index + 1) % len(points)]
    ex, ez = bx - ax, bz - az
    length = math.hypot(ex, ez)
    if length < EPS:
        raise ValueError(f"Wall {wall_index} has zero length")
    nx, nz = ez / length, -ex / length
    mx, mz = (ax + bx) / 2, (az + bz) / 2
    probe = min(0.01, length * 0.1)
    if point_in_polygon(points, mx + nx * probe, mz + nz * probe):
        nx, nz = -nx, -nz
    return nx, nz


# ---------------------------------------------------------------------------
# 벽 가림 (③)
# ---------------------------------------------------------------------------


def _cross2(ox: float, oz: float, ax: float, az: float, bx: float, bz: float) -> float:
    return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox)


def segment_hits_wall(p: Point2, q: Point2, wall: Wall) -> bool:
    """선분 p->q가 벽 선분과 만나는지. p, q 끝점에서 "닿기만" 하는 건 제외.

    q는 창문 위의 점이라 창문 벽(과 그 양끝 모서리)에 닿아 있으니 끝점 접촉을 제외해야 한다.
    중간에서 벽 끝(모서리)을 정확히 스치는 경우는 막힌 것으로 본다(ㄱ자 안쪽 모서리를 스치는 광선).
    """
    (px, pz), (qx, qz) = p, q
    (ax, az), (bx, bz) = wall
    rx, rz = qx - px, qz - pz
    sx, sz = bx - ax, bz - az
    denom = rx * sz - rz * sx
    if abs(denom) < EPS:
        return False  # 평행(겹치는 경우 포함) - 벽을 따라 미끄러지는 광선은 막힘으로 안 봄
    t = ((ax - px) * sz - (az - pz) * sx) / denom  # p->q 위 위치 (0~1)
    u = ((ax - px) * rz - (az - pz) * rx) / denom  # 벽 위 위치 (0~1)
    t_eps = 1e-6
    return t_eps < t < 1 - t_eps and -t_eps <= u <= 1 + t_eps


def blocked_by_other_walls(p: Point2, q: Point2, walls: list[Wall], skip_wall_index: int | None) -> bool:
    """칸 p -> 창문 통과점 q 사이를 창문 벽(skip_wall_index)이 아닌 다른 벽이 막으면 True."""
    for i, wall in enumerate(walls):
        if i == skip_wall_index:
            continue
        if segment_hits_wall(p, q, wall):
            return True
    return False


# ---------------------------------------------------------------------------
# 방 방향 (④)
# ---------------------------------------------------------------------------


def normal_angle_deg(nx: float, nz: float) -> float:
    """방 좌표계에서 법선이 X축으로부터 몇 도 돌아가 있는지 (X축 0도, Z축 90도 방향으로 증가).

    d_light.sun_direction()과 같은 기준: 진북 방위각 A인 방향은 방 좌표계에서
    (cos(A - x_az), _, sin(A - x_az))이므로 θ = A - x_az, 즉 x_az = A - θ.
    """
    return math.degrees(math.atan2(nz, nx))


def window_outward_normal_xz(v0, v1, v3) -> Point2:
    """창문 꼭짓점으로 구한 바깥 법선의 수평 성분. n = (V3 - V0) x (V1 - V0) (CLAUDE.md 4장)."""
    ux, uy, uz = v3[0] - v0[0], v3[1] - v0[1], v3[2] - v0[2]
    wx, wy, wz = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
    nx = uy * wz - uz * wy
    nz = ux * wy - uy * wx
    length = math.hypot(nx, nz)
    if length < EPS:
        raise ValueError("Window normal is degenerate (not a vertical window?)")
    return nx / length, nz / length


def room_azimuth_from_window(window_azimuth_deg: float, normal_xz: Point2) -> float:
    """창문 정면(바깥) 진북 방위각 W와 방 좌표계 법선 -> 방 X축 방위각 = (W - θ) mod 360."""
    theta = normal_angle_deg(*normal_xz)
    return (window_azimuth_deg - theta) % 360.0


def angular_diff_deg(a: float, b: float) -> float:
    """두 각도 차이 (0~180)."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def circular_mean_deg(angles: list[float]) -> float:
    """각도 평균 (350도와 10도의 평균은 0도). 단위벡터 합의 방향."""
    s = sum(math.sin(math.radians(a)) for a in angles)
    c = sum(math.cos(math.radians(a)) for a in angles)
    if abs(s) < EPS and abs(c) < EPS:
        raise ValueError("Window directions cancel out; cannot average room direction")
    return math.degrees(math.atan2(s, c)) % 360.0


def compute_room_direction(payload: dict) -> dict:
    """백엔드 DIRECTION_CALLABLE 진입점.

    입력:
      corners: [{order_index, x, z}, ...]          방 바닥 모서리
      windows: [{wall_index, window_azimuth_deg,     창밖 스캔 때 잰 창문 정면(바깥) 진북 방위각
                 v0?, v1?, v3? ([x, y, z])}, ...]   있으면 벽 법선과 비교해 측정 오류 경고용으로 씀
    출력:
      {x_axis_azimuth_deg: 0 이상 360 미만 (소수 3자리),
       per_window: [{wall_index, window_azimuth_deg, x_axis_azimuth_deg}],
       spread_deg: 창문별 값과 평균의 최대 차이,
       warnings: [...]}
    방향은 벽 법선으로 계산한다(창문은 벽에 붙어 있으므로). 창문 꼭짓점은 검증에만 쓴다.
    """
    points = corners_to_points(payload["corners"])
    windows = payload["windows"]
    if not windows:
        raise ValueError("At least one window with window_azimuth_deg is required")

    warnings: list[str] = []
    per_window = []
    for w in windows:
        wall_index = int(w["wall_index"])
        if not 0 <= wall_index < len(points):
            raise ValueError(f"wall_index {wall_index} out of range")
        normal = outward_wall_normal(points, wall_index)
        value = room_azimuth_from_window(float(w["window_azimuth_deg"]), normal)
        per_window.append(
            {"wall_index": wall_index, "window_azimuth_deg": float(w["window_azimuth_deg"]), "x_axis_azimuth_deg": round(value, 3)}
        )

        if all(k in w and w[k] is not None for k in ("v0", "v1", "v3")):
            win_normal = window_outward_normal_xz(w["v0"], w["v1"], w["v3"])
            gap = angular_diff_deg(normal_angle_deg(*normal), normal_angle_deg(*win_normal))
            if gap > WALL_VS_WINDOW_WARN_DEG:
                warnings.append(
                    f"wall {wall_index}: window corner normal differs from wall normal by {gap:.1f} deg "
                    "(check window corner order or wall_index)"
                )

    mean = circular_mean_deg([p["x_axis_azimuth_deg"] for p in per_window])
    spread = max(angular_diff_deg(p["x_axis_azimuth_deg"], mean) for p in per_window)
    if spread > DIRECTION_SPREAD_WARN_DEG:
        warnings.append(
            f"Window directions disagree by up to {spread:.1f} deg from the mean; "
            "compass reading may be disturbed - consider rescanning"
        )

    result_deg = round(mean, 3) % 360.0  # round 결과가 360.0이 되는 경우 0.0으로
    return {
        "x_axis_azimuth_deg": result_deg,
        "per_window": per_window,
        "spread_deg": round(spread, 3),
        "warnings": warnings,
    }
