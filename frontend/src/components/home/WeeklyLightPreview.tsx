import { ArrowRight } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AnalysisSteps } from '@/components/common/AnalysisSteps';
import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { StatusChip } from '@/components/common/StatusChip';
import { lightAnalysisSteps, lightSourceLabel } from '@/components/light/lightUi';
import { DliLegend, WeeklyDliChart } from '@/components/light/WeeklyDliChart';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDli, weekInsight } from '@/services/lightForecast';
import type { LightForecastValue } from '@/store/LightForecastProvider';
import type { Plant } from '@/types';

export interface WeeklyLightPreviewProps {
  plants: Plant[];
  selectedId: string;
  onSelect: (plantId: string) => void;
  forecast: LightForecastValue;
  onOpenDetail: (plantId: string) => void;
}

/** HOME 주간 광환경 미리보기 — 앞으로 7일 예상 DLI (자세한 수치는 상세 화면) */
export function WeeklyLightPreview({ plants, selectedId, onSelect, forecast, onOpenDetail }: WeeklyLightPreviewProps) {
  const plant = plants.find((p) => p.id === selectedId) ?? plants[0];
  const series = plant ? forecast.series[plant.id] : undefined;
  const sourceLabel = lightSourceLabel(forecast);
  const hasValues = !!series && series.upcoming.some((p) => p.dli !== null);
  const loading = forecast.status === 'loading';

  return (
    <Card padding={Spacing.lg} radius={Radius.xl}>
      {plants.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {plants.map((p) => {
            const active = p.id === plant?.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => onSelect(p.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && styles.tabActive]}>
                <AppText variant="captionStrong" color={active ? Colors.white : Colors.textSecondary}>
                  {p.name}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.header}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {plant ? `${plant.name} · 앞으로 7일` : '앞으로 7일'}
        </AppText>
        {sourceLabel ? <StatusChip label={sourceLabel} tone={forecast.source === 'mock' ? 'neutral' : 'green'} size="sm" /> : null}
      </View>

      {series && hasValues ? (
        <>
          <WeeklyDliChart
            variant="compact"
            points={series.upcoming}
            range={series.range}
            today={forecast.today}
            selectedDate={forecast.today}
            onSelectDate={() => onOpenDetail(series.plantId)}
            style={styles.chart}
          />
          <AppText variant="caption" color={Colors.textSecondary} style={styles.insight}>
            {weekInsight(series.upcoming, 'upcoming') ?? ''}
          </AppText>
          <View style={styles.footer}>
            <DliLegend style={styles.flex} />
          </View>
          <AppText variant="small" color={Colors.textTertiary} style={styles.rangeNote}>
            {`요구 DLI ${formatDli(series.range.min)}–${formatDli(series.range.max)}${
              series.range.source === 'example' ? ' (예시 범위)' : series.range.estimated ? ' (추정값)' : ''
            } · 예상치예요`}
          </AppText>
          {loading ? (
            <AppText variant="small" color={Colors.primary} style={styles.rangeNote}>
              새로 계산하는 중이에요. 끝나면 바로 바뀌어요.
            </AppText>
          ) : null}
        </>
      ) : loading ? (
        <AnalysisSteps
          title="광환경을 계산하고 있어요"
          caption="날짜마다 계산해서 조금 걸릴 수 있어요."
          steps={lightAnalysisSteps(forecast)}
          style={styles.chart}
        />
      ) : (
        <AppText variant="caption" color={Colors.textSecondary} style={styles.chart}>
          {series?.unavailableReason ?? forecast.note ?? '아직 광환경 데이터가 없어요.'}
        </AppText>
      )}

      {forecast.source === 'mock' && forecast.note ? (
        <AppText variant="small" color={Colors.textTertiary} style={styles.rangeNote}>
          {forecast.note}
        </AppText>
      ) : null}

      {plant ? (
        <Pressable
          onPress={() => onOpenDetail(plant.id)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}>
          <AppText variant="captionStrong" color={Colors.primary}>
            날짜별 자세히 보기
          </AppText>
          <ArrowRight size={14} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: {
    gap: 6,
    paddingBottom: Spacing.md,
  },
  tab: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: '#F0F1EA',
  },
  tabActive: {
    backgroundColor: Colors.deepGreen,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chart: {
    marginTop: Spacing.md,
  },
  insight: {
    marginTop: Spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  rangeNote: {
    marginTop: Spacing.xs,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: Spacing.md,
  },
});
