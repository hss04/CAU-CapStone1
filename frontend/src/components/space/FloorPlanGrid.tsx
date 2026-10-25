import { useState, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { FACING_KO } from '@/constants/labels';
import { Colors } from '@/constants/theme';
import { getLightMap, lightOverlayColor } from '@/services/space/lightAnalysis';
import { windowName } from '@/services/space/windows';
import type { Furniture, GridPosition, LightMap, Room, RoomDoor, RoomWindow, TimeOfDay, WallOpening } from '@/types';

import { PlantMarker, type MarkerStatus, type MarkerVariant } from './PlantMarker';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface FloorPlanMarker {
  id: string;
  position: GridPosition;
  variant?: MarkerVariant;
  label?: string;
  showLabel?: boolean;
  status?: MarkerStatus;
}

export interface FloorPlanGridProps {
  room: Room;
  timeOfDay?: TimeOfDay;
  /** 백엔드 분석 광량 맵을 직접 넘길 때 사용 (없으면 room 기반 추정값) */
  lightMap?: LightMap;
  showLight?: boolean;
  showFurnitureLabels?: boolean;
  showWindowLabels?: boolean;
  markers?: FloorPlanMarker[];
  selectedMarkerId?: string | null;
  onMarkerPress?: (id: string) => void;
  onCellPress?: (pos: GridPosition) => void;
  selectedCell?: GridPosition | null;
  /** 현재 → 추천 위치 이동 경로 */
  path?: { from: GridPosition; to: GridPosition } | null;
  /** SpacePreview 등 작은 썸네일 모드 */
  compact?: boolean;
  /** 벽 개구부를 칠할 바탕색 (카드 배경과 맞춘다) */
  surfaceColor?: string;
  /** 마커 크기(px) 직접 지정 */
  markerSize?: number;
  /** 창문 탭 (창밖 스캔 플로우) */
  onWindowPress?: (windowId: string) => void;
  selectedWindowId?: string | null;
  /** 창밖 스캔을 마친 창문 — 체크 배지 표시 */
  scannedWindowIds?: string[];
  style?: StyleProp<ViewStyle>;
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const WALL = '#3F5244';
const FLOOR = '#FAF9F3';
const TILE_NEUTRAL = '#F1F2EB';
const FURNITURE_TEXT = '#858B83';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

interface Geo {
  cell: number;
  ox: number;
  oy: number;
  floorW: number;
  floorH: number;
  wallT: number;
  width: number;
  height: number;
}

function padCellsFor(compact: boolean) {
  return compact ? 0.35 : 0.8;
}

function makeGeo(room: Room, width: number, compact: boolean): Geo {
  const pad = padCellsFor(compact);
  const cell = width / (room.cols + pad * 2);
  const ox = pad * cell;
  const oy = pad * cell;
  return {
    cell,
    ox,
    oy,
    floorW: room.cols * cell,
    floorH: room.rows * cell,
    wallT: compact ? Math.max(2.5, cell * 0.12) : Math.max(4.5, cell * 0.15),
    width,
    height: cell * (room.rows + pad * 2),
  };
}

/** 벽 개구부의 화면 좌표: 시작점, 끝점, 벽 방향 단위벡터 u, 방 안쪽 법선 n */
function openingCoords(o: WallOpening, g: Geo) {
  const { ox, oy, floorW, floorH, cell } = g;
  switch (o.wall) {
    case 'top':
      return { a: [ox + o.offset * cell, oy], b: [ox + (o.offset + o.length) * cell, oy], n: [0, 1] };
    case 'bottom':
      return { a: [ox + o.offset * cell, oy + floorH], b: [ox + (o.offset + o.length) * cell, oy + floorH], n: [0, -1] };
    case 'left':
      return { a: [ox, oy + o.offset * cell], b: [ox, oy + (o.offset + o.length) * cell], n: [1, 0] };
    case 'right':
      return { a: [ox + floorW, oy + o.offset * cell], b: [ox + floorW, oy + (o.offset + o.length) * cell], n: [-1, 0] };
  }
}

/** 개구부 위치의 벽을 지우는 사각형 (벽 두께만큼 바깥쪽) */
function wallCutRect(o: WallOpening, g: Geo) {
  const { a, b, n } = openingCoords(o, g);
  const t = g.wallT + 1;
  const horizontal = n[0] === 0;
  if (horizontal) {
    const y = n[1] === 1 ? a[1] - t : a[1] - 0.5;
    return { x: a[0], y, w: b[0] - a[0], h: t + 0.5 };
  }
  const x = n[0] === 1 ? a[0] - t : a[0] - 0.5;
  return { x, y: a[1], w: t + 0.5, h: b[1] - a[1] };
}

/* ------------------------------------------------------------------ */
/* Furniture drawings (top view)                                       */
/* ------------------------------------------------------------------ */

function FurnitureShape({ f, g, room, showLabel }: { f: Furniture; g: Geo; room: Room; showLabel: boolean }) {
  const inset = g.cell * 0.07;
  const x = g.ox + f.x * g.cell + inset;
  const y = g.oy + f.y * g.cell + inset;
  const w = f.w * g.cell - inset * 2;
  const h = f.h * g.cell - inset * 2;
  const r = Math.min(g.cell * 0.18, 7);
  const fontSize = Math.max(8.5, Math.min(11, g.cell * 0.3));
  const parts: ReactElement[] = [];
  let labelY = y + h / 2;
  let withLabel = showLabel;

  switch (f.type) {
    case 'bed': {
      // 벽에 붙은 쪽을 머리 방향으로
      const headBottom = f.y + f.h === room.rows;
      const blanketH = h * 0.62;
      const blanketY = headBottom ? y : y + h - blanketH;
      parts.push(<Rect key="frame" x={x} y={y} width={w} height={h} rx={r} fill="#FFFFFF" stroke="#D8D3C6" strokeWidth={1.2} />);
      parts.push(<Rect key="blanket" x={x + 2} y={blanketY + (headBottom ? 2 : 0)} width={w - 4} height={blanketH - 2} rx={r * 0.8} fill="#DCE7D4" />);
      parts.push(
        <Line key="fold" x1={x + 4} x2={x + w - 4} y1={headBottom ? blanketY + blanketH - 5 : blanketY + 5} y2={headBottom ? blanketY + blanketH - 5 : blanketY + 5} stroke="#C5D5BB" strokeWidth={1.4} strokeLinecap="round" />,
      );
      const pw = (w - g.cell * 0.5) / 2;
      const ph = g.cell * 0.55;
      const py = headBottom ? y + h - ph - g.cell * 0.18 : y + g.cell * 0.18;
      parts.push(<Rect key="p1" x={x + g.cell * 0.18} y={py} width={pw} height={ph} rx={ph * 0.35} fill="#FFFFFF" stroke="#DCD8CC" strokeWidth={1} />);
      parts.push(<Rect key="p2" x={x + w - g.cell * 0.18 - pw} y={py} width={pw} height={ph} rx={ph * 0.35} fill="#FFFFFF" stroke="#DCD8CC" strokeWidth={1} />);
      labelY = blanketY + blanketH / 2;
      break;
    }
    case 'desk': {
      parts.push(<Rect key="top" x={x} y={y} width={w} height={h} rx={r * 0.7} fill="#EFE4D2" stroke="#D8C7AC" strokeWidth={1.2} />);
      // 노트북 + 스탠드
      const lw = w * 0.55;
      const lh = Math.min(h * 0.22, g.cell * 0.55);
      parts.push(<Rect key="laptop" x={x + (w - lw) / 2} y={y + h * 0.18} width={lw} height={lh} rx={2.5} fill="#FFFFFF" stroke="#D5CBB9" strokeWidth={1} />);
      parts.push(<Circle key="lamp" cx={x + w * 0.3} cy={y + h * 0.8} r={g.cell * 0.13} fill="#F5D98F" stroke="#E2C06C" strokeWidth={1} />);
      labelY = y + h * 0.56;
      break;
    }
    case 'chair': {
      const cy = y + h / 2;
      parts.push(<Rect key="seat" x={x + w * 0.12} y={y + h * 0.12} width={w * 0.76} height={h * 0.76} rx={w * 0.26} fill="#F4EEE4" stroke="#D9D0C1" strokeWidth={1.1} />);
      // 책상 반대편에 등받이
      const desk = room.furniture.find((d) => d.type === 'desk');
      const deskLeft = desk && desk.x + desk.w === f.x;
      const bx = deskLeft ? x + w * 0.86 : x + w * 0.14;
      parts.push(<Line key="back" x1={bx} x2={bx} y1={cy - h * 0.3} y2={cy + h * 0.3} stroke="#C9BDA9" strokeWidth={3} strokeLinecap="round" />);
      withLabel = false;
      break;
    }
    case 'drawer': {
      parts.push(<Rect key="body" x={x} y={y} width={w} height={h} rx={r * 0.7} fill="#F1E8DA" stroke="#DACBB3" strokeWidth={1.2} />);
      const knobY = f.y === 0 ? y + h - g.cell * 0.18 : y + g.cell * 0.18;
      [0.3, 0.7].forEach((p, i) =>
        parts.push(<Circle key={`k${i}`} cx={x + w * p} cy={knobY} r={1.8} fill="#C3B08F" />),
      );
      break;
    }
    case 'wardrobe': {
      parts.push(<Rect key="body" x={x} y={y} width={w} height={h} rx={r * 0.7} fill="#ECE6DA" stroke="#D5CCBA" strokeWidth={1.2} />);
      parts.push(<Line key="rail" x1={x + w * 0.15} x2={x + w * 0.85} y1={y + h * 0.45} y2={y + h * 0.45} stroke="#CFC4AF" strokeWidth={1.2} strokeDasharray="3 3" />);
      labelY = y + h * 0.7;
      break;
    }
    default:
      parts.push(<Rect key="body" x={x} y={y} width={w} height={h} rx={r} fill="#F3EEE6" stroke="#D8D0C2" strokeWidth={1.2} />);
  }

  return (
    <G>
      {parts}
      {withLabel ? (
        <SvgText
          x={x + w / 2}
          y={labelY + fontSize * 0.35}
          fontSize={fontSize}
          fontWeight="600"
          fill={FURNITURE_TEXT}
          textAnchor="middle">
          {f.label}
        </SvgText>
      ) : null}
    </G>
  );
}

/* ------------------------------------------------------------------ */
/* Windows & doors                                                     */
/* ------------------------------------------------------------------ */

function WindowShape({ w, g, surface }: { w: RoomWindow; g: Geo; surface: string }) {
  const cut = wallCutRect(w, g);
  const { a, b, n } = openingCoords(w, g);
  const horizontal = n[0] === 0;
  const t = g.wallT;
  // 유리 두 줄 (벽 두께 안쪽)
  const lines = [0.32, 0.68].map((p, i) => {
    if (horizontal) {
      const y = n[1] === 1 ? a[1] - t * p : a[1] + t * p;
      return <Line key={i} x1={a[0]} x2={b[0]} y1={y} y2={y} stroke={Colors.water} strokeWidth={1.4} />;
    }
    const x = n[0] === 1 ? a[0] - t * p : a[0] + t * p;
    return <Line key={i} x1={x} x2={x} y1={a[1]} y2={b[1]} stroke={Colors.water} strokeWidth={1.4} />;
  });
  return (
    <G>
      <Rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} fill={surface} />
      <Rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} fill={Colors.waterSoft} opacity={0.9} />
      {lines}
    </G>
  );
}

