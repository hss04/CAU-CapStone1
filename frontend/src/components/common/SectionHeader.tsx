import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

import { AppText } from './AppText';

export interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, eyebrow, subtitle, actionLabel, onAction, right, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.texts}>
        {eyebrow ? (
          <AppText variant="label" color={Colors.primary} style={styles.eyebrow}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="h2">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color={Colors.textSecondary} style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={10} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
          <AppText variant="captionStrong" color={Colors.primary}>
            {actionLabel}
          </AppText>
          <ChevronRight size={15} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  texts: { flex: 1 },
  eyebrow: { marginBottom: 6 },
  subtitle: { marginTop: 2 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingBottom: 2,
  },
});
