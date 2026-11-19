import { X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { Colors, Layout, Radius, Shadows, Spacing } from '@/constants/theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 배경 딤 강도 (평면도가 비쳐 보이도록 기본값은 연하게) */
  dim?: number;
  /** 시트 위쪽에 고정되는 제목 + 닫기(X) 버튼. 키보드가 올라와도 항상 보인다 */
  title?: string;
  /**
   * 입력칸이 있는 시트. 키보드 위로 시트를 올리고, 내용이 길면 시트 안에서 스크롤한다.
   * 안드로이드(edge-to-edge)는 Modal 창 안에서 키보드가 올라와도 화면이 줄지 않고 키보드 이벤트도 오지 않아,
   * 이 모드에서는 Modal 대신 지금 화면 위에 겹쳐 그린다 (탭 화면에서는 탭바를 덮지 않으니 쌓인 화면에서만 쓸 것).
   */
  keyboardAware?: boolean;
}

const useNative = Platform.OS !== 'web';

export function BottomSheet({ visible, onClose, children, dim = 0.22, title, keyboardAware = false }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(0));
  const [keyboardShown, setKeyboardShown] = useState(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const inline = keyboardAware && Platform.OS === 'android';

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

  // 키보드가 올라오면 아래쪽(메모 칸·저장 버튼)이 보이도록 시트 내용을 끝까지 내린다
  useEffect(() => {
    if (!keyboardAware || !mounted) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(showEvent, () => {
        setKeyboardShown(true);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
      }),
      Keyboard.addListener(hideEvent, () => setKeyboardShown(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [keyboardAware, mounted]);

  // Modal이 아니면 안드로이드 뒤로가기를 직접 받아 시트를 닫는다 (키보드가 열려 있으면 키보드가 먼저 닫힌다)
  useEffect(() => {
    if (!inline || !visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [inline, visible, onClose]);

  if (!mounted) return null;

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  // 키보드가 열려 있을 때 바깥을 누르면 입력한 내용을 날리지 않고 키보드만 내린다
  const onBackdrop = () => {
    if (keyboardAware && Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  };

  const sheet = (
    <Animated.View
      style={[
        styles.sheet,
        keyboardAware && styles.sheetShrink,
        Shadows.floating,
        {
          paddingBottom: keyboardShown ? Spacing.md : insets.bottom + Spacing.xl,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [460, 0] }) }],
        },
      ]}>
      <View style={styles.handle} />
      {title ? (
        <View style={styles.header}>
          <AppText variant="h3" numberOfLines={1} style={styles.headerTitle}>
            {title}
          </AppText>
          <IconButton icon={X} size={36} shadow={false} background={Colors.surfaceMuted} accessibilityLabel="닫기" onPress={close} />
        </View>
      ) : null}
      {keyboardAware ? (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bounces={false}>
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </Animated.View>
  );

  const content = (
    <>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(30, 42, 33, ${dim})`, opacity: progress }]}>
        <Pressable accessibilityLabel="닫기" style={StyleSheet.absoluteFill} onPress={onBackdrop} />
      </Animated.View>
      {keyboardAware ? (
        <KeyboardAvoidingView behavior="padding" style={[styles.container, { paddingTop: insets.top + Spacing.lg }]}>
          {sheet}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.container}>{sheet}</View>
      )}
    </>
  );

  if (inline) {
    return <View style={[StyleSheet.absoluteFill, styles.inlineRoot]}>{content}</View>;
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  inlineRoot: { zIndex: 100 },
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
  /** 화면보다 길어지면 시트를 줄이고 안쪽 ScrollView로 넘긴다 */
  sheetShrink: { flexShrink: 1, maxHeight: '100%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: '#DDE1D7',
    marginBottom: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.screen,
    paddingRight: Spacing.md,
    marginBottom: Spacing.xs,
  },
  headerTitle: { flex: 1 },
});
