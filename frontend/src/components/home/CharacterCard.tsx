import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, RadialGradient, Stop } from 'react-native-svg';

import { PlantCharacter } from '@/components/character/PlantCharacter';
import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { FadeInView } from '@/components/common/FadeInView';
import { StatusChip } from '@/components/common/StatusChip';
import { CHARACTER_COPY } from '@/constants/labels';
import { Colors, Radius, Shadows, Spacing } from '@/constants/theme';
import type { CharacterMood } from '@/store/selectors';

export interface CharacterCardProps {
  mood: CharacterMood;
  dateLabel: string;
  /** 시연용: 길게 누르면 캐릭터 상태 순환 */
  onLongPress?: () => void;
  /** 상태 판단 근거 안내 (예: 예상 광량·물주기 기록 기반 · 예시 데이터) */
  basisNote?: string;
}

/** 배경 빛 분위기 — 따뜻함(햇빛) / 서늘함(흐림·목마름) */
const GLOW: Record<CharacterMood['state'], { color: string; beam: number }> = {
  happy: { color: '#FBE3A6', beam: 0.9 },
  healthy: { color: '#FBE3A6', beam: 0.9 },
  tooBright: { color: '#F9D27E', beam: 1 },
  thirsty: { color: '#CFE3EC', beam: 0.45 },
  veryThirsty: { color: '#CFE3EC', beam: 0.45 },
  lowLight: { color: '#D9E0E8', beam: 0.25 },
};

/** HOME 메인 — 식물 캐릭터와 상태 메시지 */
export function CharacterCard({ mood, dateLabel, onLongPress, basisNote }: CharacterCardProps) {
  const copy = CHARACTER_COPY[mood.state];
  const glow = GLOW[mood.state];
  const warm = glow.beam >= 0.9;
  const secondary = mood.secondary ? CHARACTER_COPY[mood.secondary] : null;

  return (
    <Card tone="green" padding={0} radius={Radius.xl} onLongPress={onLongPress} style={styles.card}>
      {/* 창문으로 들어오는 빛 느낌의 배경 */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="cc-beam" x1="1" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.75} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Polygon points="70,0 84,0 36,100 16,100" fill="url(#cc-beam)" opacity={glow.beam} />
        <Polygon points="90,0 96,0 62,100 52,100" fill="url(#cc-beam)" opacity={glow.beam * 0.75} />
      </Svg>
      <Svg style={styles.glow} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="cc-glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glow.color} stopOpacity={warm ? 0.95 : 0.8} />
            <Stop offset="1" stopColor={glow.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill="url(#cc-glow)" />
      </Svg>

      <View style={styles.topRow}>
        <View style={styles.chips}>
          <View style={[styles.stateChip, { backgroundColor: Colors.surface }]}>
            <View style={[styles.stateDot, { backgroundColor: copy.color }]} />
            <AppText variant="small" color={copy.color} style={styles.stateText}>
              {copy.label}
            </AppText>
          </View>
          {secondary ? <StatusChip label={`+ ${secondary.labelKo}`} tone="white" size="sm" style={styles.secondary} /> : null}
        </View>
        <AppText variant="label" color={Colors.textSecondary} style={styles.date}>
          {dateLabel}
        </AppText>
      </View>

      <View style={styles.characterWrap}>
        <PlantCharacter state={mood.state} size={196} />
      </View>

      <FadeInView key={mood.message} style={styles.pillWrap}>
        <View style={[styles.pill, Shadows.soft]}>
          <AppText variant="bodyStrong" align="center" style={styles.pillText}>
            {mood.message}
          </AppText>
        </View>
      </FadeInView>

      {basisNote ? (
        <AppText variant="small" color={Colors.textSecondary} align="center" style={styles.basis}>
          {basisNote}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  glow: {
    position: 'absolute',
    width: 260,
    height: 260,
    right: -90,
    top: -110,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  secondary: {
    height: 27,
  },
  stateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  stateDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  stateText: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  date: {
    letterSpacing: 1.2,
  },
  characterWrap: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  pillWrap: {
    alignItems: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  pill: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingVertical: 13,
    paddingHorizontal: Spacing.xxl,
  },
  pillText: {
    fontSize: 15.5,
    fontWeight: '500',
  },
  basis: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
});
