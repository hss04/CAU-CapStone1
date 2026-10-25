import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { useTween } from '@/hooks/useTween';

import { AppText } from './AppText';

export interface ScoreRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  caption?: string;
  animateFrom?: number;
}

/** 배치 적합도(%)를 보여주는 원형 게이지 */
export function ScoreRing({
  value,
  size = 84,
  strokeWidth = 7,
  color = Colors.primary,
  trackColor = Colors.lightGreen,
  caption,
  animateFrom = 0,
}: ScoreRingProps) {
  const animated = useTween(value, { from: animateFrom, duration: 900 });
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, animated)) / 100);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <AppText variant="value" style={{ fontSize: size * 0.3, lineHeight: size * 0.34 }}>
          {`${Math.round(animated)}%`}
        </AppText>
        {caption ? (
          <AppText variant="small" color={Colors.textSecondary} style={styles.caption}>
            {caption}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    fontSize: 10,
    marginTop: -2,
  },
});
