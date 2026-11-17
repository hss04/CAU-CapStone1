import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { FloorPlanGrid } from '@/components/space/FloorPlanGrid';
import { LightLegend } from '@/components/space/LightLegend';
import { DLI_PERIOD } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { usePeriodDliMap } from '@/hooks/usePeriodDliMap';
import { fetchSuitableSpecies } from '@/services/api/endpoints';
import { formatDli } from '@/services/lightForecast';
import { evidenceText } from '@/services/placement/evidence';
import { describePosition } from '@/services/space/geometry';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { ApiSuitableSpecies } from '@/types/api';

type Result = ApiSuitableSpecies['results'][number];

const EMPTY_COPY: Record<Exclude<ApiSuitableSpecies['reasonCode'], 'MATCHES_FOUND'>, string> = {
  NO_FREE_CELL: '식물과 배치 불가 칸을 빼면 남는 칸이 없어요.',
  NO_SUITABLE_SPECIES: '빈 칸의 예상 DLI에 맞는 식물이 카탈로그에 없어요.',
};

/**
 * 이 방에 맞는 식물 — 지금 DLI 지도의 빈 칸(식물·배치 불가 칸 제외)에서 요구 DLI 범위에 드는 칸이 많은 종 순서
 * (GET /rooms/{id}/suitable-species). 새 식물을 들일 때 참고용.
 */
export default function SuitableSpeciesScreen() {
  const { state } = useGarden();
  const signedIn = useAuth().status === 'signedIn';
  const map = usePeriodDliMap(state.dliPeriod);
  const { room } = state;
  const roomId = room.server?.roomId;
  const jobId = map.source === 'calculated' ? map.jobId : null;

  const [data, setData] = useState<{ jobId: string; result: ApiSuitableSpecies } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!signedIn || roomId === undefined || !jobId) return;
    let cancelled = false;
    fetchSuitableSpecies(roomId, jobId, 30)
      .then((result) => {
        if (cancelled) return;
        setData({ jobId, result });
        setSelected(result.results[0]?.speciesId ?? null);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '불러오지 못했어요');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, roomId, jobId]);

  if (!signedIn || roomId === undefined) {
    return (
      <ScreenContainer header={<TopBar title="맞는 식물 찾기" />}>
        <EmptyState
          style={styles.section}
          title="측정한 방에서 쓸 수 있어요"
          description="로그인하고 서버에 저장된 방의 빛 지도를 계산하면 빈 칸에 맞는 식물을 찾아드려요."
          actionLabel="돌아가기"
          onAction={goBackOrHome}
        />
      </ScreenContainer>
    );
  }

  const result = data?.jobId === jobId ? data.result : null;
  const pick: Result | undefined = result?.results.find((r) => r.speciesId === selected);
  const bestPos = pick ? { x: pick.bestCell.col, y: pick.bestCell.row } : null;

  return (
    <ScreenContainer header={<TopBar title="맞는 식물 찾기" />}>
      <AppText variant="title" style={styles.title}>
        이 방 빈 자리에 맞는 식물
      </AppText>
      <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        {`${DLI_PERIOD[state.dliPeriod].label} 하루 평균 예상 DLI로, 지금 식물과 배치 불가 칸을 뺀 빈 칸 중 요구 범위에 드는 칸이 많은 순서예요.`}
      </AppText>

      {!jobId ? (
        <Card padding={Spacing.xl} radius={Radius.xl} style={styles.section}>
          {map.status === 'loading' ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <AppText variant="caption" color={Colors.textSecondary}>
                빛 지도를 계산하는 중이에요{map.progress ? ` · ${map.progress.done}/${map.progress.total}일` : ''}
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" color={Colors.textSecondary}>
              빛 지도를 먼저 계산해야 해요 · 공간 화면에서 창밖 스캔과 방 위치를 확인해 주세요{map.note ? ` (${map.note})` : ''}
            </AppText>
          )}
        </Card>
      ) : error ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.section}>
          불러오지 못했어요 · {error}
        </AppText>
      ) : !result ? (
        <ActivityIndicator size="small" color={Colors.primary} style={styles.section} />
      ) : result.reasonCode !== 'MATCHES_FOUND' ? (
        <Card padding={Spacing.xl} radius={Radius.xl} style={styles.section}>
          <AppText variant="caption" color={Colors.textSecondary}>
            {EMPTY_COPY[result.reasonCode]}
          </AppText>
        </Card>
      ) : (
        <>
          <Card padding={Spacing.lg} radius={Radius.xl} style={styles.section}>
            <FloorPlanGrid
              room={room}
              dli={map.map.totalDli}
              showFurnitureLabels={false}
              markers={[
                ...state.plants.map((p) => ({ id: p.id, position: p.location.position, variant: 'ghost' as const })),
                ...(bestPos ? [{ id: 'best', position: bestPos, variant: 'recommended' as const, label: pick?.name, showLabel: true }] : []),
              ]}
            />
            <LightLegend dli showPlant={false} showWindow={false} showRecommendation style={styles.legend} />
          </Card>

          <View style={styles.section}>
            <SectionHeader eyebrow="Candidates" title={`맞는 식물 ${result.total}종`} subtitle="눌러서 가장 잘 맞는 칸을 지도에서 확인해요" />
            <View style={styles.list}>
              {result.results.map((r) => {
                const active = r.speciesId === selected;
                const pos = { x: r.bestCell.col, y: r.bestCell.row };
                return (
                  <Pressable key={r.speciesId} onPress={() => setSelected(r.speciesId)} accessibilityState={{ selected: active }}>
                    <Card padding={Spacing.lg} radius={Radius.lg} tone={active ? 'green' : 'surface'}>
                      <View style={styles.row}>
                        <View style={styles.flex}>
                          <AppText variant="bodyStrong">{r.name}</AppText>
                          {r.scientificName ? (
                            <AppText variant="small" color={Colors.textSecondary} style={styles.italic}>
                              {r.scientificName}
                            </AppText>
                          ) : null}
                        </View>
                        <StatusChip label={`빈 칸 ${Math.round(r.suitableFraction * 100)}%`} tone="green" size="sm" />
                      </View>
                      <AppText variant="caption" color={Colors.textSecondary} style={styles.meta}>
                        {`요구 ${r.requiredDli.min}–${r.requiredDli.max} · 맞는 칸 ${r.suitableCells}/${r.availableCells} · 가장 잘 맞는 칸 ${describePosition(room, pos)} (DLI ${formatDli(r.bestCell.totalDli)})`}
                      </AppText>
                      <AppText variant="small" color={Colors.textTertiary} style={styles.meta}>
                        요구 DLI 근거: {evidenceText(r.evidence)}
                      </AppText>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <AppText variant="small" color={Colors.textTertiary} style={styles.sectionSm}>
            요구 DLI는 참고 범위(잠정)예요. 실제로 들일 때는 식물 상태를 보며 자리를 조정해 주세요.
          </AppText>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  italic: { fontStyle: 'italic' },
  title: { marginTop: Spacing.sm },
  subtitle: { marginTop: Spacing.sm },
  section: { marginTop: Spacing.xxl },
  sectionSm: { marginTop: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  legend: {
    marginTop: Spacing.md,
    justifyContent: 'center',
  },
  list: { gap: Spacing.sm },
  meta: { marginTop: 4 },
});
