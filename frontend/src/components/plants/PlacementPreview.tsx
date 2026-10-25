import { Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { ScoreRing } from '@/components/common/ScoreRing';
import { LIGHT_LEVEL_LABEL } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { PlacementAnalysis } from '@/types';
import { withRo } from '@/utils/korean';

/** 식물 등록 중 실시간 배치 적합도 미리보기 */
export function PlacementPreview({ analysis }: { analysis: PlacementAnalysis }) {
  const { current, recommended } = analysis;
  return (
    <Card tone="green" padding={Spacing.lg} radius={Radius.lg} style={styles.card}>
      <ScoreRing
        value={current.score}
        size={72}
        strokeWidth={6}
        color={recommended ? Colors.sunlight : Colors.primary}
        trackColor={Colors.surface}
        animateFrom={current.score}
      />
      <View style={styles.flex}>
        <AppText variant="label" color={Colors.primary}>
          Live analysis
        </AppText>
        <AppText variant="bodyStrong" style={styles.title}>
          이 위치의 예상 적합도
        </AppText>
        <AppText variant="caption" color={Colors.textSecondary}>
          빛 {LIGHT_LEVEL_LABEL[current.lightLevel]} · 예상 일조 {current.expectedSunHours}시간
        </AppText>
        {recommended ? (
          <View style={styles.hint}>
            <Sparkles size={13} color={Colors.primary} strokeWidth={2} />
            <AppText variant="small" color={Colors.deepGreen} style={styles.flex}>
              {withRo(recommended.label)} 옮기면 {recommended.score}%까지 좋아져요
            </AppText>
          </View>
        ) : (
          <View style={styles.hint}>
            <Sparkles size={13} color={Colors.primary} strokeWidth={2} />
            <AppText variant="small" color={Colors.deepGreen}>
              이미 잘 맞는 자리예요
            </AppText>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  title: {
    marginTop: 2,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
});
