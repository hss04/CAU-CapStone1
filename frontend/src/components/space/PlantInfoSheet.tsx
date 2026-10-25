import { ArrowRight, Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ProgressBar } from '@/components/common/ProgressBar';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { StatusChip } from '@/components/common/StatusChip';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { LIGHT_LEVEL_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { getPlantStatus } from '@/store/selectors';
import type { Plant } from '@/types';

export interface PlantInfoSheetProps {
  plant: Plant;
  today: Date;
  onRecommendation: () => void;
  onDetail: () => void;
}

/** SPACE에서 식물 마커를 눌렀을 때 뜨는 바텀시트 내용 */
export function PlantInfoSheet({ plant, today, onRecommendation, onDetail }: PlantInfoSheetProps) {
  const species = getSpecies(plant.speciesId);
  const status = getPlantStatus(plant, today);
  const { current, recommended, message } = plant.analysis;

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <PlantIllustration speciesId={plant.speciesId} size={54} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading">{plant.name}</AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.italic}>
            {species.scientificName}
          </AppText>
        </View>
        <StatusChip label={status.label} tone={status.tone} dot size="sm" />
      </View>

      <View style={styles.grid}>
        <Cell label="현재 위치" value={current.label} />
        <View style={styles.divider} />
        <Cell label="빛 환경" value={LIGHT_LEVEL_LABEL[current.lightLevel]} />
        <View style={styles.divider} />
        <Cell label="현재 적합도" value={`${current.score}%`} />
      </View>
      <ProgressBar
        value={current.score}
        color={current.score >= 75 ? Colors.primary : Colors.sunlight}
        trackColor="#EEF0E8"
        height={6}
        style={styles.bar}
      />

      <View style={[styles.message, !recommended && styles.messageOk]}>
        <Sparkles size={16} color={recommended ? Colors.sunlightDeep : Colors.primary} strokeWidth={1.9} />
        <AppText variant="bodyStrong" color={recommended ? Colors.text : Colors.deepGreen} style={styles.flex}>
          {message}
        </AppText>
      </View>

      <View style={styles.actions}>
        {recommended ? (
          <PrimaryButton title="추천 위치 확인" icon={ArrowRight} iconPosition="right" onPress={onRecommendation} />
        ) : null}
        <SecondaryButton title="식물 상세 보기" variant={recommended ? 'ghost' : 'soft'} onPress={onDetail} size="md" />
      </View>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <AppText variant="small" color={Colors.textSecondary}>
        {label}
      </AppText>
      <AppText variant="heading" numberOfLines={1} adjustsFontSizeToFit style={styles.cellValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  italic: { fontStyle: 'italic' },
  grid: {
    flexDirection: 'row',
    marginTop: Spacing.xl,
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  cell: {
    flex: 1,
    gap: 4,
    alignItems: 'center',
  },
  cellValue: {
    fontSize: 22,
    lineHeight: 27,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  bar: {
    marginTop: Spacing.md,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.sunlightSoft,
  },
  messageOk: {
    backgroundColor: Colors.lightGreen,
  },
  actions: {
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
});
