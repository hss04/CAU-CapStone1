import { ActivityIndicator, Pressable, View } from 'react-native';

import { Colors, Shadows, Spacing } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

import { AppText } from './AppText';
import {
  BUTTON_FONT,
  BUTTON_HEIGHT,
  BUTTON_ICON,
  buttonStyles as styles,
  type BaseButtonProps,
} from './buttonTokens';

export type PrimaryTone = 'primary' | 'deep' | 'water' | 'sun';

const PALETTE: Record<PrimaryTone, { bg: string; pressed: string; fg: string }> = {
  primary: { bg: Colors.primary, pressed: Colors.deepGreen, fg: Colors.white },
  deep: { bg: Colors.deepGreen, pressed: '#29412D', fg: Colors.white },
  water: { bg: Colors.water, pressed: Colors.waterDeep, fg: Colors.white },
  sun: { bg: Colors.sunlight, pressed: '#E0A536', fg: Colors.text },
};

export interface PrimaryButtonProps extends BaseButtonProps {
  tone?: PrimaryTone;
  loading?: boolean;
}

export function PrimaryButton({
  title,
  onPress,
  icon: Icon,
  iconPosition = 'left',
  size = 'lg',
  disabled,
  loading,
  fullWidth = true,
  tone = 'primary',
  style,
}: PrimaryButtonProps) {
  const palette = PALETTE[tone];
  const fg = disabled ? Colors.white : palette.fg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled || loading}
      onPress={() => {
        haptic.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        { height: BUTTON_HEIGHT[size], paddingHorizontal: size === 'sm' ? Spacing.lg : Spacing.xxl },
        { backgroundColor: disabled ? '#C8D1C5' : pressed ? palette.pressed : palette.bg },
        !disabled && size !== 'sm' ? Shadows.button : null,
        fullWidth ? styles.fullWidth : styles.hug,
        pressed && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {Icon && iconPosition === 'left' ? <Icon size={BUTTON_ICON[size]} color={fg} strokeWidth={1.9} /> : null}
          <AppText variant="button" color={fg} style={{ fontSize: BUTTON_FONT[size] }}>
            {title}
          </AppText>
          {Icon && iconPosition === 'right' ? <Icon size={BUTTON_ICON[size]} color={fg} strokeWidth={1.9} /> : null}
        </View>
      )}
    </Pressable>
  );
}
