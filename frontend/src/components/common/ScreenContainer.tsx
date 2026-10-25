import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';

export interface ScreenContainerProps {
  children: ReactNode;
  /** false면 ScrollView 없이 고정 레이아웃 */
  scroll?: boolean;
  /** ScrollView 위에 고정되는 헤더 (TopBar 등) */
  header?: ReactNode;
  /** 하단에 고정되는 CTA 영역 */
  footer?: ReactNode;
  edges?: Edge[];
  padded?: boolean;
  background?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** 탭 화면처럼 하단 safe area를 다른 곳(탭바)이 처리하는 경우 false */
  bottomSafeArea?: boolean;
}

export function ScreenContainer({
  children,
  scroll = true,
  header,
  footer,
  edges = ['top'],
  padded = true,
  background = Colors.background,
  contentContainerStyle,
  bottomSafeArea = false,
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = bottomSafeArea && !footer ? insets.bottom : 0;

  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        padded && styles.padded,
        { paddingBottom: Spacing.huge + bottomPad },
        contentContainerStyle,
      ]}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: background }]}>
      {header}
      {content}
      {footer ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: background, paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}>
          <LinearGradient
            colors={[`${background}00`, background]}
            style={styles.footerFade}
          />
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { paddingHorizontal: Spacing.screen },
  footer: {
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  footerFade: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    top: -28,
    height: 28,
  },
});
