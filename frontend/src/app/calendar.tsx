import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, LogIn, Plus, Trash2, Undo2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField, TextField } from '@/components/common/FormField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { useToast } from '@/components/common/Toast';
import { TopBar } from '@/components/common/TopBar';
import { CARE_TYPES, eventStatusChip, TASK_TYPE } from '@/constants/care';
import { Colors, Radius, Spacing } from '@/constants/theme';
import * as api from '@/services/api/endpoints';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { ApiCalendar, ApiCalendarEvent, ApiCareType } from '@/types/api';
import { formatMonthDayKo, parseISODate, toISODate } from '@/utils/date';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
/** 반복 간격 선택지 (null = 한 번만) */
const INTERVALS: (number | null)[] = [null, 7, 14, 30, 60];

function monthRange(year: number, month: number) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { start: toISODate(start), end: toISODate(end), firstWeekday: start.getDay(), days: end.getDate() };
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : '알 수 없는 오류';
}

/**
 * 관리 캘린더 — 물주기(식물 물주기 간격)와 직접 추가한 관리 일정(비료·분갈이 등).
 * GET /calendar로 한 달을 받고, 날짜를 누르면 그날 일정을 보여준다. 서버가 반복 일정을 계산한다.
 */
export default function CalendarScreen() {
  const signedIn = useAuth().status === 'signedIn';
  const { state, actions } = useGarden();
  const toast = useToast();
  const today = state.today;
  const [cursor, setCursor] = useState(() => {
    const d = parseISODate(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [data, setData] = useState<ApiCalendar | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const range = monthRange(cursor.year, cursor.month);

  /** 일정을 바꾼 뒤 이번 달을 다시 받는다 */
  const load = useCallback(async () => {
    setData(await api.fetchCalendar(range.start, range.end));
  }, [range.start, range.end]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    api
      .fetchCalendar(range.start, range.end)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError({ key: range.start, message: errorText(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, range.start, range.end]);

  const loading = data?.startDate !== range.start && error?.key !== range.start;

  const shown = data?.startDate === range.start ? data : null;
  const dayByDate = useMemo(() => new Map((shown?.days ?? []).map((d) => [d.date, d])), [shown]);
  const events = (shown?.events ?? []).filter((e) => e.date === selected);

  if (!signedIn) {
    return (
      <ScreenContainer header={<TopBar title="관리 캘린더" />}>
        <EmptyState
          style={styles.section}
          title="로그인하면 관리 일정을 볼 수 있어요"
          description="물주기 기록과 비료·분갈이 같은 관리 일정을 서버에 저장해요."
          actionLabel="로그인하기"
          actionIcon={LogIn}
          onAction={() => router.push('/login')}
        />
      </ScreenContainer>
    );
  }

  /** 일정 처리 후 달력과 식물(마지막 물주기)을 다시 받는다 */
  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast.show(done, 'leaf');
      await load();
      if (id.startsWith('water')) await actions.reloadFromServer();
    } catch (e) {
      toast.show(`처리하지 못했어요 · ${errorText(e)}`, 'leaf');
    } finally {
      setBusy(null);
    }
  };

  const moveMonth = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(toISODate(d));
  };

  const cells: (string | null)[] = [
    ...Array.from({ length: range.firstWeekday }, () => null),
    ...Array.from({ length: range.days }, (_, i) => toISODate(new Date(cursor.year, cursor.month, i + 1))),
  ];

  return (
    <>
      <ScreenContainer header={<TopBar title="관리 캘린더" />}>
        <Card padding={Spacing.lg} radius={Radius.xl} style={styles.sectionSm}>
          <View style={styles.monthRow}>
            <Pressable hitSlop={10} onPress={() => moveMonth(-1)} accessibilityLabel="이전 달">
              <ChevronLeft size={22} color={Colors.textSecondary} strokeWidth={1.8} />
            </Pressable>
            <AppText variant="heading">{`${cursor.year}년 ${cursor.month + 1}월`}</AppText>
            <Pressable hitSlop={10} onPress={() => moveMonth(1)} accessibilityLabel="다음 달">
              <ChevronRight size={22} color={Colors.textSecondary} strokeWidth={1.8} />
            </Pressable>
          </View>
          <View style={styles.weekRow}>
            {WEEK.map((w, i) => (
              <AppText key={w} variant="small" align="center" color={i === 0 ? Colors.clayDeep : Colors.textTertiary} style={styles.weekCell}>
                {w}
              </AppText>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((date, i) => {
              if (!date) return <View key={`blank-${i}`} style={styles.dayCell} />;
              const day = dayByDate.get(date);
              const active = date === selected;
              const isToday = date === today;
              return (
                <Pressable
                  key={date}
                  onPress={() => setSelected(date)}
                  accessibilityLabel={`${date} 일정 ${day?.totalCount ?? 0}개`}
                  style={[styles.dayCell, active && styles.dayActive]}>
                  <AppText
                    variant={isToday ? 'captionStrong' : 'caption'}
                    color={active ? Colors.white : isToday ? Colors.primary : Colors.text}>
                    {Number(date.slice(8))}
                  </AppText>
                  <View style={styles.dots}>
                    {day && day.overdueCount > 0 ? <View style={[styles.dot, { backgroundColor: Colors.clay }]} /> : null}
                    {day && day.pendingCount - day.overdueCount > 0 ? <View style={[styles.dot, { backgroundColor: Colors.water }]} /> : null}
                    {day && day.completedCount > 0 ? <View style={[styles.dot, { backgroundColor: Colors.primarySoft }]} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.legend}>
            <Legend color={Colors.water} label="예정" />
            <Legend color={Colors.clay} label="지남" />
            <Legend color={Colors.primarySoft} label="완료" />
            {loading ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
          </View>
        </Card>

        {error?.key === range.start ? (
          <AppText variant="caption" color={Colors.clayDeep} style={styles.sectionSm}>
            일정을 불러오지 못했어요 · {error.message}
          </AppText>
        ) : null}

        <View style={styles.section}>
          <SectionHeader
            eyebrow="Care"
            title={formatMonthDayKo(parseISODate(selected))}
            subtitle={events.length ? `일정 ${events.length}개` : '이 날은 일정이 없어요'}
            actionLabel="일정 추가"
            onAction={() => setAdding(true)}
          />
          {events.length ? (
            <Card padding={0} radius={Radius.xl}>
              {events.map((e, i) => (
                <EventRow
                  key={e.eventId}
                  event={e}
                  today={today}
                  busy={busy}
                  divider={i < events.length - 1}
                  onRun={run}
                />
              ))}
            </Card>
          ) : null}
        </View>

        <AppText variant="small" color={Colors.textTertiary} style={styles.sectionSm}>
          물주기 예정일은 마지막으로 물 준 날 + 물주기 간격으로 계산해요. 물 준 날짜를 잘못 눌렀으면 식물 상세의 물주기 기록에서 고칠 수 있어요.
        </AppText>
      </ScreenContainer>

      <BottomSheet visible={adding} onClose={() => setAdding(false)}>
        <AddCareForm
          initialDate={selected}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            toast.show('관리 일정을 추가했어요', 'leaf');
            await load();
          }}
          plants={state.plants.filter((p) => p.serverId !== undefined).map((p) => ({ id: p.serverId!, name: p.name }))}
        />
      </BottomSheet>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText variant="small" color={Colors.textSecondary}>
        {label}
      </AppText>
    </View>
  );
}

function EventRow({
  event: e,
  today,
  busy,
  divider,
  onRun,
}: {
  event: ApiCalendarEvent;
  today: string;
  busy: string | null;
  divider: boolean;
  onRun: (id: string, fn: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const type = TASK_TYPE[e.taskType];
  const chip = eventStatusChip(e);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isBusy = busy !== null && busy.endsWith(e.eventId);
  const watering = e.taskType === 'WATERING';
  // 미래 예정 물주기는 '오늘 줬어요'로만 기록 (실제 날짜를 보낸다)
  const canWater = watering && e.status === 'PENDING';
  const canComplete = !watering && e.status === 'PENDING' && e.scheduleId !== null;
  const canUndo = !watering && e.status !== 'PENDING' && e.scheduleId !== null;

  return (
    <View style={[styles.eventRow, divider && styles.divider]}>
      <View style={styles.eventIcon}>
        <type.icon size={18} color={Colors.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <View style={styles.eventTitle}>
          <AppText variant="bodyStrong">{e.plantNickname}</AppText>
          <StatusChip label={chip.label} tone={chip.tone} size="sm" />
        </View>
        <AppText variant="caption" color={Colors.textSecondary}>
          {e.title}
          {e.intervalDays ? ` · ${e.intervalDays}일마다` : ''} · {e.speciesName}
        </AppText>
        <View style={styles.eventActions}>
          {canWater ? (
            <SecondaryButton
              title={isBusy ? '저장 중…' : '오늘 물 줬어요'}
              size="sm"
              fullWidth={false}
              disabled={isBusy}
              onPress={() => onRun(`water:${e.eventId}`, () => api.waterPlant(e.plantId, today), `${e.plantNickname} 물주기를 기록했어요 💧`)}
            />
          ) : null}
          {canComplete ? (
            <>
              <SecondaryButton
                title="완료"
                size="sm"
                fullWidth={false}
                disabled={isBusy}
                onPress={() =>
                  onRun(
                    `care:${e.eventId}`,
                    () => api.recordCareOccurrence(e.scheduleId!, e.date, { status: 'COMPLETED', completedOn: today }),
                    `${e.title} 완료로 기록했어요`,
                  )
                }
              />
              <SecondaryButton
                title="건너뛰기"
                size="sm"
                variant="ghost"
                fullWidth={false}
                disabled={isBusy}
                onPress={() =>
                  onRun(`care:${e.eventId}`, () => api.recordCareOccurrence(e.scheduleId!, e.date, { status: 'SKIPPED' }), '이번 회차를 건너뛰었어요')
                }
              />
            </>
          ) : null}
          {canUndo ? (
            <SecondaryButton
              title="되돌리기"
              icon={Undo2}
              size="sm"
              variant="ghost"
              fullWidth={false}
              disabled={isBusy}
              onPress={() => onRun(`care:${e.eventId}`, () => api.undoCareOccurrence(e.scheduleId!, e.date), '기록을 취소했어요')}
            />
          ) : null}
          {!watering && e.scheduleId !== null ? (
            <SecondaryButton
              title={confirmDelete ? '한 번 더 누르면 일정 삭제' : '일정 삭제'}
              icon={Trash2}
              size="sm"
              variant="ghost"
              fullWidth={false}
              disabled={isBusy}
              onPress={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void onRun(`care:${e.eventId}`, () => api.deleteCareSchedule(e.scheduleId!), '관리 일정을 삭제했어요');
              }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** 관리 일정 추가 — 식물·종류·시작일·반복 간격 */
function AddCareForm({
  initialDate,
  plants,
  onClose,
  onSaved,
}: {
  initialDate: string;
  plants: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [plantId, setPlantId] = useState<number | null>(plants[0]?.id ?? null);
  const [type, setType] = useState<ApiCareType>('FERTILIZING');
  const [repeat, setRepeat] = useState<number | null>(14);
  const [startDate, setStartDate] = useState(initialDate);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plants.length === 0) {
    return (
      <View style={styles.sheet}>
        <AppText variant="h3">관리 일정 추가</AppText>
        <AppText variant="caption" color={Colors.textSecondary} style={styles.sectionSm}>
          서버에 등록된 식물이 없어요. 식물을 먼저 추가해 주세요.
        </AppText>
        <SecondaryButton title="닫기" onPress={onClose} style={styles.sectionSm} />
      </View>
    );
  }

  const save = async () => {
    if (plantId === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError('시작일은 2026-11-15 형식으로 입력해 주세요');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createCareSchedule(plantId, {
        taskType: type,
        title: title.trim() || null,
        startDate,
        intervalDays: repeat,
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <AppText variant="h3">관리 일정 추가</AppText>
      <FormField label="식물">
        <View style={styles.chips}>
          {plants.map((p) => (
            <Pressable key={p.id} onPress={() => setPlantId(p.id)}>
              <StatusChip label={p.name} tone={p.id === plantId ? 'deep' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      </FormField>
      <FormField label="종류">
        <View style={styles.chips}>
          {CARE_TYPES.map((t) => (
            <Pressable key={t} onPress={() => setType(t)}>
              <StatusChip label={TASK_TYPE[t].label} icon={TASK_TYPE[t].icon} tone={t === type ? 'deep' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      </FormField>
      <FormField label="반복">
        <View style={styles.chips}>
          {INTERVALS.map((d) => (
            <Pressable key={String(d)} onPress={() => setRepeat(d)}>
              <StatusChip label={d === null ? '한 번만' : `${d}일마다`} tone={d === repeat ? 'deep' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      </FormField>
      <FormField label="시작일" hint="YYYY-MM-DD">
        <TextField value={startDate} onChangeText={setStartDate} autoCorrect={false} />
      </FormField>
      <FormField label="이름 (선택)" hint={`비우면 '${TASK_TYPE[type].label}'로 저장해요`}>
        <TextField value={title} onChangeText={setTitle} placeholder="예: 액체 비료 주기" maxLength={60} />
      </FormField>
      {error ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.sectionSm}>
          {error}
        </AppText>
      ) : null}
      <PrimaryButton title={saving ? '저장 중…' : '일정 추가'} icon={Plus} disabled={saving} onPress={save} style={styles.section} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: Spacing.xxl },
  sectionSm: { marginTop: Spacing.lg },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  weekRow: {
    flexDirection: 'row',
    marginTop: Spacing.md,
  },
  weekCell: { width: `${100 / 7}%` },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.xs,
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  dayActive: { backgroundColor: Colors.primary },
  dots: {
    flexDirection: 'row',
    gap: 3,
    height: 6,
    marginTop: 3,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  eventRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  eventIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  eventActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  sheet: { paddingHorizontal: Spacing.screen },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
});
