"""초록자리 광량 계산 알고리즘 패키지.

두 가지 방식으로 불러올 수 있다.
- 패키지:  from algorithm.grid_dli_service import compute_room_dli
- 평면:    sys.path에 이 폴더를 넣고 from grid_dli_service import compute_room_dli
           (백엔드 algorithm_worker.py가 subprocess에서 쓰는 방식)

그래서 각 모듈은 `try: from .x import y / except ImportError: from x import y` 형태로 import한다.

백엔드 연결점(환경변수 module:function 값):
- DLI_CALLABLE=grid_dli_service:compute_room_dli
- DIRECTION_CALLABLE=room_geometry:compute_room_direction
- RECOMMENDATION_CALLABLE=recommend_service:recommend_for_room
"""
