import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/common/AppText';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import type { CellPpfd } from '@/services/lightForecast';

/**
 * 식물 자리 한 칸의 하루 10분 PPFD — 산란광(아래) 위에 직사광을 쌓은 면 그래프.
 * 위쪽 선이 전체 PPFD이고, 그래프를 누르거나 끌면 그 시각 값을 위 줄에 보여준다 (처음엔 가장 밝은 시각).
 */

/** 직사광·산란광 색 — 밝은 배경에서 색약 구분 검사 통과 (dataviz validate_palette, ΔE 22 이상) */
export const PPFD_COLORS = { direct: '#D08A1E', diffuse: '#3A87C0' } as const;

const PLOT_H = 150;
const TOP = 18;
const GUTTER = 36;
const X_LABEL_H = 18;
const HALF_BIN = 5;

export function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatPpfd(v: number): string {
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
}

/** 축 최댓값을 깔끔한 수로 (138 → 150, 42 → 50) */
function niceMax(v: number): number {
  if (v <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * exp >= v) return m * exp;
  }
  return 10 * exp;
}

export function peakIndex(total: number[]): number {
  let best = 0;
  total.forEach((v, i) => {
    if (v > total[best]) best = i;
  });
  return best;
}

export interface DailyPpfdChartProps {
  data: CellPpfd;
  /** 고른 10분 구간 — 주면 밖에서 관리 (표와 같이 쓸 때), 안 주면 그래프가 직접 관리 */
  picked?: number | null;
  onPick?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}

