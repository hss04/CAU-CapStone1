import { Droplet, Sun } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';

import { PlantCharacter } from '@/components/character/PlantCharacter';
import { AppText } from '@/components/common/AppText';
import { FloorPlanGrid } from '@/components/space/FloorPlanGrid';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import { MOCK_ROOM } from '@/data/mockRoom';

const SIZE = 270;

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <View style={styles.backdrop}>
      <View style={styles.circle} />
      {children}
    </View>
  );
}

function FloatingChip({
  icon: Icon,
  text,
  color,
  bg,
  style,
}: {
  icon?: typeof Sun;
  text: string;
  color: string;
  bg: string;
  style: object;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }, Shadows.soft, style]}>
      {Icon ? <Icon size={13} color={color} strokeWidth={2} /> : null}
      <AppText variant="captionStrong" color={color}>
        {text}
      </AppText>
    </View>
  );
}

/** 1. 서비스 소개 — 우리 집 평면도 위에서 좋은 자리 찾기 */
export function IntroIllustration() {
  return (
    <Backdrop>
      <View style={[styles.planCard, Shadows.card]}>
        <FloorPlanGrid
          room={MOCK_ROOM}
          showFurnitureLabels={false}
          showWindowLabels={false}
          markerSize={26}
          markers={[{ id: 'best', position: { x: 3, y: 2 }, variant: 'recommended' }]}
        />
      </View>
      <FloatingChip icon={Sun} text="여기가 가장 밝아요" color={Colors.sunlightDeep} bg={Colors.surface} style={{ top: 22, right: 6 }} />
      <View style={[styles.question, Shadows.card]}>
        <AppText variant="title" color={Colors.white} style={{ fontSize: 30, lineHeight: 34 }}>
          ?
        </AppText>
      </View>
    </Backdrop>
  );
}

/** 2. 방 스캔 — 휴대폰 뷰파인더 */
export function ScanIllustration() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [t]);
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: 20 + t.get() * 170 }] }));

  return (
    <Backdrop>
      <View style={[styles.phone, Shadows.card]}>
        <Svg width={148} height={236} viewBox="0 0 148 236">
          <Defs>
            <LinearGradient id="room" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#2F4535" />
              <Stop offset="1" stopColor="#1C2A20" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={148} height={236} rx={18} fill="url(#room)" />
          {/* 방 모서리 원근선 */}
          <Path d="M 0 60 L 50 88 L 98 88 L 148 60" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.2} fill="none" />
          <Path d="M 50 88 L 50 170 L 0 210 M 98 88 L 98 170 L 148 210 M 50 170 L 98 170" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.2} fill="none" />
          {/* 창문 감지 */}
          <Rect x={58} y={100} width={32} height={40} fill="#F6E7B4" opacity={0.28} />
          <Path d="M 54 104 L 54 96 L 62 96 M 86 96 L 94 96 L 94 104 M 94 136 L 94 144 L 86 144 M 62 144 L 54 144 L 54 136" stroke={Colors.sunlight} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          {/* 특징점 */}
          {[
            [20, 70],
            [36, 120],
            [120, 76],
            [128, 150],
            [74, 184],
            [24, 190],
            [112, 196],
          ].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={2} fill="#BFE3C3" opacity={0.9} />
          ))}
          <Line x1={20} y1={70} x2={36} y2={120} stroke="#BFE3C3" strokeOpacity={0.4} strokeWidth={0.8} />
          <Line x1={120} y1={76} x2={128} y2={150} stroke="#BFE3C3" strokeOpacity={0.4} strokeWidth={0.8} />
        </Svg>
        <Animated.View style={[styles.scanLine, lineStyle]} />
        <View style={styles.notch} />
      </View>
      <FloatingChip text="창문 감지됨" color={Colors.deepGreen} bg={Colors.surface} icon={Sun} style={{ top: 58, right: 0 }} />
      <FloatingChip text="벽 4 · 가구 5" color={Colors.textSecondary} bg={Colors.surface} style={{ bottom: 40, left: 0 }} />
    </Backdrop>
  );
}

/** 3. 배치 추천 — 현재 → 추천 위치 */
export function RecommendIllustration() {
  return (
    <Backdrop>
      <View style={[styles.planCard, styles.planCardLarge, Shadows.card]}>
        <FloorPlanGrid
          room={MOCK_ROOM}
          showFurnitureLabels={false}
          showWindowLabels={false}
          markers={[
            { id: 'cur', position: { x: 2, y: 5 }, variant: 'current' },
            { id: 'rec', position: { x: 3, y: 2 }, variant: 'recommended' },
          ]}
          path={{ from: { x: 2, y: 5 }, to: { x: 3, y: 2 } }}
        />
      </View>
      <FloatingChip text="현재 62%" color={Colors.white} bg="#737B72" style={{ bottom: 44, left: -4 }} />
      <FloatingChip text="추천 87%" color={Colors.white} bg={Colors.primary} style={{ top: 30, right: -6 }} />
    </Backdrop>
  );
}

/** 4. 함께 관리 — 캐릭터 */
export function CareIllustration() {
  return (
    <Backdrop>
      <PlantCharacter state="happy" size={190} />
      <FloatingChip icon={Droplet} text="내일 물주기" color={Colors.waterDeep} bg={Colors.surface} style={{ top: 44, left: 0 }} />
      <FloatingChip icon={Sun} text="오늘 햇빛 High" color={Colors.sunlightDeep} bg={Colors.surface} style={{ bottom: 58, right: 0 }} />
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    width: SIZE + 30,
    height: SIZE + 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: Colors.lightGreen,
  },
  planCard: {
    width: 170,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  planCardLarge: {
    width: 206,
    padding: Spacing.xs,
  },
  question: {
    position: 'absolute',
    bottom: 36,
    left: 34,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
  },
  phone: {
    width: 160,
    height: 248,
    borderRadius: 24,
    backgroundColor: '#1C2A20',
    padding: 6,
    overflow: 'hidden',
  },
  scanLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#CFE8C8',
    boxShadow: '0px 0px 12px rgba(207, 232, 200, 0.9)',
  },
  notch: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    left: 62,
    width: 36,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0F1712',
  },
});
