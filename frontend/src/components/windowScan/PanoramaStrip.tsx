import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { ScanMark } from '@/services/windowScan/scanController';

const MINT = '#BFE8C4';
const AMBER = '#F2B84B';

export interface PanoramaStripProps {
  /** 현재 진행 각도 (0 ~ target) */
  progress: number;
  target: number;
  step: number;
  marks: ScanMark[];
  warning?: boolean;
}

/**
 * 파노라마 촬영 가이드 스트립.
 * 0° ~ 180° 트랙 위에 진행 구간, 촬영된 지점(●), 현재 위치(▶)를 표시한다.
 */
export function PanoramaStrip({ progress, target, step, marks, warning = false }: PanoramaStripProps) {
  const [width, setWidth] = useState(0);
  const height = 58;
  const pad = 14;
  const trackY = 30;
  const inner = Math.max(0, width - pad * 2);
  const xOf = (deg: number) => pad + (Math.max(0, Math.min(target, deg)) / target) * inner;
  const ticks = Array.from({ length: Math.floor(target / step) + 1 }, (_, i) => i * step);
  const cx = xOf(progress);
  const indicator = warning ? AMBER : '#FFFFFF';

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Rect x={pad} y={trackY - 9} width={inner} height={18} rx={9} fill="rgba(255,255,255,0.1)" />
          <Rect x={pad} y={trackY - 9} width={Math.max(0, cx - pad)} height={18} rx={9} fill="rgba(191,232,196,0.3)" />

          {ticks.map((t) => (
            <Line
              key={t}
              x1={xOf(t)}
              x2={xOf(t)}
              y1={trackY - (t % 45 === 0 ? 13 : 5)}
              y2={trackY + (t % 45 === 0 ? 13 : 5)}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
            />
          ))}
          {[0, 90, 180].filter((t) => t <= target).map((t) => (
            <SvgText key={`l${t}`} x={xOf(t)} y={height - 1} fontSize={9.5} fill="rgba(255,255,255,0.6)" textAnchor="middle">
              {`${t}°`}
            </SvgText>
          ))}

          {marks.map((m, i) => (
            <Circle key={i} cx={xOf(m.relative)} cy={trackY} r={4} fill={MINT} stroke="#1B2A20" strokeWidth={1.2} />
          ))}

          {/* 현재 위치 */}
          <Line x1={cx} x2={cx} y1={4} y2={trackY + 14} stroke={indicator} strokeWidth={2} />
          <Path d={`M ${cx + 4} 2 L ${cx + 12} 7 L ${cx + 4} 12 Z`} fill={indicator} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 58,
  },
});
