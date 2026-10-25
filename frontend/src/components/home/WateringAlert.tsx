import { CircleCheck, Droplet, Droplets } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { FadeInView } from '@/components/common/FadeInView';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Plant } from '@/types';

export interface WateringAlertProps {
  duePlants: Plant[];
  lastWateredDaysAgo?: number;
  onWater: () => void;
  /** 오늘 물주기를 모두 마친 경우 */
  completed?: { nextLabel: string } | null;
}

export function WateringAlert({ duePlants, lastWateredDaysAgo, onWater, completed }: WateringAlertProps) {
  if (duePlants.length === 0 && completed) {
    return (
      <FadeInView>
        <Card tone="green" padding={Spacing.lg} radius={Radius.lg} style={styles.doneRow}>
          <View style={[styles.icon, { backgroundColor: Colors.surface }]}>
            <CircleCheck size={20} color={Colors.primary} strokeWidth={1.9} />
          </View>
          <View style={styles.texts}>
            <AppText variant="bodyStrong" color={Colors.deepGreen}>
              오늘 물주기를 마쳤어요
            </AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              다음 물주기 · {completed.nextLabel}
            </AppText>
          </View>
        </Card>
      </FadeInView>
    );
  }

  if (duePlants.length === 0) return null;

  const names = duePlants.map((p) => p.name).join(', ');

  return (
    <Card tone="water" padding={Spacing.xl} radius={Radius.lg}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: Colors.surface }]}>
          <Droplets size={20} color={Colors.waterDeep} strokeWidth={1.8} />
        </View>
        <View style={styles.texts}>
          <AppText variant="label" color={Colors.waterDeep}>
            Watering today
          </AppText>
          <AppText variant="h3" style={styles.title}>
            오늘 물 줄 식물이 있어요.
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary}>
            {names}
            {typeof lastWateredDaysAgo === 'number' ? ` · 마지막 물주기 ${lastWateredDaysAgo}일 전` : ''}
          </AppText>
        </View>
      </View>
      <PrimaryButton title="물 줬어요" icon={Droplet} tone="water" size="md" onPress={onWater} style={styles.button} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  title: {
    marginTop: 2,
  },
  button: {
    marginTop: Spacing.lg,
  },
});
