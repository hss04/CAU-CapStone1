import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

import { AppText } from './AppText';
import { CHIP_TONES, type ChipTone } from './StatusChip';

export interface SettingRowProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  value?: string;
  tone?: ChipTone;
  onPress?: () => void;
  /** 설정하면 우측에 스위치가 표시된다 */
  toggleValue?: boolean;
  onToggle?: () => void;
  showDivider?: boolean;
  destructive?: boolean;
}

export function SettingRow({
  icon: Icon,
  title,
  subtitle,
  value,
  tone = 'green',
  onPress,
  toggleValue,
  onToggle,
  showDivider = true,
  destructive = false,
}: SettingRowProps) {
  const palette = CHIP_TONES[tone];
  const hasToggle = typeof toggleValue === 'boolean';

  return (
    <Pressable
      accessibilityRole={hasToggle ? 'switch' : 'button'}
      onPress={() => {
        haptic.selection();
        if (hasToggle) onToggle?.();
        else onPress?.();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: Colors.surfaceMuted }]}>
      <View style={[styles.icon, { backgroundColor: palette.bg }]}>
        <Icon size={18} color={palette.fg} strokeWidth={1.7} />
      </View>
      <View style={[styles.body, showDivider && styles.divider]}>
        <View style={styles.texts}>
          <AppText variant="bodyStrong" color={destructive ? Colors.clayDeep : Colors.text} style={styles.title}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color={Colors.textSecondary} numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {value ? (
          <AppText variant="caption" color={Colors.textSecondary}>
            {value}
          </AppText>
        ) : null}
        {hasToggle ? (
          <Switch
            value={toggleValue}
            onValueChange={() => onToggle?.()}
            trackColor={{ false: '#DADDD3', true: Colors.primary }}
            thumbColor={Colors.white}
            ios_backgroundColor="#DADDD3"
            {...(Platform.OS === 'web' ? { activeThumbColor: Colors.white } : null)}
          />
        ) : (
          <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={1.8} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.lg,
    gap: Spacing.md + 2,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 15,
    paddingRight: Spacing.lg,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  texts: { flex: 1, gap: 1 },
  title: { fontSize: 15 },
});
