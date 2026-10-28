"""롤(roll) 부호 검증 도구.

같은 건물(랜드마크)을 ① 수평에 가깝게 찍은 사진 1장, ② 일부러 기울여서 찍은 사진 1장,
이렇게 두 번 찍어서 각 사진에서 그 건물이 있는 픽셀 좌표를 알아낸 뒤 아래 OBSERVATIONS 값을
실제 값으로 바꿔서 실행하면 된다.

원리: 같은 건물은 실제로 안 움직였으니, 두 사진에서 계산한 방위각/고도각이 거의 같게 나와야 정상이다.
pixel_to_azimuth_elevation()의 롤 부호가 틀렸다면, 기울인 사진 쪽 결과가 "기울인 각도의 약 2배"만큼
어긋나게 나온다 (c_sky.py 주석 참고).

필요한 값:
- 각 사진의 camera.hfov_deg / vfov_deg / width / height (스캔 업로드 JSON과 동일, CLAUDE.md 6장)
- 각 사진 촬영 당시 azimuth_deg(진북 기준) / pitch_deg / roll_deg
- 두 사진에서 같은 건물의 같은 지점을 가리키는 픽셀 좌표 (x, y) — 이미지 뷰어로 눈대중 확인하면 됨

사용법:
    python verify_roll_sign.py
"""

from dataclasses import dataclass

from c_sky import CameraParams, pixel_to_azimuth_elevation


@dataclass
class Observation:
    label: str
    image_width: int
    image_height: int
    hfov_deg: float
    vfov_deg: float
    azimuth_deg: float  # 촬영 당시 진북 기준 방위각
    pitch_deg: float
    roll_deg: float
    landmark_px: tuple[float, float]  # 같은 건물 지점의 (x, y) 픽셀 좌표


def _compute(obs: Observation) -> tuple[float, float]:
    camera = CameraParams(obs.hfov_deg, obs.vfov_deg, obs.image_width, obs.image_height)
    px, py = obs.landmark_px
    az, el = pixel_to_azimuth_elevation(px, py, camera, obs.azimuth_deg, obs.pitch_deg, obs.roll_deg)
    return float(az), float(el)


def check(level_obs: Observation, tilted_obs: Observation) -> None:
    az_l, el_l = _compute(level_obs)
    az_t, el_t = _compute(tilted_obs)

    print(f"[{level_obs.label}] roll={level_obs.roll_deg:+.1f}도 -> 방위각={az_l:.2f}도, 고도각={el_l:.2f}도")
    print(f"[{tilted_obs.label}] roll={tilted_obs.roll_deg:+.1f}도 -> 방위각={az_t:.2f}도, 고도각={el_t:.2f}도")

    az_diff = ((az_t - az_l + 180) % 360) - 180  # -180~180으로 정규화
    el_diff = el_t - el_l
    roll_delta = tilted_obs.roll_deg - level_obs.roll_deg

    print()
    print(f"방위각 차이: {az_diff:+.2f}도, 고도각 차이: {el_diff:+.2f}도 (기울인 각도 차: {roll_delta:+.1f}도)")

    total_diff = (az_diff ** 2 + el_diff ** 2) ** 0.5
    if total_diff < 3:
        print("-> 거의 일치함: 롤 부호가 맞는 것으로 보임")
    elif abs(total_diff - 2 * abs(roll_delta)) < 5:
        print("-> 기울인 각도의 약 2배만큼 어긋남: 롤 부호가 반대일 가능성 높음")
        print("   (c_sky.py의 pixel_to_azimuth_elevation()에서 rho 부호를 반대로 바꿔볼 것)")
    else:
        print("-> 패턴이 명확하지 않음: 랜드마크 픽셀 좌표나 각도 값을 다시 확인해볼 것")


if __name__ == "__main__":
    # 아래 두 값을 실제 촬영한 사진 정보로 바꿔서 실행하세요.
    level_obs = Observation(
        label="수평(roll≈0)",
        image_width=960, image_height=1280,
        hfov_deg=55.0, vfov_deg=70.0,
        azimuth_deg=90.0, pitch_deg=10.0, roll_deg=0.0,
        landmark_px=(480.0, 300.0),
    )
    tilted_obs = Observation(
        label="기울임",
        image_width=960, image_height=1280,
        hfov_deg=55.0, vfov_deg=70.0,
        azimuth_deg=90.0, pitch_deg=10.0, roll_deg=20.0,
        landmark_px=(600.0, 250.0),
    )
    check(level_obs, tilted_obs)
