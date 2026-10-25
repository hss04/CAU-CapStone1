import { ArrowRight, Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { StatusChip } from '@/components/common/StatusChip';
import { LIGHT_LEVEL_LABEL, LIGHT_PREFERENCE_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { getPlantStatus, getWateringInfo } from '@/store/selectors';
import type { Plant } from '@/types';
import { withRo } from '@/utils/korean';

import { PlantIllustration } from './PlantIllustration';

export interface PlantCardProps {
  plant: Plant;
  today: Date;
  onPress?: () => void;
}

export function PlantCard({ plant, today, onPress }: PlantCardProps) {
  const species = getSpecies(plant.speciesId);
  const status = getPlantStatus(plant, today);
  const water = getWateringInfo(plant, today);
  const rec = plant.analysis.recommended;

  return (
    <Card onPress={onPress} padding={0} radius={Radius.xl} accessibilityLabel={`${plant.name} 상세 보기`}>
      <View style={styles.top}>
        <View style={styles.illustration}>
          <PlantIllustration speciesId={plant.speciesId} size={78} />
        </View>
        <View style={styles.heading}>
          <View style={styles.titleRow}>
            <AppText variant="h2" numberOfLines={1} style={styles.name}>
              {plant.name}
            </AppText>
            <StatusChip label={status.label} tone={status.tone} dot size="sm" />
          </View>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.scientific}>
            {species.scientificName}
          </AppText>
          <View style={styles.prefRow}>
            <AppText variant="small" color={Colors.textSecondary}>
              {LIGHT_PREFERENCE_LABEL[plant.preferredLight]} · {plant.wateringIntervalDays}일마다 물주기
            </AppText>
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat label="Light" value={LIGHT_LEVEL_LABEL[plant.analysis.current.lightLevel]} />
        <View style={styles.statDivider} />
        <Stat label="Water" value={water.label} highlight={water.isDue} />
        <View style={styles.statDivider} />
        <Stat label="Location" value={plant.location.label} />
      </View>

      {rec ? (
        <View style={styles.recStrip}>
          <Sparkles size={14} color={Colors.primary} strokeWidth={1.9} />
          <AppText variant="captionStrong" color={Colors.deepGreen} style={styles.recText} numberOfLines={1}>
            {withRo(rec.label)} 옮기면 {plant.analysis.current.score}% → {rec.score}%
          </AppText>
          <ArrowRight size={15} color={Colors.primary} strokeWidth={1.9} />
        </View>
      ) : (
        <View style={[styles.recStrip, styles.okStrip]}>
          <View style={styles.okDot} />
          <AppText variant="caption" color={Colors.textSecondary} style={styles.recText} numberOfLines={1}>
            지금 자리가 잘 맞아요 · 적합도 {plant.analysis.current.score}%
          </AppText>
        </View>
      )}
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <AppText variant="label" color={Colors.textTertiary} style={styles.statLabel}>
        {label}
      </AppText>
      <AppText
        variant="heading"
        color={highlight ? Colors.waterDeep : Colors.text}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={styles.statValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    gap: Spacing.lg,
    padding: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  illustration: {
    width: 92,
    height: 100,
    borderRadius: Radius.md,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
    overflow: 'hidden',
  },
  heading: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  name: {
    flexShrink: 1,
  },
  scientific: {
    fontStyle: 'italic',
  },
  prefRow: {
    marginTop: Spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  stats: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  stat: {
    flex: 1,
    gap: 4,
  },
  statLabel: {
    fontSize: 10,
  },
  statValue: {
    fontSize: 19,
    lineHeight: 24,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.md,
  },
  recStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    backgroundColor: Colors.lightGreen,
  },
  okStrip: {
    backgroundColor: Colors.surfaceMuted,
  },
  okDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.primarySoft,
  },
  recText: {
    flex: 1,
  },
});
