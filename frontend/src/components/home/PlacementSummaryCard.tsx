import { ArrowRight, MapPin, Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ProgressBar } from '@/components/common/ProgressBar';
import { StatusChip } from '@/components/common/StatusChip';
import { PlantIllustration } from '@/components/plants/PlantIllustration';
import { DLI_STATUS_COPY } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getSpecies } from '@/data/plantSpecies';
import { dliValueText, rangeText, usePlantDli } from '@/hooks/usePlantDli';
import { formatDli } from '@/services/lightForecast';
import type { DliStatus, Plant } from '@/types';
import { withRo } from '@/utils/korean';

export interface PlacementSummaryCardProps {
  plant: Plant;
  onPress: () => void;
}

/** HOME "오늘의 배치 추천" — 현재 위치 vs 추천 위치 (예상 DLI와 요구 범위로 비교) */
export function PlacementSummaryCard({ plant, onPress }: PlacementSummaryCardProps) {
  const light = usePlantDli(plant);
  if (!light || light.source === 'pending') return null;
  const { current, recommended: rec, range } = light;
  // 서버 방은 앱 예시 추천 칸이 없다 → 지금 자리가 범위 밖일 때만 서버 추천을 보러 가게 한다
  if (!rec && current.status === 'ok') return null;
  const species = getSpecies(plant.speciesId);
  const progress = (dli: number | null) => (dli === null ? 0 : Math.min(100, Math.round((dli / Math.max(range.max, 0.1)) * 100)));
  const delta = rec && rec.dli !== null && current.dli !== null ? rec.dli - current.dli : null;

  return (
    <Card padding={Spacing.xl} radius={Radius.xl}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <PlantIllustration speciesId={plant.speciesId} size={48} />
        </View>
        <View style={styles.headerText}>
          <AppText variant="h2">{plant.name}</AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.italic}>
            {species.scientificName}
          </AppText>
        </View>
        <StatusChip
          label={delta !== null ? `DLI ${delta >= 0 ? '+' : ''}${formatDli(delta)}` : rangeText(range)}
          tone="green"
          icon={Sparkles}
          size="sm"
        />
      </View>

      <View style={styles.compare}>
        <SpotBox kind="current" label="현재 위치" place={current.label} dli={current.dli} status={current.status} progress={progress(current.dli)} />
        {rec ? (
          <>
            <View style={styles.arrow}>
              <ArrowRight size={16} color={Colors.primary} strokeWidth={2} />
            </View>
            <SpotBox kind="recommended" label="추천 위치" place={rec.label} dli={rec.dli} status={rec.status} progress={progress(rec.dli)} />
          </>
        ) : null}
      </View>

      <AppText variant="caption" color={Colors.textSecondary} style={styles.message}>
        {rec
          ? `${withRo(rec.label)} 옮기면 예상 DLI가 ${dliValueText(current.dli)} → ${dliValueText(rec.dli)} mol/m²/day가 돼요 (${rangeText(range)}).`
          : `지금 자리는 ${rangeText(range)} 범위 밖이에요. 서버가 계산한 추천 위치를 확인해 보세요.`}
      </AppText>

      <PrimaryButton title="추천 위치 보기" icon={ArrowRight} iconPosition="right" size="md" onPress={onPress} />
    </Card>
  );
}

function SpotBox({
  kind,
  label,
  place,
  dli,
  status,
  progress,
}: {
  kind: 'current' | 'recommended';
  label: string;
  place: string;
  dli: number | null;
  status: DliStatus | null;
  progress: number;
}) {
  const rec = kind === 'recommended';
  return (
    <View style={[styles.box, rec ? styles.boxRec : styles.boxCur]}>
      <View style={styles.boxLabel}>
        <MapPin size={12} color={rec ? Colors.primary : Colors.markerGray} strokeWidth={2} />
        <AppText variant="small" color={rec ? Colors.primary : Colors.textSecondary}>
          {label}
        </AppText>
      </View>
      <AppText variant="bodyStrong" numberOfLines={1} style={styles.place}>
        {place}
      </AppText>
      <View style={styles.scoreRow}>
        <AppText variant="small" color={Colors.textSecondary}>
          {status ? `DLI · ${DLI_STATUS_COPY[status].label}` : 'DLI'}
        </AppText>
        <AppText variant="value" color={rec ? Colors.deepGreen : Colors.textSecondary} style={styles.score}>
          {dliValueText(dli)}
        </AppText>
      </View>
      <ProgressBar
        value={progress}
        height={5}
        color={rec ? Colors.primary : Colors.markerGray}
        trackColor={rec ? '#DCE6D3' : '#E6E8E1'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  headerText: {
    flex: 1,
  },
  italic: {
    fontStyle: 'italic',
  },
  compare: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  box: {
    flex: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 6,
  },
  boxCur: {
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  boxRec: {
    backgroundColor: Colors.lightGreen,
  },
  boxLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  place: {
    fontSize: 15.5,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  score: {
    fontSize: 26,
    lineHeight: 30,
  },
  arrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginHorizontal: -6,
    zIndex: 1,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 2px 8px rgba(53,82,58,0.12)',
  },
  message: {
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
});
