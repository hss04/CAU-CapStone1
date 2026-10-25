import { Clock, Sun } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { LIGHT_LEGEND, type LightSummary } from '@/services/space/lightAnalysis';

export interface LightSummaryCardProps {
  summary: LightSummary;
  timeLabel: string;
}

/** 공간 전체 빛 분포 요약 (High / Medium / Low 비율) */
export function LightSummaryCard({ summary, timeLabel }: LightSummaryCardProps) {
  const parts = [
    { ...LIGHT_LEGEND[0], value: summary.high },
    { ...LIGHT_LEGEND[1], value: summary.medium },
    { ...LIGHT_LEGEND[2], value: summary.low },
  ];

  return (
    <Card padding={Spacing.xl} radius={Radius.xl}>
      <View style={styles.header}>
        <View>
          <AppText variant="label" color={Colors.primary}>
            Light analysis
          </AppText>
          <AppText variant="h2" style={styles.title}>
            빛 분포 · {timeLabel}
          </AppText>
        </View>
        <View style={styles.hours}>
          <Clock size={14} color={Colors.sunlightDeep} strokeWidth={2} />
          <AppText variant="captionStrong" color={Colors.sunlightDeep}>
            평균 {summary.averageSunHours}h
          </AppText>
        </View>
      </View>

      <View style={styles.bar}>
        {parts.map((p) => (
          <View
            key={p.level}
            style={[styles.segment, { flex: Math.max(p.value, 1), backgroundColor: p.color }]}
          />
        ))}
      </View>

      <View style={styles.legend}>
        {parts.map((p) => (
          <View key={p.level} style={styles.legendItem}>
            <View style={styles.legendTop}>
              <View style={[styles.swatch, { backgroundColor: p.color }]} />
              <AppText variant="small" color={Colors.textSecondary}>
                {p.label} · {p.labelKo}
              </AppText>
            </View>
            <AppText variant="value" style={styles.pct}>
              {`${p.value}%`}
            </AppText>
          </View>
        ))}
      </View>

      <View style={styles.tip}>
        <Sun size={15} color={Colors.sunlightDeep} strokeWidth={1.9} />
        <AppText variant="caption" color={Colors.text} style={styles.flex}>
          창가 쪽 {summary.high}% 구역은 햇빛이 충분해요. 방 안쪽은 반그늘 식물에게 좋아요.
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    marginTop: 4,
  },
  hours: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.sunlightSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    marginTop: Spacing.lg,
    gap: 3,
  },
  segment: {
    height: '100%',
    borderRadius: 4,
  },
  legend: {
    flexDirection: 'row',
    marginTop: Spacing.md,
  },
  legendItem: {
    flex: 1,
    gap: 2,
  },
  legendTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  pct: {
    fontSize: 24,
    lineHeight: 28,
  },
  tip: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
});
