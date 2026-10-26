import { Check } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { PLANT_SPECIES } from '@/data/plantSpecies';
import type { PlantSpeciesId } from '@/types';
import { haptic } from '@/utils/haptics';

import { PlantIllustration } from './PlantIllustration';

export interface SpeciesPickerProps {
  value: PlantSpeciesId | null;
  onChange: (id: PlantSpeciesId) => void;
  /** 고를 수 없는 종과 그 이유 (예: 서버 카탈로그에 없음) */
  unavailable?: Partial<Record<PlantSpeciesId, string>>;
}

/** 식물 종류 선택 — 가로 스크롤 카드 */
export function SpeciesPicker({ value, onChange, unavailable }: SpeciesPickerProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}>
      {PLANT_SPECIES.map((s) => {
        const selected = s.id === value;
        const disabledReason = unavailable?.[s.id];
        return (
          <Pressable
            key={s.id}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabledReason }}
            disabled={!!disabledReason}
            onPress={() => {
              haptic.selection();
              onChange(s.id);
            }}
            style={({ pressed }) => [
              styles.card,
              selected ? styles.cardSelected : Shadows.soft,
              disabledReason ? styles.cardDisabled : null,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}>
            <View style={[styles.art, selected && styles.artSelected]}>
              <PlantIllustration
                speciesId={s.id}
                size={70}
                background={selected ? Colors.lightGreenStrong : Colors.lightGreen}
              />
            </View>
            <AppText variant="captionStrong" numberOfLines={1} style={styles.name}>
              {s.name}
            </AppText>
            <AppText variant="small" color={Colors.textTertiary} numberOfLines={1}>
              {disabledReason ?? s.englishName}
            </AppText>
            {selected ? (
              <View style={styles.badge}>
                <Check size={12} color={Colors.white} strokeWidth={3} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    marginHorizontal: -Spacing.screen,
  },
  row: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.screen,
    paddingVertical: 4,
  },
  card: {
    width: 112,
    padding: Spacing.sm,
    paddingBottom: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  art: {
    width: '100%',
    height: 92,
    borderRadius: Radius.md,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  artSelected: {
    backgroundColor: Colors.lightGreenStrong,
  },
  name: {
    marginTop: Spacing.sm,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
