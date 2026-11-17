import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { fetchNotificationSchedule } from '@/services/api/endpoints';
import { addDays, parseISODate, toISODate } from '@/utils/date';

/**
 * 관리 일정 기기 알림 (GET /notifications/schedule → 휴대폰에서 직접 예약).
 * 서버는 푸시를 보내지 않는다 (delivery = DEVICE_LOCAL). 일정이 바뀌면 schedule_version이 달라지므로
 * 그때만 LUMAP 알림을 모두 지우고 다시 예약한다. 웹은 기기 알림을 지원하지 않는다.
 */

/** 앞으로 며칠치를 예약할지 (기기 예약 수 제한을 넘지 않게) */
const DAYS_AHEAD = 14;
const SOURCE = 'lumap-care';
const HOUR = 9;

let lastVersion: string | null = null;

if (Platform.OS !== 'web') {
  // 앱을 보고 있을 때도 알림을 보여준다
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type DeviceScheduleResult =
  | { ok: true; count: number; changed: boolean }
  | { ok: false; reason: 'web' | 'denied' | 'error'; message: string };

async function cancelLumapNotifications() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { source?: string } | undefined)?.source === SOURCE)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * enabled면 서버 일정으로 예약, 아니면 LUMAP 알림을 모두 지운다.
 * ask가 false면 권한을 묻지 않는다 (앱 시작 시 조용히 갱신할 때).
 */
export async function syncDeviceNotifications(today: string, enabled: boolean, ask: boolean): Promise<DeviceScheduleResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web', message: '웹에서는 기기 알림을 예약할 수 없어요' };
  try {
    if (!enabled) {
      await cancelLumapNotifications();
      lastVersion = null;
      return { ok: true, count: 0, changed: true };
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && ask && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied', message: '휴대폰 설정에서 알림을 허용해 주세요' };

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('care', { name: '식물 관리 일정', importance: AndroidImportance.DEFAULT });
    }

    const end = toISODate(addDays(parseISODate(today), DAYS_AHEAD));
    const schedule = await fetchNotificationSchedule(today, end, HOUR);
    if (schedule.scheduleVersion === lastVersion) return { ok: true, count: schedule.notifications.length, changed: false };

    await cancelLumapNotifications();
    const now = Date.now();
    const future = schedule.notifications.filter((n) => new Date(n.scheduledAt).getTime() > now);
    for (const n of future) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'LUMAP 관리 알림', body: n.title, data: { source: SOURCE, plantId: n.plantId, eventId: n.eventId } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.scheduledAt), channelId: 'care' },
      });
    }
    lastVersion = schedule.scheduleVersion;
    return { ok: true, count: future.length, changed: true };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : '알림을 예약하지 못했어요' };
  }
}
