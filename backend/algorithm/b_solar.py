"""b. 태양 위치 계산 (NREL SPA, pvlib) + DNI/DHI (백엔드가 넘겨준 일사량, 없으면 맑은 하늘 모델로 대체).

DNI/DHI는 백엔드가 Open-Meteo를 직접 조회·캐시해서 알고리즘 쪽에 함수 호출로 넘겨주는 값이다.
값이 없으면(Mock/테스트용) pvlib의 맑은 하늘 모델로 대체한다.

계산 시점 (10/8 팀 결정, 08~18시 -> 하루 전체):
- 하루를 10분 구간 144개로 나누고, 각 구간의 "가운데 시각"(00:05, 00:15, ..., 23:55)에서 태양 위치를 계산한다.
  구간 [00:00, 00:10)을 대표하는 값은 00:05에서 잰다는 뜻. 고도각 0도 이하 시점은 제외한다.
- 가운데 시각을 쓰는 이유: 아래 계단식 일사량과 합칠 때 10분 구간이 어느 1시간에 속하는지 애매하지 않고,
  구간 시작 시각으로 재는 것보다 그 10분 동안의 태양 위치를 더 잘 대표한다.

일사량 시간 기준 (백엔드 WEATHER_API.md 계약):
- PRECEDING_HOUR_MEAN(기본): "H시 값 = (H-1시, H시] 1시간 평균". 그 1시간 안의 10분 구간 6개에 같은 값을
  그대로 쓴다(계단식). 이렇게 하면 6개 구간을 합쳤을 때 원래 1시간 평균 에너지가 그대로 보존된다.
  예) 13:05, 13:15, ..., 13:55 구간은 모두 14:00 값을 쓴다.
- INSTANTANEOUS: 시각별 순간값으로 보고 시간 기준 선형보간 (예전 방식, 테스트/비교용으로 남겨둠).
"""

import calendar
from datetime import date as Date
from datetime import timedelta

import pandas as pd
import pvlib

try:  # 패키지/평면 import 둘 다 지원 - __init__.py 참고
    from .models import Room
except ImportError:
    from models import Room

SAMPLES_PER_DAY = 144  # 10분 구간 개수 (24시간 x 6)
SOLAR_FREQ = "10min"
SAMPLE_OFFSET = "5min"  # 구간 시작 -> 구간 가운데까지

TIME_BASIS_PRECEDING_HOUR_MEAN = "PRECEDING_HOUR_MEAN"
TIME_BASIS_INSTANTANEOUS = "INSTANTANEOUS"


SEASON_MONTHS = {"봄": (3, 4, 5), "여름": (6, 7, 8), "가을": (9, 10, 11), "겨울": (12, 1, 2)}


