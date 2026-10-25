import { Minus, Plus } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

import { AppText } from './AppText';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  caption?: string;
}

export function Stepper({ value, onChange, min = 1, max = 30, unit = '', caption }: StepperProps) {
  const change = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) {
      haptic.selection();
      onChange(next);
    }
  };

  return (
    <View style={[styles.wrap, Shadows.soft]}>
      <StepButton icon="minus" disabled={value <= min} onPress={() => change(-1)} />
      <View style={styles.center}>
        <AppText variant="valueLarge" style={styles.value}>
          {`${value}`}
          <AppText variant="h3" color={Colors.textSecondary}>
            {` ${unit}`}
          </AppText>
        </AppText>
        {caption ? (
          <AppText variant="small" color={Colors.textSecondary}>
            {caption}
          </AppText>
        ) : null}
      </View>
      <StepButton icon="plus" disabled={value >= max} onPress={() => change(1)} />
    </View>
  );
}

function StepButton({ icon, disabled, onPress }: { icon: 'minus' | 'plus'; disabled: boolean; onPress: () => void }) {
  const Icon = icon === 'minus' ? Minus : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === 'minus' ? '줄이기' : '늘리기'}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: Colors.lightGreenStrong }, disabled && { opacity: 0.35 }]}>
      <Icon size={20} color={Colors.deepGreen} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  value: {
    lineHeight: 46,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
