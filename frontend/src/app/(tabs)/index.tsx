import { router } from 'expo-router';
import { Leaf, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { Card } from '@/components/common/Card';
import { PageHeader } from '@/components/common/PageHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SectionHeader } from '@/components/common/SectionHeader';
import { useToast } from '@/components/common/Toast';
import { CharacterCard } from '@/components/home/CharacterCard';
import { PlacementSummaryCard } from '@/components/home/PlacementSummaryCard';
import { PlantStatusCard } from '@/components/home/PlantStatusCard';
import { WateringAlert } from '@/components/home/WateringAlert';
import { WeatherCard, type TodayLightSummary } from '@/components/home/WeatherCard';
import { WeeklyLightPreview } from '@/components/home/WeeklyLightPreview';
import { lightSourceLabel } from '@/components/light/lightUi';
import { SpacePreview } from '@/components/space/SpacePreview';
import { DLI_STATUS_COPY } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { recentStatusOf, todayPointOf } from '@/services/lightForecast';
import { useGarden, useRecentFlag } from '@/store/GardenProvider';
import { useLightForecast, type LightForecastValue } from '@/store/LightForecastProvider';
import {
  getCharacterMood,
  getDuePlants,
  getFeaturedRecommendation,
  getNextWatering,
  getPlantsWithRecommendation,
  getWateringInfo,
  type PlantLightState,
} from '@/store/selectors';
import { useWeather } from '@/store/WeatherProvider';
import type { DliStatus, Plant } from '@/types';
import { formatShortDateEn, getGreeting } from '@/utils/date';
import { withEge } from '@/utils/korean';

/** 홈 식물 상태 카드에 보여줄 최대 식물 수 */
const STATUS_ROWS = 3;

/** 식물들의 오늘 예상 광환경을 한 줄로 */
function summarizeToday(plants: Plant[], forecast: LightForecastValue): TodayLightSummary | null {
  const statuses = plants
    .map((p) => {
      const series = forecast.series[p.id];
      return series ? (todayPointOf(series, forecast.today)?.status ?? null) : null;
    })
    .filter((s): s is DliStatus => s !== null);

  if (statuses.length === 0) {
    return forecast.status === 'loading' ? { label: '계산 중', tone: 'neutral', sourceTag: null } : null;
  }
  // 예시 데이터·임시 계산일 때만 출처 표시 (실제 계산 결과는 '예상' 문구로 충분)
  const sourceTag = forecast.source === 'mock' ? '예시' : forecast.provisional ? '임시 계산' : null;
  if (statuses.every((s) => s === statuses[0])) {
    const copy = DLI_STATUS_COPY[statuses[0]];
    return { label: copy.label, tone: copy.tone, sourceTag };
  }
  if (statuses.includes('high')) return { label: '일부 과다', tone: 'sun', sourceTag };
  return { label: '일부 부족', tone: 'dusk', sourceTag };
}

export default function HomeScreen() {
  const { state, today, actions } = useGarden();
  const weather = useWeather();
  const forecast = useLightForecast();
  const toast = useToast();
  const { plants, user, room } = state;
  const [previewId, setPreviewId] = useState<string | null>(null);

  const recentlyWatered = useRecentFlag(state.lastWateredEventAt, 4500);
  const light: PlantLightState[] = plants.map((plant) => {
    const series = forecast.series[plant.id];
    return { plant, status: series ? recentStatusOf(series) : null };
  });
  const mood = getCharacterMood({
    plants,
    light,
    today,
    recentlyWatered,
    override: state.characterOverride,
  });

  const due = getDuePlants(plants, today);
  const next = getNextWatering(plants, today);
  const wateredToday = plants.some((p) => getWateringInfo(p, today).wateredToday);
  const featured = getFeaturedRecommendation(plants);
  const moreRecs = Math.max(0, getPlantsWithRecommendation(plants).length - 1);
  const previewPlantId = plants.some((p) => p.id === previewId) ? previewId! : plants[0]?.id;
  const sourceLabel = lightSourceLabel(forecast);
  const sourceTag = sourceLabel === 'LUMAP 계산' ? null : sourceLabel;

  const handleWater = () => {
    const names = due.map((p) => p.name).join(', ');
    toast.show(`${withEge(names)} 물을 줬어요 💧`, 'water');
    actions.waterPlants(due.map((p) => p.id)).then((saved) => {
      if (!saved) toast.show('서버에 저장하지 못했어요 · 앱에만 기록했어요', 'water');
    });
  };

  const openLight = (plantId: string) => router.push({ pathname: '/light/[plantId]', params: { plantId } });

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow={`${getGreeting()}, ${user.nameEn}`}
        title="My Indoor Garden"
        right={<Avatar name={user.nameEn} size={50} onPress={() => router.navigate('/my-page')} />}
      />

      {/* 1. 지역 날씨 · 오늘의 예상 광환경 */}
      <View style={styles.sectionTop}>
        <WeatherCard
          weather={weather}
          onRetry={weather.refresh}
          todayLight={plants.length > 0 ? summarizeToday(plants, forecast) : null}
          onLightPress={previewPlantId ? () => openLight(previewPlantId) : undefined}
          onSetLocation={room.server ? () => router.push('/room-location') : undefined}
        />
      </View>

      {/* 2. 식물 캐릭터 */}
      <View style={styles.sectionSm}>
        <CharacterCard
          mood={mood}
          dateLabel={formatShortDateEn(today)}
          onLongPress={actions.cycleCharacter}
          basisNote={
            plants.length > 0 && !state.characterOverride
              ? `예상 광량과 물주기 기록으로 본 안내예요${forecast.source === 'mock' ? ' · 빛은 예시 데이터' : ''}`
              : undefined
          }
        />
      </View>

      {due.length > 0 || wateredToday ? (
        <View style={styles.sectionSm}>
          <WateringAlert
            duePlants={due}
            lastWateredDaysAgo={due[0] ? getWateringInfo(due[0], today).daysSinceWatered : undefined}
            onWater={handleWater}
            completed={next && due.length === 0 ? { nextLabel: `${next.plant.name} · ${next.info.labelKo}` } : null}
          />
        </View>
      ) : null}

      {plants.length > 0 ? (
        <>
          {/* 3. 식물 상태 — 광환경 · 물주기 */}
          <View style={styles.section}>
            <SectionHeader
              eyebrow="Plant status"
              title="식물 상태"
              actionLabel={plants.length > STATUS_ROWS ? `전체 ${plants.length}개` : '전체 보기'}
              onAction={() => router.navigate('/plants')}
            />
            <PlantStatusCard
              rows={light.slice(0, STATUS_ROWS).map(({ plant, status }) => ({ plant, light: status }))}
              today={today}
              lightLoading={forecast.status === 'loading'}
              sourceTag={sourceTag}
              onPressPlant={(p) => router.push({ pathname: '/plant/[id]', params: { id: p.id } })}
            />
          </View>

          {/* 4. 주간 광환경 미리보기 */}
          <View style={styles.section}>
            <SectionHeader eyebrow="Weekly light" title="주간 광환경" subtitle="식물 자리에 들어올 빛을 미리 확인해 보세요" />
            <WeeklyLightPreview
              plants={plants}
              selectedId={previewPlantId!}
              onSelect={setPreviewId}
              forecast={forecast}
              onOpenDetail={openLight}
            />
          </View>
        </>
      ) : null}

      {/* 5. 기존 배치 추천 · 공간 분석 */}
      <View style={styles.section}>
        <SectionHeader
          eyebrow="Placement"
          title="오늘의 배치 추천"
          actionLabel={moreRecs > 0 ? `외 ${moreRecs}개` : undefined}
          onAction={() => router.navigate('/plants')}
        />
        {featured ? (
          <PlacementSummaryCard
            plant={featured}
            onPress={() => router.push({ pathname: '/recommendation/[id]', params: { id: featured.id } })}
          />
        ) : plants.length === 0 ? (
          <Card tone="green" radius={Radius.xl} style={styles.allGood} onPress={() => router.push('/add-plant')}>
            <View style={styles.allGoodIcon}>
              <Plus size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" color={Colors.deepGreen}>
                첫 식물을 등록해보세요
              </AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                우리 집에서 가장 잘 맞는 자리를 찾아드릴게요.
              </AppText>
            </View>
          </Card>
        ) : (
          <Card tone="green" radius={Radius.xl} style={styles.allGood}>
            <View style={styles.allGoodIcon}>
              <Leaf size={20} color={Colors.primary} strokeWidth={1.8} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" color={Colors.deepGreen}>
                모든 식물이 좋은 자리에 있어요
              </AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                빛 환경이 바뀌면 다시 알려드릴게요.
              </AppText>
            </View>
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader eyebrow="Space" title="My Space Preview" actionLabel="전체 보기" onAction={() => router.navigate('/space')} />
        <SpacePreview
          room={room}
          plants={plants}
          actionLabel="공간 보기"
          onAction={() => router.navigate('/space')}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sectionTop: {
    marginTop: Spacing.xl,
  },
  section: {
    marginTop: Spacing.xxl + 4,
  },
  sectionSm: {
    marginTop: Spacing.lg,
  },
  allGood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  allGoodIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
