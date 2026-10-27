import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/common/AppText';
import { WeatherIcon } from '@/components/weather/WeatherIcon';
import { DLI_STATUS_COPY, WEATHER_LABEL } from '@/constants/labels';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import { formatDli } from '@/services/lightForecast';
import type { DailyLightPoint, DliRange } from '@/types';
import { formatMonthDayKo, formatMonthDaySlash, parseISODate, weekdayKo } from '@/utils/date';

/**
 * 7일 예상 DLI 막대그래프 + 식물 요구 범위(띠).
 * 막대 색은 요구 범위 비교 상태(부족/적정/과다)이고, 띠와의 위치로도 같은 정보를 읽을 수 있다.
 */

export interface WeeklyDliChartProps {
  points: DailyLightPoint[];
  range: DliRange;
  today: string;
  /** compact: 홈 미리보기 (값 라벨·날짜 없음) · full: 상세 화면 */
  variant?: 'compact' | 'full';
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  style?: StyleProp<ViewStyle>;
}

const LAYOUT = {
  compact: { valueRow: 0, plot: 72, maxBar: 16 },
  full: { valueRow: 20, plot: 136, maxBar: 24 },
} as const;

const BAND_FILL = Colors.lightGreen;
const BAND_EDGE = Colors.primarySoft;

/** 위쪽만 4px 둥근 막대 (바닥은 직각) */
function barPath(x: number, top: number, w: number, base: number): string {
  const r = Math.min(4, w / 2, base - top);
  return `M ${x} ${base} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + w - r} ${top} Q ${x + w} ${top} ${x + w} ${top + r} L ${x + w} ${base} Z`;
}

