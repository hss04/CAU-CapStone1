import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ImagePlus, LogIn, Trash2, Upload } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image as RNImage, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { AuthImage } from '@/components/common/AuthImage';
import { BottomSheet } from '@/components/common/BottomSheet';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FormField, TextField } from '@/components/common/FormField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { StatusChip } from '@/components/common/StatusChip';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { newRequestKey } from '@/services/api/client';
import * as api from '@/services/api/endpoints';
import { buildGrowthPhotoForm, type PickedPhoto, takenAtFor } from '@/services/growth/photoUpload';
import { useAuth } from '@/store/AuthProvider';
import { useGarden, usePlant } from '@/store/GardenProvider';
import type { ApiGrowthPhoto, ApiGrowthPhotoList } from '@/types/api';
import { diffInDays, formatMonthDayKo, parseISODate } from '@/utils/date';

type Order = 'asc' | 'desc';
const ORDER_OPTIONS: { value: Order; label: string }[] = [
  { value: 'asc', label: '처음부터' },
  { value: 'desc', label: '최근부터' },
];

function errorText(e: unknown) {
  return e instanceof Error ? e.message : '알 수 없는 오류';
}

/**
 * 식물별 성장 사진 — 사진·촬영일·메모를 서버에 저장하고 날짜순으로 본다 (GET/POST /plants/{id}/growth-photos).
 * 사진과 썸네일은 로그인한 사람만 볼 수 있어 Authorization 헤더로 받는다.
 */
