import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Camera, CircleCheck, Compass, TriangleAlert } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { EmptyState } from '@/components/common/EmptyState';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ProgressBar } from '@/components/common/ProgressBar';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { PanoramaStrip } from '@/components/windowScan/PanoramaStrip';
import { ScanNotice } from '@/components/windowScan/ScanNotice';
import { DEV_TOOLS_ENABLED } from '@/constants/app';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { mockShooter, useScanCamera } from '@/hooks/useScanCamera';
import { useWindowScanController } from '@/hooks/useWindowScanController';
import { magneticToTrue as trueAz } from '@/services/orientation/declination';
import { compassLabel, signedDelta } from '@/services/orientation/headingMath';
import { isHeadingSensorAvailable } from '@/services/orientation/headingSource';
import { findWindow, windowName } from '@/services/space/windows';
import type { FacingResult, ScanHint } from '@/services/windowScan/scanController';
import { DEFAULT_SCAN_CONFIG, isPitchOff } from '@/services/windowScan/scanTracker';
import { useGarden } from '@/store/GardenProvider';
import type { HeadingSourceKind, WindowScan } from '@/types';
import { haptic } from '@/utils/haptics';

const HINT_TEXT: Record<Exclude<ScanHint, null>, string> = {
  reverse: '← 반대 방향이에요. 오른쪽으로 움직여 주세요',
  tooFast: '조금 더 천천히 움직여 주세요',
  tilt: `휴대폰을 약 ${DEFAULT_SCAN_CONFIG.targetPitch}° 위로 들어주세요`,
  interference: '주변 금속·자석 때문에 방향이 흔들릴 수 있어요',
};

const FACING_FAIL_TEXT: Record<Exclude<FacingResult, 'ok'>, string> = {
  notReady: '방향 센서를 준비하고 있어요. 잠시 뒤 다시 눌러 주세요',
  unsteady: '휴대폰이 흔들렸어요. 잠시 멈춘 뒤 다시 눌러 주세요',
};

/** 스캔은 창문 정면에서 왼쪽으로 이만큼 돌린 방향에서 시작한다 (180° 스캔의 절반) */
const START_OFFSET_DEG = -DEFAULT_SCAN_CONFIG.targetAngle / 2;
/**
 * 시작 위치 허용 오차 (°). 서버는 사진마다 '정면 −90° + 15°·n'에서 5° 이내를 요구하는데,
 * 촬영 시점이 15° 지점을 조금 지나서 잡히므로 시작은 더 좁게 맞춘다.
 */
const START_TOLERANCE_DEG = 3;

/**
 * 창밖 180° 스캔 (카메라)
 * - 카메라: hooks/useScanCamera
 * - 방향 센서(Magnetometer + Accelerometer): services/orientation
 * - 진행/촬영 판단: services/windowScan
 */
