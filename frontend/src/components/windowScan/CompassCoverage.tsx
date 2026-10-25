import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import type { ScanCapture } from '@/types';

export interface CompassCoverageProps {
  startAzimuth: number;
  scannedAngle: number;
  captures: ScanCapture[];
  /** 창문 정면 방위각 (참고선) */
  facingAzimuth?: number;
  size?: number;
}

/**
 * 절대 방위(N/E/S/W) 기준으로 스캔한 범위와 촬영 방향을 보여주는 나침반.
 * 예: 남쪽 창문이면 대략 90° ~ 270° 구간이 칠해져야 정상.
 */
export function CompassCoverage({ startAzimuth, scannedAngle, captures, facingAzimuth, size = 190 }: CompassCoverageProps) {
  const c = size / 2;
  const R = size / 2 - 26;
  const pt = (az: number, r: number) => {
    const a = (az * Math.PI) / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };

  const sweep = Math.min(Math.max(scannedAngle, 0), 359.9);
  const [sx, sy] = pt(startAzimuth, R);
  const [ex, ey] = pt(startAzimuth + sweep, R);
  const arc = `M ${sx} ${sy} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${ex} ${ey}`;

  return (
    <Svg width={size} height={size}>
      <Circle cx={c} cy={c} r={R} fill={Colors.surfaceMuted} stroke="#D5D9CF" strokeWidth={1.5} />
      {[0, 90, 180, 270].map((az) => {
        const [x, y] = pt(az, R + 13);
        return (
          <SvgText key={az} x={x} y={y + 4} fontSize={11} fontWeight="700" fill={az === 0 ? Colors.clayDeep : Colors.textSecondary} textAnchor="middle">
            {['N', 'E', 'S', 'W'][az / 90]}
          </SvgText>
        );
      })}

      {/* 스캔 범위 */}
      <Path d={arc} stroke={Colors.primary} strokeOpacity={0.35} strokeWidth={12} fill="none" strokeLinecap="round" />

      {/* 촬영 방향 */}
      {captures.map((cap, i) => {
        const [x, y] = pt(cap.azimuth, R);
        return <Line key={i} x1={c} y1={c} x2={x} y2={y} stroke={Colors.deepGreen} strokeWidth={1.2} strokeOpacity={0.8} />;
      })}

      {/* 창문 정면 */}
      {facingAzimuth !== undefined ? (
        <G>
          <Line
            x1={c}
            y1={c}
            x2={pt(facingAzimuth, R + 4)[0]}
            y2={pt(facingAzimuth, R + 4)[1]}
            stroke={Colors.water}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        </G>
      ) : null}

      {/* 시작 / 끝 */}
      <Circle cx={sx} cy={sy} r={5} fill={Colors.white} stroke={Colors.deepGreen} strokeWidth={2} />
      <Circle cx={ex} cy={ey} r={5} fill={Colors.deepGreen} />
      <Circle cx={c} cy={c} r={3} fill={Colors.text} />
    </Svg>
  );
}
