import type { ReactElement } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import type { PlantSpeciesId } from '@/types';

/**
 * 식물 종류별 top-front 일러스트 (사진 대신 사용).
 * viewBox 120 x 140, 화분 입구 중심은 (60, 98).
 */

type PotTone = 'clay' | 'cream' | 'sage' | 'sand';

const POT: Record<PotTone, { rim: string; body: string; shade: string }> = {
  clay: { rim: '#D49E76', body: '#C68D65', shade: '#AE7550' },
  cream: { rim: '#F6F0E4', body: '#ECE3D2', shade: '#D6CAB4' },
  sage: { rim: '#C3D3BC', body: '#AFC3A7', shade: '#93A98A' },
  sand: { rim: '#E7CFAE', body: '#DDBF97', shade: '#C4A276' },
};

const SPECIES_POT: Record<PlantSpeciesId, PotTone> = {
  monstera: 'clay',
  pothos: 'cream',
  olive: 'sand',
  sansevieria: 'sage',
  fiddleLeaf: 'cream',
  pilea: 'clay',
};

function Pot({ tone }: { tone: PotTone }) {
  const c = POT[tone];
  return (
    <G>
      <Ellipse cx={60} cy={138} rx={28} ry={3} fill="#35523A" opacity={0.08} />
      <Path d="M 37 104 L 83 104 L 79.5 130.5 Q 78.5 137 72 137 L 48 137 Q 41.5 137 40.5 130.5 Z" fill={c.body} />
      <Path d="M 75 104 L 83 104 L 79.5 130.5 Q 78.5 137 72 137 L 69 137 Q 74.5 134 75.5 128 Z" fill={c.shade} opacity={0.5} />
      <Rect x={32} y={94} width={56} height={12} rx={6} fill={c.rim} />
      <Rect x={37} y={96.5} width={22} height={2.5} rx={1.2} fill="#FFFFFF" opacity={0.3} />
    </G>
  );
}

const tf = (x: number, y: number, deg: number, s = 1) => `translate(${x} ${y}) rotate(${deg}) scale(${s})`;

/* ---------------- Monstera ---------------- */
const MONSTERA_LEAF =
  'M 0 0 C -10 2 -24 -4 -26 -18 C -28 -32 -16 -44 0 -46 C 16 -44 28 -32 26 -18 C 24 -4 10 2 0 0 Z';
const MONSTERA_SLITS = [
  'M -2 -12 L -25 -14',
  'M -2 -24 L -27 -28',
  'M -1 -35 L -19 -42',
  'M 2 -16 L 26 -18',
  'M 1 -29 L 25 -35',
];

function Monstera({ bg }: { bg: string }) {
  const leaves: [number, number, number, number, string][] = [
    [62, 40, 4, 0.78, '#5C8C58'],
    [40, 56, -42, 0.95, '#6C9D63'],
    [82, 50, 38, 1.0, '#78A86C'],
    [86, 80, 72, 0.6, '#6A9A61'],
    [36, 84, -70, 0.55, '#7AA96E'],
  ];
  return (
    <G>
      {leaves.map(([x, y], i) => (
        <Path key={`s${i}`} d={`M 60 98 Q ${(60 + x) / 2} ${y + 22} ${x} ${y}`} stroke="#5E8759" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      ))}
      {leaves.map(([x, y, deg, s, color], i) => (
        <G key={`l${i}`} transform={tf(x, y, deg, s)}>
          <Path d={MONSTERA_LEAF} fill={color} />
          <Path d="M 0 -2 Q 1 -24 0 -44" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.3} fill="none" />
          {MONSTERA_SLITS.map((d, k) => (
            <Path key={k} d={d} stroke={bg} strokeWidth={2.6} strokeLinecap="round" />
          ))}
        </G>
      ))}
    </G>
  );
}

/* ---------------- Pothos ---------------- */
const HEART_LEAF = 'M 0 0 C -6 -6 -16 -2 -15 -12 C -14 -22 -6 -28 0 -34 C 6 -28 14 -22 15 -12 C 16 -2 6 -6 0 0 Z';

