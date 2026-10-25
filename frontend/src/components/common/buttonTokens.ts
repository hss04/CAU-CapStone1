import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

export type ButtonSize = 'lg' | 'md' | 'sm';

export const BUTTON_HEIGHT: Record<ButtonSize, number> = { lg: 56, md: 48, sm: 38 };
export const BUTTON_FONT: Record<ButtonSize, number> = { lg: 16, md: 15, sm: 13.5 };
export const BUTTON_ICON: Record<ButtonSize, number> = { lg: 19, md: 18, sm: 16 };

export interface BaseButtonProps {
  title: string;
  onPress?: () => void;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  size?: ButtonSize;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const buttonStyles = StyleSheet.create({
  base: {
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  outline: {
    borderWidth: 1.2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
});