export function WeeklyDliChart({
  points,
  range,
  today,
  variant = 'full',
  selectedDate = null,
  onSelectDate,
  style,
}: WeeklyDliChartProps) {
  const [width, setWidth] = useState(0);
  const full = variant === 'full';
  const L = LAYOUT[variant];
  const height = L.valueRow + L.plot;
  const base = height - 1;

  // 상세 그래프는 왼쪽에 요구 범위 눈금 자리를 둔다
  const gutter = full ? 30 : 0;
  const n = Math.max(points.length, 1);
  const colW = Math.max(0, width - gutter) / n;
  const colX = (i: number) => gutter + i * colW;
  const barW = Math.min(L.maxBar, colW * 0.46);

  // y축: 값과 요구 범위가 모두 보이게. 범위가 값보다 훨씬 크면 띠를 위로 잘라 막대가 납작해지지 않게 한다
  const values = points.map((p) => p.dli).filter((v): v is number => v !== null);
  const valueMax = values.length ? Math.max(...values) : 0;
  const anchor = Math.max(valueMax, range.min, 0.5);
  const fit = Math.max(valueMax * 1.15, range.max * 1.08);
  const yMax = fit > anchor * 2.2 ? anchor * 1.6 : fit;
  const y = (v: number) => base - (Math.min(v, yMax) / yMax) * (L.plot - 4);
  const bandClipped = range.max > yMax;
  const bandTop = bandClipped ? L.valueRow : y(range.max);
  const bandBottom = y(range.min);
  // 띠가 얇아도 두 눈금이 겹치지 않게
  const maxLabelY = bandClipped ? bandTop + 8 : Math.max(9, Math.min(bandTop + 3.5, bandBottom - 9.5));

  return (
    <View style={style} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* 날씨 아이콘 */}
      <View style={[styles.row, { paddingLeft: gutter }]}>
        {points.map((p) => (
          <View key={p.date} style={styles.cell}>
            {p.weather ? (
              <WeatherIcon condition={p.weather.condition} size={full ? 18 : 16} />
            ) : (
              <View style={styles.noIcon} />
            )}
          </View>
        ))}
      </View>

      <View style={{ height, marginTop: full ? Spacing.xs : 2 }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {/* 선택한 날짜 열 강조 */}
            {points.map((p, i) =>
              p.date === selectedDate && full ? (
                <Rect key={`sel-${p.date}`} x={colX(i) + 3} y={0} width={colW - 6} height={height} rx={10} fill={Colors.divider} />
              ) : null,
            )}

            {/* 요구 범위 띠 */}
            <Rect
              x={gutter}
              y={bandTop}
              width={width - gutter}
              height={Math.max(0, bandBottom - bandTop)}
              fill={BAND_FILL}
              opacity={0.85}
            />
            {!bandClipped ? <Line x1={gutter} x2={width} y1={bandTop} y2={bandTop} stroke={BAND_EDGE} strokeWidth={1} /> : null}
            <Line x1={gutter} x2={width} y1={bandBottom} y2={bandBottom} stroke={BAND_EDGE} strokeWidth={1} />
            {full ? (
              <>
                <SvgText
                  x={gutter - 5}
                  y={bandBottom + 3.5}
                  fontSize={10}
                  fill={Colors.textSecondary}
                  textAnchor="end"
                  fontFamily={FontFamily.sans}>
                  {formatDli(range.min)}
                </SvgText>
                <SvgText
                  x={gutter - 5}
                  y={maxLabelY}
                  fontSize={10}
                  fill={Colors.textSecondary}
                  textAnchor="end"
                  fontFamily={FontFamily.sans}>
                  {bandClipped ? `↑${formatDli(range.max)}` : formatDli(range.max)}
                </SvgText>
              </>
            ) : null}

            {/* 기준선 */}
            <Line x1={gutter} x2={width} y1={base} y2={base} stroke={Colors.border} strokeWidth={1} />

            {/* 막대 */}
            {points.map((p, i) => {
              const cx = colX(i) + colW / 2;
              if (p.dli === null || p.status === null) {
                return <Circle key={p.date} cx={cx} cy={base - 3} r={2.5} fill={Colors.mutedGreen} />;
              }
              const top = Math.min(y(p.dli), base - 3);
              const dimmed = full && selectedDate !== null && p.date !== selectedDate;
              return (
                <Path
                  key={p.date}
                  d={barPath(cx - barW / 2, top, barW, base)}
                  fill={DLI_STATUS_COPY[p.status].color}
                  opacity={dimmed ? 0.45 : 1}
                />
              );
            })}

            {/* 선택한 날짜 값 (값 라벨은 하나만) */}
            {full
              ? points.map((p, i) =>
                  p.date === selectedDate && p.dli !== null ? (
                    <SvgText
                      key={`v-${p.date}`}
                      x={colX(i) + colW / 2}
                      y={Math.max(12, Math.min(y(p.dli), base - 3) - 6)}
                      fontSize={11.5}
                      fontWeight="700"
                      fill={Colors.text}
                      textAnchor="middle"
                      fontFamily={FontFamily.sans}>
                      {formatDli(p.dli)}
                    </SvgText>
                  ) : null,
                )
              : null}
          </Svg>
        ) : null}
      </View>

      {/* 요일 · 날짜 */}
      <View style={[styles.row, styles.labels, { paddingLeft: gutter }]}>
        {points.map((p) => {
          const date = parseISODate(p.date);
          const isToday = p.date === today;
          const selected = p.date === selectedDate;
          return (
            <View key={p.date} style={styles.cell}>
              <AppText
                variant="small"
                color={isToday || selected ? Colors.text : Colors.textSecondary}
                style={(isToday || selected) && styles.strong}>
                {isToday ? '오늘' : weekdayKo(date)}
              </AppText>
              {full ? (
                <AppText variant="small" color={Colors.textTertiary} style={styles.date}>
                  {formatMonthDaySlash(date)}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* 날짜 선택 (막대보다 넓은 터치 영역) */}
      {onSelectDate ? (
        <View style={[StyleSheet.absoluteFill, styles.row, { paddingLeft: gutter }]}>
          {points.map((p) => (
            <Pressable
              key={p.date}
              style={styles.hit}
              onPress={() => onSelectDate(p.date)}
              accessibilityRole="button"
              accessibilityState={{ selected: p.date === selectedDate }}
              accessibilityLabel={pointLabel(p)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function pointLabel(p: DailyLightPoint): string {
  const day = formatMonthDayKo(parseISODate(p.date));
  const weather = p.weather ? ` ${WEATHER_LABEL[p.weather.condition]}` : '';
  if (p.dli === null || p.status === null) return `${day}${weather} 예상 DLI 없음`;
  return `${day}${weather} 예상 DLI ${formatDli(p.dli)} ${DLI_STATUS_COPY[p.status].label}`;
}

/** 상태 색 범례 (막대 색 + 요구 범위 띠) */
export function DliLegend({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.legend, style]}>
      {(['ok', 'low', 'high'] as const).map((s) => (
        <View key={s} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: DLI_STATUS_COPY[s].color }]} />
          <AppText variant="small" color={Colors.textSecondary}>
            {DLI_STATUS_COPY[s].label}
          </AppText>
        </View>
      ))}
      <View style={styles.legendItem}>
        <View style={[styles.swatch, styles.bandSwatch]} />
        <AppText variant="small" color={Colors.textSecondary}>
          요구 범위
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 20,
  },
  noIcon: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },
  labels: {
    marginTop: 6,
  },
  strong: {
    fontWeight: '700',
  },
  date: {
    fontSize: 10.5,
    lineHeight: 14,
  },
  hit: {
    flex: 1,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  bandSwatch: {
    backgroundColor: BAND_FILL,
    borderWidth: 1,
    borderColor: BAND_EDGE,
  },
});
