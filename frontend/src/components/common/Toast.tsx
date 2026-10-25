import { CircleCheck, Droplet, Leaf, type LucideIcon } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Layout, Radius, Shadows, Spacing } from '@/constants/theme';
import { haptic } from '@/utils/haptics';

import { AppText } from './AppText';

type ToastTone = 'success' | 'water' | 'leaf';

const TONE_ICON: Record<ToastTone, { icon: LucideIcon; bg: string }> = {
  success: { icon: CircleCheck, bg: Colors.primary },
  water: { icon: Droplet, bg: Colors.water },
  leaf: { icon: Leaf, bg: Colors.primary },
};

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

const useNative = Platform.OS !== 'web';

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; key: number } | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      if (timer.current) clearTimeout(timer.current);
      haptic.success();
      setToast({ message, tone, key: Date.now() });
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: useNative, damping: 16, stiffness: 200 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: useNative }).start(() =>
          setToast(null),
        );
      }, 2400);
    },
    [anim],
  );

  const value = useMemo(() => ({ show }), [show]);
  const Icon = toast ? TONE_ICON[toast.tone].icon : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && Icon ? (
        <View style={[styles.host, { top: insets.top + Spacing.sm }]}>
          <Animated.View
            key={toast.key}
            style={[
              styles.toast,
              Shadows.floating,
              {
                opacity: anim,
                transform: [
                  { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
                  { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                ],
              },
            ]}>
            <View style={[styles.icon, { backgroundColor: TONE_ICON[toast.tone].bg }]}>
              <Icon size={15} color={Colors.white} strokeWidth={2.2} />
            </View>
            <AppText variant="bodyStrong" color={Colors.white} style={styles.text} numberOfLines={2}>
              {toast.message}
            </AppText>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  host: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    zIndex: 1000,
  },
  toast: {
    maxWidth: Layout.maxAppWidth - 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: 'rgba(38, 50, 41, 0.94)',
    borderRadius: Radius.pill,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: Spacing.xl,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14.5,
    flexShrink: 1,
  },
});
