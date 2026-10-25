import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Shadows } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

import { AppText } from './AppText';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md';
}

const PAD = 4;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
  size = 'md',
}: SegmentedControlProps<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width > 0 ? (width - PAD * 2) / options.length : 0;
  const [translate] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(translate, {
      toValue: index * segment,
      useNativeDriver: Platform.OS !== 'web',
      damping: 18,
      stiffness: 220,
      mass: 0.8,
    }).start();
  }, [index, segment, translate]);

  const height = size === 'sm' ? 36 : 42;

  return (
    <View style={[styles.wrap, { height }, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {segment > 0 ? (
        <Animated.View
          style={[
            styles.indicator,
            Shadows.soft,
            { width: segment, height: height - PAD * 2, transform: [{ translateX: translate }] },
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={styles.item}
            onPress={() => {
              if (!selected) haptic.selection();
              onChange(o.value);
            }}>
            <AppText
              variant="captionStrong"
              color={selected ? Colors.deepGreen : Colors.textSecondary}
              style={{ fontSize: size === 'sm' ? 12.5 : 13.5 }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: '#EDEFE6',
    borderRadius: Radius.pill,
    padding: PAD,
  },
  indicator: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
