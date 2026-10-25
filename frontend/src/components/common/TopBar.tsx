import { router } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface TopBarProps {
  title?: string;
  onBack?: () => void;
  backIcon?: 'back' | 'close';
  right?: ReactNode;
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** 스택 화면 공통 상단바 */
export function TopBar({ title, onBack, backIcon = 'back', right, tone = 'light', style }: TopBarProps) {
  const dark = tone === 'dark';
  return (
    <View style={[styles.bar, style]}>
      <IconButton
        icon={backIcon === 'close' ? X : ChevronLeft}
        accessibilityLabel={backIcon === 'close' ? '닫기' : '뒤로 가기'}
        onPress={onBack ?? goBackOrHome}
        size={42}
        color={dark ? Colors.white : Colors.text}
        background={dark ? 'rgba(255,255,255,0.14)' : Colors.surface}
        shadow={!dark}
      />
      {title ? (
        <View style={styles.titleWrap}>
          <AppText variant="h3" color={dark ? Colors.white : Colors.text} numberOfLines={1}>
            {title}
          </AppText>
        </View>
      ) : null}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  titleWrap: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 72,
    right: 72,
    alignItems: 'center',
  },
  right: {
    minWidth: 42,
    alignItems: 'flex-end',
  },
});
