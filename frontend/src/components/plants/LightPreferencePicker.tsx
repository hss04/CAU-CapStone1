import { Cloud, CloudSun, Sun, SunDim, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { LIGHT_PREFERENCE_DESC, LIGHT_PREFERENCE_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { LightPreference } from '@/types';
import { haptic } from '@/utils/haptics';

const OPTIONS: { value: LightPreference; icon: LucideIcon }[] = [
  { value: 'direct', icon: Sun },
  { value: 'brightIndirect', icon: SunDim },
  { value: 'partialShade', icon: CloudSun },
  { value: 'shade', icon: Cloud },
];

export interface LightPreferencePickerProps {
  value: LightPreference;
  onChange: (value: LightPreference) => void;
}

export function LightPreferencePicker({ value, onChange }: LightPreferencePickerProps) {
  return (
    <View style={styles.grid}>
      {OPTIONS.map(({ value: v, icon: Icon }) => {
        const selected = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              haptic.selection();
              onChange(v);
            }}
            style={[styles.option, selected && styles.optionSelected]}>
            <View style={[styles.icon, selected && styles.iconSelected]}>
              <Icon size={18} color={selected ? Colors.white : Colors.sunlightDeep} strokeWidth={1.8} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" color={selected ? Colors.deepGreen : Colors.text} style={styles.label}>
                {LIGHT_PREFERENCE_LABEL[v]}
              </AppText>
              <AppText variant="small" color={Colors.textSecondary} numberOfLines={1}>
                {LIGHT_PREFERENCE_DESC[v]}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  option: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: '#F6F9F2',
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.sunlightSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSelected: {
    backgroundColor: Colors.primary,
  },
  label: {
    fontSize: 14,
  },
});
