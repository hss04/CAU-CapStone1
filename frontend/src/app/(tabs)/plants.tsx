import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PlantCharacter } from '@/components/character/PlantCharacter';
import { AppText } from '@/components/common/AppText';
import { EmptyState } from '@/components/common/EmptyState';
import { FadeInView } from '@/components/common/FadeInView';
import { IconButton } from '@/components/common/IconButton';
import { PageHeader } from '@/components/common/PageHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { PlantCard } from '@/components/plants/PlantCard';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useGarden } from '@/store/GardenProvider';
import { getWateringInfo } from '@/store/selectors';
import { haptic } from '@/utils/haptics';

type Filter = 'all' | 'water' | 'placement';

export default function PlantsScreen() {
  const { state, today } = useGarden();
  const { plants, room } = state;
  const [filter, setFilter] = useState<Filter>('all');

  const needsWater = plants.filter((p) => getWateringInfo(p, today).daysLeft <= 1);
  const needsPlacement = plants.filter((p) => p.analysis.recommended);
  const visible = filter === 'water' ? needsWater : filter === 'placement' ? needsPlacement : plants;

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: plants.length },
    { key: 'water', label: '물주기 임박', count: needsWater.length },
    { key: 'placement', label: '위치 추천', count: needsPlacement.length },
  ];

  const goAdd = () => router.push('/add-plant');

  return (
    <ScreenContainer>
      <PageHeader
        eyebrow={`${plants.length} plants · ${room.name}`}
        title="My Plants"
        subtitle="식물마다 꼭 맞는 자리를 찾아보세요."
        right={
          plants.length > 0 ? (
            <IconButton
              icon={Plus}
              accessibilityLabel="식물 추가"
              background={Colors.primary}
              color={Colors.white}
              onPress={goAdd}
            />
          ) : undefined
        }
      />

      {plants.length === 0 ? (
        <EmptyState
          style={styles.empty}
          illustration={
            <View style={styles.emptyCharacter}>
              <PlantCharacter state="healthy" size={120} />
            </View>
          }
          title="아직 등록된 식물이 없어요."
          description="식물을 등록하면 우리 집에서 가장 좋은 위치를 찾아드릴게요."
          actionLabel="식물 추가하기"
          actionIcon={Plus}
          onAction={goAdd}
        />
      ) : (
        <>
          <View style={styles.filters}>
            {filters.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => {
                    haptic.selection();
                    setFilter(f.key);
                  }}
                  style={[styles.filter, active && styles.filterActive]}>
                  <AppText variant="captionStrong" color={active ? Colors.white : Colors.textSecondary}>
                    {f.label}
                  </AppText>
                  <View style={[styles.count, active && styles.countActive]}>
                    <AppText variant="small" color={active ? Colors.deepGreen : Colors.textSecondary} style={styles.countText}>
                      {f.count}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.list}>
            {visible.map((p, i) => (
              <FadeInView key={`${filter}-${p.id}`} delay={i * 60}>
                <PlantCard
                  plant={p}
                  today={today}
                  onPress={() => router.push({ pathname: '/plant/[id]', params: { id: p.id } })}
                />
              </FadeInView>
            ))}
            {visible.length === 0 ? (
              <View style={styles.noResult}>
                <AppText variant="caption" color={Colors.textSecondary}>
                  조건에 맞는 식물이 없어요 🌿
                </AppText>
              </View>
            ) : null}
          </View>

          <Pressable onPress={goAdd} style={({ pressed }) => [styles.addCard, pressed && { opacity: 0.7 }]}>
            <View style={styles.addIcon}>
              <Plus size={20} color={Colors.primary} strokeWidth={2} />
            </View>
            <View>
              <AppText variant="bodyStrong" color={Colors.deepGreen}>
                식물 추가
              </AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                새 식물에게 꼭 맞는 자리를 찾아드릴게요
              </AppText>
            </View>
          </Pressable>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {
    marginTop: Spacing.xxl,
  },
  emptyCharacter: {
    marginTop: 18,
  },
  filters: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterActive: {
    backgroundColor: Colors.deepGreen,
    borderColor: Colors.deepGreen,
  },
  count: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F1EA',
  },
  countActive: {
    backgroundColor: '#DCE8D4',
  },
  countText: {
    fontWeight: '700',
  },
  list: {
    marginTop: Spacing.lg,
    gap: Spacing.lg,
  },
  noResult: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#C9D5C2',
    backgroundColor: 'rgba(238, 243, 232, 0.5)',
  },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
