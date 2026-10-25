import { Armchair, BrickWall, PanelsTopLeft, Pause, Play, Zap, type LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { ProgressBar } from '@/components/common/ProgressBar';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { SCAN_STAGE_MESSAGE } from '@/services/scan';
import type { ScanDetections, ScanStage, ScanStatus } from '@/types';

export interface ScanPanelProps {
  progress: number;
  stage: ScanStage;
  status: ScanStatus;
  detected: ScanDetections;
  onPause: () => void;
  onResume: () => void;
  onMockComplete: () => void;
  bottomInset: number;
}

function PulseDot({ active }: { active: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 900 }), -1, true));
  }, [t]);
  const style = useAnimatedStyle(() => ({ opacity: active ? 0.35 + 0.65 * t.get() : 1 }));
  return <Animated.View style={[styles.pulse, !active && { backgroundColor: Colors.markerGray }, style]} />;
}

/** 스캔 화면 하단 진행 패널 */
export function ScanPanel({
  progress,
  stage,
  status,
  detected,
  onPause,
  onResume,
  onMockComplete,
  bottomInset,
}: ScanPanelProps) {
  const paused = status === 'paused';
  const done = status === 'complete';

  return (
    <View style={[styles.panel, { paddingBottom: bottomInset + Spacing.lg }]}>
      <View style={styles.header}>
        <View>
          <AppText variant="label" color={Colors.primary}>
            Scan progress
          </AppText>
          <View style={styles.stageRow}>
            <PulseDot active={!paused && !done} />
            <AppText variant="bodyStrong">{paused ? '스캔이 일시정지됐어요.' : SCAN_STAGE_MESSAGE[stage]}</AppText>
          </View>
        </View>
        <AppText variant="valueLarge" color={Colors.deepGreen}>
          {`${progress}%`}
        </AppText>
      </View>

      <ProgressBar value={progress} animated={false} height={8} style={styles.bar} />

      <View style={styles.detections}>
        <Detection icon={BrickWall} label="벽" value={`${detected.walls}/4`} active={detected.walls > 0} />
        <Detection icon={PanelsTopLeft} label="창문" value={`${detected.windows}`} active={detected.windows > 0} />
        <Detection icon={Armchair} label="가구" value={`${detected.objects}`} active={detected.objects > 0} />
      </View>

      <View style={styles.actions}>
        <SecondaryButton
          title={paused ? '계속하기' : '일시정지'}
          icon={paused ? Play : Pause}
          size="md"
          fullWidth={false}
          style={styles.flex}
          disabled={done}
          onPress={paused ? onResume : onPause}
        />
        <SecondaryButton
          title="Mock 완료"
          icon={Zap}
          size="md"
          variant="outline"
          fullWidth={false}
          style={styles.flex}
          disabled={done}
          onPress={onMockComplete}
        />
      </View>
      <AppText variant="small" color={Colors.textTertiary} align="center" style={styles.devNote}>
        시연용 Mock 스캔 · 실제 스캔은 백엔드 연동 예정
      </AppText>
    </View>
  );
}

function Detection({ icon: Icon, label, value, active }: { icon: LucideIcon; label: string; value: string; active: boolean }) {
  return (
    <View style={[styles.detection, active && styles.detectionActive]}>
      <Icon size={16} color={active ? Colors.primary : Colors.textTertiary} strokeWidth={1.8} />
      <AppText variant="caption" color={active ? Colors.deepGreen : Colors.textTertiary}>
        {label}
      </AppText>
      <AppText variant="captionStrong" color={active ? Colors.deepGreen : Colors.textTertiary}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl + 4,
    borderTopRightRadius: Radius.xl + 4,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  bar: {
    marginTop: Spacing.lg,
  },
  detections: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  detection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: '#F3F4EE',
  },
  detectionActive: {
    backgroundColor: Colors.lightGreen,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  devNote: {
    marginTop: Spacing.md,
  },
});
