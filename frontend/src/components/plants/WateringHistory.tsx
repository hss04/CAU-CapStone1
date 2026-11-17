import { Check, Pencil, Undo2, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { TextField } from '@/components/common/FormField';
import { SectionHeader } from '@/components/common/SectionHeader';
import { useToast } from '@/components/common/Toast';
import { Colors, Radius, Spacing } from '@/constants/theme';
import * as api from '@/services/api/endpoints';
import { useGarden } from '@/store/GardenProvider';
import type { ApiWateringRecord } from '@/types/api';
import { formatMonthDayKo, parseISODate } from '@/utils/date';

const SHOWN = 6;

/**
 * 물주기 기록 (서버 식물만) — 잘못 누른 날짜 정정(PATCH)·기록 취소(DELETE).
 * 서버가 남은 기록의 최신 날짜로 마지막 물주기를 다시 계산하므로, 바꾼 뒤 식물 목록을 다시 받는다.
 */
export function WateringHistory({ plantServerId, lastWateredAt }: { plantServerId: number; lastWateredAt: string }) {
  const { actions, state } = useGarden();
  const toast = useToast();
  const [records, setRecords] = useState<ApiWateringRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmUndo, setConfirmUndo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  /** 고치거나 취소한 뒤 다시 받는다 */
  const load = useCallback(async () => {
    setRecords(await api.fetchWaterings(plantServerId));
  }, [plantServerId]);

  // 물 줬어요를 누르면(lastWateredAt 변경) 다시 받는다
  useEffect(() => {
    let cancelled = false;
    api
      .fetchWaterings(plantServerId)
      .then((list) => {
        if (cancelled) return;
        setRecords(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '기록을 불러오지 못했어요');
      });
    return () => {
      cancelled = true;
    };
  }, [plantServerId, lastWateredAt]);

  const change = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.show(done, 'water');
      setEditing(null);
      setConfirmUndo(null);
      await Promise.all([load(), actions.reloadFromServer()]);
    } catch (e) {
      toast.show(`바꾸지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'water');
    } finally {
      setBusy(false);
    }
  };

  const saveDate = (record: ApiWateringRecord) => {
    const value = draft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      toast.show('날짜는 2026-11-10 형식으로 입력해 주세요', 'water');
      return;
    }
    if (value > state.today) {
      toast.show('미래 날짜는 기록할 수 없어요', 'water');
      return;
    }
    void change(() => api.correctWatering(plantServerId, record.id, value), '물 준 날짜를 고쳤어요');
  };

  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="History" title="물주기 기록" subtitle="잘못 누른 날짜는 고치거나 취소할 수 있어요" />
      <Card padding={0} radius={Radius.xl}>
        {records === null ? (
          <View style={styles.row}>
            {error ? (
              <AppText variant="caption" color={Colors.clayDeep}>
                {error}
              </AppText>
            ) : (
              <ActivityIndicator size="small" color={Colors.primary} />
            )}
          </View>
        ) : records.length === 0 ? (
          <View style={styles.row}>
            <AppText variant="caption" color={Colors.textSecondary}>
              아직 서버에 저장된 물주기 기록이 없어요.
            </AppText>
          </View>
        ) : (
          records.slice(0, SHOWN).map((r, i) => (
            <View key={r.id} style={[styles.row, i < Math.min(records.length, SHOWN) - 1 && styles.divider]}>
              {editing === r.id ? (
                <>
                  <TextField value={draft} onChangeText={setDraft} autoCorrect={false} style={styles.input} />
                  <IconAction icon={Check} label="저장" disabled={busy} onPress={() => saveDate(r)} />
                  <IconAction icon={X} label="닫기" disabled={busy} onPress={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{formatMonthDayKo(parseISODate(r.wateredAt))}</AppText>
                    <AppText variant="small" color={Colors.textSecondary}>
                      {r.wateredAt}
                      {i === 0 ? ' · 마지막 물주기' : ''}
                    </AppText>
                  </View>
                  <IconAction
                    icon={Pencil}
                    label="날짜 고치기"
                    disabled={busy}
                    onPress={() => {
                      setDraft(r.wateredAt);
                      setConfirmUndo(null);
                      setEditing(r.id);
                    }}
                  />
                  <IconAction
                    icon={Undo2}
                    label={confirmUndo === r.id ? '한 번 더 누르면 취소' : '기록 취소'}
                    showLabel={confirmUndo === r.id}
                    disabled={busy}
                    onPress={() => {
                      if (confirmUndo !== r.id) {
                        setConfirmUndo(r.id);
                        return;
                      }
                      void change(() => api.undoWatering(plantServerId, r.id), '물주기 기록을 취소했어요');
                    }}
                  />
                </>
              )}
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

function IconAction({
  icon: Icon,
  label,
  showLabel,
  disabled,
  onPress,
}: {
  icon: typeof Check;
  label: string;
  showLabel?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconAction, (pressed || disabled) && { opacity: 0.5 }]}>
      <Icon size={16} color={Colors.textSecondary} strokeWidth={1.9} />
      {showLabel ? (
        <AppText variant="small" color={Colors.clayDeep}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: Spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 56,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  input: { flex: 1 },
  iconAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: Spacing.xs,
  },
});
