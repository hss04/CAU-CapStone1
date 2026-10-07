"""Meter-based geometry. Room polygons use x/z exclusively; room y is fixed to zero."""
from math import ceil, sqrt
from decimal import Decimal, ROUND_HALF_UP


EPS = 1e-8


def cross2(a, b, c):
    return (b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x)


def on_segment(a, b, x, z):
    return (abs((b.x-a.x)*(z-a.z)-(b.z-a.z)*(x-a.x)) <= EPS
            and min(a.x,b.x)-EPS <= x <= max(a.x,b.x)+EPS
            and min(a.z,b.z)-EPS <= z <= max(a.z,b.z)+EPS)


def segments_intersect(a, b, c, d):
    c1,c2,c3,c4 = cross2(a,b,c),cross2(a,b,d),cross2(c,d,a),cross2(c,d,b)
    if c1*c2 < -EPS and c3*c4 < -EPS:
        return True
    return ((abs(c1) <= EPS and on_segment(a,b,c.x,c.z))
            or (abs(c2) <= EPS and on_segment(a,b,d.x,d.z))
            or (abs(c3) <= EPS and on_segment(c,d,a.x,a.z))
            or (abs(c4) <= EPS and on_segment(c,d,b.x,b.z)))


def ordered(corners):
    result = sorted(corners, key=lambda c: c.order_index)
    if [c.order_index for c in result] != list(range(len(result))):
        raise ValueError('order_index must be unique and consecutive from 0')
    return result


def floor_area(corners):
    return abs(sum(a.x*b.z-b.x*a.z for a,b in zip(corners, corners[1:]+corners[:1]))) / 2


def validate_room(corners):
    corners = ordered(corners)
    n = len(corners)
    for i,a in enumerate(corners):
        for b in corners[i+1:]:
            if (a.x-b.x)**2+(a.z-b.z)**2 < 0.05**2:
                raise ValueError('Room corners must be at least 0.05 m apart')
    for i in range(n):
        if abs(cross2(corners[i],corners[(i+1)%n],corners[(i+2)%n])) < EPS:
            raise ValueError('Consecutive room corners must not be collinear')
        for j in range(i+1,n):
            if j == i+1 or (i == 0 and j == n-1):
                continue
            if segments_intersect(corners[i],corners[(i+1)%n],corners[j],corners[(j+1)%n]):
                raise ValueError('Room polygon must not self-intersect')
    if floor_area(corners) < 0.01:
        raise ValueError('Room floor area must be at least 0.01 m²')
    return corners


def contains(corners, x, z):
    inside = False
    for a,b in zip(corners, corners[1:]+corners[:1]):
        if on_segment(a,b,x,z):
            return True
        if (a.z > z) != (b.z > z):
            if x < (b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x:
                inside = not inside
    return inside


def sub(a,b):
    return (a.x-b.x,a.y-b.y,a.z-b.z)


def cross(a,b):
    return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])


def dot(a,b):
    return sum(x*y for x,y in zip(a,b))


def norm(a):
    return sqrt(dot(a,a))


