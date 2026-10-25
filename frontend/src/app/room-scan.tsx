import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CircleHelp, Smartphone } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { ScanPanel } from '@/components/scan/ScanPanel';
import { ScanViewfinder } from '@/components/scan/ScanViewfinder';
import { Colors, Spacing } from '@/constants/theme';
import { useRoomScan } from '@/hooks/useRoomScan';
import { setLastScanResult } from '@/services/scan';
import { useGarden } from '@/store/GardenProvider';

/**
 * ROOM SCAN (Mock)
 * - 화면은 useRoomScan 훅의 상태만 그린다.
 * - 실제 스캔 로직은 services/scan 의 RoomScanner 구현체가 담당한다.
 */
export default function RoomScanScreen() {
  const insets = useSafeAreaInsets();
  const { actions } = useGarden();
  const toast = useToast();

  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (navTimer.current) clearTimeout(navTimer.current);
  }, []);

  const scan = useRoomScan({
    onComplete: (result) => {
      setLastScanResult(result);
      actions.setRoom(result.room);
      // 100% 상태를 잠깐 보여준 뒤 완료 화면으로 (그 사이 닫으면 취소)
      navTimer.current = setTimeout(() => router.replace('/scan-complete'), 650);
    },
  });

  const sway = useSharedValue(0);
  useEffect(() => {
    sway.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [sway]);
  const phoneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (sway.get() - 0.5) * 22 }, { rotate: `${(sway.get() - 0.5) * 16}deg` }],
  }));

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScanViewfinder progress={scan.progress} detected={scan.detected} paused={scan.status === 'paused'} />

      <View style={{ paddingTop: insets.top }}>
        <TopBar
          title="공간 스캔"
          tone="dark"
          backIcon="close"
          onBack={goBackOrHome}
          right={
            <IconButton
              icon={CircleHelp}
              accessibilityLabel="스캔 도움말"
              size={42}
              color={Colors.white}
              background="rgba(255,255,255,0.14)"
              shadow={false}
              onPress={() => toast.show('벽 → 창문 → 가구 순서로 천천히 비춰주세요')}
            />
          }
        />
      </View>

      <View style={styles.guide}>
        <Animated.View style={[styles.phoneBadge, phoneStyle]}>
          <Smartphone size={22} color={Colors.white} strokeWidth={1.6} />
        </Animated.View>
        <AppText variant="h1" color={Colors.white} align="center">
          방을 천천히 둘러봐 주세요.
        </AppText>
        <AppText variant="body" color="rgba(255,255,255,0.78)" align="center" style={styles.guideSub}>
          벽과 창문이 화면에 잘 보이도록{'\n'}휴대폰을 천천히 움직여주세요.
        </AppText>
      </View>

      <View style={styles.bottom}>
        <ScanPanel
          progress={scan.progress}
          stage={scan.stage}
          status={scan.status}
          detected={scan.detected}
          onPause={scan.pause}
          onResume={scan.resume}
          onMockComplete={scan.finishNow}
          bottomInset={insets.bottom}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111A14',
  },
  guide: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '11%',
    left: Spacing.xxl,
    right: Spacing.xxl,
    alignItems: 'center',
  },
  phoneBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  guideSub: {
    marginTop: Spacing.sm,
    lineHeight: 23,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