function Pothos() {
  const vines = ['M 40 98 C 30 104 26 116 26 132', 'M 80 98 C 92 104 96 116 95 128'];
  const leaves: [number, number, number, number][] = [
    [60, 96, 0, 0.95],
    [49, 95, -34, 0.85],
    [71, 95, 34, 0.85],
    [40, 98, -72, 0.72],
    [80, 98, 72, 0.72],
    [30, 112, -150, 0.56],
    [25, 127, -172, 0.5],
    [92, 110, 150, 0.56],
    [96, 124, 170, 0.5],
  ];
  return (
    <G>
      {vines.map((d, i) => (
        <Path key={i} d={d} stroke="#7E9C5E" strokeWidth={1.6} fill="none" />
      ))}
      {leaves.map(([x, y, deg, s], i) => (
        <G key={i} transform={tf(x, y, deg, s)}>
          <Path d={HEART_LEAF} fill={i % 2 === 0 ? '#7FAE63' : '#93BE72'} />
          <Path d="M 0 -3 C -3 -12 2 -20 -1 -28" stroke="#EDE9A8" strokeWidth={3} strokeLinecap="round" opacity={0.65} fill="none" />
          <Path d="M 0 -2 L 0 -30" stroke="#FFFFFF" strokeOpacity={0.3} strokeWidth={1} />
        </G>
      ))}
    </G>
  );
}

/* ---------------- Olive ---------------- */
function Olive() {
  const clusters: [number, number][] = [
    [42, 50],
    [76, 44],
    [60, 30],
    [50, 66],
    [72, 62],
  ];
  const colors = ['#8FA38A', '#A6B89D', '#7F977A'];
  const leaves: ReactElement[] = [];
  clusters.forEach(([cx, cy], ci) => {
    for (let i = 0; i < 8; i++) {
      const deg = i * 45 + ci * 17;
      const rad = (deg * Math.PI) / 180;
      const x = cx + Math.sin(rad) * 7;
      const y = cy - Math.cos(rad) * 7;
      leaves.push(
        <Ellipse
          key={`${ci}-${i}`}
          cx={0}
          cy={-7}
          rx={2.8}
          ry={8.5}
          fill={colors[(i + ci) % 3]}
          transform={tf(x, y, deg)}
        />,
      );
    }
  });
  return (
    <G>
      <Path d="M 60 98 C 58 84 62 72 59 58" stroke="#8B7358" strokeWidth={3.6} strokeLinecap="round" fill="none" />
      <Path d="M 59 66 C 54 60 48 56 43 51" stroke="#8B7358" strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <Path d="M 60 62 C 66 56 71 50 76 45" stroke="#8B7358" strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <Path d="M 59 58 C 60 48 60 40 60 31" stroke="#8B7358" strokeWidth={2} strokeLinecap="round" fill="none" />
      {leaves}
      {[
        [48, 58],
        [70, 50],
        [62, 38],
      ].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={2.6} fill="#5E4E6E" />
      ))}
    </G>
  );
}

/* ---------------- Sansevieria ---------------- */
function Sansevieria() {
  const leaves: [number, number, number][] = [
    [44, 34, 42],
    [52, 47, 22],
    [60, 62, 12],
    [68, 74, 26],
    [76, 86, 44],
  ];
  return (
    <G>
      {leaves.map(([bx, tx, top], i) => (
        <G key={i}>
          <Path
            d={`M ${bx - 5} 100 C ${bx - 6} 72 ${tx - 4} 44 ${tx} ${top} C ${tx + 4} 44 ${bx + 6} 72 ${bx + 5} 100 Z`}
            fill={i % 2 === 0 ? '#4E7A55' : '#5E8A5F'}
            stroke="#D8D48A"
            strokeWidth={1.3}
          />
          {[0.3, 0.5, 0.7].map((p, k) => {
            const y = 100 - (100 - top) * p;
            const x = bx + (tx - bx) * p;
            return (
              <Path key={k} d={`M ${x - 3} ${y} Q ${x} ${y - 2} ${x + 3} ${y}`} stroke="#8DB08A" strokeWidth={1.2} fill="none" opacity={0.8} />
            );
          })}
        </G>
      ))}
    </G>
  );
}

