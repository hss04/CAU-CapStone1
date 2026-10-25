import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Layout, Radius, Shadows, Spacing } from '@/constants/theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 배경 딤 강도 (평면도가 비쳐 보이도록 기본값은 연하게) */
  dim?: number;
}

const useNative = Platform.OS !== 'web';

export function BottomSheet({ visible, onClose, children, dim = 0.22 }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(0));

  // 열릴 때는 렌더 중에 바로 마운트 (effect 안에서 setState 하지 않도록)
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      progress.setValue(0);
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: useNative,
        damping: 22,
        stiffness: 210,
        mass: 0.9,
      }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: useNative }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(30, 42, 33, ${dim})`, opacity: progress }]}>
        <Pressable accessibilityLabel="닫기" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.sheet,
            Shadows.floating,
            {
              paddingBottom: insets.bottom + Spacing.xl,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [460, 0] }) },
              ],
            },
          ]}>
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    pointerEvents: 'box-none',
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: Layout.maxAppWidth,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl + 4,
    borderTopRightRadius: Radius.xl + 4,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: '#DDE1D7',
    marginBottom: Spacing.lg,
  },
});
