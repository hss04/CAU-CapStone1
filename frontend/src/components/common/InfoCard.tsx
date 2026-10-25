import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

import { AppText } from './AppText';
import { Card } from './Card';
import { CHIP_TONES, type ChipTone } from './StatusChip';

export interface InfoCardProps {
  label: string;
  value: string;
  caption?: string;
  icon?: LucideIcon;
  tone?: ChipTone;
  onPress?: () => void;
  compact?: boolean;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** WATERING / SUNLIGHT / WEATHER 같은 요약 정보 카드 */
export function InfoCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'green',
  onPress,
  compact = false,
  footer,
  style,
}: InfoCardProps) {
  const palette = CHIP_TONES[tone];
  return (
    <Card onPress={onPress} padding={compact ? Spacing.lg : 18} style={[styles.card, style]}>
      <View style={styles.top}>
        <AppText variant="label" color={Colors.textSecondary} style={styles.label} numberOfLines={1}>
          {label}
        </AppText>
        {Icon ? (
          <View style={[styles.icon, { backgroundColor: palette.bg }]}>
            <Icon size={15} color={palette.fg} strokeWidth={1.9} />
          </View>
        ) : null}
      </View>
      <AppText
        variant={compact ? 'heading' : 'value'}
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ marginTop: compact ? Spacing.sm : Spacing.md }}>
        {value}
      </AppText>
      {caption ? (
        <AppText variant="caption" color={Colors.textSecondary} style={styles.caption} numberOfLines={2}>
          {caption}
        </AppText>
      ) : null}
      {footer}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 132,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  label: {
    flexShrink: 1,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    marginTop: Spacing.xs,
    fontSize: 12.5,
    lineHeight: 18,
  },
});
