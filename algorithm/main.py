"""1차 구현 End-to-End 실행 (Mock Room/Window/스캔). a -> b -> c -> d -> e -> f 순서로 실행한다.

d는 하루치가 아니라 "오늘이 속한 계절의 작년 대표일 여러 개"를 각각 계산해서 평균낸다 (알고리즘 PDF
9.4장: 추천은 하루치가 아니라 월/계절 평균 DLI를 써야 날씨 때문에 추천이 매일 들쭉날쭉하지 않음).
"""

import datetime

from a_grid import generate_grid_fixed_size
from b_solar import compute_solar_times, season_sample_dates
from c_sky import generate_mock_scan, resolve_unscanned
from d_light import average_light_results, build_vwindow_cache, compute_light_result
from e_diagnosis import diagnose_all
from f_recommendation import recommend_all, recommend_top_k_combinations
from models import build_mock_plants, build_mock_room, build_mock_species, build_mock_window

SEASON_SAMPLES = 6  # 계절 하나를 대표하는 날짜 몇 개로 평균낼지
ROOM_ID = 1
BLOCKED_CELLS = [(0, 0), (0, 1), (1, 0)]  # 가구 등 Mock 불가 칸 예시 (실제로는 프론트가 전달)


def main() -> None:
    room = build_mock_room()
    window = build_mock_window()
    species = build_mock_species()
    plants = build_mock_plants(species)

    # a. 실내 2D 격자 생성 (칸 크기 20cm x 20cm 고정, 칸 개수는 방 크기에 맞춰 계산)
    grid, rows, cols = generate_grid_fixed_size(room)
    print(f"[a] 격자 생성: {rows}x{cols} (칸 크기 0.200m x 0.200m 고정)")

    # c. 창밖 SKY/NON-SKY (Mock 스캔: 이미지는 이미 분류되어 들어왔다고 가정) - 날짜와 무관하므로 1회만
    window_outward_azimuth = room.z_axis_azimuth_deg
    scan = generate_mock_scan(
        window_outward_azimuth,
        obstructions=[(window_outward_azimuth - 30, window_outward_azimuth - 10, 20)],  # mock 건물
    )
    resolved_sky = resolve_unscanned(scan)
    print(f"[c] 창문 바깥 방향 방위각: {window_outward_azimuth:.1f}도, 스캔 마스크 해상 완료")

    # b + d. 오늘이 속한 계절의 작년 대표일 여러 개 각각 태양 위치+DNI/DHI -> DLI 계산 후 평균
    today = datetime.date.today().isoformat()
    season_name, sample_dates = season_sample_dates(today, samples=SEASON_SAMPLES)
    print(f"[b] 오늘({today}) 기준 계절: {season_name}, 대표일 {len(sample_dates)}개: {sample_dates}")

    vwindow_cache = build_vwindow_cache(grid, window, room.x_axis_azimuth_deg)
    daily_results = []
    for d in sample_dates:
        solar_df = compute_solar_times(room, d)
        daily_results.append(
            compute_light_result(
                room_id=ROOM_ID,
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
    light_result = average_light_results(
        daily_results, label=f"{season_name} 평균 ({sample_dates[0]}~{sample_dates[-1]}, {len(sample_dates)}일)"
    )
    print(f"[d] DLI 격자 계산 완료 ({light_result['date']})")

    # e. 진단 (현재 위치의 OK/LOW/HIGH)
    diagnoses = diagnose_all(plants, light_result)
    print("[e] 진단 결과:")
    for d in diagnoses:
        print(f"  plant {d.plant_id} ({d.row},{d.col}) total_dli={d.total_dli} -> {d.status}")

    # f. 추천 (중복 없는 최적 위치, 가구 등 불가 칸 제외)
    recommendations = recommend_all(plants, diagnoses, light_result, blocked_cells=BLOCKED_CELLS)
    print("[f] 추천 결과:")
    for plant, rec in zip(plants, recommendations):
        current = rec["current"]
        req = rec["required_dli"]
        line = (
            f"  {plant.species.name_ko} (id={plant.plant_id}, 적정 DLI {req['min']}~{req['max']}): "
            f"({current['row']},{current['col']}) DLI={current['total_dli']} -> {current['status']}"
        )
        if rec["recommended"] is None:
            line += ", 추천: 없음(현재 자리 유지)"
        else:
            r = rec["recommended"]
            line += f", 추천: ({r['row']},{r['col']}) DLI={r['total_dli']} (score {r['score']})"
        print(line)

    # f-2. 여러 조합 비교 (식물1은 A자리, 식물2는 B자리... 세트 단위로 상위 몇 개)
    plant_by_id = {p.plant_id: p for p in plants}
    combos = recommend_top_k_combinations(plants, diagnoses, light_result, k=3, blocked_cells=BLOCKED_CELLS)
    print("[f-2] 조합별 추천 (상위 3개):")
    if not combos:
        print("  추천이 필요한 식물 없음 (전부 OK)")
    for i, combo in enumerate(combos, start=1):
        print(f"  조합 {i} (총점 {combo['total_score']}):")
        for p in combo["placements"]:
            name = plant_by_id[p["plant_id"]].species.name_ko
            print(f"    {name}: ({p['row']},{p['col']}) DLI={p['total_dli']} (score {p['score']})")


if __name__ == "__main__":
    main()
