import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowDown,
  CalendarDays,
  Check,
  CircleCheck,
  type LucideIcon,
  Map as MapIcon,
  Ruler,
  Sun,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AnalysisSteps } from '@/components/common/AnalysisSteps';
import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FadeInView } from '@/components/common/FadeInView';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ProgressBar } from '@/components/common/ProgressBar';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { type ChipTone, StatusChip } from '@/components/common/StatusChip';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { FloorPlanGrid, type FloorPlanMarker } from '@/components/space/FloorPlanGrid';
import { LightLegend } from '@/components/space/LightLegend';
import { ANALYSIS_STEP_LABEL, DLI_STATUS_COPY } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { useServerRecommendation } from '@/hooks/useServerRecommendation';
import { dliValueText, usePlantsDli } from '@/hooks/usePlantDli';
import { classifyDli, formatDli } from '@/services/lightForecast';
import { dliAt } from '@/services/space/dliMap';
import { type ServerPlacement, toPlacementRecommendation } from '@/services/placement/serverRecommendation';
import { useGarden, usePlant } from '@/store/GardenProvider';
import type { GridPosition, PlacementAnalysis, Plant } from '@/types';
import { withIga, withRo } from '@/utils/korean';

/**
 * 배치 추천.
 * 로그인 + 서버 DLI 지도가 있으면 서버 추천(POST /rooms/{id}/recommendations), 아니면 앱 예시 추천.
 */
export default function RecommendationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plant = usePlant(id);
  const server = useServerRecommendation(plant);

  // 적용 후에도 비교 화면을 유지하기 위해 처음 받은 결과를 보관
  const [localSnap] = useState<PlacementAnalysis | null>(() => plant?.analysis ?? null);
  const [serverSnap, setServerSnap] = useState<ServerPlacement | null>(null);
  if (server.status === 'ready' && server.placement && !serverSnap) setServerSnap(server.placement);

  if (!plant) {
    return <NoChange title="식물을 찾을 수 없어요" description="목록에서 다시 선택해 주세요." />;
  }
  if (serverSnap) return <ServerResult plant={plant} placement={serverSnap} />;
  if (server.status === 'waitingMap' || server.status === 'loading' || server.status === 'ready') {
    return <Waiting mapReady={server.status !== 'waitingMap'} />;
  }
  const note = server.status === 'error' ? `서버 추천을 불러오지 못해 예시 추천을 보여드려요 · ${server.error}` : null;
  return <LocalResult plant={plant} snapshot={localSnap} note={note} />;
}

function NoChange({ title, description }: { title: string; description: string }) {
  return (
    <ScreenContainer header={<TopBar title="배치 추천" />}>
      <EmptyState style={styles.section} title={title} description={description} actionLabel="돌아가기" onAction={goBackOrHome} />
    </ScreenContainer>
  );
}

function Waiting({ mapReady }: { mapReady: boolean }) {
  return (
    <ScreenContainer header={<TopBar title="배치 추천" />}>
      <AnalysisSteps
        style={styles.section}
        title="추천 위치를 찾고 있어요"
        caption="공간 화면에서 고른 기간의 일조 환경으로 계산해요."
        steps={[
          { key: 'dli', label: ANALYSIS_STEP_LABEL.dli, status: mapReady ? 'done' : 'active' },
          { key: 'recommend', label: ANALYSIS_STEP_LABEL.recommend, status: mapReady ? 'active' : 'pending' },
        ]}
      />
    </ScreenContainer>
  );
}

