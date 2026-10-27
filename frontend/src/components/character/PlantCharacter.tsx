import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { easeInOutCubic } from '@/hooks/useTween';
import type { CharacterState } from '@/types';
import { mixColor } from '@/utils/color';

/* ------------------------------------------------------------------ */
/* Pose 정의 — 상태별 줄기/잎의 모양과 색                                  */
/* ------------------------------------------------------------------ */

type Pt = [number, number];

interface StemPose {
  ctrl: Pt;
  tip: Pt;
  scale: number;
}

interface Pose {
  left: StemPose;
  right: StemPose;
  center: StemPose;
  leafLeft: string;
  leafRight: string;
  leafCenter: string;
  stem: string;
  cheek: number;
}

const BASE = { left: [95, 120] as Pt, right: [105, 120] as Pt, center: [100, 120] as Pt };

const POSES: Record<CharacterState, Pose> = {
  healthy: {
    left: { ctrl: [86, 84], tip: [64, 62], scale: 1 },
    right: { ctrl: [115, 80], tip: [137, 56], scale: 1 },
    center: { ctrl: [99, 92], tip: [101, 62], scale: 0.58 },
    leafLeft: '#6C9A66',
    leafRight: '#86AF7B',
    leafCenter: '#A6C996',
    stem: '#5D8A5B',
    cheek: 0.45,
  },
  happy: {
    left: { ctrl: [82, 80], tip: [56, 54], scale: 1.08 },
    right: { ctrl: [120, 76], tip: [146, 48], scale: 1.08 },
    center: { ctrl: [100, 88], tip: [100, 54], scale: 0.66 },
    leafLeft: '#679A5F',
    leafRight: '#80B073',
    leafCenter: '#A9CE93',
    stem: '#5A8A56',
    cheek: 0.62,
  },
  thirsty: {
    left: { ctrl: [84, 74], tip: [62, 78], scale: 0.96 },
    right: { ctrl: [117, 72], tip: [140, 82], scale: 0.96 },
    center: { ctrl: [100, 86], tip: [106, 64], scale: 0.55 },
    leafLeft: '#839E64',
    leafRight: '#9AB277',
    leafCenter: '#B3C68F',
    stem: '#6D8A58',
    cheek: 0.28,
  },
  veryThirsty: {
    left: { ctrl: [86, 66], tip: [64, 100], scale: 0.9 },
    right: { ctrl: [115, 64], tip: [137, 104], scale: 0.9 },
    center: { ctrl: [102, 74], tip: [115, 84], scale: 0.5 },
    leafLeft: '#A59E5F',
    leafRight: '#B8AE71',
    leafCenter: '#C7BD86',
    stem: '#878A5B',
    cheek: 0.12,
  },
  // 빛이 부족 — 잎이 빛을 찾아 한쪽(창가)으로 기울고 색이 옅어진다
  lowLight: {
    left: { ctrl: [92, 86], tip: [78, 68], scale: 0.92 },
    right: { ctrl: [119, 84], tip: [147, 72], scale: 0.96 },
    center: { ctrl: [104, 92], tip: [115, 66], scale: 0.54 },
    leafLeft: '#7E9C7C',
    leafRight: '#97B293',
    leafCenter: '#B4C8AE',
    stem: '#6A8C69',
    cheek: 0.2,
  },
  // 빛이 과다 — 잎이 옆으로 늘어지고 노랗게, 볼이 달아오른다
  tooBright: {
    left: { ctrl: [84, 80], tip: [58, 74], scale: 0.98 },
    right: { ctrl: [117, 78], tip: [143, 72], scale: 0.98 },
    center: { ctrl: [100, 90], tip: [99, 60], scale: 0.6 },
    leafLeft: '#8EA35C',
    leafRight: '#A5B56C',
    leafCenter: '#C3CA86',
    stem: '#788B52',
    cheek: 0.85,
  },
};

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const LEAF: Pt[][] = [
  [[0, 0]],
  [[-15, -3], [-25, -20], [-19, -36]],
  [[-15, -45], [-6, -50], [0, -53]],
  [[6, -50], [15, -45], [19, -36]],
  [[25, -20], [15, -3], [0, 0]],
];

function rotate([x, y]: Pt, origin: Pt, angle: number, s: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [origin[0] + (x * cos - y * sin) * s, origin[1] + (x * sin + y * cos) * s];
}

const fmt = ([x, y]: Pt) => `${x.toFixed(2)} ${y.toFixed(2)}`;

function leafPath(origin: Pt, angle: number, s: number): string {
  return LEAF.map((seg, i) => (i === 0 ? `M ${fmt(rotate(seg[0], origin, angle, s))}` : `C ${seg.map((p) => fmt(rotate(p, origin, angle, s))).join(', ')}`)).join(' ') + ' Z';
}

