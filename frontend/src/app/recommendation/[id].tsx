import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDown, Check, CircleCheck, Clock, Map as MapIcon, Ruler, ShieldCheck, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FadeInView } from '@/components/common/FadeInView';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ProgressBar } from '@/components/common/ProgressBar';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { FloorPlanGrid, type FloorPlanMarker } from '@/components/space/FloorPlanGrid';
import { LightLegend } from '@/components/space/LightLegend';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { lightLabelFor } from '@/services/placement/placementEngine';
import { useGarden, usePlant } from '@/store/GardenProvider';
import type { PlacementAnalysis } from '@/types';
import { withIga, withRo } from '@/utils/korean';

export default function RecommendationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plant = usePlant(id);
  const { state, actions } = useGarden();
  const toast = useToast();

  // 적용 후에도 비교 화면을 유지하기 위해 진입 시점의 분석 결과를 보관
  const [snapshot] = useState<PlacementAnalysis | null>(() => plant?.analysis ?? null);
  const [applied, setApplied] = useState(false);

  const rec = snapshot?.recommended;

  if (!plant || !snapshot || !rec) {
    return (
      <ScreenContainer header={<TopBar title="배치 추천" />}>
        <EmptyState
          style={styles.section}
          title="지금 위치가 가장 좋아요"
          description="이 식물은 이미 가장 잘 맞는 자리에 있어요."
          actionLabel="돌아가기"
          onAction={goBackOrHome}
        />
      </ScreenContainer>
    );
  }

  const species = getSpecies(plant.speciesId);
  const current = snapshot.current;
  const gain = rec.score - current.score;
  const sunGain = Math.round((rec.expectedSunHours - current.expectedSunHours) * 10) / 10;

  const others: FloorPlanMarker[] = state.plants
    .filter((p) => p.id !== plant.id)
    .map((p) => ({ id: p.id, position: p.location.position, variant: 'ghost' }));

  const markers: FloorPlanMarker[] = applied
    ? [...others, { id: 'moved', position: rec.position, variant: 'plant', label: '새 위치', showLabel: true }]
    : [
        ...others,
        { id: 'current', position: current.position, variant: 'current', label: '현재 위치', showLabel: true },
        { id: 'rec', position: rec.position, variant: 'recommended', label: '추천 위치', showLabel: true },
      ];

  const handleApply = async () => {
    try {
      await actions.applyRecommendation(plant.id);
      setApplied(true);
      toast.show('추천 위치로 변경했어요 🌿', 'leaf');
    } catch (e) {
      toast.show(`위치를 바꾸지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'leaf');
    }
  };

  const metrics = [
    { icon: Clock, label: '예상 일조', value: `${rec.expectedSunHours}h`, sub: sunGain > 0 ? `+${sunGain}h` : `${sunGain}h` },
    { icon: Ruler, label: '창문까지', value: `${rec.distanceFromWindowM}m`, sub: '적당한 거리' },
    { icon: ShieldCheck, label: '직사광선', value: rec.lightValue > 86 ? '강함' : '낮음', sub: rec.lightValue > 86 ? '주의' : '안전' },
  ];

  return (
    <ScreenContainer
      header={<TopBar title="배치 추천" />}
      footer={
        applied ? (
          <View style={styles.footerRow}>
            <SecondaryButton title="공간 보기" icon={MapIcon} fullWidth={false} style={styles.flex} onPress={() => {
              router.dismissAll();
              router.navigate('/space');
            }} />
            <PrimaryButton title="완료" tone="deep" fullWidth={false} style={styles.flex} onPress={goBackOrHome} />
          </View>
        ) : (
          <PrimaryButton title="이 위치로 설정" icon={Check} onPress={handleApply} />
        )
      }>
      {/* Title */}
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <AppText variant="label" color={Colors.primary}>
            Placement result
          </AppText>
          <AppText variant="title" style={styles.title}>
            {applied ? `${withRo(rec.label)} 옮겼어요` : '더 좋은 자리를 찾았어요'}
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.subtitle}>
            {plant.name} · <AppText variant="caption" color={Colors.textSecondary} style={styles.italic}>{species.scientificName}</AppText>
          </AppText>
        </View>
        <View style={styles.avatar}>
          <PlantIllustration speciesId={plant.speciesId} size={58} />
        </View>
      </View>

      {/* Floor plan */}
      <Card padding={Spacing.lg} radius={Radius.xl} style={styles.section}>
        <View style={styles.planHeader}>
          <AppText variant="h3">{state.room.name}</AppText>
          <StatusChip
            label={applied ? '위치 변경 완료' : `적합도 +${gain}%p`}
            tone={applied ? 'deep' : 'green'}
            size="sm"
            icon={applied ? CircleCheck : undefined}
          />
        </View>
        <View style={styles.plan}>
          <FloorPlanGrid
            room={state.room}
            showFurnitureLabels
            markers={markers}
            path={applied ? null : { from: current.position, to: rec.position }}
          />
        </View>
        <LightLegend showPlant={false} showWindow={false} showRecommendation style={styles.legend} />
      </Card>

      {/* Compare */}
      <Card padding={Spacing.xl} radius={Radius.xl} style={styles.sectionSm}>
        <CompareRow
          kind="current"
          title="현재 위치"
          place={current.label}
          score={current.score}
          light={lightLabelFor(current.lightLevel)}
          dimmed={applied}
        />
        <View style={styles.arrowRow}>
          <View style={styles.arrowLine} />
          <View style={styles.arrowCircle}>
            <ArrowDown size={16} color={Colors.primary} strokeWidth={2.2} />
          </View>
          <StatusChip label={`+${gain}%p`} tone="green" size="sm" />
          <View style={styles.arrowLine} />
        </View>
        <CompareRow kind="recommended" title="추천 위치" place={rec.label} score={rec.score} light={rec.lightLabel} />
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
                이제 {withIga(plant.name)} {rec.label}에서 하루 약 {rec.expectedSunHours}시간 빛을 받아요.
              </AppText>
            </View>
          </Card>
        </FadeInView>
      ) : null}

      {/* Metrics */}
      <View style={[styles.metrics, styles.sectionSm]}>
        {metrics.map((m) => (
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
          {rec.reasons.map((r, i) => (
            <View key={r} style={[styles.reason, i < rec.reasons.length - 1 && styles.reasonDivider]}>
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
              {state.room.orientationLabel} 창문 {state.room.windows.length}개 기준 하루 평균 빛 분석 결과예요.
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
  place,
  score,
  light,
  dimmed,
}: {
  kind: 'current' | 'recommended';
  title: string;
  place: string;
  score: number;
  light: string;
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
        <AppText variant="h2">{place}</AppText>
        <ProgressBar
          value={score}
          height={6}
          color={color}
          trackColor={rec ? Colors.lightGreen : '#EEEFE9'}
          style={styles.compareBar}
        />
      </View>
      <View style={styles.compareScore}>
        <AppText variant="valueLarge" color={rec ? Colors.deepGreen : Colors.textSecondary}>
          {`${score}%`}
        </AppText>
        <AppText variant="small" color={Colors.textSecondary}>
          {light}
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
