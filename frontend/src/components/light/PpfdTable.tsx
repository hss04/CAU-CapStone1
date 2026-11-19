import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatClock } from '@/components/light/DailyPpfdChart';
import type { CellPpfd } from '@/services/lightForecast';

/** 직사광이 '든다'고 볼 최소값 (DayPpfdCard와 같은 기준) */
const DIRECT_MIN = 1;
const HOUR_COL_W = 34;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 하루 10분 PPFD를 시(행) × 10분(열) 표로 보여준다 — 그래프를 끌지 않고도 특정 시각 값을 바로 읽고,
 * 광량기 값과 시각을 맞춰 비교하기 쉽게. 각 칸은 그 시각을 가운데로 한 10분 구간 값이다 (14:15 = 14:10~14:20).
 * 칸을 누르면 위 줄에 직사·산란 값을 나눠 보여주고, 그래프의 고른 시각도 같이 바뀐다.
 */
export function PpfdTable({
  data,
  active,
  onPick,
  style,
}: {
  data: CellPpfd;
  active: number;
  onPick: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { minutes, direct, diffuse } = data;
  if (minutes.length === 0) return null;

  const total = direct.map((d, i) => d + diffuse[i]);
  const hours = Array.from(new Set(minutes.map((m) => Math.floor(m / 60)))).sort((a, b) => a - b);
  const cols = Array.from(new Set(minutes.map((m) => m % 60))).sort((a, b) => a - b);
  const indexOf = new Map(minutes.map((m, i) => [m, i]));
  const a = active >= 0 && active < minutes.length ? active : 0;

  return (
    <View style={style}>
      <View style={styles.selected}>
        <AppText variant="bodyStrong">{formatClock(minutes[a])}</AppText>
        <AppText variant="caption" color={Colors.text}>
          {`전체 ${total[a].toFixed(1)}`}
        </AppText>
        <AppText variant="caption" color={Colors.textSecondary}>
          {`직사 ${direct[a].toFixed(1)} · 산란 ${diffuse[a].toFixed(1)} μmol/m²/s`}
        </AppText>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]}>
          <View style={styles.hourCell} />
          {cols.map((c) => (
            <AppText key={`h-${c}`} variant="small" color={Colors.textSecondary} style={styles.headCell}>
              {`:${pad2(c)}`}
            </AppText>
          ))}
        </View>
        {hours.map((h) => (
          <View key={`r-${h}`} style={styles.row}>
            <AppText variant="small" color={Colors.textSecondary} style={styles.hourCell}>
              {`${h}시`}
            </AppText>
            {cols.map((c) => {
              const i = indexOf.get(h * 60 + c);
              if (i === undefined) return <View key={`c-${h}-${c}`} style={styles.cell} />;
              const sunny = direct[i] >= DIRECT_MIN;
              const picked = i === a;
              return (
                <Pressable
                  key={`c-${h}-${c}`}
                  onPress={() => onPick(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatClock(minutes[i])} 전체 ${total[i].toFixed(1)} 마이크로몰`}
                  style={[styles.cell, sunny && styles.sunnyCell, picked && styles.pickedCell]}>
                  <AppText variant="small" color={picked ? Colors.deepGreen : Colors.text} style={styles.value}>
                    {total[i].toFixed(1)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <AppText variant="small" color={Colors.textTertiary} style={styles.note}>
        단위 μmol/m²/s · 노란 칸은 직사광이 드는 시간이에요. 날씨 자료가 1시간 단위라 산란광은 한 시간 안에서 같은 값이에요.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  selected: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.md,
    rowGap: 2,
    marginBottom: Spacing.sm,
  },
  table: {
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: Radius.xs,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  headRow: {
    borderTopWidth: 0,
    backgroundColor: Colors.surfaceMuted,
  },
  hourCell: {
    width: HOUR_COL_W,
    paddingVertical: 6,
    textAlign: 'center',
  },
  headCell: {
    flex: 1,
    paddingVertical: 6,
    textAlign: 'center',
  },
  cell: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sunnyCell: {
    backgroundColor: Colors.sunlightSoft,
  },
  pickedCell: {
    borderColor: Colors.primary,
    backgroundColor: Colors.lightGreen,
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
  note: {
    marginTop: Spacing.sm,
  },
});
