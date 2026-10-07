"""Room/Window/Plant 데이터 모델 + Mock 데이터 (CLAUDE.md 규격 기준)."""

from dataclasses import dataclass, field


@dataclass
class RoomCorner:
    order_index: int
    x: float  # m
    z: float  # m


@dataclass
class Room:
    corners: list[RoomCorner]  # 바닥 모서리 4개, 시계방향(위에서 볼 때), order_index 0~3
    height_m: float
    x_axis_azimuth_deg: float  # X축(0->1번 모서리)이 가리키는 방위각 (진북 기준)
    latitude: float
    longitude: float

    @property
    def width_m(self) -> float:
        """X축 방향 길이 (0->1번 모서리)."""
        c0, c1 = self.corners[0], self.corners[1]
        return ((c1.x - c0.x) ** 2 + (c1.z - c0.z) ** 2) ** 0.5

    @property
    def depth_m(self) -> float:
        """Z축 방향 길이 (0->3번 모서리)."""
        c0, c3 = self.corners[0], self.corners[3]
        return ((c3.x - c0.x) ** 2 + (c3.z - c0.z) ** 2) ** 0.5

    @property
    def z_axis_azimuth_deg(self) -> float:
        return (self.x_axis_azimuth_deg + 90.0) % 360.0


@dataclass
class Window:
    # 방 안에서 창문을 바라봤을 때: 0 좌하, 1 우하, 2 우상, 3 좌상. 좌표는 방 좌표계 (x, y, z)
    v0: tuple[float, float, float]
    v1: tuple[float, float, float]
    v2: tuple[float, float, float]
    v3: tuple[float, float, float]


@dataclass
class PlantSpecies:
    species_id: int
    name_ko: str
    name_en: str
    scientific_name: str
    min_dli: float
    max_dli: float
    source: str = "Plant Light Database"


@dataclass
class Plant:
    plant_id: int
    species: PlantSpecies
    row: int
    col: int


def build_mock_room() -> Room:
    """X축 진북(0도) 기준, 4m(X) x 5m(Z) x 2.5m(H) 직사각형 방."""
    corners = [
        RoomCorner(0, 0.0, 0.0),
        RoomCorner(1, 4.0, 0.0),
        RoomCorner(2, 4.0, 5.0),
        RoomCorner(3, 0.0, 5.0),
    ]
    return Room(
        corners=corners,
        height_m=2.5,
        x_axis_azimuth_deg=0.0,  # Z축 방위각 = 90 (동쪽을 향함)
        latitude=37.5665,
        longitude=126.9780,
    )


def build_mock_window() -> Window:
    """Z=5.0 벽(방 바깥 방향 = +Z = 동쪽)에 있는 창문. 바깥 방향 법선이 +Z가 되도록 꼭짓점 순서를 둔다."""
    z = 5.0
    y0, y1 = 1.0, 2.2
    x_left, x_right = 3.0, 1.0  # 방 안에서 +Z를 바라볼 때 좌(큰 x) -> 우(작은 x)
    return Window(
        v0=(x_left, y0, z),
        v1=(x_right, y0, z),
        v2=(x_right, y1, z),
        v3=(x_left, y1, z),
    )


def build_mock_species() -> list[PlantSpecies]:
    # min/max는 Mock 방(작은 방 + 동향 창 하나)에서 나오는 DLI 범위(약 0~5 mol/m2/day)에 맞춰
    # OK/LOW/HIGH가 모두 나오도록 조정한 데모용 값이다. 실제 서비스에서는 Plant Light Database 값을 사용한다.
    return [
        PlantSpecies(1, "산세베리아", "Snake Plant", "Dracaena trifasciata", 0.05, 0.3),
        PlantSpecies(2, "몬스테라", "Monstera", "Monstera deliciosa", 2.0, 4.0),
        PlantSpecies(3, "다육식물", "Succulent", "Echeveria sp.", 0.01, 0.05),
    ]


def build_mock_plants(species: list[PlantSpecies]) -> list[Plant]:
    # row는 Z방향 인덱스. 창문이 Z=5 벽에 있으므로 row가 클수록 창문에 가깝다.
    return [
        Plant(plant_id=1, species=species[0], row=2, col=10),   # 창문에서 먼 자리 -> OK 예상
        Plant(plant_id=2, species=species[1], row=10, col=10),  # 중간 거리 -> LOW 예상
        Plant(plant_id=3, species=species[2], row=18, col=10),  # 창문 바로 앞 -> HIGH 예상
    ]