export default function WindowScanScreen() {
  const { windowId } = useLocalSearchParams<{ windowId: string }>();
  const { state, actions } = useGarden();
  const roomWindow = findWindow(state.room, windowId);
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [permission, requestPermission] = useCameraPermissions();
  const [sensorAvailable, setSensorAvailable] = useState<boolean | null>(null);
  const [simulateHeading, setSimulateHeading] = useState(false);
  const [simulateCamera, setSimulateCamera] = useState(false);
  const { cameraRef, isReady: cameraIsReady, onCameraReady, shoot } = useScanCamera();
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    isHeadingSensorAvailable().then((ok) => {
      if (alive) setSensorAvailable(ok);
    });
    return () => {
      alive = false;
      if (navTimer.current) clearTimeout(navTimer.current);
    };
  }, []);

  const cameraGranted = !!permission?.granted;
  const useRealCamera = cameraGranted && !simulateCamera;
  const sourceKind: HeadingSourceKind | null = sensorAvailable ? 'sensors' : simulateHeading ? 'simulated' : null;
  const canRun = !!roomWindow && !!sourceKind && (useRealCamera || simulateCamera);

  const handleComplete = (scan: WindowScan) => {
    actions.saveWindowScan(scan);
    haptic.success();
    navTimer.current = setTimeout(() => {
      if (DEV_TOOLS_ENABLED) {
        router.replace({ pathname: '/window-scan/[windowId]/result', params: { windowId: scan.windowId } });
      } else {
        toast.show('창밖 스캔을 저장했어요 🌿', 'leaf');
        goBackOrHome();
      }
    }, 900);
  };

  const { state: scan, recordFacing, startScan } = useWindowScanController({
    windowId: windowId ?? '',
    sourceKind: canRun ? sourceKind : null,
    shooter: useRealCamera ? shoot : mockShooter,
    onComplete: handleComplete,
  });
  const [facingNotice, setFacingNotice] = useState<string | null>(null);

  const handleRecordFacing = () => {
    const result = recordFacing();
    if (result === 'ok') {
      haptic.success();
      setFacingNotice(null);
    } else {
      setFacingNotice(FACING_FAIL_TEXT[result]);
    }
  };

  useEffect(() => {
    if (scan.lastCaptureAt) haptic.light();
  }, [scan.lastCaptureAt]);

  /* ---------------- 예외 상태 ---------------- */

  if (!roomWindow) {
    return (
      <ScreenContainer header={<TopBar title="창밖 환경 스캔" />}>
        <EmptyState title="창문을 찾을 수 없어요" description="공간 화면에서 창문을 다시 선택해 주세요." actionLabel="돌아가기" onAction={goBackOrHome} />
      </ScreenContainer>
    );
  }

  if (!permission || sensorAvailable === null) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.white} />
      </View>
    );
  }

  if (!cameraGranted && !simulateCamera) {
    return (
      <ScanNotice
        icon={Camera}
        title="카메라 권한이 필요해요"
        description={'창밖을 180° 촬영해 방향별 사진을 저장해요.\n사진은 기기에 저장되고, \'서버로 보내기\'를 누를 때만 전송돼요.'}
        onClose={goBackOrHome}>
        {permission.canAskAgain ? (
          <PrimaryButton title="카메라 권한 허용하기" icon={Camera} onPress={requestPermission} />
        ) : (
          <PrimaryButton title="설정에서 허용하기" onPress={() => Linking.openSettings()} />
        )}
        {DEV_TOOLS_ENABLED ? (
          <SecondaryButton title="카메라 없이 테스트 (Dev)" variant="ghost" color={Colors.white} onPress={() => setSimulateCamera(true)} />
        ) : null}
      </ScanNotice>
    );
  }

  if (!sensorAvailable && !simulateHeading) {
    return (
      <ScanNotice
        icon={Compass}
        title="방향 센서를 사용할 수 없어요"
        description={
          Platform.OS === 'web'
            ? '웹에서는 자력계를 사용할 수 없어요.\n실제 휴대폰(Expo Go)에서 실행해 주세요.'
            : '이 기기에서 자력계/가속도계를 찾지 못했어요.\n실제 휴대폰에서 다시 시도해 주세요.'
        }
        onClose={goBackOrHome}>
        {DEV_TOOLS_ENABLED ? (
          <PrimaryButton title="방향 시뮬레이션으로 테스트 (Dev)" onPress={() => setSimulateHeading(true)} />
        ) : null}
      </ScanNotice>
    );
  }

  /* ---------------- 스캔 화면 ---------------- */

  const target = DEFAULT_SCAN_CONFIG.targetAngle;
  const tracker = scan.tracker;
  const progress = tracker?.progress ?? 0;
  const sample = scan.sample;
  const scanning = scan.phase === 'scanning';
  const finished = scan.phase === 'finishing' || scan.phase === 'done';
  const cameraReady = useRealCamera ? cameraIsReady : true;
  const targetPitch = DEFAULT_SCAN_CONFIG.targetPitch;
  const pitchOff = sample ? isPitchOff(sample.pitch) : false;
  const facing = scan.facing;
  const needsFacing = scan.phase === 'ready' && !facing;
  /** 현재 방향이 정면에서 몇 도 떨어져 있는지 (왼쪽 −, 진북 기준) */
  const fromFacing = facing && sample ? signedDelta(facing.azimuth, trueAz(sample.azimuth)) : null;
  // 실제 센서일 때만 시작 위치를 맞춰야 시작할 수 있다 (시뮬레이션은 개발용)
  const startOff = fromFacing === null ? null : fromFacing - START_OFFSET_DEG;
  const startAligned = sourceKind !== 'sensors' || (startOff !== null && Math.abs(startOff) <= START_TOLERANCE_DEG);
  const canStart = scan.phase === 'ready' && cameraReady && startAligned;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {useRealCamera ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          onCameraReady={onCameraReady}
        />
      ) : (
        <SimulatedCamera />
      )}

      <LinearGradient colors={['rgba(8,12,9,0.7)', 'rgba(8,12,9,0)']} style={[styles.topShade, { height: insets.top + 190 }]} />
      <LinearGradient colors={['rgba(8,12,9,0)', 'rgba(8,12,9,0.75)']} style={styles.bottomShade} />

      <View style={{ paddingTop: insets.top }}>
        <TopBar
          title="창밖 환경 스캔"
          tone="dark"
          backIcon="close"
          onBack={goBackOrHome}
          right={
            <View style={styles.sourceBadge}>
              <View style={[styles.sourceDot, { backgroundColor: sourceKind === 'sensors' ? '#8FE0A0' : Colors.sunlight }]} />
              <AppText variant="small" color={Colors.white} style={styles.sourceText}>
                {sourceKind === 'sensors' ? 'SENSOR' : 'SIM'}
                {useRealCamera ? '' : ' · NO CAM'}
              </AppText>
            </View>
          }
        />
        <View style={styles.guide}>
          <View style={styles.windowChip}>
            <AppText variant="small" color={Colors.white} style={styles.windowChipText}>
              {windowName(roomWindow)}
            </AppText>
          </View>
          <AppText variant="bodyStrong" color={Colors.white} align="center" style={styles.guideText}>
            {needsFacing
              ? '먼저 창문 정면 방향을 기록해요.\n휴대폰 뒷면을 창문 유리에 대고 잠시 멈춰 주세요.'
              : `휴대폰을 약 ${targetPitch}° 위로 든 채로\n왼쪽에서 오른쪽으로 천천히 움직여 주세요.`}
          </AppText>
        </View>
      </View>

      {/* 조준선 */}
      <View style={styles.crosshair}>
        <View style={styles.crossLine} />
        <View style={styles.crossDot} />
      </View>

      {scan.lastCaptureAt ? <CaptureFlash key={scan.lastCaptureAt} /> : null}

      {scanning && scan.hint ? (
        <View style={styles.hint}>
          <TriangleAlert size={16} color="#1E2A21" strokeWidth={2.2} />
          <AppText variant="captionStrong" color="#1E2A21">
            {scan.hint === 'tilt' && sample ? tiltHint(sample.pitch) : HINT_TEXT[scan.hint]}
          </AppText>
        </View>
      ) : null}

      <View style={[styles.panel, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <PanoramaStrip
          progress={progress}
          target={target}
          step={DEFAULT_SCAN_CONFIG.captureStep}
          marks={scan.marks}
          warning={scan.hint === 'reverse'}
        />

        <View style={styles.readout}>
          <View>
            <AppText variant="label" color="rgba(255,255,255,0.6)">
              Progress
            </AppText>
            <AppText variant="valueLarge" color={Colors.white}>
              {`${Math.floor(progress)}° / ${target}°`}
            </AppText>
          </View>
          <View style={styles.readoutRight}>
            <AppText variant="captionStrong" color={Colors.white}>
              {sample ? `Azimuth ${trueAz(sample.azimuth).toFixed(0)}° ${compassLabel(trueAz(sample.azimuth))} (진북)` : 'Azimuth —'}
            </AppText>
            {sample ? (
              <View style={[styles.pitchChip, pitchOff && styles.pitchChipOff]}>
                <AppText variant="small" color={pitchOff ? '#1E2A21' : Colors.white} style={styles.pitchText}>
                  {`각도 ${formatPitch(sample.pitch)} / 목표 ${targetPitch}°`}
                </AppText>
              </View>
            ) : null}
            <AppText variant="small" color="rgba(255,255,255,0.65)">
              사진 {scan.captureCount}장
            </AppText>
          </View>
        </View>

        <ProgressBar
          value={(progress / target) * 100}
          animated={false}
          height={6}
          color="#BFE8C4"
          trackColor="rgba(255,255,255,0.14)"
        />

        {scan.phase === 'waitingSensor' ? (
          <AppText variant="caption" color="rgba(255,255,255,0.7)" align="center" style={styles.caption}>
            방향 센서를 준비하고 있어요…
          </AppText>
        ) : null}

        {needsFacing ? (
          <View style={styles.actions}>
            <AppText variant="caption" color="rgba(255,255,255,0.75)" align="center">
              ① 휴대폰을 창문과 평행하게 세워{'\n'}카메라가 창밖 정면을 보게 한 뒤 눌러 주세요
            </AppText>
            {facingNotice ? (
              <AppText variant="captionStrong" color={Colors.sunlight} align="center">
                {facingNotice}
              </AppText>
            ) : null}
            <PrimaryButton title="창문 정면 기록" icon={Compass} onPress={handleRecordFacing} />
          </View>
        ) : null}

        {scan.phase === 'ready' && facing ? (
          <View style={styles.actions}>
            <View style={styles.facingRow}>
              <AppText variant="captionStrong" color={Colors.white}>
                {`창문 정면 ${facing.azimuth.toFixed(0)}° ${compassLabel(facing.azimuth)} (진북)`}
              </AppText>
              <SecondaryButton title="다시 기록" variant="ghost" color={Colors.white} size="sm" onPress={handleRecordFacing} />
            </View>
            <AppText variant="caption" color="rgba(255,255,255,0.75)" align="center">
              ② 정면에서 왼쪽으로 약 {-START_OFFSET_DEG}° 돌린 뒤{'\n'}휴대폰을 약 {targetPitch}° 위로 들고 시작해 주세요
            </AppText>
            {fromFacing !== null ? (
              <AppText
                variant="small"
                color={startAligned ? '#BFE8C4' : 'rgba(255,255,255,0.65)'}
                align="center">
                {startAligned
                  ? `시작 위치에 맞았어요 (정면 기준 ${formatSignedDeg(fromFacing)})`
                  : `지금 정면 기준 ${formatSignedDeg(fromFacing)} / 시작 위치 ${formatSignedDeg(START_OFFSET_DEG)} ±${START_TOLERANCE_DEG}°`}
              </AppText>
            ) : null}
            <PrimaryButton
              title={!cameraReady ? '카메라 준비 중…' : startAligned ? '스캔 시작' : '시작 위치를 맞춰 주세요'}
              disabled={!canStart}
              onPress={startScan}
            />
          </View>
        ) : null}

        {scanning ? (
          <View style={styles.actions}>
            <SecondaryButton title="취소" variant="ghost" color={Colors.white} size="md" onPress={goBackOrHome} />
          </View>
        ) : null}
      </View>

      {finished ? (
        <View style={[StyleSheet.absoluteFill, styles.doneOverlay]}>
          <View style={styles.doneBadge}>
            <CircleCheck size={40} color={Colors.white} strokeWidth={1.8} />
          </View>
          <AppText variant="h1" color={Colors.white}>
            {scan.phase === 'done' ? '180° 스캔 완료' : '사진을 저장하고 있어요…'}
          </AppText>
          <AppText variant="body" color="rgba(255,255,255,0.75)">
            사진 {scan.captureCount}장
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function formatPitch(pitch: number) {
  return `${pitch >= 0 ? '+' : ''}${pitch.toFixed(0)}°`;
}

function formatSignedDeg(deg: number) {
  return `${deg > 0 ? '+' : ''}${deg.toFixed(0)}°`;
}

/** 목표 피치 기준 방향 안내 */
function tiltHint(pitch: number) {
  const target = DEFAULT_SCAN_CONFIG.targetPitch;
  return pitch < target ? `휴대폰을 조금 더 위로 들어주세요 (목표 ${target}°)` : `휴대폰을 조금 내려주세요 (목표 ${target}°)`;
}

/** 촬영 순간 살짝 번쩍이는 피드백 */
function CaptureFlash() {
  const [opacity] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [opacity]);
  return <Animated.View style={[StyleSheet.absoluteFill, styles.flash, { opacity }]} />;
}

/** 카메라 없이 테스트할 때의 배경 (Dev) */
function SimulatedCamera() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.center]}>
      <LinearGradient colors={['#3E5A6B', '#7C9AA8', '#556B4F', '#2C3A2A']} locations={[0, 0.45, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <AppText variant="label" color="rgba(255,255,255,0.55)">
        Camera simulation (Dev)
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0E1511',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  topShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bottomShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 360,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  guide: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  windowChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(119,170,192,0.45)',
  },
  windowChipText: {
    fontWeight: '700',
  },
  guideText: {
    lineHeight: 22,
  },
  crosshair: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '30%',
    bottom: '38%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crossLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  crossDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  flash: {
    pointerEvents: 'none',
    backgroundColor: Colors.white,
  },
  hint: {
    position: 'absolute',
    top: '56%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sunlight,
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: 'rgba(17, 26, 20, 0.78)',
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  readoutRight: {
    alignItems: 'flex-end',
    gap: 2,
    paddingBottom: 6,
  },
  pitchChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(143,224,160,0.28)',
  },
  pitchChipOff: {
    backgroundColor: Colors.sunlight,
  },
  pitchText: {
    fontWeight: '700',
  },
  caption: {
    marginTop: Spacing.xs,
  },
  actions: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  facingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  doneOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(14, 21, 17, 0.72)',
  },
  doneBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
});