def season_sample_dates(reference_date: str, samples: int = 6) -> tuple[str, list[str]]:
    """기준 날짜가 속한 계절 이름 + 그 계절(작년 치, 확실히 지나간 과거)의 대표 날짜 N개.

    작년 걸 쓰는 이유: "이번 계절"은 아직 다 안 지나서 뒷부분 날짜의 일사량(DNI/DHI) 실측값이
    존재하지 않음. 1년 전 같은 계절은 완전히 지나간 과거라 "이맘때 평소 패턴"을 대표하는 용도로 쓸
    실측 데이터가 확실히 존재함.
    **[TODO]** 프론트가 이 작년 날짜들의 DNI/DHI를 실제로 보내줄 수 있는지는 미확인 — README 참고.
    """
    ref = Date.fromisoformat(reference_date)
    for name, months in SEASON_MONTHS.items():
        if ref.month in months:
            season_name = name
            season_months = months
            break

    # 그 계절이 걸쳐있는 (연도, 월) 목록. 겨울(12,1,2)만 해를 넘김
    first_month = season_months[0]
    year_of_first_month = ref.year if ref.month >= first_month else ref.year - 1
    year_of_first_month -= 1  # 항상 작년 인스턴스로 (확실히 과거)

    start = Date(year_of_first_month, first_month, 1)
    last_month_year = year_of_first_month if season_months[-1] >= first_month else year_of_first_month + 1
    last_day = calendar.monthrange(last_month_year, season_months[-1])[1]
    end = Date(last_month_year, season_months[-1], last_day)

    total_days = (end - start).days
    step = max(total_days // max(samples - 1, 1), 1)
    seen: set[str] = set()
    dates: list[str] = []
    for i in range(samples):
        d = (start + timedelta(days=min(i * step, total_days))).isoformat()
        if d not in seen:
            seen.add(d)
            dates.append(d)
    return season_name, dates


def _step_hourly_mean(dni_dhi: pd.DataFrame, times: pd.DatetimeIndex) -> pd.DataFrame:
    """PRECEDING_HOUR_MEAN 값을 10분 구간에 계단식으로 배정.

    구간 가운데 시각 t가 속한 1시간은 (floor(t), floor(t)+1h]이고, 그 평균값의 라벨은 floor(t)+1h다.
    라벨로 정확히 찾기만 하므로 dni_dhi에 여러 날짜가 섞여 있어도 그 날짜 값만 골라진다(⑦ 버그 해결).
    """
    labels = times.floor("h") + pd.Timedelta(hours=1)
    picked = dni_dhi.reindex(labels)
    picked.index = times
    return picked


def _linear_instantaneous(dni_dhi: pd.DataFrame, times: pd.DatetimeIndex) -> pd.DataFrame:
    """INSTANTANEOUS(순간값) 선형보간. 대상 날짜 앞뒤 1시간 범위만 써서, 다른 날짜 값이 섞이지 않게 한다.

    (예전에는 여러 날짜를 계산할 때 같은 dni_dhi를 통째로 보간해서, 범위 밖 날짜는 NaN이나 마지막 값이
    그대로 이어지는 문제가 있었다 - ⑦)
    """
    lo = times[0] - pd.Timedelta(hours=1)
    hi = times[-1] + pd.Timedelta(hours=1)
    near = dni_dhi[(dni_dhi.index >= lo) & (dni_dhi.index <= hi)]
    combined_index = near.index.union(times)
    return near.reindex(combined_index).interpolate(method="time", limit_area="inside").reindex(times)


def compute_solar_times(
    room: Room,
    date: str,
    tz: str = "Asia/Seoul",
    dni_dhi: pd.DataFrame | None = None,
    time_basis: str = TIME_BASIS_PRECEDING_HOUR_MEAN,
) -> pd.DataFrame:
    """하루 전체 10분 구간(144개, 구간 가운데 시각) 태양 위치 + DNI/DHI. 고도각 0도 이하 시점은 제외.

    dni_dhi: 시간별(1시간 간격) 일사량. "dni"/"dhi" 컬럼(W/m^2), tz-aware DatetimeIndex.
             여러 날짜가 섞여 있어도 됨(그 날짜에 필요한 시각만 골라 씀).
             None이면(Mock/테스트용) "구름 한 점 없는 맑은 날" 가정인 pvlib 맑은 하늘 모델로 대체.
    time_basis: dni_dhi 값의 시간 의미. 모듈 docstring 참고.

    해가 떠 있는 시점에 일사량 값이 없으면 ValueError (조용히 0이나 엉뚱한 값을 쓰지 않음).
    """
    # tz를 날짜 문자열에 바로 안 붙이고 pd.date_range(tz=...)로 넘기는 이유:
    # "2026-10-05 00:05"처럼 오프셋 없는 문자열은 pandas가 그냥 naive 시각으로 읽는데,
    # tz 인자를 따로 주면 그 타임존 기준으로 해석해줘서 서머타임 등 엣지케이스에서도 안전함
    times = pd.date_range(
        start=pd.Timestamp(f"{date} 00:00") + pd.Timedelta(SAMPLE_OFFSET),
        periods=SAMPLES_PER_DAY,
        freq=SOLAR_FREQ,
        tz=tz,
    )

    # 태양의 방위각/고도각(기하학적 위치) 계산 - NREL SPA, CLAUDE.md 8장 규격
    solpos = pvlib.solarposition.get_solarposition(
        times, room.latitude, room.longitude, method="nrel_numpy"
    )

    if dni_dhi is not None:
        source = dni_dhi.sort_index()
        source.index = source.index.tz_convert(tz)
        if time_basis == TIME_BASIS_PRECEDING_HOUR_MEAN:
            radiation = _step_hourly_mean(source, times)
        elif time_basis == TIME_BASIS_INSTANTANEOUS:
            radiation = _linear_instantaneous(source, times)
        else:
            raise ValueError(f"Unknown time_basis: {time_basis}")
        dni, dhi = radiation["dni"], radiation["dhi"]

        sun_up = solpos["apparent_elevation"] > 0
        missing = times[sun_up & (dni.isna() | dhi.isna())]
        if len(missing) > 0:
            raise ValueError(
                f"Irradiance missing for {date} at {len(missing)} sun-up samples "
                f"(first: {missing[0].isoformat()}); need hourly values covering the whole day"
            )
    else:
        # 일사량을 안 받은 경우(Mock/테스트) 대체: 맑은 하늘 가정 이론값
        # (태양 고도각과 Linke turbidity 기후 통계값만 쓰고 그날 실제 날씨는 반영 못 함)
        location = pvlib.location.Location(room.latitude, room.longitude, tz=tz)
        clearsky = location.get_clearsky(times, model="ineichen")
        dni, dhi = clearsky["dni"], clearsky["dhi"]

    df = pd.DataFrame(
        {
            "azimuth_deg": solpos["azimuth"],
            "elevation_deg": solpos["apparent_elevation"],  # 대기굴절 보정된 고도각
            "dni": dni,  # W/m^2, 태양 광선에 수직인 면 기준
            "dhi": dhi,  # W/m^2, 수평면 기준 산란광
        }
    )
    # 고도각<=0(해 뜨기 전/진 후)은 광량 계산에 의미 없는 시점이라 제외 (CLAUDE.md 8장)
    return df[df["elevation_deg"] > 0].copy()
