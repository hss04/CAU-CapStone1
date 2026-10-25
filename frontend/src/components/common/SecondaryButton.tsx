import { Pressable, View } from 'react-native';

import { Colors, IconStroke, Shadows, Spacing } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

import { AppText } from './AppText';
import {
  BUTTON_FONT,
  BUTTON_HEIGHT,
  BUTTON_ICON,
  buttonStyles as styles,
  type BaseButtonProps,
} from './buttonTokens';

export type SecondaryVariant = 'soft' | 'outline' | 'ghost' | 'white';

export interface SecondaryButtonProps extends BaseButtonProps {
  variant?: SecondaryVariant;
  color?: string;
}

export function SecondaryButton({
  title,
  onPress,
  icon: Icon,
  iconPosition = 'left',
  size = 'lg',
  disabled,
  fullWidth = true,
  variant = 'soft',
  color = Colors.primary,
  style,
}: SecondaryButtonProps) {
  const bg = variant === 'soft' ? Colors.lightGreen : variant === 'white' ? Colors.surface : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          height: BUTTON_HEIGHT[size],
          paddingHorizontal: size === 'sm' ? Spacing.lg : Spacing.xxl,
          backgroundColor: bg,
        },
        variant === 'outline' ? styles.outline : null,
        variant === 'white' ? Shadows.soft : null,
        fullWidth ? styles.fullWidth : styles.hug,
        pressed && styles.pressed,
        pressed && variant !== 'ghost' ? { backgroundColor: Colors.lightGreenStrong } : null,
        disabled ? { opacity: 0.45 } : null,
        style,
      ]}>
      <View style={styles.content}>
        {Icon && iconPosition === 'left' ? (
          <Icon size={BUTTON_ICON[size]} color={color} strokeWidth={IconStroke + 0.2} />
        ) : null}
        <AppText variant="button" color={color} style={{ fontSize: BUTTON_FONT[size] }}>
          {title}
        </AppText>
        {Icon && iconPosition === 'right' ? (
          <Icon size={BUTTON_ICON[size]} color={color} strokeWidth={IconStroke + 0.2} />
        ) : null}
      </View>
    </Pressable>
  );
}
