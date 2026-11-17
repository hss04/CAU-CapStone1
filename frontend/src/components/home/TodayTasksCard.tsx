import { useFocusEffect } from 'expo-router';
import { CalendarCheck, ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { StatusChip } from '@/components/common/StatusChip';
import { TASK_TYPE } from '@/constants/care';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { fetchDashboard } from '@/services/api/endpoints';
import type { ApiDashboard } from '@/types/api';

/**
 * 홈 '오늘 할 일' — GET /dashboard (오늘 미완료 일정 + 최근 30일 지난 일정).
 * 화면에 돌아올 때마다 다시 받는다. 받지 못하면 카드를 숨긴다 (홈의 다른 카드는 그대로).
 */
export function TodayTasksCard({ refreshKey, onPress }: { refreshKey: string; onPress: () => void }) {
  const [data, setData] = useState<ApiDashboard | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchDashboard()
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
      // refreshKey: 물 줬어요 등으로 식물이 바뀌면 다시 받는다
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]),
  );

  if (!data) return null;
  const tasks = data.todayTasks;
  const overdue = data.overdueTasks.length;
  const shown = tasks.slice(0, 3);

  return (
    <Card padding={Spacing.lg} radius={Radius.xl} onPress={onPress} accessibilityLabel="관리 캘린더 열기">
      <View style={styles.header}>
        <View style={styles.icon}>
          <CalendarCheck size={18} color={Colors.primary} strokeWidth={1.9} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">오늘 할 일 {tasks.length}개</AppText>
          <AppText variant="caption" color={Colors.textSecondary}>
            {overdue > 0 ? `지난 일정 ${overdue}개가 남아 있어요` : tasks.length ? '관리 캘린더에서 완료로 기록해요' : '오늘은 할 일이 없어요'}
          </AppText>
        </View>
        {overdue > 0 ? <StatusChip label={`지남 ${overdue}`} tone="clay" size="sm" /> : null}
        <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={1.8} />
      </View>
      {shown.length ? (
        <View style={styles.list}>
          {shown.map((t) => {
            const type = TASK_TYPE[t.taskType];
            return (
              <View key={t.eventId} style={styles.item}>
                <type.icon size={14} color={Colors.textSecondary} strokeWidth={1.9} />
                <AppText variant="caption" style={styles.flex} numberOfLines={1}>
                  {t.plantNickname} · {t.title}
                </AppText>
              </View>
            );
          })}
          {tasks.length > shown.length ? (
            <AppText variant="small" color={Colors.textTertiary}>
              외 {tasks.length - shown.length}개
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    marginTop: Spacing.md,
    gap: 6,
    paddingLeft: 52,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