/** 잎 왼쪽 절반 — 입체감을 위한 하이라이트 */
function halfLeafPath(origin: Pt, angle: number, s: number): string {
  const segs = LEAF.slice(0, 3);
  return (
    segs.map((seg, i) => (i === 0 ? `M ${fmt(rotate(seg[0], origin, angle, s))}` : `C ${seg.map((p) => fmt(rotate(p, origin, angle, s))).join(', ')}`)).join(' ') +
    ` L ${fmt(rotate([0, 0], origin, angle, s))} Z`
  );
}

function veinPath(origin: Pt, angle: number, s: number): string {
  return `M ${fmt(rotate([0, -4], origin, angle, s))} Q ${fmt(rotate([1.5, -26], origin, angle, s))} ${fmt(rotate([0, -45], origin, angle, s))}`;
}

function tangentAngle(ctrl: Pt, tip: Pt): number {
  return Math.atan2(tip[0] - ctrl[0], -(tip[1] - ctrl[1]));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const lerpStem = (a: StemPose, b: StemPose, t: number): StemPose => ({
  ctrl: lerpPt(a.ctrl, b.ctrl, t),
  tip: lerpPt(a.tip, b.tip, t),
  scale: lerp(a.scale, b.scale, t),
});

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    left: lerpStem(a.left, b.left, t),
    right: lerpStem(a.right, b.right, t),
    center: lerpStem(a.center, b.center, t),
    leafLeft: mixColor(a.leafLeft, b.leafLeft, t),
    leafRight: mixColor(a.leafRight, b.leafRight, t),
    leafCenter: mixColor(a.leafCenter, b.leafCenter, t),
    stem: mixColor(a.stem, b.stem, t),
    cheek: lerp(a.cheek, b.cheek, t),
  };
}

/** 상태가 바뀌면 이전 자세에서 새 자세로 부드럽게 보간 (잎이 처졌다가 다시 펴지는 연출) */
function useAnimatedPose(target: Pose, enabled: boolean, duration = 850): Pose {
  const [pose, setPose] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (!enabled) {
      current.current = target;
      return;
    }
    const from = current.current;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - t0) / duration);
      const next = lerpPose(from, target, easeInOutCubic(t));
      current.current = next;
      setPose(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);

  // 애니메이션을 끄면 목표 자세를 바로 사용
  return enabled ? pose : target;
}

/* ------------------------------------------------------------------ */
/* Sub-parts                                                           */
/* ------------------------------------------------------------------ */

const INK = '#3B2A20';

function Stem({ base, pose, color }: { base: Pt; pose: StemPose; color: string }) {
  return (
    <Path
      d={`M ${fmt(base)} Q ${fmt(pose.ctrl)} ${fmt(pose.tip)}`}
      stroke={color}
      strokeWidth={5}
      strokeLinecap="round"
      fill="none"
    />
  );
}

function Leaf({ pose, color }: { pose: StemPose; color: string }) {
  const angle = tangentAngle(pose.ctrl, pose.tip);
  return (
    <G>
      <Path d={leafPath(pose.tip, angle, pose.scale)} fill={color} />
      <Path d={halfLeafPath(pose.tip, angle, pose.scale)} fill="#FFFFFF" opacity={0.13} />
      <Path
        d={veinPath(pose.tip, angle, pose.scale)}
        stroke="#FFFFFF"
        strokeOpacity={0.45}
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </G>
  );
}

function Sparkle({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <Path
      d={`M ${x} ${y - s} Q ${x} ${y} ${x + s} ${y} Q ${x} ${y} ${x} ${y + s} Q ${x} ${y} ${x - s} ${y} Q ${x} ${y} ${x} ${y - s} Z`}
      fill={color}
    />
  );
}

function Drop({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d="M 0 -12 C -3.5 -6.5 -5.5 -3 -5.5 0 A 5.5 5.5 0 0 0 5.5 0 C 5.5 -3 3.5 -6.5 0 -12 Z" fill="#8EBBD0" />
      <Path d="M -2.6 -0.5 A 2.8 2.8 0 0 0 -0.6 2.6" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" fill="none" />
    </G>
  );
}

/** 빛 부족 상태 장식 — 작은 구름 */
function SmallCloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path
        d="M -14 6 A 7 7 0 0 1 -9 -6 A 9 9 0 0 1 8 -8 A 7 7 0 0 1 15 6 Z"
        fill="#D5DDE5"
      />
      <Path d="M -9 1.5 L 9 1.5" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
    </G>
  );
}