function DoorShape({ d, g, surface }: { d: RoomDoor; g: Geo; surface: string }) {
  const cut = wallCutRect(d, g);
  const { a, b, n } = openingCoords(d, g);
  const hinge = d.hinge === 'start' ? a : b;
  const other = d.hinge === 'start' ? b : a;
  const L = d.length * g.cell;
  const leafEnd = [hinge[0] + n[0] * L, hinge[1] + n[1] * L];
  const sx = other[0] - hinge[0];
  const sy = other[1] - hinge[1];
  const ex = leafEnd[0] - hinge[0];
  const ey = leafEnd[1] - hinge[1];
  const sweep = sx * ey - sy * ex > 0 ? 1 : 0;

  return (
    <G>
      <Rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} fill={surface} />
      <Path
        d={`M ${other[0]} ${other[1]} A ${L} ${L} 0 0 ${sweep} ${leafEnd[0]} ${leafEnd[1]}`}
        stroke="#BFC4BA"
        strokeWidth={1.2}
        strokeDasharray="3 4"
        fill="rgba(255,255,255,0.35)"
      />
      <Line x1={hinge[0]} y1={hinge[1]} x2={leafEnd[0]} y2={leafEnd[1]} stroke={WALL} strokeWidth={2.2} strokeLinecap="round" />
    </G>
  );
}

