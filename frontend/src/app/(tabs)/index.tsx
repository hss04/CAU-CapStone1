import { router } from 'expo-router';
import { CloudSun, Droplet, Leaf, Plus, Sun, Sunrise } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { Card } from '@/components/common/Card';
import { InfoCard } from '@/components/common/InfoCard';
import { PageHeader } from '@/components/common/PageHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SectionHeader } from '@/components/common/SectionHeader';
import { useToast } from '@/components/common/Toast';
import { CharacterCard } from '@/components/home/CharacterCard';
import { PlacementSummaryCard } from '@/components/home/PlacementSummaryCard';
import { WateringAlert } from '@/components/home/WateringAlert';
import { SpacePreview } from '@/components/space/SpacePreview';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useGarden, useRecentFlag } from '@/store/GardenProvider';
import {
  getCharacterMood,
  getDuePlants,
  getFeaturedRecommendation,
  getNextWatering,
  getPlantsWithRecommendation,
  getWateringInfo,
} from '@/store/selectors';
import { formatShortDateEn, getGreeting } from '@/utils/date';
import { withEge } from '@/utils/korean';

export default function HomeScreen() {
  const { state, today, actions } = useGarden();
  const toast = useToast();
  const { plants, weather, user, room } = state;

  const recentlyWatered = useRecentFlag(state.lastWateredEventAt, 4500);
  const mood = getCharacterMood({
    plants,
    weather,
    today,
    recentlyWatered,
    override: state.characterOverride,
  });

  const due = getDuePlants(plants, today);
  const next = getNextWatering(plants, today);
  const wateredToday = plants.some((p) => getWateringInfo(p, today).wateredToday);
  const featured = getFeaturedRecommendation(plants);
  const moreRecs = Math.max(0, getPlantsWithRecommendation(plants).length - 1);

  const handleWater = () => {
    const names = due.map((p) => p.name).join(', ');
    actions.waterPlants(due.map((p) => p.id));
    toast.show(`${withEge(names)} 물을 줬어요 💧`, 'water');
  };

  const wateringValue = next ? (due.length > 0 ? 'Today' : next.info.label) : '—';
  const wateringCaption = !next
    ? '등록된 식물이 없어요'
    : due.length > 0
      ? `${due[0].name} 물주기`
      : `${next.plant.name} 물주기 예정`;

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow={`${getGreeting()}, ${user.nameEn}`}
        title="My Indoor Garden"
        right={<Avatar name={user.nameEn} size={50} onPress={() => router.navigate('/my-page')} />}
      />

      <View style={styles.section}>
        <CharacterCard mood={mood} dateLabel={formatShortDateEn(today)} onLongPress={actions.cycleCharacter} />
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

      <View style={[styles.grid, styles.sectionSm]}>
        <View style={styles.gridRow}>
          <InfoCard
            label="Watering"
            value={wateringValue}
            caption={wateringCaption}
            icon={Droplet}
            tone="water"
            onPress={() => router.navigate('/plants')}
          />
          <InfoCard label="Sunlight" value={weather.sunlightLabel} caption="오늘 햇빛 충분" icon={Sun} tone="sun" />
        </View>
        <View style={styles.gridRow}>
          <InfoCard
            label="Weather"
            value={`${weather.temperature}°C`}
            caption={`${weather.conditionLabel} · 습도 ${weather.humidity}%`}
            icon={CloudSun}
            tone="green"
          />
          <InfoCard
            label="Best light"
            value="Morning"
            caption={`${weather.bestLightWindow} 창가가 가장 밝아요`}
            icon={Sunrise}
            tone="clay"
          />
        </View>
      </View>

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
  section: {
    marginTop: Spacing.xxl + 4,
  },
  sectionSm: {
    marginTop: Spacing.lg,
  },
  grid: {
    gap: Spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    gap: Spacing.md,
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
