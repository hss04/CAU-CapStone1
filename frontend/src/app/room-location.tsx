import { router } from 'expo-router';
import { Check, LogIn, MapPin, Search, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField, TextField } from '@/components/common/FormField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/services/api/client';
import { searchLocations } from '@/services/api/endpoints';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';
import type { ApiLocationResult } from '@/types/api';

interface Candidate {
  key: string;
  label: string;
  detail: string;
  latitude: number;
  longitude: number;
}

/** 검색 결과 → 고를 수 있는 후보 (좌표가 없는 결과는 뺀다) */
function toCandidates(results: ApiLocationResult[]): Candidate[] {
  return results.flatMap((r, i) => {
    if (r.latitude === null || r.longitude === null || !r.name) return [];
    const label = r.admin1 && r.admin1 !== r.name ? `${r.admin1} ${r.name}` : r.name;
    const detail = [r.country, `${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)}`].filter(Boolean).join(' · ');
    return [{ key: `${r.id ?? i}`, label, detail, latitude: r.latitude, longitude: r.longitude }];
  });
}

/**
 * 방 위치 설정 — 지역 검색(GET /locations/search) → 후보 선택 → 저장(PUT /rooms/{id}/location).
 * 날씨·일사량(DNI/DHI)·태양 위치 계산이 이 위경도를 쓴다.
 */
export default function RoomLocationScreen() {
  const { state, actions } = useGarden();
  const auth = useAuth();
  const toast = useToast();
  const { room } = state;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = auth.status === 'signedIn' && !!room.server;
  const hasScans = room.windows.some((w) => state.scanUploads[w.id]?.phase === 'done');

  if (!canEdit) {
    return (
      <ScreenContainer header={<TopBar title="방 위치" />}>
        <EmptyState
          style={styles.section}
          title="측정한 방에서 설정할 수 있어요"
          description={
            auth.status === 'signedIn'
              ? 'ARCore 앱으로 방을 측정해 서버에 보내면 위치를 저장할 수 있어요.'
              : '로그인하고 서버에 저장된 방을 불러오면 위치를 저장할 수 있어요. 지금은 예시 방(서울 마포구)이에요.'
          }
          actionLabel={auth.status === 'signedIn' ? '돌아가기' : '로그인하기'}
          actionIcon={auth.status === 'signedIn' ? undefined : LogIn}
          onAction={auth.status === 'signedIn' ? goBackOrHome : () => router.push('/login')}
        />
      </ScreenContainer>
    );
  }

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchError('2글자 이상 입력해 주세요');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setPicked(null);
    try {
      const { results } = await searchLocations(q);
      setCandidates(toCandidates(results));
    } catch (e) {
      setCandidates(null);
      setSearchError(e instanceof ApiError || e instanceof Error ? e.message : '검색하지 못했어요');
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      await actions.saveRoomLocation({ latitude: picked.latitude, longitude: picked.longitude, label: picked.label });
      toast.show(`방 위치를 ${picked.label}(으)로 저장했어요`, 'leaf');
      goBackOrHome();
    } catch (e) {
      toast.show(`저장하지 못했어요 · ${e instanceof Error ? e.message : '알 수 없는 오류'}`, 'leaf');
      setSaving(false);
    }
  };

  const current = room.location;

  return (
    <ScreenContainer
      header={<TopBar title="방 위치" />}
      footer={
        picked ? (
          <PrimaryButton title={saving ? '저장 중…' : `${picked.label}(으)로 저장`} icon={Check} disabled={saving} onPress={save} />
        ) : undefined
      }>
      <AppText variant="title" style={styles.title}>
        방이 있는 지역을 알려주세요
      </AppText>
      <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        날씨와 햇빛 세기, 태양 위치를 이 지역 기준으로 계산해요.
      </AppText>

      <Card tone="green" radius={Radius.lg} padding={Spacing.lg} style={[styles.section, styles.row]}>
        <MapPin size={18} color={Colors.primary} strokeWidth={1.9} />
        <View style={styles.flex}>
          <AppText variant="captionStrong" color={Colors.deepGreen}>
            {room.name} · 지금 위치
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary}>
            {current
              ? `${current.label ?? '이름 없음'} (${current.latitude.toFixed(3)}, ${current.longitude.toFixed(3)})`
              : '아직 저장하지 않았어요'}
          </AppText>
        </View>
      </Card>

      {/* 서버가 쓰는 Open-Meteo 지오코딩은 한글 시·구 이름(서울, 마포구)을 거의 못 찾고, 영문 도시명·동 이름은 찾는다 */}
      <FormField label="지역 검색" hint="도시는 영문(예: Seoul, Busan), 동네는 동 이름(예: 흑석동)으로 찾으면 잘 나와요">
        <View style={styles.searchRow}>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder="지역 이름"
            returnKeyType="search"
            onSubmitEditing={search}
            autoCorrect={false}
            style={styles.flex}
          />
          <SecondaryButton title="검색" icon={Search} fullWidth={false} onPress={search} disabled={searching} />
        </View>
      </FormField>

      {searching ? (
        <View style={[styles.section, styles.row]}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <AppText variant="caption" color={Colors.textSecondary}>
            검색하는 중…
          </AppText>
        </View>
      ) : null}
      {searchError ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.section}>
          {searchError}
        </AppText>
      ) : null}
      {candidates && !searching ? (
        candidates.length === 0 ? (
          <AppText variant="caption" color={Colors.textSecondary} style={styles.section}>
            검색 결과가 없어요. &apos;Seoul&apos;처럼 영문 도시 이름이나 &apos;흑석동&apos;처럼 동 이름으로 찾아보세요.
          </AppText>
        ) : (
          <Card padding={0} radius={Radius.lg} style={styles.section}>
            {candidates.map((c, i) => {
              const active = picked?.key === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setPicked(c)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.candidate,
                    i < candidates.length - 1 && styles.divider,
                    (pressed || active) && { backgroundColor: Colors.lightGreen },
                  ]}>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{c.label}</AppText>
                    <AppText variant="small" color={Colors.textSecondary}>
                      {c.detail}
                    </AppText>
                  </View>
                  {active ? <Check size={18} color={Colors.primary} strokeWidth={2.2} /> : null}
                </Pressable>
              );
            })}
          </Card>
        )
      ) : null}

      {/* 서버 v0.4.0: 위치를 바꿔도 창밖 스캔은 유지되고, 광환경 결과만 새 위치로 다시 계산한다 */}
      <View style={[styles.section, styles.row, styles.warn]}>
        <TriangleAlert size={16} color={Colors.textTertiary} strokeWidth={2} />
        <AppText variant="caption" color={Colors.textSecondary} style={styles.flex}>
          {hasScans
            ? '위치를 바꾸면 광환경을 새 위치 기준으로 다시 계산해요. 보낸 창밖 스캔은 그대로 써요.'
            : '위치를 바꾸면 광환경을 새 위치 기준으로 다시 계산해요.'}
        </AppText>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  warn: {
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.xs,
  },
});
