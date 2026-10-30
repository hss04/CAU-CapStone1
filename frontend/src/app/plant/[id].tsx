import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowRight,
  ChevronRight,
  CircleCheck,
  Droplet,
  Gauge,
  Heart,
  MapPin,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Waves,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { InfoCard } from '@/components/common/InfoCard';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScoreRing } from '@/components/common/ScoreRing';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { WaterCycle } from '@/components/plants/WaterCycle';
import { FloorPlanGrid } from '@/components/space/FloorPlanGrid';
import { DLI_STATUS_COPY, LIGHT_PREFERENCE_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { dliValueText, rangeText, usePlantDli } from '@/hooks/usePlantDli';
import { recentStatusOf } from '@/services/lightForecast';
import { useGarden, usePlant } from '@/store/GardenProvider';
import { useLightForecast } from '@/store/LightForecastProvider';
import { getHealthLabel, getPlantStatus, getWateringInfo } from '@/store/selectors';
import type { DliStatus } from '@/types';
import { withEge } from '@/utils/korean';

export default function PlantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plant = usePlant(id);
  const { state, today, actions } = useGarden();
  const forecast = useLightForecast();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const light = usePlantDli(plant);

  if (!plant) {
    return (
      <ScreenContainer header={<TopBar />}>
        <EmptyState title="식물을 찾을 수 없어요" description="삭제되었거나 잘못된 경로예요." actionLabel="돌아가기" onAction={goBackOrHome} />
      </ScreenContainer>
    );
  }

  const species = getSpecies(plant.speciesId);
  const status = getPlantStatus(plant, today);
  const water = getWateringInfo(plant, today);
  const health = getHealthLabel(plant, today);
  const current = plant.analysis.current;
  // 예상 DLI 기준 (예시 방: 앱 예시 추천 칸 · 서버 방: 범위 밖이면 추천 화면에서 서버 추천)
  const recommended = light?.recommended ?? null;
  const pending = !light || light.source === 'pending';
  const outOfRange = !pending && !recommended && !!light?.current.status && light.current.status !== 'ok';
  const ringProgress = (dli: number | null) =>
    dli === null || !light ? 0 : Math.min(100, Math.round((dli / Math.max(light.range.max, 0.1)) * 100));
  const statusText = (s: DliStatus | null) => (s ? DLI_STATUS_COPY[s].label : '계산 전');

  const handleWater = () => {
    toast.show(`${withEge(plant.name)} 물을 줬어요 💧`, 'water');
    actions.waterPlants([plant.id]).then((saved) => {
      if (!saved) toast.show('서버에 저장하지 못했어요 · 앱에만 기록했어요', 'water');
    });
  };

  const openRecommendation = () => router.push({ pathname: '/recommendation/[id]', params: { id: plant.id } });
  const serverSpecies = state.serverSpecies[plant.speciesId];

  // 실수로 지우지 않도록 두 번 눌러야 삭제 (웹에서는 Alert가 동작하지 않아 버튼으로 확인)
  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await actions.deletePlant(plant.id);
      toast.show(`${plant.name}을(를) 삭제했어요`, 'leaf');
      goBackOrHome();
    } catch (e) {
      toast.show(`삭제하지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'leaf');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <ScreenContainer header={<TopBar title={plant.name} />}>
      {/* Hero */}
      <View style={styles.hero}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="hero-beam" x1="1" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.8} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Polygon points="64,0 80,0 34,100 14,100" fill="url(#hero-beam)" />
          <Polygon points="88,0 95,0 60,100 50,100" fill="url(#hero-beam)" opacity={0.7} />
        </Svg>
        <StatusChip label={status.label} tone={status.tone} dot style={styles.heroChip} />
        <PlantIllustration speciesId={plant.speciesId} size={176} />
      </View>

      {/* Title */}
      <View style={styles.titleBlock}>
        <AppText variant="display">{species.englishName}</AppText>
        <AppText variant="body" color={Colors.textSecondary} style={styles.scientific}>
          {species.scientificName}
        </AppText>
        <View style={styles.tags}>
          <StatusChip label={plant.name} tone="deep" size="sm" />
          <StatusChip label={LIGHT_PREFERENCE_LABEL[plant.preferredLight]} tone="sun" size="sm" icon={Sun} />
          <StatusChip label={`난이도 ${species.difficulty}`} tone="neutral" size="sm" />
        </View>
      </View>

      {/* Current status */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Status" title="현재 상태" />
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <InfoCard
              compact
              label="DLI"
              value={light ? dliValueText(light.current.dli) : '—'}
              caption={light ? `${statusText(light.current.status)} · ${rangeText(light.range)}` : '계산 전'}
              icon={Sun}
              tone="sun"
            />
            <InfoCard compact label="Water" value={water.label} caption={`${plant.wateringIntervalDays}일마다`} icon={Droplet} tone="water" />
          </View>
          <View style={styles.gridRow}>
            <InfoCard compact label="Location" value={plant.location.label} caption={state.room.name} icon={MapPin} tone="green" />
            <InfoCard compact label="Health" value={health.label} caption={health.caption} icon={Heart} tone="clay" />
          </View>
        </View>
      </View>

      {/* Weekly light — 날짜별 예상 광량 */}
      <WeeklyLightLink
        status={forecast.series[plant.id] ? recentStatusOf(forecast.series[plant.id]) : null}
        mock={forecast.source === 'mock'}
        onPress={() => router.push({ pathname: '/light/[plantId]', params: { plantId: plant.id } })}
      />

      {/* Watering */}
      <View style={styles.section}>
        <Card tone="surface" padding={Spacing.xl} radius={Radius.xl}>
          <View style={styles.cardHeader}>
            <View style={styles.flex}>
              <AppText variant="label" color={Colors.waterDeep}>
                Watering
              </AppText>
              <AppText variant="h2" style={styles.cardTitle}>
                다음 물주기
              </AppText>
            </View>
            <AppText variant="valueLarge" color={water.isDue ? Colors.waterDeep : Colors.text}>
              {water.labelKo}
            </AppText>
          </View>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.cardCaption}>
            {plant.wateringIntervalDays}일마다 · 마지막 물주기 {water.daysSinceWatered === 0 ? '오늘' : `${water.daysSinceWatered}일 전`}
          </AppText>
          <View style={styles.cycle}>
            <WaterCycle intervalDays={plant.wateringIntervalDays} daysSinceWatered={water.daysSinceWatered} />
          </View>
          {water.wateredToday ? (
            <View style={styles.watered}>
              <CircleCheck size={18} color={Colors.primary} strokeWidth={2} />
              <AppText variant="bodyStrong" color={Colors.deepGreen}>
                오늘 물을 줬어요
              </AppText>
            </View>
          ) : (
            <PrimaryButton title="물 줬어요" icon={Droplet} tone="water" onPress={handleWater} />
          )}
        </Card>
      </View>

      {/* Placement */}
      <View style={styles.section}>
        <Card padding={Spacing.xl} radius={Radius.xl}>
          <AppText variant="label" color={Colors.primary}>
            Placement
          </AppText>
          <AppText variant="h2" style={styles.cardTitle}>
            배치 분석
          </AppText>

          <View style={styles.miniPlan}>
            <FloorPlanGrid
              room={state.room}
              showFurnitureLabels={false}
              showWindowLabels={false}
              surfaceColor={Colors.surfaceMuted}
              markers={[
                { id: 'cur', position: current.position, variant: recommended ? 'current' : 'plant' },
                ...(recommended ? [{ id: 'rec', position: recommended.position, variant: 'recommended' as const }] : []),
              ]}
              path={recommended ? { from: current.position, to: recommended.position } : null}
            />
          </View>

          <View style={styles.rings}>
            <View style={styles.ringItem}>
              <ScoreRing
                value={ringProgress(light?.current.dli ?? null)}
                label={light ? dliValueText(light.current.dli) : '—'}
                caption="DLI"
                color={recommended || outOfRange ? Colors.sunlight : Colors.primary}
                trackColor="#F1F1EA"
              />
              <AppText variant="captionStrong" style={styles.ringLabel}>
                현재 위치 예상 DLI
              </AppText>
              <AppText variant="small" color={Colors.textSecondary}>
                {current.label} · {statusText(light?.current.status ?? null)}
              </AppText>
            </View>
            {recommended ? (
              <>
                <ArrowRight size={18} color={Colors.textTertiary} strokeWidth={1.8} />
                <View style={styles.ringItem}>
                  <ScoreRing value={ringProgress(recommended.dli)} label={dliValueText(recommended.dli)} caption="DLI" />
                  <AppText variant="captionStrong" style={styles.ringLabel}>
                    추천 위치 예상 DLI
                  </AppText>
                  <AppText variant="small" color={Colors.textSecondary}>
                    {recommended.label} · {statusText(recommended.status)}
                  </AppText>
                </View>
              </>
            ) : null}
          </View>

          <View style={[styles.note, !(recommended || outOfRange) && styles.noteOk]}>
            <Sparkles size={16} color={recommended || outOfRange ? Colors.sunlightDeep : Colors.primary} strokeWidth={1.9} />
            <AppText variant="bodyStrong" style={styles.flex}>
              {pending
                ? '빛 지도를 계산하면 예상 DLI가 나와요.'
                : recommended
                  ? `요구 범위(${light?.range.min}–${light?.range.max})에 더 가까운 자리가 있어요.`
                  : outOfRange
                    ? `지금 자리는 요구 범위(${light?.range.min}–${light?.range.max}) 밖이에요.`
                    : '지금 자리가 요구 범위 안이에요.'}
            </AppText>
          </View>

          {recommended || outOfRange ? (
            <PrimaryButton title="추천 위치 보기" icon={ArrowRight} iconPosition="right" onPress={openRecommendation} />
          ) : (
            <SecondaryButton title="공간에서 보기" onPress={() => router.navigate('/space')} />
          )}
        </Card>
      </View>

      {/* Care guide */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Care guide" title={`${species.name} 돌보기`} />
        <Card padding={Spacing.xl} radius={Radius.xl}>
          <AppText variant="body" color={Colors.text} style={styles.summary}>
            {species.summary}
          </AppText>
          <View style={styles.guideRows}>
            <GuideRow icon={Sun} label="선호 광량" value={LIGHT_PREFERENCE_LABEL[species.preferredLight]} />
            <GuideRow icon={Thermometer} label="적정 온도" value={species.temperature} />
            <GuideRow icon={Waves} label="습도" value={species.humidity} />
            <GuideRow icon={Gauge} label="난이도" value={species.difficulty} last={!serverSpecies} />
            {serverSpecies ? (
              <GuideRow icon={Sun} label="필요 광량 (DLI)" value={`${serverSpecies.minDli}–${serverSpecies.maxDli} mol/m²/day`} last />
            ) : null}
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SecondaryButton
          title={confirmDelete ? '한 번 더 누르면 삭제돼요' : '식물 삭제'}
          icon={Trash2}
          variant={confirmDelete ? 'outline' : 'ghost'}
          color={Colors.clayDeep}
          size="md"
          disabled={deleting}
          onPress={handleDelete}
        />
      </View>
    </ScreenContainer>
  );
}

function GuideRow({ icon: Icon, label, value, last }: { icon: typeof Sun; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.guideRow, !last && styles.guideDivider]}>
      <Icon size={16} color={Colors.primary} strokeWidth={1.8} />
      <AppText variant="caption" color={Colors.textSecondary} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="captionStrong">{value}</AppText>
    </View>
  );
}

function WeeklyLightLink({ status, mock, onPress }: { status: DliStatus | null; mock: boolean; onPress: () => void }) {
  const copy = status ? DLI_STATUS_COPY[status] : null;
  return (
    <Card padding={Spacing.lg} radius={Radius.xl} onPress={onPress} accessibilityLabel="주간 광환경 보기" style={weeklyStyles.card}>
      <View style={weeklyStyles.icon}>
        <Sun size={18} color={Colors.sunlightDeep} strokeWidth={1.9} />
      </View>
      <View style={weeklyStyles.texts}>
        <AppText variant="bodyStrong">주간 광환경</AppText>
        <AppText variant="caption" color={Colors.textSecondary}>
          {copy ? `최근 7일 예상 광량 · ${copy.sentence}` : '날짜별 예상 광량을 확인해요'}
          {mock ? ' (예시)' : ''}
        </AppText>
      </View>
      {copy ? <StatusChip label={copy.label} tone={copy.tone} size="sm" dot /> : null}
      <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={1.8} />
    </Card>
  );
}

const weeklyStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.sunlightSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
  },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    height: 250,
    borderRadius: Radius.xl + 4,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: Spacing.md,
    overflow: 'hidden',
    marginTop: Spacing.xs,
  },
  heroChip: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.lg,
    backgroundColor: Colors.surface,
  },
  titleBlock: {
    marginTop: Spacing.xl,
  },
  scientific: {
    fontStyle: 'italic',
    marginTop: 2,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.md,
  },
  section: {
    marginTop: Spacing.xxl,
  },
  grid: {
    gap: Spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  cardTitle: {
    marginTop: 4,
  },
  cardCaption: {
    marginTop: 4,
  },
  cycle: {
    marginVertical: Spacing.xl,
  },
  watered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lightGreen,
  },
  miniPlan: {
    marginTop: Spacing.lg,
    padding: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
  },
  rings: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: Spacing.xl,
  },
  ringItem: {
    alignItems: 'center',
    gap: 2,
  },
  ringLabel: {
    marginTop: Spacing.sm,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.sunlightSoft,
  },
  noteOk: {
    backgroundColor: Colors.lightGreen,
  },
  summary: {
    lineHeight: 23,
  },
  guideRows: {
    marginTop: Spacing.lg,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 12,
  },
  guideDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
});
