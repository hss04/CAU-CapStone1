import { Clock, RefreshCw } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { DailyPpfdChart, formatClock, peakIndex } from '@/components/light/DailyPpfdChart';
import { PpfdTable } from '@/components/light/PpfdTable';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDli, loadCellPpfd, type CellPpfd, type CellPpfdResult, type JobProgress } from '@/services/lightForecast';
import type { Plant, Room } from '@/types';

/** 직사광이 '든다'고 볼 최소값 (반올림 잔값 제외) */
const DIRECT_MIN = 1;

function durationText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function summary(data: CellPpfd) {
  const total = data.direct.map((d, i) => d + data.diffuse[i]);
  const peak = peakIndex(total);
  const sunny = data.direct.map((v, i) => (v >= DIRECT_MIN ? i : -1)).filter((i) => i >= 0);
  const dli = (total.reduce((s, v) => s + v, 0) * 600) / 1_000_000;
  return {
    peakTime: formatClock(data.minutes[peak]),
    peakValue: total[peak],
    sunnyMinutes: sunny.length * 10,
    sunnyFrom: sunny.length ? formatClock(data.minutes[sunny[0]] - 5) : null,
    sunnyTo: sunny.length ? formatClock(data.minutes[sunny[sunny.length - 1]] + 5) : null,
    dli,
  };
}

/**
 * 고른 날짜의 식물 자리 10분 PPFD (서버 계산). 날짜 하나를 새로 계산하면 시간이 걸려서
 * 처음엔 버튼으로 켜고, 켠 뒤에는 날짜를 바꿀 때마다 그 날짜를 불러온다 (불러온 날짜는 다시 요청하지 않는다).
 */
export function DayPpfdCard({ room, plant, date, style }: { room: Room; plant: Plant; date: string; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Record<string, CellPpfdResult>>({});
  const [progress, setProgress] = useState<{ key: string; p: JobProgress } | null>(null);
  const { x: col, y: row } = plant.location.position;
  const key = `${room.server?.roomId}:${room.server?.geometryVersion}:${date}:${row}:${col}`;
  const result = results[key];

  useEffect(() => {
    if (!open || result) return;
    let cancelled = false;
    loadCellPpfd(room, date, row, col, () => cancelled, (p) => {
      if (!cancelled) setProgress({ key, p });
    }).then((r) => {
      if (!cancelled && r) setResults((m) => ({ ...m, [key]: r }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, result, key, room, date, row, col]);

  const retry = () =>
    setResults((m) => {
      const next = { ...m };
      delete next[key];
      return next;
    });

  const queued = progress?.key === key && progress.p.queued;

  return (
    <Card padding={Spacing.xl} radius={Radius.xl} style={style}>
      <AppText variant="label" color={Colors.primary}>
        Hourly light
      </AppText>
      <AppText variant="h2" style={styles.title}>
        하루 중 빛 변화
      </AppText>
      <AppText variant="caption" color={Colors.textSecondary} style={styles.sub}>
        식물 자리에 언제 해가 드는지 10분 단위로 보여줘요.
      </AppText>

      {!open ? (
        <SecondaryButton title="시간대별로 보기" icon={Clock} size="sm" fullWidth={false} style={styles.section} onPress={() => setOpen(true)} />
      ) : !result ? (
        <View style={[styles.section, styles.loading]}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <AppText variant="caption" color={Colors.textSecondary} style={styles.flex}>
            {queued ? '서버가 다른 계산을 마치는 중이에요. 곧 시작해요.' : '이 날짜의 시간대별 빛을 계산하고 있어요.'}
          </AppText>
        </View>
      ) : !result.ok ? (
        <View style={styles.section}>
          <AppText variant="caption" color={Colors.clayDeep}>
            시간대별 값을 불러오지 못했어요 · {result.error}
          </AppText>
          <SecondaryButton title="다시 시도" icon={RefreshCw} size="sm" fullWidth={false} style={styles.sectionSm} onPress={retry} />
        </View>
      ) : (
        <PpfdBody data={result.data} />
      )}
    </Card>
  );
}

function PpfdBody({ data }: { data: CellPpfd }) {
  const s = summary(data);
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? peakIndex(data.direct.map((d, i) => d + data.diffuse[i]));
  return (
    <>
      <DailyPpfdChart data={data} picked={active} onPick={setPicked} style={styles.section} />
      <View style={styles.facts}>
        <Fact label="가장 밝은 때" value={s.peakTime} note={`${Math.round(s.peakValue)} μmol/m²/s`} />
        <Fact
          label="직사광 드는 시간"
          value={s.sunnyMinutes > 0 ? `약 ${durationText(s.sunnyMinutes)}` : '없음'}
          note={s.sunnyFrom && s.sunnyTo ? `${s.sunnyFrom}~${s.sunnyTo} 사이` : '하늘에서 오는 산란광만 들어요'}
        />
      </View>
      <AppText variant="label" color={Colors.primary} style={styles.section}>
        10분 단위 값
      </AppText>
      <PpfdTable data={data} active={active} onPick={setPicked} style={styles.sectionXs} />
      <AppText variant="small" color={Colors.textTertiary} style={styles.sectionSm}>
        {`그래프를 하루 동안 더하면 DLI ${formatDli(s.dli)} mol/m²/day예요. 측정값이 아니라 시간별 날씨와 방·창문·창밖 스캔으로 계산한 값이에요.`}
      </AppText>
      {data.provisional ? (
        <AppText variant="small" color={Colors.clayDeep} style={styles.sectionXs}>
          연동 테스트 설정(창밖 스캔 없이 등)으로 계산한 임시 결과예요.
        </AppText>
      ) : null}
    </>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="small" color={Colors.textSecondary}>
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
      {note ? (
        <AppText variant="small" color={Colors.textSecondary}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: 4 },
  sub: { marginTop: 2 },
  section: { marginTop: Spacing.lg },
  sectionSm: { marginTop: Spacing.md },
  sectionXs: { marginTop: Spacing.xs },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  facts: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  fact: {
    flex: 1,
    gap: 2,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
});