/** 빛 과다 상태 장식 — 해 */
function HotSun({ x, y }: { x: number; y: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <G>
      {rays.map((a) => (
        <Path
          key={a}
          d={`M ${x + Math.cos(a) * 13} ${y + Math.sin(a) * 13} L ${x + Math.cos(a) * 18} ${y + Math.sin(a) * 18}`}
          stroke="#F2B84B"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      ))}
      <Circle cx={x} cy={y} r={9.5} fill="#F6C65E" />
    </G>
  );
}

/** 빛 과다 상태 장식 — 땀방울 */
function Sweat({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(0.62) rotate(14)`}>
      <Path d="M 0 -12 C -3.5 -6.5 -5.5 -3 -5.5 0 A 5.5 5.5 0 0 0 5.5 0 C 5.5 -3 3.5 -6.5 0 -12 Z" fill="#A9D2E2" />
    </G>
  );
}

function Face({ state, cheek }: { state: CharacterState; cheek: number }) {
  const eyes = (() => {
    switch (state) {
      case 'happy':
        return (
          <G stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none">
            <Path d="M 79.5 160 Q 85 152.5 90.5 160" />
            <Path d="M 109.5 160 Q 115 152.5 120.5 160" />
          </G>
        );
      case 'veryThirsty':
        return (
          <G stroke={INK} strokeLinecap="round" fill="none">
            <Path d="M 79.5 158.5 Q 85 163 90.5 158.5" strokeWidth={2.8} />
            <Path d="M 109.5 158.5 Q 115 163 120.5 158.5" strokeWidth={2.8} />
            <Path d="M 80 151.5 L 89 148.5" strokeWidth={2} opacity={0.75} />
            <Path d="M 111 148.5 L 120 151.5" strokeWidth={2} opacity={0.75} />
          </G>
        );
      case 'lowLight':
        // 반쯤 감긴 졸린 눈 + 처진 눈썹
        return (
          <G>
            <Path d="M 80.5 157 A 4.5 4.5 0 0 0 89.5 157 Z" fill={INK} />
            <Path d="M 110.5 157 A 4.5 4.5 0 0 0 119.5 157 Z" fill={INK} />
            <G stroke={INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.6}>
              <Path d="M 80.5 149 L 89 151" />
              <Path d="M 111 151 L 119.5 149" />
            </G>
          </G>
        );
      case 'tooBright':
        // 눈부셔서 찡그린 눈 (> <)
        return (
          <G stroke={INK} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <Path d="M 81 153.5 L 89 158 L 81 162.5" />
            <Path d="M 119 153.5 L 111 158 L 119 162.5" />
          </G>
        );
      case 'thirsty':
        return (
          <G>
            <Circle cx={85} cy={159} r={4} fill={INK} />
            <Circle cx={115} cy={159} r={4} fill={INK} />
            <Circle cx={86.4} cy={157.6} r={1.3} fill="#FFFFFF" />
            <Circle cx={116.4} cy={157.6} r={1.3} fill="#FFFFFF" />
            <G stroke={INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.6}>
              <Path d="M 80.5 150.5 L 89 148.8" />
              <Path d="M 111 148.8 L 119.5 150.5" />
            </G>
          </G>
        );
      default:
        return (
          <G>
            <Circle cx={85} cy={158} r={4.4} fill={INK} />
            <Circle cx={115} cy={158} r={4.4} fill={INK} />
            <Circle cx={86.5} cy={156.5} r={1.4} fill="#FFFFFF" />
            <Circle cx={116.5} cy={156.5} r={1.4} fill="#FFFFFF" />
          </G>
        );
    }
  })();

  const mouth = (() => {
    switch (state) {
      case 'happy':
        return (
          <G>
            <Path d="M 91 167.5 Q 100 182 109 167.5 Z" fill={INK} />
            <Path d="M 95.5 174 Q 100 170.5 104.5 174 Q 100 178.5 95.5 174 Z" fill="#E7907C" />
          </G>
        );
      case 'thirsty':
        return <Ellipse cx={100} cy={171} rx={3.6} ry={3} fill={INK} />;
      case 'lowLight':
        return (
          <Path d="M 94 172.5 Q 100 167.5 106 172.5" stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
        );
      case 'tooBright':
        // 더워서 헥헥 — 물결 입
        return (
          <Path
            d="M 91.5 170.5 Q 94.3 167.5 97.2 170.5 Q 100 173.5 102.8 170.5 Q 105.7 167.5 108.5 170.5"
            stroke={INK}
            strokeWidth={2.4}
            strokeLinecap="round"
            fill="none"
          />
        );
      case 'veryThirsty':
        return (
          <Path
            d="M 92 173.5 Q 96 169 100 172 Q 104 175 108 170.5"
            stroke={INK}
            strokeWidth={2.6}
            strokeLinecap="round"
            fill="none"
          />
        );
      default:
        return (
          <Path d="M 93 169 Q 100 176.5 107 169" stroke={INK} strokeWidth={2.8} strokeLinecap="round" fill="none" />
        );
    }
  })();

  return (
    <G>
      <Ellipse cx={72.5} cy={170} rx={7.5} ry={4.6} fill="#EE9C84" opacity={cheek} />
      <Ellipse cx={127.5} cy={170} rx={7.5} ry={4.6} fill="#EE9C84" opacity={cheek} />
      {eyes}
      {mouth}
    </G>
  );
}

/* ------------------------------------------------------------------ */
/* PlantCharacter                                                      */
/* ------------------------------------------------------------------ */

export interface PlantCharacterProps {
  state: CharacterState;
  /** 가로 크기(px). 세로는 1.1배 */
  size?: number;
  /** 둥실둥실 떠 있는 idle 애니메이션 + 상태 전환 애니메이션 */
  animated?: boolean;
  /** 반짝이 / 물방울 같은 상태별 장식 */
  showDecorations?: boolean;
}

export function PlantCharacter({ state, size = 200, animated = true, showDecorations = true }: PlantCharacterProps) {
  const pose = useAnimatedPose(POSES[state], animated);
  const height = size * 1.1;

  const float = useSharedValue(0);
  useEffect(() => {
    if (!animated) return;
    float.set(withRepeat(withTiming(1, { duration: 2300, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [animated, float]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -5 * float.get() }] }));

  return (
    <View style={{ width: size, height }} accessibilityRole="image" accessibilityLabel={`식물 캐릭터 (${state})`}>
      {/* 그림자는 떠오르는 애니메이션과 분리 */}
      <Svg width={size} height={height} viewBox="0 0 200 220" style={StyleSheet.absoluteFill}>
        <Ellipse cx={100} cy={210} rx={50} ry={6.5} fill="#35523A" opacity={0.1} />
        {showDecorations && state === 'veryThirsty' ? (
          <Path d={leafPath([158, 208], 1.75, 0.34)} fill="#C8B46D" />
        ) : null}
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, floatStyle]}>
        <Svg width={size} height={height} viewBox="0 0 200 220">
          {/* 줄기 & 잎 (화분 뒤) */}
          <Stem base={BASE.left} pose={pose.left} color={pose.stem} />
          <Stem base={BASE.right} pose={pose.right} color={pose.stem} />
          <Stem base={BASE.center} pose={pose.center} color={pose.stem} />
          <Leaf pose={pose.left} color={pose.leafLeft} />
          <Leaf pose={pose.right} color={pose.leafRight} />
          <Leaf pose={pose.center} color={pose.leafCenter} />

          {/* 화분 */}
          <Path d="M 55 130 L 145 130 L 137.5 191 Q 136 204 123 204 L 77 204 Q 64 204 62.5 191 Z" fill="#C68D65" />
          <Path
            d="M 131 130 L 145 130 L 137.5 191 Q 136 204 123 204 L 116 204 Q 127.5 200 129 188 Z"
            fill="#AE7550"
            opacity={0.45}
          />
          <Rect x={47} y={114} width={106} height={22} rx={11} fill="#D49E76" />
          <Rect x={57} y={118.5} width={46} height={4} rx={2} fill="#FFFFFF" opacity={0.2} />

          <Face state={state} cheek={pose.cheek} />

          {showDecorations && state === 'happy' ? (
            <G>
              <Sparkle x={34} y={46} s={7} color="#F2B84B" />
              <Sparkle x={167} y={30} s={9} color="#F2B84B" />
              <Sparkle x={176} y={86} s={5} color="#F6CD77" />
              <Sparkle x={24} y={94} s={4.5} color="#F6CD77" />
            </G>
          ) : null}
          {showDecorations && state === 'thirsty' ? <Drop x={152} y={120} /> : null}
          {showDecorations && state === 'lowLight' ? (
            <G>
              <SmallCloud x={30} y={26} s={0.9} />
              <SmallCloud x={178} y={22} s={0.7} />
            </G>
          ) : null}
          {showDecorations && state === 'tooBright' ? (
            <G>
              <HotSun x={166} y={34} />
              <Sweat x={136} y={150} />
            </G>
          ) : null}
          {showDecorations && state === 'veryThirsty' ? (
            <G>
              <Drop x={154} y={116} s={1.15} />
              <Drop x={40} y={132} s={0.75} />
            </G>
          ) : null}
        </Svg>
      </Animated.View>
    </View>
  );
}
