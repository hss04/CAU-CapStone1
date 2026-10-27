import { ChevronRight, MapPin, RefreshCw, Sun } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { StatusChip, type ChipTone } from '@/components/common/StatusChip';
import { WeatherIcon, weatherTone } from '@/components/weather/WeatherIcon';
import { WEATHER_LABEL } from '@/constants/labels';
import { Colors, Layout, Radius, Spacing } from '@/constants/theme';
import { weatherHeadline } from '@/services/weather';
import type { WeatherState } from '@/store/WeatherProvider';
import type { WeatherLocation } from '@/types';

/** 오늘의 예상 광환경 (식물 자리 예상 DLI 기준 — 날씨와는 다른 데이터) */
export interface TodayLightSummary {
  label: string;
  tone: ChipTone;
  /** 예시 데이터·임시 계산 표시 */
  sourceTag: string | null;
}

export interface WeatherCardProps {
  weather: WeatherState;
  onRetry: () => void;
  todayLight: TodayLightSummary | null;
  onLightPress?: () => void;
}

const SOFT_BG: Record<ReturnType<typeof weatherTone>, string> = {
  sun: Colors.sunlightSoft,
  neutral: '#EEF0EA',
  water: Colors.waterSoft,
};

function locationText(location: WeatherLocation): string {
  if (location.kind === 'demo') return `${location.label} · 예시 방`;
  if (location.kind === 'default') return `${location.label} · 기본 위치`;
  return location.label;
}

/** "2026-10-27T17:30" → "17:30" */
function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

/** HOME 상단 — 방이 있는 지역의 현재 날씨와 오늘의 예상 광환경 */
export function WeatherCard({ weather, onRetry, todayLight, onLightPress }: WeatherCardProps) {
  const { data } = weather;

  if (!data) {
    return (
      <Card radius={Radius.xl} padding={Spacing.lg} style={styles.placeholder}>
        {weather.status === 'error' ? (
          <>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">날씨를 불러오지 못했어요</AppText>
              <AppText variant="caption" color={Colors.textSecondary}>
                {weather.error ?? '네트워크를 확인해 주세요'}
              </AppText>
            </View>
            <RetryButton onPress={onRetry} busy={weather.refreshing} />
          </>
        ) : (
          <>
            <ActivityIndicator size="small" color={Colors.primary} />
            <AppText variant="caption" color={Colors.textSecondary}>
              날씨를 불러오는 중…
            </AppText>
          </>
        )}
      </Card>
    );
  }

  const { current, today, location } = data;
  const tone = weatherTone(today?.condition ?? current.condition);
  const mock = data.source === 'mock';
  const sourceText = mock ? '예시 날씨 · 실제 날씨가 아니에요' : `Open-Meteo 예보 · ${timeOf(current.time)} 기준`;

  return (
    <Card radius={Radius.xl} padding={Spacing.lg + 2}>
      <View style={styles.topRow}>
        <View style={styles.location}>
          <MapPin size={13} color={Colors.textSecondary} strokeWidth={2} />
          <AppText variant="captionStrong" color={Colors.textSecondary} numberOfLines={1}>
            {locationText(location)}
          </AppText>
          {mock ? <StatusChip label="예시" tone="neutral" size="sm" /> : null}
        </View>
        <RetryButton onPress={onRetry} busy={weather.refreshing} subtle />
      </View>

      <View style={styles.main}>
        <View style={[styles.iconCircle, { backgroundColor: SOFT_BG[tone] }]}>
          <WeatherIcon condition={current.condition} isDay={current.isDay} size={30} strokeWidth={1.7} />
        </View>
        <AppText variant="valueLarge" style={styles.temp}>
          {`${Math.round(current.temperatureC)}°`}
        </AppText>
        <View style={styles.flex}>
          <AppText variant="h3">{WEATHER_LABEL[current.condition]}</AppText>
          {today && today.maxC !== null && today.minC !== null ? (
            <AppText variant="caption" color={Colors.textSecondary}>
              {`최고 ${Math.round(today.maxC)}° · 최저 ${Math.round(today.minC)}°`}
            </AppText>
          ) : null}
        </View>
      </View>

      <AppText variant="bodyStrong" color={Colors.deepGreen} style={styles.headline}>
        {weatherHeadline(today, current)}
      </AppText>

      {location.kind === 'default' ? (
        <AppText variant="small" color={Colors.textTertiary} style={styles.hint}>
          방 위치가 저장되면 그 지역 날씨로 바뀌어요.
        </AppText>
      ) : null}

      {todayLight ? (
        <Pressable
          onPress={onLightPress}
          disabled={!onLightPress}
          accessibilityRole="button"
          accessibilityLabel={`오늘의 예상 광환경 ${todayLight.label}`}
          style={({ pressed }) => [styles.lightRow, pressed && { opacity: 0.7 }]}>
          <Sun size={15} color={Colors.sunlightDeep} strokeWidth={1.9} />
          <AppText variant="captionStrong" style={styles.flex}>
            오늘의 예상 광환경
          </AppText>
          {todayLight.sourceTag ? <StatusChip label={todayLight.sourceTag} tone="neutral" size="sm" /> : null}
          <StatusChip label={todayLight.label} tone={todayLight.tone} size="sm" dot />
          {onLightPress ? <ChevronRight size={16} color={Colors.textTertiary} strokeWidth={1.8} /> : null}
        </Pressable>
      ) : null}

      <AppText variant="small" color={Colors.textTertiary} style={styles.source}>
        {weather.error ? `${sourceText} · 업데이트 실패` : sourceText}
      </AppText>
    </Card>
  );
}

function RetryButton({ onPress, busy, subtle }: { onPress: () => void; busy: boolean; subtle?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={Layout.hitSlop}
      accessibilityRole="button"
      accessibilityLabel="날씨 새로고침"
      style={({ pressed }) => [styles.retry, !subtle && styles.retrySolid, pressed && { opacity: 0.6 }]}>
      {busy ? (
        <ActivityIndicator size="small" color={Colors.textTertiary} />
      ) : (
        <RefreshCw size={15} color={subtle ? Colors.textTertiary : Colors.primary} strokeWidth={2} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  placeholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 72,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  location: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  temp: {
    minWidth: 52,
  },
  headline: {
    marginTop: Spacing.md,
  },
  hint: {
    marginTop: 2,
  },
  lightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  source: {
    marginTop: Spacing.sm,
  },
  retry: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retrySolid: {
    backgroundColor: Colors.lightGreen,
  },
});
