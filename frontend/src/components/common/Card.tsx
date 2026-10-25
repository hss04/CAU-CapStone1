import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';

export type CardTone = 'surface' | 'green' | 'muted' | 'sun' | 'water' | 'clay' | 'deep';

const TONE_BG: Record<CardTone, string> = {
  surface: Colors.surface,
  green: Colors.lightGreen,
  muted: Colors.surfaceMuted,
  sun: Colors.sunlightSoft,
  water: Colors.waterSoft,
  clay: Colors.claySoft,
  deep: Colors.deepGreen,
};

export interface CardProps {
  children: ReactNode;
  tone?: CardTone;
  padding?: number;
  radius?: number;
  shadow?: boolean;
  bordered?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Card({
  children,
  tone = 'surface',
  padding = Spacing.xl,
  radius = Radius.lg,
  shadow = true,
  bordered = false,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
}: CardProps) {
  const base: StyleProp<ViewStyle> = [
    styles.card,
    { backgroundColor: TONE_BG[tone], padding, borderRadius: radius },
    shadow && tone === 'surface' ? Shadows.soft : null,
    bordered ? styles.bordered : null,
    style,
  ];

  if (!onPress && !onLongPress) return <View style={base}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [base, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'visible',
  },
  bordered: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.94,
  },
});
