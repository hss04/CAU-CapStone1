import { Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { ScoreRing } from '@/components/common/ScoreRing';
import { DLI_STATUS_COPY } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { dliValueText, rangeText, useSpotDli } from '@/hooks/usePlantDli';
import type { PlacementAnalysis, PlantSpeciesId } from '@/types';
import { withRo } from '@/utils/korean';

/** 식물 등록 중 고른 자리의 예상 DLI 미리보기 (요구 범위와 비교) */
export function PlacementPreview({
  analysis,
  speciesId,
}: {
  analysis: PlacementAnalysis;
  speciesId: PlantSpeciesId | null;
}) {
  const { current } = analysis;
  const here = useSpotDli(current.position, speciesId);
  // 서버 방은 앱 예시 추천 칸을 쓰지 않는다 (등록 후 추천 화면에서 서버 추천)
  const recommended = here && here.source !== 'mock' ? null : analysis.recommended;
  const there = useSpotDli(recommended?.position ?? null, speciesId);
  const progress = here && here.dli !== null ? Math.min(100, Math.round((here.dli / Math.max(here.range.max, 0.1)) * 100)) : 0;
  const statusText = here?.status ? DLI_STATUS_COPY[here.status].label : '계산 전';

  return (
    <Card tone="green" padding={Spacing.lg} radius={Radius.lg} style={styles.card}>
      <ScoreRing
        value={progress}
        label={here ? dliValueText(here.dli) : '—'}
        caption="DLI"
        size={72}
        strokeWidth={6}
        color={here?.status === 'ok' ? Colors.primary : Colors.sunlight}
        trackColor={Colors.surface}
        animateFrom={progress}
      />
      <View style={styles.flex}>
        <AppText variant="label" color={Colors.primary}>
          Live analysis
        </AppText>
        <AppText variant="bodyStrong" style={styles.title}>
          이 위치의 예상 DLI
        </AppText>
        <AppText variant="caption" color={Colors.textSecondary}>
          {here ? `${statusText} · ${rangeText(here.range)} mol/m²/day` : '식물 종류를 고르면 요구 범위와 비교해요'}
        </AppText>
        {here?.source === 'pending' ? (
          <View style={styles.hint}>
            <Sparkles size={13} color={Colors.primary} strokeWidth={2} />
            <AppText variant="small" color={Colors.deepGreen} style={styles.flex}>
              빛 지도를 계산하면 예상 DLI가 나와요
            </AppText>
          </View>
        ) : recommended && there ? (
          <View style={styles.hint}>
            <Sparkles size={13} color={Colors.primary} strokeWidth={2} />
            <AppText variant="small" color={Colors.deepGreen} style={styles.flex}>
              {withRo(recommended.label)} 옮기면 DLI {dliValueText(here?.dli ?? null)} → {dliValueText(there.dli)}
            </AppText>
          </View>
        ) : here?.status === 'ok' ? (
          <View style={styles.hint}>
            <Sparkles size={13} color={Colors.primary} strokeWidth={2} />
            <AppText variant="small" color={Colors.deepGreen}>
              요구 범위 안이에요
            </AppText>
          </View>
        ) : null}
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
