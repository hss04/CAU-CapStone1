import { Bug, Camera, CircleCheck, Compass, PanelsTopLeft, ScanLine } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { StatusChip } from '@/components/common/StatusChip';
import { DEV_TOOLS_ENABLED } from '@/constants/app';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { windowFacingAzimuth, windowFacingLabel, windowName, windowWallLabel, windowWidthM } from '@/services/space/windows';
import type { Room, RoomWindow, WindowScan } from '@/types';

export interface WindowDetailSheetProps {
  room: Room;
  roomWindow: RoomWindow;
  scan?: WindowScan;
  onScan: () => void;
  onViewResult: () => void;
}

/** 평면도에서 창문을 선택했을 때의 간단한 상세 */
export function WindowDetailSheet({ room, roomWindow: w, scan, onScan, onViewResult }: WindowDetailSheetProps) {
  return (
    <View>
      <View style={styles.header}>
        <View style={styles.icon}>
          <PanelsTopLeft size={24} color={Colors.waterDeep} strokeWidth={1.7} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading">{windowName(w)}</AppText>
          <AppText variant="caption" color={Colors.textSecondary}>
            {room.name} · {windowWallLabel(w)} · 폭 약 {windowWidthM(room, w)}m
          </AppText>
        </View>
        <StatusChip
          label={w.facingUnknown ? windowFacingLabel(w) : `${w.facing} · ${windowFacingAzimuth(w)}°`}
          tone={w.facingUnknown ? 'neutral' : 'sun'}
          icon={Compass}
          size="sm"
        />
      </View>

      <AppText variant="label" color={Colors.textSecondary} style={styles.sectionLabel}>
        Outside environment
      </AppText>

      {scan ? (
        <View style={[styles.status, styles.statusDone]}>
          <CircleCheck size={20} color={Colors.primary} strokeWidth={2} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color={Colors.deepGreen}>
              외부 환경 스캔 완료
            </AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              {scan.scannedAngle.toFixed(0)}° 스캔 · 사진 {scan.captures.length}장 · {scan.startAzimuth.toFixed(0)}° →{' '}
              {scan.endAzimuth.toFixed(0)}°
            </AppText>
          </View>
        </View>
      ) : (
        <View style={styles.status}>
          <Camera size={20} color={Colors.textTertiary} strokeWidth={1.8} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">아직 외부 환경을 스캔하지 않았어요</AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              창문 앞에서 바깥을 180° 스캔하면, 하늘이 보이는 방향과 건물·나무에 가려지는 방향을 분석할 수 있어요.
            </AppText>
          </View>
        </View>
      )}

      <View style={styles.actions}>
        <PrimaryButton title={scan ? '창밖 다시 스캔하기' : '창밖 스캔하기'} icon={ScanLine} onPress={onScan} />
        {scan && DEV_TOOLS_ENABLED ? (
          <SecondaryButton title="스캔 결과 보기 (Dev)" icon={Bug} variant="ghost" size="md" onPress={onViewResult} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.waterSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  statusDone: {
    backgroundColor: Colors.lightGreen,
    borderColor: Colors.lightGreen,
  },
  actions: {
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
});
