import { LinearGradient as ExpoGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, Path, Polygon, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { ScanDetections } from '@/types';

/**
 * 카메라 프리뷰 자리에 들어가는 Placeholder.
 * 실제 카메라/AR 뷰가 준비되면 이 컴포넌트만 교체하면 된다.
 */

const MINT = '#BFE8C4';
const SUN = '#F2B84B';

const FEATURE_POINTS: [number, number][] = [
  [40, 90], [110, 60], [320, 80], [250, 40], [90, 200], [30, 300], [300, 240], [335, 420],
  [120, 360], [210, 170], [270, 330], [60, 470], [180, 450], [310, 520], [140, 560], [240, 600],
  [20, 560], [350, 300], [160, 110], [200, 380], [95, 520], [285, 470], [45, 380], [225, 250],
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export interface ScanViewfinderProps {
  progress: number;
  detected: ScanDetections;
  paused?: boolean;
}

export function ScanViewfinder({ progress, detected, paused = false }: ScanViewfinderProps) {
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [sweep]);
  const lineStyle = useAnimatedStyle(() => ({ top: `${8 + sweep.get() * 70}%` }));

  const wallOn = (i: number) => detected.walls > i;
  const visiblePoints = Math.round((Math.min(progress, 100) / 100) * FEATURE_POINTS.length);
  const floorMesh = progress > 40;

  // 바닥 격자 (원근)
  const floorLines: [number, number, number, number][] = [];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const y = lerp(400, 640, t * t * 0.9 + t * 0.1);
    const xl = lerp(70, 0, (y - 400) / 240);
    const xr = lerp(290, 360, (y - 400) / 240);
    floorLines.push([xl, y, xr, y]);
  }
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    floorLines.push([lerp(70, 290, t), 400, lerp(0, 360, t), 640]);
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <ExpoGradient colors={['#2B3F30', '#1A271E', '#0F1712']} style={StyleSheet.absoluteFill} />

      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="win-glow" cx="50%" cy="50%" r="60%">
            <Stop offset="0" stopColor="#FCE9B8" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#FCE9B8" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* 흐릿한 방 장면 */}
        <Rect x={70} y={150} width={220} height={250} fill="#34493A" opacity={0.55} />
        <Polygon points="0,640 70,400 290,400 360,640" fill="#223127" opacity={0.8} />
        <Circle cx={200} cy={250} r={140} fill="url(#win-glow)" />
        <Rect x={152} y={190} width={96} height={118} rx={3} fill="#E9DDB5" opacity={0.3} />
        <Line x1={200} y1={190} x2={200} y2={308} stroke="#FFFFFF" strokeOpacity={0.25} strokeWidth={2} />
        <Polygon points="306,186 336,152 336,362 306,346" fill="#E9DDB5" opacity={0.18} />
        {/* 빛 줄기 */}
        <Polygon points="152,308 248,308 300,520 110,520" fill="#FCE9B8" opacity={0.06} />
        {/* 가구 실루엣 */}
        <Polygon points="215,440 335,440 360,575 225,575" fill="#3D5343" opacity={0.85} />
        <Polygon points="228,448 322,448 326,470 232,470" fill="#56705C" opacity={0.8} />
        <Polygon points="18,428 118,428 110,470 8,478" fill="#3D5343" opacity={0.85} />

        {/* 벽 / 모서리 선 */}
        <G strokeWidth={wallOn(0) ? 2.2 : 1}>
          <Rect x={70} y={150} width={220} height={250} fill="none" stroke={wallOn(0) ? MINT : '#FFFFFF'} strokeOpacity={wallOn(0) ? 0.95 : 0.16} />
        </G>
        <Path d="M 0 0 L 70 150 L 70 400 L 0 640" fill="none" stroke={wallOn(1) ? MINT : '#FFFFFF'} strokeOpacity={wallOn(1) ? 0.9 : 0.14} strokeWidth={wallOn(1) ? 2.2 : 1} />
        <Path d="M 360 0 L 290 150 L 290 400 L 360 640" fill="none" stroke={wallOn(2) ? MINT : '#FFFFFF'} strokeOpacity={wallOn(2) ? 0.9 : 0.14} strokeWidth={wallOn(2) ? 2.2 : 1} />
        <Path d="M 70 400 L 290 400" fill="none" stroke={wallOn(3) ? MINT : '#FFFFFF'} strokeOpacity={wallOn(3) ? 0.9 : 0.14} strokeWidth={wallOn(3) ? 2.2 : 1} />

        {/* 바닥 AR 메쉬 */}
        {floorMesh
          ? floorLines.map(([x1, y1, x2, y2], i) => (
              <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={MINT} strokeOpacity={0.22} strokeWidth={1} strokeDasharray="3 5" />
            ))
          : null}

        {/* 창문 감지 */}
        {detected.windows >= 1 ? (
          <G>
            <Path
              d="M 144 204 L 144 182 L 166 182 M 234 182 L 256 182 L 256 204 M 256 294 L 256 316 L 234 316 M 166 316 L 144 316 L 144 294"
              stroke={SUN}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
            />
            <Rect x={168} y={160} width={64} height={18} rx={9} fill={SUN} />
            <SvgText x={200} y={173} fontSize={10.5} fontWeight="700" fill="#263229" textAnchor="middle">
              창문 · 남
            </SvgText>
          </G>
        ) : null}
        {detected.windows >= 2 ? (
          <G>
            <Polygon points="306,186 336,152 336,362 306,346" fill="none" stroke={SUN} strokeWidth={2.4} strokeDasharray="6 4" />
            <Rect x={286} y={372} width={56} height={18} rx={9} fill={SUN} />
            <SvgText x={314} y={385} fontSize={10.5} fontWeight="700" fill="#263229" textAnchor="middle">
              창문 · 동
            </SvgText>
          </G>
        ) : null}

        {/* 가구 감지 */}
        {detected.objects >= 1 ? (
          <G>
            <Polygon points="210,432 340,432 364,582 220,582" fill="none" stroke={MINT} strokeWidth={1.8} strokeDasharray="5 4" />
            <Rect x={244} y={588} width={44} height={18} rx={9} fill={MINT} />
            <SvgText x={266} y={601} fontSize={10.5} fontWeight="700" fill="#1F3024" textAnchor="middle">
              침대
            </SvgText>
          </G>
        ) : null}
        {detected.objects >= 2 ? (
          <G>
            <Polygon points="12,420 124,420 116,478 2,486" fill="none" stroke={MINT} strokeWidth={1.8} strokeDasharray="5 4" />
            <Rect x={40} y={494} width={44} height={18} rx={9} fill={MINT} />
            <SvgText x={62} y={507} fontSize={10.5} fontWeight="700" fill="#1F3024" textAnchor="middle">
              책상
            </SvgText>
          </G>
        ) : null}

        {/* 특징점 */}
        {FEATURE_POINTS.slice(0, visiblePoints).map(([x, y], i) => (
          <G key={i}>
            <Circle cx={x} cy={y} r={2.3} fill={MINT} />
            <Circle cx={x} cy={y} r={5} fill={MINT} opacity={0.18} />
          </G>
        ))}
      </Svg>

      {/* 스캔 라인 */}
      {!paused ? (
        <Animated.View style={[styles.scanLine, lineStyle]}>
          <ExpoGradient
            colors={['rgba(191,232,196,0)', 'rgba(191,232,196,0.22)']}
            style={styles.scanTrail}
          />
          <View style={styles.scanCore} />
        </Animated.View>
      ) : null}

      {/* 뷰파인더 모서리 */}
      <View style={styles.frame}>
        <View style={[styles.corner, styles.tl]} />
        <View style={[styles.corner, styles.tr]} />
        <View style={[styles.corner, styles.bl]} />
        <View style={[styles.corner, styles.br]} />
      </View>

      {paused ? <View style={styles.pausedDim} /> : null}
    </View>
  );
}

const C = 30;

const styles = StyleSheet.create({
  scanLine: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    height: 60,
    marginTop: -58,
  },
  scanTrail: {
    flex: 1,
  },
  scanCore: {
    height: 2,
    backgroundColor: MINT,
    boxShadow: '0px 0px 14px rgba(191, 232, 196, 0.95)',
  },
  frame: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '14%',
    bottom: '30%',
    left: 24,
    right: 24,
  },
  corner: {
    position: 'absolute',
    width: C,
    height: C,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  pausedDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 16, 12, 0.45)',
  },
});
