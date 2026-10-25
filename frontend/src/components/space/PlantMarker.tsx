import { Leaf, Sprout } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { Colors, Radius, Shadows } from '@/constants/theme';

export type MarkerVariant = 'plant' | 'current' | 'recommended' | 'ghost';
export type MarkerStatus = 'ok' | 'thirsty' | 'needsLight';

export interface PlantMarkerProps {
  variant?: MarkerVariant;
  size: number;
  selected?: boolean;
  label?: string;
  showLabel?: boolean;
  status?: MarkerStatus;
  compact?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

const VARIANT_STYLE: Record<MarkerVariant, { bg: string; border: string; icon: string; labelBg: string; labelFg: string }> = {
  plant: { bg: Colors.surface, border: Colors.primary, icon: Colors.primary, labelBg: Colors.surface, labelFg: Colors.deepGreen },
  current: { bg: Colors.surface, border: Colors.markerGray, icon: Colors.markerGray, labelBg: '#6F776F', labelFg: Colors.white },
  recommended: { bg: Colors.primary, border: Colors.surface, icon: Colors.white, labelBg: Colors.primary, labelFg: Colors.white },
  ghost: { bg: 'rgba(255,255,255,0.7)', border: '#C4CAC1', icon: '#AEB5AC', labelBg: Colors.surface, labelFg: Colors.textSecondary },
};

function Pulse({ size, color }: { size: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - t.get()),
    transform: [{ scale: 1 + t.get() * 0.95 }],
  }));
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { pointerEvents: 'none' },
        { borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

/** 평면도 위 식물 위치 마커 */
export function PlantMarker({
  variant = 'plant',
  size,
  selected = false,
  label,
  showLabel = false,
  status = 'ok',
  compact = false,
  onPress,
  accessibilityLabel,
}: PlantMarkerProps) {
  const v = VARIANT_STYLE[variant];
  const Icon = variant === 'recommended' ? Sprout : Leaf;

  const body = compact ? (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: variant === 'current' ? Colors.markerGray : Colors.primary,
          borderWidth: Math.max(1.5, size * 0.14),
          borderColor: Colors.white,
        },
        Shadows.soft,
      ]}
    />
  ) : (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: v.bg,
          borderWidth: variant === 'recommended' ? 3 : 2.5,
          borderColor: selected ? Colors.deepGreen : v.border,
        },
        Shadows.soft,
        selected && styles.selected,
      ]}>
      <Icon size={size * 0.48} color={selected && variant === 'plant' ? Colors.deepGreen : v.icon} strokeWidth={1.9} />
      {status !== 'ok' && variant === 'plant' ? (
        <View
          style={[
            styles.statusDot,
            { backgroundColor: status === 'thirsty' ? Colors.water : Colors.sunlight },
          ]}
        />
      ) : null}
    </View>
  );

  const content = (
    <>
      {variant === 'recommended' ? <Pulse size={size} color={Colors.primary} /> : null}
      {selected && variant === 'plant' ? <Pulse size={size} color={Colors.primarySoft} /> : null}
      {body}
      {showLabel && label ? (
        <View style={[styles.labelWrap, { bottom: size + 5 }]}>
          <View style={[styles.label, { backgroundColor: v.labelBg }, Shadows.soft]}>
            <AppText variant="small" color={v.labelFg} style={styles.labelText} numberOfLines={1}>
              {label}
            </AppText>
          </View>
          <View style={[styles.labelTail, { borderTopColor: v.labelBg }]} />
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={{ width: size, height: size, pointerEvents: 'none' }}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={{ width: size, height: size }}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    transform: [{ scale: 1.12 }],
  },
  statusDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  labelWrap: {
    pointerEvents: 'none',
    position: 'absolute',
    left: -60,
    right: -60,
    alignItems: 'center',
  },
  label: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '700',
  },
  labelTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
});