export default function GrowthPhotosScreen() {
  const { plantId } = useLocalSearchParams<{ plantId: string }>();
  const plant = usePlant(plantId);
  const signedIn = useAuth().status === 'signedIn';
  const { state } = useGarden();
  const toast = useToast();
  const serverId = plant?.serverId;

  const [order, setOrder] = useState<Order>('asc');
  const [photos, setPhotos] = useState<ApiGrowthPhoto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [viewing, setViewing] = useState<ApiGrowthPhoto | null>(null);

  const show = useCallback((list: ApiGrowthPhotoList) => {
    setPhotos(list.photos);
    setTotal(list.total);
    setError(null);
  }, []);

  /** 올리기·수정·삭제 뒤 목록을 다시 받는다 */
  const load = useCallback(async () => {
    if (serverId === undefined) return;
    show(await api.fetchGrowthPhotos(serverId, order));
  }, [serverId, order, show]);

  useEffect(() => {
    if (!signedIn || serverId === undefined) return;
    let cancelled = false;
    api
      .fetchGrowthPhotos(serverId, order)
      .then((list) => {
        if (!cancelled) show(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, serverId, order, show]);

  if (!plant) {
    return (
      <ScreenContainer header={<TopBar title="성장 사진" />}>
        <EmptyState style={styles.section} title="식물을 찾을 수 없어요" actionLabel="돌아가기" onAction={goBackOrHome} />
      </ScreenContainer>
    );
  }
  if (!signedIn || serverId === undefined) {
    return (
      <ScreenContainer header={<TopBar title="성장 사진" />}>
        <EmptyState
          style={styles.section}
          title="서버에 저장된 식물만 사진을 기록할 수 있어요"
          description="로그인하고 식물을 등록하면 날짜별 사진과 메모를 남길 수 있어요."
          actionLabel={signedIn ? '돌아가기' : '로그인하기'}
          actionIcon={signedIn ? undefined : LogIn}
          onAction={signedIn ? goBackOrHome : () => router.push('/login')}
        />
      </ScreenContainer>
    );
  }

  const pick = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          toast.show('카메라 권한이 필요해요', 'leaf');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (asset) setPicked({ uri: asset.uri, width: asset.width, height: asset.height });
    } catch (e) {
      toast.show(`사진을 고르지 못했어요 · ${errorText(e)}`, 'leaf');
    }
  };

  const first = order === 'asc' ? photos?.[0] : photos?.[photos.length - 1];

  return (
    <>
      <ScreenContainer header={<TopBar title={`${plant.name} 성장 사진`} />}>
        <AppText variant="title" style={styles.title}>
          자라는 모습을 기록해요
        </AppText>
        <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
          같은 자리·같은 각도로 찍으면 변화가 잘 보여요. 사진은 내 계정에서만 볼 수 있어요.
        </AppText>

        <View style={[styles.section, styles.row]}>
          {Platform.OS !== 'web' ? (
            <SecondaryButton title="사진 찍기" icon={Camera} fullWidth={false} style={styles.flex} onPress={() => pick('camera')} />
          ) : null}
          <SecondaryButton title="앨범에서 고르기" icon={ImagePlus} fullWidth={false} style={styles.flex} onPress={() => pick('library')} />
        </View>

        <View style={styles.section}>
          <SectionHeader eyebrow="Timeline" title="성장 기록" subtitle={photos ? `사진 ${total}장` : undefined} />
          <SegmentedControl options={ORDER_OPTIONS} value={order} onChange={setOrder} size="sm" style={styles.segment} />
          {error ? (
            <AppText variant="caption" color={Colors.clayDeep}>
              사진을 불러오지 못했어요 · {error}
            </AppText>
          ) : photos === null ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : photos.length === 0 ? (
            <Card padding={Spacing.xl} radius={Radius.xl}>
              <AppText variant="caption" color={Colors.textSecondary}>
                아직 사진이 없어요. 첫 사진을 올려 기록을 시작해 보세요.
              </AppText>
            </Card>
          ) : (
            <View style={styles.timeline}>
              {photos.map((p) => (
                <Pressable key={p.id} onPress={() => setViewing(p)} accessibilityLabel={`${p.takenOn} 사진 보기`}>
                  <Card padding={Spacing.md} radius={Radius.lg} style={styles.item}>
                    <AuthImage path={p.thumbnailUrl} style={styles.thumb} />
                    <View style={styles.flex}>
                      <View style={styles.row}>
                        <AppText variant="bodyStrong">{formatMonthDayKo(parseISODate(p.takenOn))}</AppText>
                        {first ? (
                          <StatusChip
                            label={p.id === first.id ? '첫 기록' : `+${diffInDays(parseISODate(p.takenOn), parseISODate(first.takenOn))}일`}
                            tone={p.id === first.id ? 'deep' : 'green'}
                            size="sm"
                          />
                        ) : null}
                      </View>
                      <AppText variant="caption" color={Colors.textSecondary} numberOfLines={2}>
                        {p.note ?? '메모 없음'}
                      </AppText>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScreenContainer>

      <BottomSheet visible={!!picked} onClose={() => setPicked(null)} title="성장 사진 올리기" keyboardAware>
        {picked ? (
          <UploadForm
            photo={picked}
            today={state.today}
            onCancel={() => setPicked(null)}
            onUpload={async (form, key) => {
              await api.uploadGrowthPhoto(serverId, form, key);
              setPicked(null);
              toast.show('성장 사진을 저장했어요 🌱', 'leaf');
              await load();
            }}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet visible={!!viewing} onClose={() => setViewing(null)} title="사진 기록" keyboardAware>
        {viewing ? (
          <PhotoDetail
            photo={viewing}
            today={state.today}
            onClose={() => setViewing(null)}
            onChanged={async (message) => {
              setViewing(null);
              toast.show(message, 'leaf');
              await load();
            }}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}

/** 고른 사진 + 촬영일·메모 → 업로드. 실패 후 다시 누르면 같은 키로 보내 중복 저장을 막는다 */
function UploadForm({
  photo,
  today,
  onCancel,
  onUpload,
}: {
  photo: PickedPhoto;
  today: string;
  onCancel: () => void;
  onUpload: (form: FormData, key: string) => Promise<void>;
}) {
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newRequestKey('growth'));
  const lastInput = useRef('');

  const submit = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
      setError('촬영일은 오늘이나 지난 날짜(2026-11-10 형식)로 입력해 주세요');
      return;
    }
    // 내용을 바꿔 다시 보내면 새 업로드로 본다 (같은 키 + 다른 내용은 서버가 409)
    const input = `${date}|${note}`;
    if (lastInput.current && lastInput.current !== input) key.current = newRequestKey('growth');
    lastInput.current = input;
    setSending(true);
    setError(null);
    try {
      const form = await buildGrowthPhotoForm(photo, takenAtFor(date, today), note);
      await onUpload(form, key.current);
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <RNImage source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
      <FormField label="촬영일" hint="YYYY-MM-DD · 지난 사진이면 찍은 날로 바꿔 주세요">
        <TextField value={date} onChangeText={setDate} autoCorrect={false} />
      </FormField>
      <FormField label="메모 (선택)">
        <TextField value={note} onChangeText={setNote} placeholder="예: 새 잎이 나왔어요" maxLength={2000} multiline style={styles.memo} />
      </FormField>
      {error ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.sectionSm}>
          {error}
        </AppText>
      ) : null}
      <View style={[styles.row, styles.section]}>
        <SecondaryButton title="취소" fullWidth={false} style={styles.flex} onPress={onCancel} disabled={sending} />
        <PrimaryButton title={sending ? '올리는 중…' : '저장'} icon={Upload} fullWidth={false} style={styles.flex} disabled={sending} onPress={submit} />
      </View>
    </View>
  );
}

/** 큰 사진 + 메모·촬영일 수정 · 삭제 */
function PhotoDetail({
  photo,
  today,
  onClose,
  onChanged,
}: {
  photo: ApiGrowthPhoto;
  today: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [note, setNote] = useState(photo.note ?? '');
  const [date, setDate] = useState(photo.takenOn);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note !== (photo.note ?? '') || date !== photo.takenOn;

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged(message);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const save = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
      setError('촬영일은 오늘이나 지난 날짜(YYYY-MM-DD)로 입력해 주세요');
      return;
    }
    void run(
      () =>
        api.updateGrowthPhoto(photo.id, {
          note: note.trim() ? note.trim() : null,
          ...(date !== photo.takenOn ? { takenAt: takenAtFor(date, today) } : {}),
        }),
      '사진 정보를 바꿨어요',
    );
  };

  return (
    <View style={styles.sheet}>
      <AuthImage path={photo.imageUrl} style={[styles.preview, { aspectRatio: photo.width / photo.height }]} contentFit="contain" />
      <FormField label="촬영일">
        <TextField value={date} onChangeText={setDate} autoCorrect={false} />
      </FormField>
      <FormField label="메모">
        <TextField value={note} onChangeText={setNote} placeholder="메모 없음" maxLength={2000} multiline style={styles.memo} />
      </FormField>
      {error ? (
        <AppText variant="caption" color={Colors.clayDeep} style={styles.sectionSm}>
          {error}
        </AppText>
      ) : null}
      <View style={[styles.row, styles.section]}>
        <SecondaryButton
          title={confirmDelete ? '한 번 더 누르면 삭제' : '삭제'}
          icon={Trash2}
          variant={confirmDelete ? 'outline' : 'ghost'}
          color={Colors.clayDeep}
          fullWidth={false}
          style={styles.flex}
          disabled={busy}
          onPress={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            void run(() => api.deleteGrowthPhoto(photo.id), '사진을 삭제했어요');
          }}
        />
        {dirty ? (
          <PrimaryButton title={busy ? '저장 중…' : '저장'} fullWidth={false} style={styles.flex} disabled={busy} onPress={save} />
        ) : (
          <SecondaryButton title="닫기" fullWidth={false} style={styles.flex} onPress={onClose} />
        )}
      </View>
    </View>
  );
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
  segment: { marginBottom: Spacing.md },
  timeline: { gap: Spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: Radius.sm,
  },
  sheet: { paddingHorizontal: Spacing.screen },
  memo: {
    height: 96,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    textAlignVertical: 'top',
  },
  preview: {
    width: '100%',
    height: 260,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
    backgroundColor: Colors.surfaceMuted,
  },
});
