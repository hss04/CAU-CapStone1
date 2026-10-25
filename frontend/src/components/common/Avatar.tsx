import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

import { AppText } from './AppText';

export interface AvatarProps {
  name: string;
  size?: number;
  onPress?: () => void;
}

/** 사진 대신 쓰는 일러스트 프로필 (이니셜 + 새싹 모티브) */
export function Avatar({ name, size = 48, onPress }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase();
  const inner = size - 6;

  const body = (
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient
        colors={['#E4EDDC', '#B9CFAF']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ width: inner, height: inner, borderRadius: inner / 2, alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant="title" color={Colors.deepGreen} style={{ fontSize: inner * 0.5, lineHeight: inner * 0.62 }}>
          {initial}
        </AppText>
        <View style={[styles.sprout, { right: inner * 0.1, top: inner * 0.08 }]}>
          <Svg width={inner * 0.3} height={inner * 0.3} viewBox="0 0 24 24">
            <Path d="M12 20 C12 15 12 12 12 10" stroke={Colors.primary} strokeWidth={2} strokeLinecap="round" />
            <Path d="M12 12 C8 12 5 9.5 5 6 C9 6 12 8 12 12Z" fill={Colors.primary} />
            <Path d="M12 10.5 C12 7 14.5 4.5 19 4.5 C19 8 16 10.5 12 10.5Z" fill="#8FB285" />
          </Svg>
        </View>
      </LinearGradient>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="프로필"
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 1.5,
    borderColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  sprout: {
    position: 'absolute',
  },
});
