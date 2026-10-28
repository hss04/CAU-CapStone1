import { useLocalSearchParams } from 'expo-router';
import { Info, RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AnalysisSteps } from '@/components/common/AnalysisSteps';
import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { IconButton } from '@/components/common/IconButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { StatusChip } from '@/components/common/StatusChip';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { lightAnalysisSteps, lightSourceLabel } from '@/components/light/lightUi';
import { DliLegend, WeeklyDliChart } from '@/components/light/WeeklyDliChart';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { WeatherIcon } from '@/components/weather/WeatherIcon';
import { DLI_STATUS_COPY, WEATHER_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { formatDli, meanDli, periodStatus, weekInsight } from '@/services/lightForecast';
import { useGarden } from '@/store/GardenProvider';
import { useLightForecast } from '@/store/LightForecastProvider';
import type { DailyLightPoint, DliRange, PlantLightSeries } from '@/types';
import { formatMonthDayKo, parseISODate } from '@/utils/date';

type Period = 'recent' | 'upcoming';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'recent', label: '지난 7일' },
  { value: 'upcoming', label: '앞으로 7일' },
];

/** 주간 광환경 상세 — 날짜별 예상 DLI와 요구 범위 비교 */
export default function LightForecastScreen() {
  const params = useLocalSearchParams<{ plantId: string }>();
  const { state } = useGarden();
  const forecast = useLightForecast();
  const { plants } = state;

  const [plantId, setPlantId] = useState(params.plantId);
  const [period, setPeriod] = useState<Period>('upcoming');
  const [selected, setSelected] = useState<string | null>(forecast.today);

  const plant = plants.find((p) => p.id === plantId) ?? plants.find((p) => p.id === params.plantId);
  if (!plant) {
    return (
      <ScreenContainer header={<TopBar title="주간 광환경" />}>
        <EmptyState title="식물을 찾을 수 없어요" description="삭제되었거나 잘못된 경로예요." actionLabel="돌아가기" onAction={goBackOrHome} />
      </ScreenContainer>
    );
  }

  const series = forecast.series[plant.id];
  const points = series ? series[period] : [];
  const selectedPoint = points.find((p) => p.date === selected) ?? null;
  const species = getSpecies(plant.speciesId);
  const sourceLabel = lightSourceLabel(forecast);
  const loading = forecast.status === 'loading';
  const hasValues = points.some((p) => p.dli !== null);

  const changePeriod = (next: Period) => {
    setPeriod(next);
    const list = series?.[next] ?? [];
    // 지난 7일은 어제, 앞으로 7일은 오늘을 먼저 보여준다
    setSelected(next === 'upcoming' ? forecast.today : (list[list.length - 1]?.date ?? null));
  };

  return (
    <ScreenContainer
      header={
        <TopBar
          title="주간 광환경"
          right={
            forecast.source === 'calculated' ? (
              <IconButton icon={RefreshCw} accessibilityLabel="다시 계산" onPress={forecast.refresh} size={42} />
            ) : undefined
          }
        />
      }>
      {plants.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {plants.map((p) => {
            const active = p.id === plant.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setPlantId(p.id)}
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

      {/* 식물 */}
      <View style={styles.titleRow}>
        <View style={styles.avatar}>
          <PlantIllustration speciesId={plant.speciesId} size={52} />
        </View>
        <View style={styles.flex}>
          <AppText variant="h1">{plant.name}</AppText>
          <AppText variant="caption" color={Colors.textSecondary}>
            {plant.location.label} · <AppText variant="caption" color={Colors.textSecondary} style={styles.italic}>{species.scientificName}</AppText>
          </AppText>
        </View>
        {sourceLabel ? <StatusChip label={sourceLabel} tone={forecast.source === 'mock' ? 'neutral' : 'green'} size="sm" /> : null}
      </View>

      {forecast.source === 'mock' && forecast.note ? (
        <Card tone="muted" bordered shadow={false} padding={Spacing.md} radius={Radius.md} style={styles.section}>
          <AppText variant="caption" color={Colors.textSecondary}>
            {`${forecast.note}. 서버 계산이 연결되면 실제 계산 결과로 바뀌어요.`}
          </AppText>
        </Card>
      ) : null}

      {loading ? (
        <AnalysisSteps
          title="광환경을 계산하고 있어요"
          caption={hasValues ? '먼저 계산된 날짜부터 보여드려요.' : '날짜마다 계산해서 조금 걸릴 수 있어요.'}
          steps={lightAnalysisSteps(forecast)}
          style={styles.section}
        />
      ) : null}

      {series ? (
        <>
          {/* 요약 — 일반 사용자에게는 상태를 먼저 */}
          <View style={[styles.summary, styles.section]}>
            <PeriodTile title="지난 7일" caption="과거 날씨 기반 추정" points={series.recent} range={series.range} />
            <PeriodTile title="앞으로 7일" caption="예보 기반 예측" points={series.upcoming} range={series.range} />
          </View>

          <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={changePeriod} style={styles.section} />

          <Card padding={Spacing.lg} radius={Radius.xl} style={styles.sectionSm}>
            {series.unavailableReason ? (
              <AppText variant="caption" color={Colors.textSecondary}>
                {series.unavailableReason}
              </AppText>
            ) : (
              <>
                <AppText variant="small" color={Colors.textSecondary}>
                  예상 DLI (mol/m²/day) · 막대를 눌러 날짜별로 확인
                </AppText>
                <WeeklyDliChart
                  points={points}
                  range={series.range}
                  today={forecast.today}
                  selectedDate={selected}
                  onSelectDate={setSelected}
                  style={styles.chart}
                />
                <DliLegend style={styles.legend} />
                <AppText variant="small" color={Colors.textTertiary} style={styles.rangeNote}>
                  {rangeText(series.range)}
                </AppText>
              </>
            )}
          </Card>

          {hasValues ? (
            <Card tone={insightTone(series, period)} padding={Spacing.lg} radius={Radius.lg} style={[styles.sectionSm, styles.insight]}>
              <Info size={16} color={Colors.deepGreen} strokeWidth={1.9} />
              <AppText variant="caption" color={Colors.text} style={styles.flex}>
                {weekInsight(points, period)}
              </AppText>
            </Card>
          ) : null}

          {selectedPoint ? <DayDetail point={selectedPoint} range={series.range} today={forecast.today} /> : null}
        </>
      ) : null}

      {forecast.note && forecast.source === 'calculated' ? (
        <AppText variant="small" color={Colors.clayDeep} style={styles.sectionSm}>
          {forecast.note}
        </AppText>
      ) : null}

      <Explainer source={forecast.source} provisional={forecast.provisional} />
    </ScreenContainer>
  );
}

function rangeText(range: DliRange): string {
  const source =
    range.source === 'example' ? '앱 예시 범위 (데모용)' : range.estimated ? '식물 종 카탈로그 · 추정값' : '식물 종 카탈로그';
  return `요구 DLI ${formatDli(range.min)}–${formatDli(range.max)} mol/m²/day · ${source}`;
}

function insightTone(series: PlantLightSeries, period: Period): 'green' | 'sun' | 'muted' {
  const status = periodStatus(series[period], series.range);
  if (status === 'ok') return 'green';
  if (status === 'high') return 'sun';
  return 'muted';
}

function PeriodTile({ title, caption, points, range }: { title: string; caption: string; points: DailyLightPoint[]; range: DliRange }) {
  const mean = meanDli(points);
  const status = periodStatus(points, range);
  const copy = status ? DLI_STATUS_COPY[status] : null;
  return (
    <Card padding={Spacing.lg} radius={Radius.lg} style={styles.tile}>
      <AppText variant="label" color={Colors.textSecondary}>
        {title}
      </AppText>
      <View style={styles.tileStatus}>
        {copy ? <View style={[styles.dot, { backgroundColor: copy.color }]} /> : null}
        <AppText variant="h2">{copy ? copy.sentence : '값 없음'}</AppText>
      </View>
      <AppText variant="small" color={Colors.textSecondary}>
        {mean !== null ? `평균 ${formatDli(mean)} · ${caption}` : caption}
      </AppText>
    </Card>
  );
}

function DayDetail({ point, range, today }: { point: DailyLightPoint; range: DliRange; today: string }) {
  const date = parseISODate(point.date);
  const copy = point.status ? DLI_STATUS_COPY[point.status] : null;
  const w = point.weather;
  const isToday = point.date === today;
  const basis = point.basis === 'historical' ? '과거 기상 데이터로 추정한 값' : '기상 예보로 예측한 값';

  let compare = '';
  if (point.dli !== null) {
    if (point.dli < range.min) compare = `요구 범위보다 ${formatDli(range.min - point.dli)} 낮아요`;
    else if (point.dli > range.max) compare = `요구 범위보다 ${formatDli(point.dli - range.max)} 높아요`;
    else compare = '요구 범위 안이에요';
  }

  return (
    <Card padding={Spacing.xl} radius={Radius.xl} style={styles.sectionSm}>
      <View style={styles.dayHeader}>
        <View style={styles.flex}>
          <AppText variant="label" color={Colors.primary}>
            {isToday ? 'Today' : point.basis === 'historical' ? 'Past day' : 'Forecast'}
          </AppText>
          <AppText variant="h2" style={styles.dayTitle}>
            {formatMonthDayKo(date)}
          </AppText>
        </View>
        {copy ? <StatusChip label={copy.label} tone={copy.tone} dot /> : null}
      </View>

      <View style={styles.dayGrid}>
        <View style={styles.dayCell}>
          <AppText variant="small" color={Colors.textSecondary}>
            날씨
          </AppText>
          {w ? (
            <View style={styles.weatherRow}>
              <WeatherIcon condition={w.condition} size={18} />
              <AppText variant="bodyStrong">{WEATHER_LABEL[w.condition]}</AppText>
            </View>
          ) : (
            <AppText variant="bodyStrong" color={Colors.textTertiary}>
              —
            </AppText>
          )}
          {w && w.maxC !== null && w.minC !== null ? (
            <AppText variant="small" color={Colors.textSecondary}>
              {`${Math.round(w.minC)}° / ${Math.round(w.maxC)}°`}
              {w.sunshineHours !== null ? ` · 일조 ${w.sunshineHours}h` : ''}
            </AppText>
          ) : null}
        </View>
        <View style={styles.dayCell}>
          <AppText variant="small" color={Colors.textSecondary}>
            예상 DLI
          </AppText>
          <AppText variant="value">{point.dli !== null ? formatDli(point.dli) : '—'}</AppText>
          <AppText variant="small" color={Colors.textSecondary}>
            mol/m²/day
          </AppText>
        </View>
      </View>

      <AppText variant="caption" color={Colors.textSecondary} style={styles.dayNote}>
        {point.dli !== null ? `${compare} · ${basis}` : '이 날짜는 계산 값이 없어요.'}
      </AppText>
    </Card>
  );
}

function Explainer({ source, provisional }: { source: 'calculated' | 'mock' | null; provisional: boolean }) {
  return (
    <Card tone="muted" bordered shadow={false} padding={Spacing.lg} radius={Radius.lg} style={styles.section}>
      <AppText variant="captionStrong">DLI(하루 광량)란?</AppText>
      <AppText variant="caption" color={Colors.textSecondary} style={styles.explain}>
        식물이 하루 동안 받는 빛의 양(mol/m²/day)이에요. 창문·방 구조·창밖 가림과 날씨 데이터로 식물 자리의 값을 계산해요.
      </AppText>
      <AppText variant="caption" color={Colors.textSecondary} style={styles.explain}>
        {'· 지난 날짜: 과거 기상 데이터로 추정\n· 오늘 이후: 기상 예보로 예측\n· 실제 측정값이 아니에요. 화분 위치·커튼에 따라 달라질 수 있어요.'}
      </AppText>
      {source === 'mock' ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.explain}>
          지금 보이는 값은 화면 확인용 예시 데이터예요.
        </AppText>
      ) : provisional ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.explain}>
          연동 테스트 설정(창밖 스캔 없이 등)으로 계산한 임시 결과예요.
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
  tabs: {
    gap: 6,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
  },
  tab: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.deepGreen,
    borderColor: Colors.deepGreen,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  section: {
    marginTop: Spacing.xl,
  },
  sectionSm: {
    marginTop: Spacing.md,
  },
  summary: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  tile: {
    flex: 1,
    gap: 4,
  },
  tileStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chart: {
    marginTop: Spacing.md,
  },
  legend: {
    marginTop: Spacing.md,
  },
  rangeNote: {
    marginTop: Spacing.xs,
  },
  insight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  dayTitle: {
    marginTop: 4,
  },
  dayGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  dayCell: {
    flex: 1,
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayNote: {
    marginTop: Spacing.md,
  },
  explain: {
    marginTop: Spacing.xs,
  },
});
