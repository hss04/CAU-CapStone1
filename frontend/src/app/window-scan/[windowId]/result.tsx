import { router, useLocalSearchParams } from 'expo-router';
import { Bug, CircleCheck, CircleX, Code, RotateCcw, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { AzimuthTimeline } from '@/components/windowScan/AzimuthTimeline';
import { CaptureCard } from '@/components/windowScan/CaptureCard';
import { CompassCoverage } from '@/components/windowScan/CompassCoverage';
import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';
import { findWindow, windowFacingAzimuth, windowName } from '@/services/space/windows';
import { analyzeWindowScan, formatDeg, formatSigned, type CaptureStat } from '@/services/windowScan/scanAnalysis';
import { DEFAULT_SCAN_CONFIG } from '@/services/windowScan/scanTracker';
import { useGarden } from '@/store/GardenProvider';

/**
 * [개발 확인용] 창밖 스캔 결과.
 * 최종 서비스 UI가 아니며, 배포 빌드에서는 DEV_TOOLS_ENABLED로 진입점이 숨겨진다.
 */
export default function WindowScanResultScreen() {
  const { windowId } = useLocalSearchParams<{ windowId: string }>();
  const { state } = useGarden();
  const toast = useToast();
  const [preview, setPreview] = useState<CaptureStat | null>(null);

  const scan = windowId ? state.windowScans[windowId] : undefined;
  const roomWindow = findWindow(state.room, windowId);

  if (!scan) {
    return (
      <ScreenContainer header={<TopBar title="Scan Result (Dev)" />}>
        <EmptyState title="스캔 결과가 없어요" description="창문을 선택해 창밖 스캔을 먼저 진행해 주세요." actionLabel="돌아가기" onAction={goBackOrHome} />
      </ScreenContainer>
    );
  }

  const step = scan.debug?.captureStepDeg ?? DEFAULT_SCAN_CONFIG.captureStep;
  const target = scan.debug?.targetAngle ?? DEFAULT_SCAN_CONFIG.targetAngle;
  const analysis = analyzeWindowScan(scan, step, target);
  const allOk = analysis.checks.every((c) => c.ok);

  const logLines = [
    `windowId: ${scan.windowId}`,
    `startAzimuth: ${formatDeg(scan.startAzimuth)}`,
    `endAzimuth: ${formatDeg(scan.endAzimuth)}`,
    `northReference: ${scan.northReference} (declination ${formatSigned(scan.declinationDeg)}, ${scan.declinationSource})`,
    `scannedAngle: ${formatDeg(scan.scannedAngle)}`,
    `captureCount: ${scan.captures.length}`,
    ...(scan.debug
      ? [
          `headingSource: ${scan.debug.headingSource}`,
          `duration: ${(scan.debug.durationMs / 1000).toFixed(1)}s`,
          `captureStep: ${scan.debug.captureStepDeg}°`,
          `targetPitch: ${scan.debug.targetPitchDeg ?? '-'}° ± ${scan.debug.pitchToleranceDeg ?? '-'}°`,
          `avgFieldStrength: ${scan.debug.avgFieldStrength ?? '-'} μT`,
          `warnings: reverse ${scan.debug.warnings.reverse} · tooFast ${scan.debug.warnings.tooFast} · tilt ${scan.debug.warnings.tilt} · interference ${scan.debug.warnings.interference}`,
          `failedCaptures: ${scan.debug.failedCaptures}`,
        ]
      : []),
    '────────────────────────',
    ...analysis.stats.map(
      (s) =>
        `Capture #${s.index + 1} → ${formatDeg(s.capture.azimuth)} (mag ${formatDeg(s.capture.magneticAzimuth)})${s.diff === null ? '' : ` (${formatSigned(s.diff)})`}`,
    ),
  ];

  const printJson = () => {
    console.log('[WindowScan]', JSON.stringify(scan, null, 2));
    toast.show('WindowScan JSON을 콘솔에 출력했어요', 'leaf');
  };

  return (
    <>
      <ScreenContainer
        header={
          <TopBar
            title="Scan Result (Dev)"
            right={<StatusChip label="DEV" tone="clay" icon={Bug} size="sm" />}
          />
        }>
        {/* 요약 */}
        <Card padding={Spacing.xl} radius={Radius.xl} style={styles.first}>
          <View style={styles.summaryHeader}>
            <AppText variant="title">Scan Complete</AppText>
            <StatusChip label={allOk ? 'ALL CHECKS OK' : 'CHECK NEEDED'} tone={allOk ? 'green' : 'clay'} size="sm" />
          </View>
          <AppText variant="caption" color={Colors.textSecondary}>
            {roomWindow ? windowName(roomWindow) : scan.windowId} · {scan.debug?.headingSource === 'simulated' ? '시뮬레이션 방향' : '실제 센서'}
          </AppText>
          <View style={styles.kv}>
            <KV k="Start Azimuth" v={formatDeg(scan.startAzimuth)} />
            <KV k="End Azimuth" v={formatDeg(scan.endAzimuth)} />
            <KV k="North Ref" v={`${scan.northReference === 'true' ? '진북' : '자북'} · 편각 ${formatSigned(scan.declinationDeg)}`} />
            <KV k="Scanned Angle" v={formatDeg(scan.scannedAngle)} />
            <KV k="Captured Images" v={`${scan.captures.length}`} />
            <KV k="Avg / Min / Max step" v={`${analysis.avgStep?.toFixed(1) ?? '-'} / ${analysis.minStep?.toFixed(1) ?? '-'} / ${analysis.maxStep?.toFixed(1) ?? '-'}°`} />
            {scan.debug ? <KV k="Duration" v={`${(scan.debug.durationMs / 1000).toFixed(1)}s`} /> : null}
          </View>
        </Card>

        {/* 검증 체크 */}
        <Card padding={Spacing.lg} radius={Radius.xl} style={styles.section}>
          {analysis.checks.map((c) => (
            <View key={c.label} style={styles.check}>
              {c.ok ? (
                <CircleCheck size={18} color={Colors.primary} strokeWidth={2} />
              ) : (
                <CircleX size={18} color="#D9534F" strokeWidth={2} />
              )}
              <AppText variant="captionStrong" style={styles.checkLabel}>
                {c.label}
              </AppText>
              <AppText variant="small" color={Colors.textSecondary} style={styles.mono}>
                {c.detail}
              </AppText>
            </View>
          ))}
        </Card>

        {/* 방위각 시각화 */}
        <View style={styles.section}>
          <SectionHeader eyebrow="Azimuth" title="촬영 방위각 타임라인" subtitle="점 = 사진 촬영 지점 · 숫자 = 실제 방위각" />
          <Card padding={Spacing.md} radius={Radius.lg}>
            <AzimuthTimeline
              stats={analysis.stats}
              startAzimuth={scan.startAzimuth}
              endAzimuth={scan.endAzimuth}
              scannedAngle={scan.scannedAngle}
              target={target}
              step={step}
            />
          </Card>
          <Card padding={Spacing.md} radius={Radius.lg} style={styles.compassCard}>
            <CompassCoverage
              startAzimuth={scan.startAzimuth}
              scannedAngle={scan.scannedAngle}
              captures={scan.captures}
              facingAzimuth={roomWindow ? windowFacingAzimuth(roomWindow) : undefined}
            />
            <View style={styles.compassInfo}>
              <AppText variant="small" color={Colors.textSecondary}>
                초록 호 = 스캔 범위{'\n'}선 = 촬영 방향{'\n'}○ 시작 · ● 끝
              </AppText>
              {roomWindow ? (
                <AppText variant="small" color={Colors.waterDeep}>
                  파란 점선 = 창문 정면{'\n'}({roomWindow.facing} {windowFacingAzimuth(roomWindow)}°, 평면도 기준)
                </AppText>
              ) : null}
            </View>
          </Card>
        </View>

        {/* 촬영 이미지 */}
        <View style={styles.section}>
          <SectionHeader eyebrow="Captures" title={`촬영 이미지 ${scan.captures.length}장`} subtitle="카드를 누르면 크게 볼 수 있어요" />
          <View style={styles.grid}>
            {analysis.stats.map((s) => (
              <CaptureCard key={s.index} stat={s} step={step} onPress={() => setPreview(s)} />
            ))}
          </View>
        </View>

        {/* Debug log */}
        <View style={styles.section}>
          <SectionHeader eyebrow="Debug" title="Debug log" />
          <View style={styles.log}>
            {logLines.map((line, i) => (
              <AppText key={i} variant="small" color="#CFE3C9" style={styles.logLine} selectable>
                {line}
              </AppText>
            ))}
          </View>
          <View style={styles.actions}>
            <SecondaryButton title="JSON 콘솔 출력" icon={Code} variant="outline" size="md" onPress={printJson} />
            <SecondaryButton
              title="창밖 다시 스캔"
              icon={RotateCcw}
              size="md"
              onPress={() => router.replace({ pathname: '/window-scan/[windowId]', params: { windowId: scan.windowId } })}
            />
            <SecondaryButton title="Space로 돌아가기" variant="ghost" size="md" onPress={goBackOrHome} />
          </View>
        </View>
      </ScreenContainer>

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBg}>
          <Pressable style={styles.previewClose} onPress={() => setPreview(null)} accessibilityLabel="닫기">
            <X size={22} color={Colors.white} strokeWidth={2} />
          </Pressable>
          {preview ? (
            <>
              {preview.capture.imageUri ? (
                <Image source={{ uri: preview.capture.imageUri }} style={styles.previewImage} resizeMode="contain" />
              ) : (
                <View style={[styles.previewImage, styles.previewEmpty]}>
                  <AppText variant="caption" color="rgba(255,255,255,0.6)">
                    no image (mock)
                  </AppText>
                </View>
              )}
              <AppText variant="small" color={Colors.white} style={[styles.mono, styles.previewText]}>
                {`#${preview.index + 1} · Azimuth ${formatDeg(preview.capture.azimuth)} · Relative ${formatDeg(preview.relative)} · Pitch ${
                  preview.capture.pitch === undefined ? '-' : formatSigned(preview.capture.pitch)
                }`}
              </AppText>
            </>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kvRow}>
      <AppText variant="caption" color={Colors.textSecondary} style={styles.mono}>
        {k}
      </AppText>
      <AppText variant="bodyStrong" style={styles.mono}>
        {v}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  first: {
    marginTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.xl,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  kv: {
    marginTop: Spacing.lg,
    gap: 6,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.divider,
    paddingBottom: 6,
  },
  mono: {
    fontFamily: FontFamily.mono,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 6,
  },
  checkLabel: {
    minWidth: 118,
  },
  compassCard: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  compassInfo: {
    flex: 1,
    gap: Spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  log: {
    backgroundColor: '#18231C',
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: 2,
  },
  logLine: {
    fontFamily: FontFamily.mono,
    fontSize: 11.5,
    lineHeight: 17,
  },
  actions: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  previewBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  previewClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    maxWidth: 420,
    aspectRatio: 3 / 4,
  },
  previewEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C2620',
  },
  previewText: {
    marginTop: Spacing.md,
    textAlign: 'center',
  },
});
