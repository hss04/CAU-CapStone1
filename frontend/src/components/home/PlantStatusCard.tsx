import { ChevronRight, Droplet, Sun } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { StatusChip, type ChipTone } from '@/components/common/StatusChip';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { DLI_STATUS_COPY } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getWateringInfo } from '@/store/selectors';
import type { DliStatus, Plant } from '@/types';

export interface PlantStatusRow {
  plant: Plant;
  /** 최근 7일 예상 광량 상태 (null = 값 없음) */
  light: DliStatus | null;
}

export interface PlantStatusCardProps {
  rows: PlantStatusRow[];
  today: Date;
  /** 광환경 계산 중 (값이 아직 없을 때 '계산 중' 표시) */
  lightLoading: boolean;
  /** 예시 데이터·임시 계산 표시 */
  sourceTag: string | null;
  onPressPlant: (plant: Plant) => void;
}

function waterChip(plant: Plant, today: Date): { label: string; tone: ChipTone } {
  const w = getWateringInfo(plant, today);
  if (w.daysLeft <= -2) return { label: `물 ${w.labelKo}`, tone: 'clay' };
  if (w.isDue) return { label: w.daysLeft === 0 ? '물 오늘' : `물 ${w.labelKo}`, tone: 'water' };
  return { label: `물 ${w.labelKo}`, tone: 'neutral' };
}

function lightChip(light: DliStatus | null, loading: boolean): { label: string; tone: ChipTone } {
  if (light) return { label: `빛 ${DLI_STATUS_COPY[light].label}`, tone: DLI_STATUS_COPY[light].tone };
  return { label: loading ? '빛 계산 중' : '빛 —', tone: 'neutral' };
}

/** HOME 식물 상태 카드 — 식물별 예상 광환경과 물주기 */
export function PlantStatusCard({ rows, today, lightLoading, sourceTag, onPressPlant }: PlantStatusCardProps) {
  return (
    <Card padding={0} radius={Radius.xl}>
      {rows.map(({ plant, light }, i) => {
        const water = waterChip(plant, today);
        const lightState = lightChip(light, lightLoading);
        return (
          <Pressable
            key={plant.id}
            onPress={() => onPressPlant(plant)}
            accessibilityRole="button"
            accessibilityLabel={`${plant.name}, ${lightState.label}, ${water.label}`}
            style={({ pressed }) => [styles.row, i < rows.length - 1 && styles.divider, pressed && styles.pressed]}>
            <View style={styles.avatar}>
              <PlantIllustration speciesId={plant.speciesId} size={40} />
            </View>
            <View style={styles.texts}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {plant.name}
              </AppText>
              <AppText variant="small" color={Colors.textSecondary} numberOfLines={1}>
                {plant.location.label}
              </AppText>
            </View>
            <View style={styles.chips}>
              <StatusChip label={lightState.label} tone={lightState.tone} icon={Sun} size="sm" />
              <StatusChip label={water.label} tone={water.tone} icon={Droplet} size="sm" />
            </View>
            <ChevronRight size={16} color={Colors.textTertiary} strokeWidth={1.8} />
          </Pressable>
        );
      })}
      <View style={styles.footer}>
        <AppText variant="small" color={Colors.textTertiary}>
          {`빛은 최근 7일 예상 광량 기준이에요 · 실제 측정값이 아니에요${sourceTag ? ` · ${sourceTag}` : ''}`}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pressed: {
    backgroundColor: Colors.surfaceMuted,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  chips: {
    alignItems: 'flex-end',
    gap: 4,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
});