/** 창문으로 들어오는 빛 줄기 */
function LightBeam({ w, g }: { w: RoomWindow; g: Geo }) {
  const { a, b, n } = openingCoords(w, g);
  const depth = g.cell * 4.6;
  const skew = g.cell * 0.9;
  const horizontal = n[0] === 0;
  const pts = horizontal
    ? [a, b, [b[0] + skew, b[1] + n[1] * depth], [a[0] + skew * 0.35, a[1] + n[1] * depth]]
    : [a, b, [b[0] + n[0] * depth, b[1] + skew], [a[0] + n[0] * depth, a[1] + skew * 0.35]];
  return (
    <Polygon
      points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
      fill={`url(#beam-${w.wall})`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* FloorPlanGrid                                                       */
/* ------------------------------------------------------------------ */

/**
 * Grid 기반 2D 평면도.
 * room 데이터(가구/창문/문 좌표)와 lightMap만 바꾸면 어떤 방이든 그릴 수 있다.
 */
export function FloorPlanGrid({
  room,
  timeOfDay = 'average',
  lightMap,
  showLight = true,
  showFurnitureLabels = true,
  showWindowLabels = true,
  markers = [],
  selectedMarkerId,
  onMarkerPress,
  onCellPress,
  selectedCell,
  path,
  compact = false,
  surfaceColor = Colors.surface,
  markerSize: markerSizeOverride,
  onWindowPress,
  selectedWindowId,
  scannedWindowIds = [],
  style,
}: FloorPlanGridProps) {
  const [width, setWidth] = useState(0);
  const pad = padCellsFor(compact);
  const aspectRatio = (room.cols + pad * 2) / (room.rows + pad * 2);
  const map = lightMap ?? getLightMap(room, timeOfDay);

  const g = width > 0 ? makeGeo(room, width, compact) : null;

  const handleCellPress = (e: GestureResponderEvent) => {
    if (!g || !onCellPress) return;
    const ne = e.nativeEvent as GestureResponderEvent['nativeEvent'] & { offsetX?: number; offsetY?: number };
    const lx = Platform.OS === 'web' && ne.offsetX !== undefined ? ne.offsetX : ne.locationX;
    const ly = Platform.OS === 'web' && ne.offsetY !== undefined ? ne.offsetY : ne.locationY;
    const x = Math.floor(lx / g.cell);
    const y = Math.floor(ly / g.cell);
    if (x >= 0 && y >= 0 && x < room.cols && y < room.rows) onCellPress({ x, y });
  };

  const markerSize =
    markerSizeOverride ??
    (g ? (compact ? Math.max(9, g.cell * 0.55) : Math.min(38, Math.max(26, g.cell * 0.92))) : 0);
  const center = (p: GridPosition) => (g ? [g.ox + (p.x + 0.5) * g.cell, g.oy + (p.y + 0.5) * g.cell] : [0, 0]);

  return (
    <View
      style={[{ width: '100%', aspectRatio }, style]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {g ? (
        <>
          <Svg width={g.width} height={g.height}>
            <Defs>
              <LinearGradient id="beam-top" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFF6D8" stopOpacity={0.5} />
                <Stop offset="1" stopColor="#FFF6D8" stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="beam-bottom" x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor="#FFF6D8" stopOpacity={0.5} />
                <Stop offset="1" stopColor="#FFF6D8" stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="beam-left" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFF6D8" stopOpacity={0.5} />
                <Stop offset="1" stopColor="#FFF6D8" stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="beam-right" x1="1" y1="0" x2="0" y2="0">
                <Stop offset="0" stopColor="#FFF6D8" stopOpacity={0.5} />
                <Stop offset="1" stopColor="#FFF6D8" stopOpacity={0} />
              </LinearGradient>
            </Defs>

            {/* 바닥 */}
            <Rect x={g.ox} y={g.oy} width={g.floorW} height={g.floorH} fill={FLOOR} />

            {/* 빛 환경 grid tiles */}
            {map.map((row, y) =>
              row.map((v, x) => {
                const gap = compact ? 0.8 : 1.4;
                return (
                  <Rect
                    key={`${x}-${y}`}
                    x={g.ox + x * g.cell + gap / 2}
                    y={g.oy + y * g.cell + gap / 2}
                    width={g.cell - gap}
                    height={g.cell - gap}
                    rx={g.cell * (compact ? 0.12 : 0.16)}
                    fill={showLight ? lightOverlayColor(v) : TILE_NEUTRAL}
                  />
                );
              }),
            )}

            {/* 창문 빛 줄기 */}
            {showLight && !compact ? room.windows.map((w) => <LightBeam key={`beam-${w.id}`} w={w} g={g} />) : null}

            {/* 가구 */}
            {room.furniture.map((f) => (
              <FurnitureShape key={f.id} f={f} g={g} room={room} showLabel={showFurnitureLabels && !compact} />
            ))}

            {/* 선택한 셀 (가구 위에도 보이도록 가구 다음에) */}
            {selectedCell ? (
              <Rect
                x={g.ox + selectedCell.x * g.cell + 1}
                y={g.oy + selectedCell.y * g.cell + 1}
                width={g.cell - 2}
                height={g.cell - 2}
                rx={g.cell * 0.2}
                fill={Colors.primary}
                fillOpacity={0.16}
                stroke={Colors.primary}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            ) : null}

            {/* 벽 */}
            <Rect
              x={g.ox - g.wallT / 2}
              y={g.oy - g.wallT / 2}
              width={g.floorW + g.wallT}
              height={g.floorH + g.wallT}
              rx={g.wallT * 0.8}
              fill="none"
              stroke={WALL}
              strokeWidth={g.wallT}
            />
            {room.windows.map((w) => (
              <WindowShape key={w.id} w={w} g={g} surface={surfaceColor} />
            ))}
            {room.doors.map((d) => (
              <DoorShape key={d.id} d={d} g={g} surface={surfaceColor} />
            ))}

            {/* 선택한 창문 / 스캔 완료 배지 */}
            {room.windows.map((w) => (
              <WindowOverlay
                key={`ov-${w.id}`}
                w={w}
                g={g}
                selected={w.id === selectedWindowId}
                scanned={!compact && scannedWindowIds.includes(w.id)}
              />
            ))}

            {/* 창문 라벨 */}
            {showWindowLabels && !compact
              ? room.windows.map((w) => {
                  const { a, b, n } = openingCoords(w, g);
                  const mx = (a[0] + b[0]) / 2;
                  const my = (a[1] + b[1]) / 2;
                  const off = g.wallT + 7;
                  const label = `창문 · ${FACING_KO[w.facing]}`;
                  if (n[0] === 0) {
                    const ty = n[1] === 1 ? my - off : my + off + 8;
                    return (
                      <SvgText key={`l-${w.id}`} x={mx} y={ty} fontSize={10} fontWeight="700" fill={Colors.waterDeep} textAnchor="middle">
                        {label}
                      </SvgText>
                    );
                  }
                  const tx = n[0] === -1 ? mx + off : mx - off;
                  return (
                    <SvgText
                      key={`l-${w.id}`}
                      x={tx}
                      y={my}
                      fontSize={10}
                      fontWeight="700"
                      fill={Colors.waterDeep}
                      textAnchor="middle"
                      transform={`rotate(${n[0] === -1 ? 90 : -90} ${tx} ${my})`}>
                      {label}
                    </SvgText>
                  );
                })
              : null}

            {/* 이동 경로 */}
            {path ? <MovePath from={center(path.from)} to={center(path.to)} cell={g.cell} /> : null}
          </Svg>

          {onCellPress ? (
            <Pressable
              accessibilityLabel="평면도에서 위치 선택"
              onPress={handleCellPress}
              style={[styles.cellLayer, { left: g.ox, top: g.oy, width: g.floorW, height: g.floorH }]}
            />
          ) : null}

          {onWindowPress
            ? room.windows.map((w) => {
                const hit = windowHitRect(w, g);
                return (
                  <Pressable
                    key={`hit-${w.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${windowName(w)} 선택`}
                    onPress={() => onWindowPress(w.id)}
                    style={[styles.cellLayer, { left: hit.x, top: hit.y, width: hit.w, height: hit.h }]}
                  />
                );
              })
            : null}

          {markers.map((m) => {
            const [cx, cy] = center(m.position);
            return (
              <View
                key={m.id}
                style={[
                  styles.marker,
                  {
                    left: cx - markerSize / 2,
                    top: cy - markerSize / 2,
                    zIndex: m.id === selectedMarkerId ? 3 : m.variant === 'recommended' ? 2 : 1,
                  },
                ]}>
                <PlantMarker
                  variant={m.variant}
                  size={markerSize}
                  compact={compact}
                  selected={m.id === selectedMarkerId}
                  label={m.label}
                  showLabel={m.showLabel}
                  status={m.status}
                  onPress={onMarkerPress ? () => onMarkerPress(m.id) : undefined}
                />
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

/** 창문 터치 영역 — 벽 두께보다 넉넉하게 */
function windowHitRect(w: RoomWindow, g: Geo) {
  const cut = wallCutRect(w, g);
  const extra = 14;
  const horizontal = w.wall === 'top' || w.wall === 'bottom';
  return horizontal
    ? { x: cut.x - 4, y: cut.y - extra, w: cut.w + 8, h: cut.h + extra * 2 }
    : { x: cut.x - extra, y: cut.y - 4, w: cut.w + extra * 2, h: cut.h + 8 };
}

function WindowOverlay({ w, g, selected, scanned }: { w: RoomWindow; g: Geo; selected: boolean; scanned: boolean }) {
  if (!selected && !scanned) return null;
  const cut = wallCutRect(w, g);
  const { a, b, n } = openingCoords(w, g);
  // 배지는 창문 가운데, 방 안쪽으로 살짝
  const bx = (a[0] + b[0]) / 2 + n[0] * g.cell * 0.55;
  const by = (a[1] + b[1]) / 2 + n[1] * g.cell * 0.55;
  const r = Math.max(7, g.cell * 0.28);
  return (
    <G>
      {selected ? (
        <Rect
          x={cut.x - 3}
          y={cut.y - 3}
          width={cut.w + 6}
          height={cut.h + 6}
          rx={4}
          fill="none"
          stroke={Colors.sunlight}
          strokeWidth={2.5}
        />
      ) : null}
      {scanned ? (
        <G>
          <Circle cx={bx} cy={by} r={r} fill={Colors.primary} stroke={Colors.white} strokeWidth={1.5} />
          <Path
            d={`M ${bx - r * 0.45} ${by} L ${bx - r * 0.1} ${by + r * 0.35} L ${bx + r * 0.45} ${by - r * 0.35}`}
            stroke={Colors.white}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      ) : null}
    </G>
  );
}

function MovePath({ from, to, cell }: { from: number[]; to: number[]; cell: number }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(len * 0.22, cell * 1.6);
  const cx = mx - (dy / len) * bend;
  const cy = my + (dx / len) * bend;
  // 곡선의 중간점과 접선 방향에 화살표
  const px = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
  const py = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
  const tx = x2 - x1;
  const ty = y2 - y1;
  const angle = (Math.atan2(ty, tx) * 180) / Math.PI;
  const s = cell * 0.2;

  return (
    <G>
      <Path
        d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
        stroke={Colors.primary}
        strokeWidth={2.2}
        strokeDasharray="5 5"
        strokeLinecap="round"
        fill="none"
      />
      <G transform={`translate(${px} ${py}) rotate(${angle})`}>
        <Circle r={s * 1.9} fill={Colors.surface} />
        <Path d={`M ${-s * 0.7} ${-s} L ${s * 0.8} 0 L ${-s * 0.7} ${s}`} stroke={Colors.primary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </G>
    </G>
  );
}

const styles = StyleSheet.create({
  cellLayer: {
    position: 'absolute',
  },
  marker: {
    pointerEvents: 'box-none',
    position: 'absolute',
    overflow: 'visible',
  },
});
