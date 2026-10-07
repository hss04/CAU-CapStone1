"""b. 태양 위치 계산 (NREL SPA, pvlib) + DNI/DHI (프론트에서 받은 일사량, 없으면 맑은 하늘 모델로 대체).

DNI/DHI는 실제 서비스에서는 프론트(앱)가 외부 일사 데이터 API에서 받아 백엔드로 넘겨주는 입력값이다
(캡스톤_DLI_algorithm_1차_고도화_업데이트_v2.pdf 6.1장 참고). 백엔드는 더 이상 일사 데이터 API를 직접
호출하지 않고, 프론트가 보낸 값을 그대로 쓴다. 값이 없으면(Mock/테스트용) pvlib의 맑은 하늘 모델로 대체한다.
"""

import calendar
from datetime import date as Date
from datetime import timedelta

import pandas as pd
import pvlib

from models import Room

SOLAR_START = "08:00"
SOLAR_END = "18:00"
SOLAR_FREQ = "10min"


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


def compute_solar_times(
    room: Room, date: str, tz: str = "Asia/Seoul", dni_dhi: pd.DataFrame | None = None
) -> pd.DataFrame:
    """08~18시 10분 간격(최대 61시점) 태양 위치 + DNI/DHI. 고도각 0도 이하 시점은 제외.

    dni_dhi: 프론트에서 받은 그 날짜의 시간별(1시간 간격) 일사량. "dni"/"dhi" 컬럼(W/m^2), tz-aware
    DatetimeIndex. None이면(Mock/테스트용) "구름 한 점 없는 맑은 날" 가정인 pvlib 맑은 하늘 모델로 대체.
    """
    # tz를 날짜 문자열에 바로 안 붙이고 pd.date_range(tz=...)로 넘기는 이유:
    # "2026-10-05 08:00"처럼 오프셋 없는 문자열은 pandas가 그냥 naive 시각으로 읽는데,
    # tz 인자를 따로 주면 그 타임존 기준으로 해석해줘서 서머타임 등 엣지케이스에서도 안전함
    times = pd.date_range(
        start=f"{date} {SOLAR_START}",
        end=f"{date} {SOLAR_END}",
        freq=SOLAR_FREQ,
        tz=tz,
    )

    # 태양의 방위각/고도각(기하학적 위치) 계산 - NREL SPA, CLAUDE.md 8장 규격
    solpos = pvlib.solarposition.get_solarposition(
        times, room.latitude, room.longitude, method="nrel_numpy"
    )

    if dni_dhi is not None:
        # 프론트 데이터는 1시간 간격이라, 10분 간격 시점에 맞춰 시간 기준 선형보간
        combined_index = dni_dhi.index.union(times)
        radiation = dni_dhi.reindex(combined_index).interpolate(method="time").reindex(times)
        dni, dhi = radiation["dni"], radiation["dhi"]
    else:
        # 프론트에서 일사량을 안 받은 경우(Mock/테스트) 대체: 맑은 하늘 가정 이론값
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
