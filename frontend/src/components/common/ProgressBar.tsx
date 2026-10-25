import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { useTween } from '@/hooks/useTween';

export interface ProgressBarProps {
  value: number;
  color?: string;
  trackColor?: string;
  height?: number;
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({
  value,
  color = Colors.primary,
  trackColor = Colors.lightGreen,
  height = 8,
  animated = true,
  style,
}: ProgressBarProps) {
  const tweened = useTween(value, { from: animated ? 0 : value, duration: 800 });
  const pct = Math.max(0, Math.min(100, animated ? tweened : value));
  return (
    <View style={[styles.track, { height, backgroundColor: trackColor, borderRadius: height / 2 }, style]}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color, borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: Radius.pill,
  },
  fill: {
    height: '100%',
  },
});
