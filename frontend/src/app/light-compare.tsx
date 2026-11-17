import { CalendarRange, Play } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatusChip, type ChipTone } from '@/components/common/StatusChip';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { compareDliPeriods } from '@/services/api/endpoints';
import { describeServerError, dliOptionsFor, ensureDliSeries, formatDli } from '@/services/lightForecast';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { ApiComparisonPeriodInput, ApiDliComparison } from '@/types/api';
import { addDays, parseISODate, toISODate } from '@/utils/date';

interface Preset extends ApiComparisonPeriodInput {
  key: string;
  hint: string;
}

/**
 * 고를 수 있는 기간 — 최근 30일과, 작년 날씨로 본 달별 기간 (지난 날짜라 실제 기상 자료로 계산).
 * '계절이 바뀌면 지금 자리가 계속 맞을까'를 미리 보는 용도다.
 */
function presets(today: string): Preset[] {
  const t = parseISODate(today);
  const list: Preset[] = [
    {
      key: 'recent',
      label: '최근 30일',
      hint: '지금',
      startDate: toISODate(addDays(t, -29)),
      endDate: today,
    },
  ];
  // 작년 같은 달부터 0·1·3·6개월 뒤 (모두 오늘보다 이전 달)
  for (const [offset, hint] of [
    [0, '작년 이맘때'],
    [1, '작년 다음 달'],
    [3, '3개월 뒤 계절'],
    [6, '반대 계절'],
  ] as const) {
    const start = new Date(t.getFullYear() - 1, t.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    if (toISODate(end) >= today) continue;
    list.push({
      key: `m${offset}`,
      label: `${start.getFullYear()}년 ${start.getMonth() + 1}월`,
      hint,
      startDate: toISODate(start),
      endDate: toISODate(end),
    });
  }
  return list;
}

const STATUS: Record<'LOW' | 'OK' | 'HIGH' | 'UNAVAILABLE', { label: string; tone: ChipTone }> = {
  LOW: { label: '부족', tone: 'dusk' },
  OK: { label: '적정', tone: 'green' },
  HIGH: { label: '과다', tone: 'sun' },
  UNAVAILABLE: { label: '자리 없음', tone: 'neutral' },
};

function roomMean(grid: (number | null)[][] | null): number | null {
  if (!grid) return null;
  const values = grid.flat().filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * 기간별 빛 비교 — 기간마다 날짜별 DLI를 서버에 저장해 두고(POST /dli-series),
 * 저장된 결과로 기간 평균을 비교한다 (POST /dli-comparison). 식물 자리마다 적정 여부가 바뀌는지 본다.
 */
export default function LightCompareScreen() {
  const { state } = useGarden();
  const signedIn = useAuth().status === 'signedIn';
  const { room, plants, serverSpecies } = state;
  const options = presets(state.today);
  const [chosen, setChosen] = useState<string[]>(() => options.filter((o) => ['recent', 'm1', 'm3'].includes(o.key)).map((o) => o.key));
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiDliComparison | null>(null);
  const runId = useRef(0);

  // 화면을 나가면 진행 중인 계산 대기를 멈춘다 (서버 계산은 저장돼 다음에 다시 쓴다)
  useEffect(
    () => () => {
      runId.current += 1;
    },
    [],
  );

  if (!signedIn || !room.server) {
    return (
      <ScreenContainer header={<TopBar title="기간 비교" />}>
        <EmptyState
          style={styles.section}
          title="측정한 방에서 쓸 수 있어요"
          description="로그인하고 서버에 저장된 방(창밖 스캔·위치 완료)에서 기간별 빛을 비교할 수 있어요."
          actionLabel="돌아가기"
          onAction={goBackOrHome}
        />
      </ScreenContainer>
    );
  }

  const toggle = (key: string) => {
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev.length >= 4 ? prev : [...prev, key]));
  };

  const run = async () => {
    const periods = options.filter((o) => chosen.includes(o.key));
    if (periods.length < 2 || !room.server) return;
    const id = ++runId.current;
    const cancelled = () => runId.current !== id;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      // ① 기간마다 날짜별 결과를 서버에 저장 (이미 있으면 바로 넘어간다)
      for (const [i, p] of periods.entries()) {
        setStage(`${i + 1}/${periods.length} ${p.label} 계산 중`);
        const r = await ensureDliSeries(room, p.startDate, p.endDate, cancelled, (pr) =>
          setStage(`${i + 1}/${periods.length} ${p.label} 계산 중 · ${pr.done}/${pr.total}일`),
        );
        if (r === null || cancelled()) return;
        if (!r.ok) throw new Error(`${p.label}: ${r.error}`);
      }
      // ② 저장된 결과로 기간 평균 비교
      setStage('기간 평균 비교 중');
      const compared = await compareDliPeriods(
        room.server.roomId,
        periods.map(({ label, startDate, endDate }) => ({ label, startDate, endDate })),
        dliOptionsFor(room),
      );
      if (!cancelled()) setResult(compared);
    } catch (e) {
      if (!cancelled()) setError(e instanceof Error && !('status' in e) ? e.message : describeServerError(e));
    } finally {
      if (!cancelled()) {
        setRunning(false);
        setStage(null);
      }
    }
  };

  const plantName = (serverId: number) => plants.find((p) => p.serverId === serverId)?.name ?? '앱에 없는 종 식물';
  const requiredOf = (serverId: number) => {
    const p = plants.find((x) => x.serverId === serverId);
    const s = p ? serverSpecies[p.speciesId] : undefined;
    return s ? `${s.minDli}–${s.maxDli}` : null;
  };

  return (
    <ScreenContainer
      header={<TopBar title="기간 비교" />}
      footer={
        <PrimaryButton
          title={running ? '계산 중…' : `${chosen.length}개 기간 비교하기`}
          icon={running ? undefined : Play}
          disabled={running || chosen.length < 2}
          onPress={run}
        />
      }>
      <AppText variant="title" style={styles.title}>
        계절이 바뀌어도 맞을까요?
      </AppText>
      <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        같은 자리라도 계절마다 들어오는 빛이 달라요. 지난 기간의 실제 날씨로 계산해 식물 자리마다 비교해요.
      </AppText>

      <View style={styles.section}>
        <SectionHeader eyebrow="Periods" title="비교할 기간" subtitle="2~4개를 골라 주세요 · 처음 계산하는 기간은 시간이 걸려요" />
        <View style={styles.chips}>
          {options.map((o) => {
            const on = chosen.includes(o.key);
            return (
              <Pressable key={o.key} onPress={() => toggle(o.key)} disabled={running} accessibilityState={{ selected: on }}>
                <Card padding={Spacing.md} radius={Radius.md} tone={on ? 'green' : 'surface'} style={styles.chip}>
                  <AppText variant="captionStrong" color={on ? Colors.deepGreen : Colors.text}>
                    {o.label}
                  </AppText>
                  <AppText variant="small" color={Colors.textSecondary}>
                    {o.hint}
                  </AppText>
                </Card>
              </Pressable>
            );
          })}
        </View>
      </View>

      {stage ? (
        <View style={[styles.section, styles.row]}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <AppText variant="caption" color={Colors.textSecondary}>
            {stage}
          </AppText>
        </View>
      ) : null}
      {error ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.section}>
          비교하지 못했어요 · {error}
        </AppText>
      ) : null}

      {result ? (
        <View style={styles.section}>
          <SectionHeader eyebrow="Result" title="기간별 하루 평균 DLI" subtitle="mol/m²/day · LUMAP 계산 · 예상치" />
          <Card padding={Spacing.lg} radius={Radius.xl}>
            <View style={[styles.tableRow, styles.tableHead]}>
              <AppText variant="small" color={Colors.textSecondary} style={styles.nameCol}>
                자리
              </AppText>
              {result.periods.map((p) => (
                <AppText key={p.label} variant="small" color={Colors.textSecondary} align="center" style={styles.valueCol}>
                  {p.label}
                </AppText>
              ))}
            </View>
            <View style={styles.tableRow}>
              <AppText variant="captionStrong" style={styles.nameCol}>
                방 평균
              </AppText>
              {result.periods.map((p) => {
                const mean = roomMean(p.meanTotalDli);
                return (
                  <AppText key={p.label} variant="captionStrong" align="center" style={styles.valueCol}>
                    {p.complete && mean !== null ? formatDli(mean) : '—'}
                  </AppText>
                );
              })}
            </View>
            {(result.periods[0]?.plants ?? []).map((pl) => (
              <View key={pl.plantId} style={[styles.tableRow, styles.divider]}>
                <View style={styles.nameCol}>
                  <AppText variant="captionStrong" numberOfLines={1}>
                    {plantName(pl.plantId)}
                  </AppText>
                  {requiredOf(pl.plantId) ? (
                    <AppText variant="small" color={Colors.textTertiary}>
                      요구 {requiredOf(pl.plantId)}
                    </AppText>
                  ) : null}
                </View>
                {result.periods.map((p) => {
                  const v = p.plants.find((x) => x.plantId === pl.plantId);
                  return (
                    <View key={p.label} style={[styles.valueCol, styles.cell]}>
                      <AppText variant="caption" align="center">
                        {v?.meanDli != null ? formatDli(v.meanDli) : '—'}
                      </AppText>
                      {v ? <StatusChip label={STATUS[v.status].label} tone={STATUS[v.status].tone} size="sm" /> : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </Card>
          {result.periods.some((p) => !p.complete) ? (
            <AppText variant="small" color={Colors.clayDeep} style={styles.sectionSm}>
              일부 날짜 결과가 없어 평균을 내지 못한 기간이 있어요 · 다시 비교해 주세요
            </AppText>
          ) : null}
          <Card tone="muted" padding={Spacing.lg} radius={Radius.lg} style={styles.sectionSm}>
            <View style={styles.row}>
              <CalendarRange size={16} color={Colors.primary} strokeWidth={1.9} />
              <AppText variant="small" color={Colors.textSecondary} style={styles.flex}>
                {seasonNote(result, plantName)}
              </AppText>
            </View>
          </Card>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

/** 기간에 따라 적정 여부가 바뀌는 식물 안내 (계절 변화에 따른 배치 적합성 재평가) */
function seasonNote(result: ApiDliComparison, name: (id: number) => string): string {
  const ids = result.periods[0]?.plants.map((p) => p.plantId) ?? [];
  const changing = ids.filter((id) => {
    const statuses = new Set(result.periods.map((p) => p.plants.find((x) => x.plantId === id)?.status).filter((s) => s && s !== 'UNAVAILABLE'));
    return statuses.size > 1;
  });
  if (!ids.length) return '이 방에 배치된 식물이 없어 방 평균만 비교했어요.';
  if (!changing.length) {
    const outside = ids.filter((id) =>
      result.periods.some((p) => {
        const s = p.plants.find((x) => x.plantId === id)?.status;
        return s === 'LOW' || s === 'HIGH';
      }),
    );
    return outside.length
      ? `기간에 따라 달라지지는 않지만, ${outside.map(name).join(', ')}은(는) 고른 기간 내내 요구 범위 밖이에요. 배치 추천을 확인해 보세요.`
      : '고른 기간 모두 요구 범위 안이에요. 지금 배치를 유지해도 돼요.';
  }
  return `${changing.map(name).join(', ')}은(는) 기간에 따라 적정 여부가 달라져요. 그 시기가 오기 전에 배치 추천을 다시 확인해 보세요.`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: Spacing.sm },
  subtitle: { marginTop: Spacing.sm },
  section: { marginTop: Spacing.xxl },
  sectionSm: { marginTop: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: { minWidth: 96 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: 4,
  },
  tableHead: { paddingTop: 0 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  nameCol: { flex: 1.3 },
  valueCol: { flex: 1 },
  cell: {
    alignItems: 'center',
    gap: 2,
  },
});