/** 앱 예시 추천 (로그인 전·서버 DLI 지도 없음) — 값은 예시 DLI 지도에서 읽는다 */
function LocalResult({ plant, snapshot, note }: { plant: Plant; snapshot: PlacementAnalysis | null; note: string | null }) {
  const { state, actions } = useGarden();
  const { byId, map } = usePlantsDli();
  const light = byId[plant.id];
  const rec = snapshot?.recommended;
  if (!snapshot || !rec || !light) {
    return <NoChange title="지금 위치가 가장 좋아요" description="이 식물은 이미 가장 잘 맞는 자리에 있어요." />;
  }
  const current = snapshot.current;
  const range = light.range;
  // 진입 시점 자리 기준 값 (적용 후에도 비교 화면 유지)
  const curDli = dliAt(map.map, current.position.x, current.position.y)?.total ?? null;
  const recDli = dliAt(map.map, rec.position.x, rec.position.y)?.total ?? null;
  const status = (dli: number | null) => (dli === null ? null : classifyDli(dli, range));
  const progress = (dli: number | null) => (dli === null ? 0 : Math.min(100, Math.round((dli / Math.max(range.max, 0.1)) * 100)));
  const delta = curDli !== null && recDli !== null ? recDli - curDli : null;
  const deltaLabel = delta === null ? 'DLI' : `DLI ${delta >= 0 ? '+' : ''}${formatDli(delta)}`;
  const statusLabel = (dli: number | null) => {
    const s = status(dli);
    return s ? DLI_STATUS_COPY[s].label : '—';
  };

  return (
    <ResultLayout
      plant={plant}
      source={{ label: '예시 데이터', tone: 'neutral' }}
      note={note}
      title="더 좋은 자리를 찾았어요"
      planChip={{ label: deltaLabel, tone: 'green' }}
      deltaLabel={deltaLabel}
      current={{ place: current.label, position: current.position, progress: progress(curDli), value: dliValueText(curDli), light: `mol/m²/day · ${statusLabel(curDli)}` }}
      recommended={{ place: rec.label, position: rec.position, progress: progress(recDli), value: dliValueText(recDli), light: `mol/m²/day · ${statusLabel(recDli)}` }}
      metrics={[
        { icon: Sun, label: '요구 DLI', value: `${range.min}–${range.max}`, sub: 'mol/m²/day' },
        { icon: MapIcon, label: '추천 칸', value: dliValueText(recDli), sub: statusLabel(recDli) },
        { icon: Ruler, label: '창문까지', value: `${rec.distanceFromWindowM}m`, sub: '추천 칸 기준' },
      ]}
      reasons={[`요구 DLI ${range.min}–${range.max} mol/m²/day와 칸별 예상 DLI를 비교했어요.`, ...rec.reasons]}
      basis={`${state.room.orientationLabel} 창문 ${state.room.windows.length}개 기준 예시 지도예요. 실제 계산값이 아니에요.`}
      successText={`이제 ${withIga(plant.name)} ${rec.label}에서 하루 약 ${dliValueText(recDli)} mol/m²/day 빛을 받을 것으로 예상돼요.`}
      onApply={() => actions.applyRecommendation(plant.id)}
    />
  );
}

