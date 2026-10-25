import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

import { AppText } from './AppText';

export type ChipTone = 'green' | 'water' | 'sun' | 'clay' | 'neutral' | 'white' | 'deep';

export const CHIP_TONES: Record<ChipTone, { bg: string; fg: string; dot: string }> = {
  green: { bg: Colors.lightGreen, fg: Colors.deepGreen, dot: Colors.primary },
  water: { bg: Colors.waterSoft, fg: Colors.waterDeep, dot: Colors.water },
  sun: { bg: Colors.sunlightSoft, fg: Colors.sunlightDeep, dot: Colors.sunlight },
  clay: { bg: Colors.claySoft, fg: Colors.clayDeep, dot: Colors.clay },
  neutral: { bg: '#F0F1EA', fg: Colors.textSecondary, dot: Colors.markerGray },
  white: { bg: Colors.surface, fg: Colors.text, dot: Colors.primary },
  deep: { bg: Colors.deepGreen, fg: Colors.white, dot: '#BFD4B8' },
};

export interface StatusChipProps {
  label: string;
  tone?: ChipTone;
  icon?: LucideIcon;
  dot?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

export function StatusChip({ label, tone = 'green', icon: Icon, dot = false, size = 'md', style }: StatusChipProps) {
  const palette = CHIP_TONES[tone];
  const small = size === 'sm';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: palette.bg,
          paddingHorizontal: small ? 9 : 12,
          height: small ? 24 : 30,
        },
        style,
      ]}>
      {dot ? <View style={[styles.dot, { backgroundColor: palette.dot }]} /> : null}
      {Icon ? <Icon size={small ? 12 : 14} color={palette.fg} strokeWidth={2} /> : null}
      <AppText
        variant={small ? 'small' : 'captionStrong'}
        color={palette.fg}
        style={small ? styles.smallText : styles.text}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    gap: Spacing.xs + 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: { fontSize: 12.5, lineHeight: 16 },
  smallText: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
});