export function DailyPpfdChart({ data, picked: pickedProp, onPick, style }: DailyPpfdChartProps) {
  const [width, setWidth] = useState(0);
  const { minutes, direct, diffuse } = data;
  const total = direct.map((d, i) => d + diffuse[i]);
  const n = minutes.length;
  const [ownPicked, setOwnPicked] = useState<number | null>(null);
  const picked = pickedProp !== undefined ? pickedProp : ownPicked;
  const setPicked = onPick ?? setOwnPicked;
  const active = picked !== null && picked < n ? picked : peakIndex(total);

  if (n === 0) {
    return (
      <AppText variant="caption" color={Colors.textSecondary} style={style}>
        이 날짜는 해가 떠 있는 구간이 없어요.
      </AppText>
    );
  }

  const x0 = Math.floor((minutes[0] - HALF_BIN) / 60) * 60;
  const x1 = Math.ceil((minutes[n - 1] + HALF_BIN) / 60) * 60;
  const plotW = Math.max(1, width - GUTTER);
  const sx = (m: number) => GUTTER + ((m - x0) / Math.max(1, x1 - x0)) * plotW;
  const yMax = niceMax(Math.max(...total) * 1.05);
  const base = TOP + PLOT_H;
  const sy = (v: number) => base - (v / yMax) * PLOT_H;

  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'} ${sx(minutes[i])} ${sy(v)}`).join(' ');
  /** upper ~ lower 사이 면 (양 끝은 구간 가장자리에서 바닥/아래 값으로 닫는다) */
  const band = (upper: number[], lower: number[] | null) => {
    const start = minutes[0] - HALF_BIN;
    const end = minutes[n - 1] + HALF_BIN;
    const top = upper.map((v, i) => `L ${sx(minutes[i])} ${sy(v)}`).join(' ');
    const bottom = lower
      ? lower
          .map((v, i) => [i, v] as const)
          .reverse()
          .map(([i, v]) => `L ${sx(minutes[i])} ${sy(v)}`)
          .join(' ')
      : '';
    return `M ${sx(start)} ${base} ${top} L ${sx(end)} ${base} ${bottom} Z`;
  };

  const spanH = (x1 - x0) / 60;
  const step = spanH <= 8 ? 2 : 3;
  const hourTicks: number[] = [];
  for (let m = x0; m <= x1; m += step * 60) hourTicks.push(m);
  const yTicks = [0, yMax / 2, yMax];

  const pickAt = (locationX: number) => {
    if (width <= 0) return;
    const m = x0 + ((locationX - GUTTER) / plotW) * (x1 - x0);
    let best = 0;
    minutes.forEach((t, i) => {
      if (Math.abs(t - m) < Math.abs(minutes[best] - m)) best = i;
    });
    setPicked(best);
  };

  const ax = sx(minutes[active]);

  return (
    <View style={style}>
      {/* 고른 시각 값 (텍스트는 글자색, 색은 옆 표시로만) */}
      <View style={styles.readout}>
        <AppText variant="bodyStrong">{formatClock(minutes[active])}</AppText>
        <AppText variant="caption" color={Colors.text}>
          전체 {formatPpfd(total[active])}
        </AppText>
        <View style={styles.readoutItem}>
          <View style={[styles.swatch, { backgroundColor: PPFD_COLORS.direct }]} />
          <AppText variant="caption" color={Colors.textSecondary}>
            직사 {formatPpfd(direct[active])}
          </AppText>
        </View>
        <View style={styles.readoutItem}>
          <View style={[styles.swatch, { backgroundColor: PPFD_COLORS.diffuse }]} />
          <AppText variant="caption" color={Colors.textSecondary}>
            산란 {formatPpfd(diffuse[active])}
          </AppText>
        </View>
      </View>

      <View style={{ height: TOP + PLOT_H + X_LABEL_H }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={TOP + PLOT_H + X_LABEL_H}>
            {/* 단위 + 가로 눈금선 + y 값 */}
            <SvgText x={width - 4} y={TOP - 6} fontSize={10} fill={Colors.textTertiary} textAnchor="end" fontFamily={FontFamily.sans}>
              PPFD μmol/m²/s
            </SvgText>
            {yTicks.map((t) => (
              <Line key={`g-${t}`} x1={GUTTER} x2={width} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? Colors.border : Colors.divider} strokeWidth={1} />
            ))}
            {yTicks.map((t) => (
              <SvgText
                key={`y-${t}`}
                x={GUTTER - 6}
                y={sy(t) + 3.5}
                fontSize={10}
                fill={Colors.textSecondary}
                textAnchor="end"
                fontFamily={FontFamily.sans}>
                {formatPpfd(t)}
              </SvgText>
            ))}

            {/* 면: 산란광(아래) + 직사광(위) */}
            <Path d={band(diffuse, null)} fill={PPFD_COLORS.diffuse} opacity={0.14} />
            <Path d={band(total, diffuse)} fill={PPFD_COLORS.direct} opacity={0.14} />
            <Path d={line(diffuse)} stroke={PPFD_COLORS.diffuse} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <Path d={line(total)} stroke={PPFD_COLORS.direct} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

            {/* 고른 시각 세로선 + 점 */}
            <Line x1={ax} x2={ax} y1={TOP} y2={base} stroke={Colors.textTertiary} strokeWidth={1} />
            <Circle cx={ax} cy={sy(diffuse[active])} r={4} fill={PPFD_COLORS.diffuse} stroke={Colors.surface} strokeWidth={2} />
            <Circle cx={ax} cy={sy(total[active])} r={4} fill={PPFD_COLORS.direct} stroke={Colors.surface} strokeWidth={2} />

            {/* 시각 */}
            {hourTicks.map((m) => (
              <SvgText
                key={`x-${m}`}
                x={sx(m)}
                y={base + 14}
                fontSize={10}
                fill={Colors.textSecondary}
                textAnchor="middle"
                fontFamily={FontFamily.sans}>
                {`${Math.floor(m / 60)}시`}
              </SvgText>
            ))}
          </Svg>
        ) : null}

        {/* 터치 영역 — 누르거나 끌면 가까운 10분 구간을 고른다 */}
        <View
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${formatClock(minutes[active])} 전체 ${formatPpfd(total[active])}, 직사 ${formatPpfd(direct[active])}, 산란 ${formatPpfd(diffuse[active])} 마이크로몰`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => setPicked(Math.max(0, Math.min(n - 1, active + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => pickAt(e.nativeEvent.locationX)}
          onResponderMove={(e) => pickAt(e.nativeEvent.locationX)}
        />
      </View>

      <View style={styles.legend}>
        <View style={styles.readoutItem}>
          <View style={[styles.swatch, { backgroundColor: PPFD_COLORS.direct }]} />
          <AppText variant="small" color={Colors.textSecondary}>
            직사광 (해에서 바로)
          </AppText>
        </View>
        <View style={styles.readoutItem}>
          <View style={[styles.swatch, { backgroundColor: PPFD_COLORS.diffuse }]} />
          <AppText variant="small" color={Colors.textSecondary}>
            산란광 (하늘에서)
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.md,
    rowGap: 2,
    marginBottom: Spacing.sm,
  },
  readoutItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
});
