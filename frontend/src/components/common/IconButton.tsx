import type { LucideIcon } from 'lucide-react-native';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, IconStroke, Shadows } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

export interface IconButtonProps {
  icon: LucideIcon;
  onPress?: () => void;
  size?: number;
  color?: string;
  background?: string;
  accessibilityLabel: string;
  shadow?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon: Icon,
  onPress,
  size = 44,
  color = Colors.text,
  background = Colors.surface,
  accessibilityLabel,
  shadow = true,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        },
        shadow ? Shadows.soft : null,
        pressed ? { transform: [{ scale: 0.94 }] } : null,
        style,
      ]}>
      <Icon size={Math.round(size * 0.46)} color={color} strokeWidth={IconStroke + 0.1} />
    </Pressable>
  );
}