/* ---------------- Fiddle leaf fig ---------------- */
const FIDDLE_LEAF =
  'M 0 0 C -8 -2 -13 -10 -12 -18 C -11 -24 -15 -30 -12 -36 C -9 -42 -3 -44 0 -44 C 3 -44 9 -42 12 -36 C 15 -30 11 -24 12 -18 C 13 -10 8 -2 0 0 Z';

function FiddleLeaf() {
  const leaves: [number, number, number, number][] = [
    [60, 78, -78, 0.72],
    [60, 82, 80, 0.72],
    [60, 60, -62, 0.82],
    [60, 64, 60, 0.82],
    [60, 42, -46, 0.86],
    [60, 46, 48, 0.86],
    [60, 30, 2, 0.8],
  ];
  return (
    <G>
      <Path d="M 60 98 L 60 30" stroke="#7F6A52" strokeWidth={3} strokeLinecap="round" />
      {leaves.map(([x, y, deg, s], i) => (
        <G key={i} transform={tf(x, y, deg, s)}>
          <Path d={FIDDLE_LEAF} fill={i % 2 === 0 ? '#4F7D50' : '#61905B'} />
          <Path d="M 0 -2 L 0 -40" stroke="#B9D2A6" strokeWidth={1.2} opacity={0.8} />
          <Path d="M 0 -14 L -7 -20 M 0 -24 L 7 -30 M 0 -20 L 7 -25" stroke="#B9D2A6" strokeWidth={0.8} opacity={0.6} />
        </G>
      ))}
    </G>
  );
}

/* ---------------- Pilea ---------------- */
function Pilea() {
  const coins: [number, number, number][] = [
    [-42, 40, 9],
    [-16, 46, 10],
    [12, 44, 9.5],
    [38, 40, 9],
    [-66, 30, 8],
    [62, 32, 8],
    [0, 28, 7.5],
    [-32, 24, 7],
    [28, 24, 7],
  ];
  return (
    <G>
      {coins.map(([deg, len], i) => {
        const rad = (deg * Math.PI) / 180;
        const x = 60 + Math.sin(rad) * len;
        const y = 97 - Math.cos(rad) * len;
        return <Path key={`s${i}`} d={`M 60 97 Q ${60 + Math.sin(rad) * len * 0.3} ${97 - len * 0.7} ${x} ${y}`} stroke="#86A36F" strokeWidth={1.4} fill="none" />;
      })}
      {coins.map(([deg, len, r], i) => {
        const rad = (deg * Math.PI) / 180;
        const x = 60 + Math.sin(rad) * len;
        const y = 97 - Math.cos(rad) * len;
        return (
          <G key={`c${i}`}>
            <Circle cx={x} cy={y} r={r} fill={i % 2 === 0 ? '#7FB069' : '#93C27C'} />
            <Circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.35} fill="#FFFFFF" opacity={0.18} />
            <Circle cx={x} cy={y} r={1.3} fill="#CFE3BF" />
          </G>
        );
      })}
    </G>
  );
}

export interface PlantIllustrationProps {
  speciesId: PlantSpeciesId;
  size?: number;
  /** 몬스테라 잎의 찢어진 부분에 비칠 배경색 */
  background?: string;
}

export function PlantIllustration({ speciesId, size = 96, background = Colors.lightGreen }: PlantIllustrationProps) {
  const foliage = (() => {
    switch (speciesId) {
      case 'monstera':
        return <Monstera bg={background} />;
      case 'pothos':
        return <Pothos />;
      case 'olive':
        return <Olive />;
      case 'sansevieria':
        return <Sansevieria />;
      case 'fiddleLeaf':
        return <FiddleLeaf />;
      case 'pilea':
        return <Pilea />;
    }
  })();

  // 덩굴 식물은 잎이 화분 앞으로 내려오도록 화분을 먼저 그린다
  const potFirst = speciesId === 'pothos';

  return (
    <Svg width={size} height={(size * 140) / 120} viewBox="0 0 120 140">
      {potFirst ? <Pot tone={SPECIES_POT[speciesId]} /> : null}
      {foliage}
      {!potFirst ? <Pot tone={SPECIES_POT[speciesId]} /> : null}
    </Svg>
  );
}