/** 서버 추천 (칸별 예상 DLI와 식물 요구 DLI 범위 비교) */
function ServerResult({ plant, placement }: { plant: Plant; placement: ServerPlacement }) {
  const { state, actions } = useGarden();
  const { required, current, recommended: rec, noFitCell, period, warnings } = placement;
  const range = `${required.min}–${required.max}`;

  if (!rec) {
    return current ? (
      <NoChange
        title="지금 위치가 잘 맞아요"
        description={`예상 DLI ${formatDli(current.dli)} · 요구 ${range} mol/m²/day 범위 안이에요. (LUMAP 계산)`}
      />
    ) : (
      <NoChange title="추천할 빈 칸이 없어요" description="다른 식물이나 배치 불가 칸을 빼면 남는 칸이 없어요." />
    );
  }

  const progress = (dli: number) => Math.min(100, Math.round((dli / Math.max(required.max, 0.1)) * 100));
  const delta = rec.dli - (current?.dli ?? 0);
  const deltaLabel = `DLI ${delta >= 0 ? '+' : ''}${formatDli(delta)}`;
  const periodText = period ? `${period.startDate} ~ ${period.endDate} 하루 평균` : '선택한 기간 하루 평균';

  const reasons = [
    `${getSpecies(plant.speciesId).name} 요구 DLI ${range} mol/m²/day와 칸별 예상 DLI를 비교했어요.`,
    current
      ? `지금 자리의 예상 DLI는 ${formatDli(current.dli)}(${DLI_STATUS_COPY[current.status].label})예요.`
      : '아직 자리를 정하지 않은 식물이에요.',
    noFitCell
      ? `방 안에 요구 범위에 드는 빈 칸이 없어요. 추천 칸의 예상 DLI도 ${formatDli(rec.dli)}(${DLI_STATUS_COPY[rec.status].label})예요.`
      : `추천 칸의 예상 DLI는 ${formatDli(rec.dli)}로 요구 범위 안이에요.`,
    '다른 식물이 있는 칸과 배치 불가 칸은 빼고 골랐어요.',
    ...warnings,
  ];

  return (
    <ResultLayout
      plant={plant}
      source={{ label: 'LUMAP 계산', tone: 'green' }}
      note={noFitCell ? '요구 범위에 드는 빈 칸이 없어 서버가 고른 칸을 참고로만 보여드려요.' : null}
      title={noFitCell ? '요구 범위에 맞는 칸이 없어요' : '더 좋은 자리를 찾았어요'}
      planChip={noFitCell ? { label: '범위에 맞는 칸 없음', tone: 'dusk' } : { label: deltaLabel, tone: 'green' }}
      deltaLabel={deltaLabel}
      current={
        current
          ? { place: current.label, position: current.position, progress: progress(current.dli), value: formatDli(current.dli), light: `mol/m²/day · ${DLI_STATUS_COPY[current.status].label}` }
          : { place: '자리 없음', position: null, progress: 0, value: '—', light: '' }
      }
      recommended={{ place: rec.label, position: rec.position, progress: progress(rec.dli), value: formatDli(rec.dli), light: `mol/m²/day · ${DLI_STATUS_COPY[rec.status].label}` }}
      metrics={[
        { icon: Sun, label: '요구 DLI', value: range, sub: 'mol/m²/day' },
        { icon: MapIcon, label: '추천 칸', value: formatDli(rec.dli), sub: DLI_STATUS_COPY[rec.status].label },
        { icon: CalendarDays, label: '계산 기간', value: period ? `${period.dayCount}일` : '—', sub: '하루 평균' },
      ]}
      reasons={reasons}
      basis={`${periodText} · LUMAP 계산 · 실제 측정값이 아니에요.`}
      successText={`이제 ${withIga(plant.name)} ${rec.label}에서 하루 약 ${formatDli(rec.dli)} mol/m²/day 빛을 받을 것으로 예상돼요.`}
      onApply={noFitCell ? null : () => actions.applyRecommendation(plant.id, toPlacementRecommendation(state.room, placement) ?? undefined)}
    />
  );
}

interface CompareData {
  place: string;
  position: GridPosition | null;
  /** 0~100 막대 길이 */
  progress: number;
  value: string;
  light: string;
}

interface ResultLayoutProps {
  plant: Plant;
  source: { label: string; tone: ChipTone };
  note: string | null;
  title: string;
  planChip: { label: string; tone: ChipTone };
  deltaLabel: string;
  current: CompareData;
  recommended: CompareData & { position: GridPosition };
  metrics: { icon: LucideIcon; label: string; value: string; sub: string }[];
  reasons: string[];
  basis: string;
  successText: string;
  /** null이면 '이 위치로 설정' 없이 둘러보기만 */
  onApply: (() => Promise<void>) | null;
}

