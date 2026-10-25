import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';

export interface FadeInViewProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  offset?: number;
  style?: StyleProp<ViewStyle>;
}

/** 마운트 시 살짝 떠오르며 나타나는 래퍼 (key를 바꾸면 다시 재생) */
export function FadeInView({ children, delay = 0, duration = 420, offset = 8, style }: FadeInViewProps) {
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [anim, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