def validate_window(corners, room_corners):
    c = ordered(corners)
    if any(p.y < 0 for p in c):
        raise ValueError('Window heights must be non-negative')
    normal = cross(sub(c[1],c[0]),sub(c[2],c[0]))
    length = norm(normal)
    if length <= 1e-5:
        raise ValueError('Window corners must form a non-degenerate quadrilateral')
    if abs(dot(sub(c[3],c[0]),normal))/length > 0.03:
        raise ValueError('Window corners must be coplanar within 3 cm')
    # Convexity also rejects crossed corners and duplicate/zero-length edges.
    for i in range(4):
        turn = cross(sub(c[(i+1)%4],c[i]),sub(c[(i+2)%4],c[(i+1)%4]))
        if dot(turn,normal) <= EPS:
            raise ValueError('Window corners must be consecutive around a convex quadrilateral')
    if max(c[0].y,c[1].y) >= min(c[2].y,c[3].y):
        raise ValueError('Window order: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left')
    # MVP uses vertical windows; top/bottom pairs share the same x/z within tolerance.
    if any((a.x-b.x)**2+(a.z-b.z)**2 > 0.05**2 for a,b in [(c[0],c[3]),(c[1],c[2])]):
        raise ValueError('MVP supports vertical windows (top/bottom x/z within 5 cm)')
    # One polygon wall must contain both bottom corners, within AR measurement tolerance.
    def near_edge(p,a,b):
        dx,dz=b.x-a.x,b.z-a.z
        t=((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)
        t_clamped=max(0,min(1,t))
        return sqrt((p.x-a.x-t_clamped*dx)**2+(p.z-a.z-t_clamped*dz)**2) <= 0.05
    if not any(all(near_edge(p,a,b) for p in c) for a,b in zip(room_corners,room_corners[1:]+room_corners[:1])):
        raise ValueError('All window corners must lie on one room wall within 5 cm')
    # Interior viewpoint fixes left/right winding: normal must point into the room.
    midpoint_x=sum(p.x for p in c)/4
    midpoint_z=sum(p.z for p in c)/4
    if not contains(room_corners,midpoint_x+normal[0]/length*0.1,midpoint_z+normal[2]/length*0.1):
        raise ValueError('Left/right must be ordered as viewed from inside the room')
    return c


def grid(room, cell_size_m, sample_height_m):
    cell_size_m=float(Decimal(str(cell_size_m)).quantize(Decimal('0.001'),rounding=ROUND_HALF_UP))
    sample_height_m=float(Decimal(str(sample_height_m)).quantize(Decimal('0.001'),rounding=ROUND_HALF_UP))
    corners = room.corners
    ox,oz = min(c.x for c in corners),min(c.z for c in corners)
    nx = ceil((max(c.x for c in corners)-ox)/cell_size_m)
    nz = ceil((max(c.z for c in corners)-oz)/cell_size_m)
    if nx*nz > 40000:
        raise ValueError('Grid exceeds 40,000 cells; increase cell_size_m')
    mask = [[contains(corners,ox+(col+0.5)*cell_size_m,oz+(row+0.5)*cell_size_m)
             for col in range(nx)] for row in range(nz)]
    return {'schema_version':'grid_v2','room_id':room.id,'geometry_version':room.geometry_version,
            'coordinate_system':room.coordinate_frame,'unit':'m','origin':{'x':ox,'y':0,'z':oz},
            'cell_size_m':cell_size_m,'sample_height_m':sample_height_m,'rows':nz,'cols':nx,
            'array_order':'[row_z][col_x]','inside_mask':mask}


def perimeter(corners):
    return sum(norm(sub(a,b)) for a,b in zip(corners,corners[1:]+corners[:1]))


def validate_measurement(body):
    """Validate the Android v3 export against the measured wall and derived sizes.

    Rounded summaries may differ by millimetres from already rounded points.
    """
    room = ordered(body.corners)
    if [c.order_index for c in body.corners] != list(range(len(room))):
        raise ValueError('Android export corners must be stored in order_index order')
    def close(actual, expected, label, tolerance=0.003):
        if abs(actual-expected) > tolerance:
            raise ValueError(f'{label} conflicts with measured corners')
    close(body.area_square_meters, floor_area(room), 'area_square_meters', 0.001 + perimeter(room)*0.001)
    close(body.perimeter_meters, perimeter(room), 'perimeter_meters', 0.001 + len(room)*0.002)
    ids = [w.window_id for w in body.windows]
    if len(set(ids)) != len(ids):
        raise ValueError('window_id must be unique within a room')
    signed_area = sum(a.x*b.z-b.x*a.z for a,b in zip(room,room[1:]+room[:1]))
    sign = 1 if signed_area > 0 else -1
    for w in body.windows:
        if w.wall_index >= len(room):
            raise ValueError('wall_index must reference an existing room wall')
        a,b = room[w.wall_index],room[(w.wall_index+1)%len(room)]
        dx,dz = b.x-a.x,b.z-a.z
        length = sqrt(dx*dx+dz*dz)
        if length < 0.05:
            raise ValueError('Window wall must be at least 0.05 m long')
        def along(p): return ((p.x-a.x)*dx+(p.z-a.z)*dz)/length
        def offset(p): return abs(((p.x-a.x)*-dz+(p.z-a.z)*dx)/length)
        c=ordered(w.corners)
        if [p.order_index for p in w.corners] != [0,1,2,3]:
            raise ValueError('Android window corners must be stored in order_index order')
        points=[w.floor_reference]+w.measured_corners+c
        if w.floor_reference.y != 0 or any(p.y<0 for p in points):
            raise ValueError('Floor reference y must be zero; window heights must be non-negative')
        if any(offset(p)>0.3511 or not -0.0311 <= along(p) <= length+0.0311 for p in points):
            raise ValueError('Window measurement lies outside its selected wall')
        # Match the Android raw-point alignment tolerances.
        raw=w.measured_corners
        if ((along(raw[1])-along(raw[0]))*sign < 0.05 or
            (along(raw[2])-along(raw[3]))*sign < 0.05 or
            raw[2].y-raw[1].y < 0.05 or raw[3].y-raw[0].y < 0.05):
            raise ValueError('Raw window order or size conflicts with Android measurement rules')
        if (abs(raw[1].y-raw[0].y)>0.1511 or abs(raw[3].y-raw[2].y)>0.1511 or
            abs(along(raw[2])-along(raw[1]))>0.1511 or abs(along(raw[3])-along(raw[0]))>0.1511):
            raise ValueError('Raw window measurement alignment exceeds Android tolerance')
        # Corrected corners are rectangular and projected to the chosen wall.
        if any(offset(p)>0.002 for p in [w.floor_reference]+c):
            raise ValueError('Corrected window corners must lie on the selected wall')
        if (along(c[1])-along(c[0]))*sign < 0.049 or c[3].y-c[0].y < 0.049:
            raise ValueError('Window left/right order or dimensions are invalid')
        for v1,v2 in [(c[0].y,c[1].y),(c[2].y,c[3].y),(along(c[0]),along(c[3])),(along(c[1]),along(c[2]))]:
            close(v1,v2,'rectangular window')
        width=sqrt((c[1].x-c[0].x)**2+(c[1].z-c[0].z)**2)
        height=c[3].y-c[0].y
        for actual,expected,label in [(w.sill_height_m,c[0].y,'sill_height_m'),
            (w.width_m,width,'width_m'),(w.height_m,height,'height_m'),
            (w.top_height_m,c[3].y,'top_height_m')]:
            close(actual,expected,label)
        close(w.area_square_meters,width*height,'window area_square_meters',0.001+(width+height)*0.002)
        # The residual describes pre-rounding points; allow rounding uncertainty.
        if w.max_plane_residual_m+0.004 < max(offset(p) for p in raw):
            raise ValueError('max_plane_residual_m is smaller than the stored raw-point residual')
        # Original floor hit can dominate the residual but is projected before export.
        # Its original offset is not recoverable, so an upper claim is preserved.
        left=max(0,min(length,(along(raw[0])+along(raw[3]))/2))
        right=max(0,min(length,(along(raw[1])+along(raw[2]))/2))
        bottom=(raw[0].y+raw[1].y)/2
        top=(raw[2].y+raw[3].y)/2
        for p,u,y in zip(c,[left,right,right,left],[bottom,bottom,top,top]):
            close(along(p),u,'corrected corner along wall')
            close(p.y,y,'corrected corner height')
    return body