function ResultLayout(props: ResultLayoutProps) {
  const { plant, current, recommended: rec, onApply } = props;
  const { state } = useGarden();
  const toast = useToast();
  const [applied, setApplied] = useState(false);
  const species = getSpecies(plant.speciesId);

  const others: FloorPlanMarker[] = state.plants
    .filter((p) => p.id !== plant.id)
    .map((p) => ({ id: p.id, position: p.location.position, variant: 'ghost' }));

  const markers: FloorPlanMarker[] = applied
    ? [...others, { id: 'moved', position: rec.position, variant: 'plant', label: '새 위치', showLabel: true }]
    : [
        ...others,
        ...(current.position
          ? [{ id: 'current', position: current.position, variant: 'current' as const, label: '현재 위치', showLabel: true }]
          : []),
        { id: 'rec', position: rec.position, variant: 'recommended', label: '추천 위치', showLabel: true },
      ];

  const handleApply = async () => {
    if (!onApply) return;
    try {
      await onApply();
      setApplied(true);
      toast.show('추천 위치로 변경했어요 🌿', 'leaf');
    } catch (e) {
      toast.show(`위치를 바꾸지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'leaf');
    }
  };

  const footer = applied ? (
    <View style={styles.footerRow}>
      <SecondaryButton
        title="공간 보기"
        icon={MapIcon}
        fullWidth={false}
        style={styles.flex}
        onPress={() => {
          router.dismissAll();
          router.navigate('/space');
        }}
      />
      <PrimaryButton title="완료" tone="deep" fullWidth={false} style={styles.flex} onPress={goBackOrHome} />
    </View>
  ) : onApply ? (
    <PrimaryButton title="이 위치로 설정" icon={Check} onPress={handleApply} />
  ) : (
    <PrimaryButton title="돌아가기" tone="deep" onPress={goBackOrHome} />
  );

  return (
    <ScreenContainer header={<TopBar title="배치 추천" />} footer={footer}>
      {/* Title */}
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <View style={styles.eyebrowRow}>
            <AppText variant="label" color={Colors.primary}>
              Placement result
            </AppText>
            <StatusChip label={props.source.label} tone={props.source.tone} size="sm" />
          </View>
          <AppText variant="title" style={styles.title}>
            {applied ? `${withRo(rec.place)} 옮겼어요` : props.title}
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.subtitle}>
            {plant.name} · <AppText variant="caption" color={Colors.textSecondary} style={styles.italic}>{species.scientificName}</AppText>
          </AppText>
        </View>
        <View style={styles.avatar}>
          <PlantIllustration speciesId={plant.speciesId} size={58} />
        </View>
      </View>

      {props.note ? (
        <Card padding={Spacing.md} radius={Radius.md} style={styles.sectionSm}>
          <AppText variant="small" color={Colors.textSecondary}>
            {props.note}
          </AppText>
        </Card>
      ) : null}

      {/* Floor plan */}
      <Card padding={Spacing.lg} radius={Radius.xl} style={styles.section}>
        <View style={styles.planHeader}>
          <AppText variant="h3">{state.room.name}</AppText>
          <StatusChip
            label={applied ? '위치 변경 완료' : props.planChip.label}
            tone={applied ? 'deep' : props.planChip.tone}
            size="sm"
            icon={applied ? CircleCheck : undefined}
          />
        </View>
        <View style={styles.plan}>
          <FloorPlanGrid
            room={state.room}
            showFurnitureLabels
            markers={markers}
            path={applied || !current.position ? null : { from: current.position, to: rec.position }}
          />
        </View>
        <LightLegend showPlant={false} showWindow={false} showRecommendation style={styles.legend} />
      </Card>

      {/* Compare */}
      <Card padding={Spacing.xl} radius={Radius.xl} style={styles.sectionSm}>
        <CompareRow kind="current" title="현재 위치" data={current} dimmed={applied} />
        <View style={styles.arrowRow}>
          <View style={styles.arrowLine} />
          <View style={styles.arrowCircle}>
            <ArrowDown size={16} color={Colors.primary} strokeWidth={2.2} />
          </View>
          <StatusChip label={props.deltaLabel} tone="green" size="sm" />
          <View style={styles.arrowLine} />
        </View>
        <CompareRow kind="recommended" title="추천 위치" data={rec} />
      </Card>

      {applied ? (
        <FadeInView>
          <Card tone="green" padding={Spacing.lg} radius={Radius.lg} style={[styles.sectionSm, styles.successCard]}>
            <View style={styles.successIcon}>
              <CircleCheck size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" color={Colors.deepGreen}>
                추천 위치로 변경했어요 🌿
              </AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                {props.successText}
              </AppText>
            </View>
          </Card>
        </FadeInView>
      ) : null}

      {/* Metrics */}
      <View style={[styles.metrics, styles.sectionSm]}>
        {props.metrics.map((m) => (
          <Card key={m.label} padding={Spacing.md} radius={Radius.md} style={styles.metric}>
            <m.icon size={16} color={Colors.primary} strokeWidth={1.8} />
            <AppText variant="small" color={Colors.textSecondary} style={styles.metricLabel}>
              {m.label}
            </AppText>
            <AppText variant="heading" style={styles.metricValue}>
              {m.value}
            </AppText>
            <AppText variant="small" color={Colors.primary}>
              {m.sub}
            </AppText>
          </Card>
        ))}
      </View>

      {/* Reasons */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Why here" title="추천 이유" />
        <Card padding={Spacing.xl} radius={Radius.xl}>
          {props.reasons.map((r, i) => (
            <View key={r} style={[styles.reason, i < props.reasons.length - 1 && styles.reasonDivider]}>
              <View style={styles.check}>
                <Check size={13} color={Colors.white} strokeWidth={3} />
              </View>
              <AppText variant="body" style={styles.flex}>
                {r}
              </AppText>
            </View>
          ))}
          <View style={styles.basis}>
            <Sun size={14} color={Colors.sunlightDeep} strokeWidth={1.9} />
            <AppText variant="small" color={Colors.textSecondary} style={styles.flex}>
              {props.basis}
            </AppText>
          </View>
        </Card>
      </View>
    </ScreenContainer>
  );
}

function CompareRow({
  kind,
  title,
  data,
  dimmed,
}: {
  kind: 'current' | 'recommended';
  title: string;
  data: CompareData;
  dimmed?: boolean;
}) {
  const rec = kind === 'recommended';
  const color = rec ? Colors.primary : Colors.markerGray;
  return (
    <View style={[styles.compareRow, dimmed && { opacity: 0.55 }]}>
      <View style={[styles.compareDot, { backgroundColor: rec ? Colors.primary : Colors.surface, borderColor: color }]} />
      <View style={styles.flex}>
        <AppText variant="small" color={rec ? Colors.primary : Colors.textSecondary}>
          {title}
        </AppText>
        <AppText variant="h2">{data.place}</AppText>
        <ProgressBar
          value={data.progress}
          height={6}
          color={color}
          trackColor={rec ? Colors.lightGreen : '#EEEFE9'}
          style={styles.compareBar}
        />
      </View>
      <View style={styles.compareScore}>
        <AppText variant="valueLarge" color={rec ? Colors.deepGreen : Colors.textSecondary}>
          {data.value}
        </AppText>
        <AppText variant="small" color={Colors.textSecondary}>
          {data.light}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: 4,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  section: {
    marginTop: Spacing.xxl,
  },
  sectionSm: {
    marginTop: Spacing.lg,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  plan: {
    marginTop: Spacing.xs,
  },
  legend: {
    marginTop: Spacing.md,
    justifyContent: 'center',
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  compareDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
  },
  compareBar: {
    marginTop: Spacing.sm,
  },
  compareScore: {
    alignItems: 'flex-end',
    minWidth: 84,
  },
  arrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.lg,
  },
  arrowLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  arrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  successIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metrics: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  metric: {
    flex: 1,
    gap: 2,
  },
  metricLabel: {
    marginTop: Spacing.sm,
  },
  metricValue: {
    fontSize: 23,
    lineHeight: 28,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 13,
  },
  reasonDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  basis: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceMuted,
  },
  footerRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
});
