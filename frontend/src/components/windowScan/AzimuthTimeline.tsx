import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/common/AppText';
import { Colors, FontFamily, Spacing } from '@/constants/theme';
import type { CaptureStat } from '@/services/windowScan/scanAnalysis';

const OK = Colors.primary;
const GAP = '#D9534F';
const DUP = Colors.sunlightDeep;

export interface AzimuthTimelineProps {
  stats: CaptureStat[];
  startAzimuth: number;
  endAzimuth: number;
  scannedAngle: number;
  target: number;
  step: number;
}

/**
 * 촬영 방위각 디버그 타임라인.
 * 가로축 = 시작점 기준 상대 각도, 점 = 실제 촬영 지점, 점 위 숫자 = 실제 방위각.
 * 선 색: 정상(초록) / 누락 의심(빨강) / 중복 의심(주황)
 */
export function AzimuthTimeline({ stats, startAzimuth, endAzimuth, scannedAngle, target, step }: AzimuthTimelineProps) {
  const [width, setWidth] = useState(0);
  const height = 150;
  const pad = 18;
  const baseY = 88;

  const minR = Math.min(0, ...stats.map((s) => s.relative));
  const maxR = Math.max(target, scannedAngle, ...stats.map((s) => s.relative)) + 4;
  const inner = Math.max(1, width - pad * 2);
  const x = (r: number) => pad + ((r - minR) / (maxR - minR)) * inner;

  const ticks: number[] = [];
  for (let t = 0; t <= maxR; t += step) ticks.push(t);

  const segColor = (diff: number) => (diff > step * 1.6 || diff <= 0 ? GAP : diff < step * 0.4 ? DUP : OK);

  return (
    <View>
      <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <SvgText x={pad} y={14} fontSize={10.5} fontWeight="700" fill={Colors.textSecondary}>
              {`Start ${startAzimuth.toFixed(1)}°`}
            </SvgText>
            <SvgText x={width - pad} y={14} fontSize={10.5} fontWeight="700" fill={Colors.textSecondary} textAnchor="end">
              {`End ${endAzimuth.toFixed(1)}°`}
            </SvgText>

            {/* 기준선 + 눈금 (상대 각도) */}
            <Line x1={x(minR)} x2={x(maxR)} y1={baseY} y2={baseY} stroke="#D5D9CF" strokeWidth={2} />
            {ticks.map((t) => (
              <G key={t}>
                <Line x1={x(t)} x2={x(t)} y1={baseY + 4} y2={baseY + (t % 45 === 0 ? 12 : 8)} stroke="#B9BFB4" strokeWidth={1} />
                {t % 45 === 0 ? (
                  <SvgText x={x(t)} y={baseY + 25} fontSize={9.5} fill={Colors.textTertiary} textAnchor="middle">
                    {`+${t}°`}
                  </SvgText>
                ) : null}
              </G>
            ))}
            {/* 목표 180° */}
            <Line x1={x(target)} x2={x(target)} y1={30} y2={baseY + 14} stroke={Colors.sunlight} strokeWidth={1.5} strokeDasharray="4 3" />
            <SvgText x={x(target)} y={baseY + 40} fontSize={9.5} fontWeight="700" fill={Colors.sunlightDeep} textAnchor="middle">
              {`target ${target}°`}
            </SvgText>

            {/* 촬영 간격 */}
            {stats.slice(1).map((s, i) => (
              <Line
                key={`seg${s.index}`}
                x1={x(stats[i].relative)}
                x2={x(s.relative)}
                y1={baseY}
                y2={baseY}
                stroke={segColor(s.diff ?? 0)}
                strokeWidth={4}
                strokeLinecap="round"
              />
            ))}

            {/* 촬영 지점 + 실제 방위각 (겹치지 않게 두 줄로) */}
            {stats.map((s) => {
              const row = s.index % 2 === 0 ? baseY - 16 : baseY - 34;
              return (
                <G key={`pt${s.index}`}>
                  <Line x1={x(s.relative)} x2={x(s.relative)} y1={row + 3} y2={baseY - 6} stroke="#C8CEC3" strokeWidth={0.8} />
                  <Circle cx={x(s.relative)} cy={baseY} r={5} fill={Colors.white} stroke={Colors.deepGreen} strokeWidth={2} />
                  <SvgText x={x(s.relative)} y={row} fontSize={9.5} fontWeight="600" fill={Colors.text} textAnchor="middle">
                    {`${Math.round(s.capture.azimuth)}°`}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        <LegendItem color={OK} label={`정상 간격`} />
        <LegendItem color={GAP} label={`누락 의심 (> ${(step * 1.6).toFixed(0)}° 또는 감소)`} />
        <LegendItem color={DUP} label={`중복 의심 (< ${(step * 0.4).toFixed(0)}°)`} />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendLine, { backgroundColor: color }]} />
      <AppText variant="small" color={Colors.textSecondary} style={{ fontFamily: FontFamily.mono, fontSize: 10.5 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 150,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.md,
    rowGap: 4,
    marginTop: Spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendLine: {
    width: 14,
    height: 4,
    borderRadius: 2,
  },
});
