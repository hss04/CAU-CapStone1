import { router } from 'expo-router';
import { CloudDownload, LogIn, Map as MapIcon, Ruler, Send, Smartphone, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Card } from '@/components/common/Card';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SecondaryButton } from '@/components/common/SecondaryButton';
import { StatusChip } from '@/components/common/StatusChip';
import { TopBar } from '@/components/common/TopBar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { roomSizeLabel } from '@/services/space/geometry';
import { useAuth } from '@/store/AuthProvider';
import { useGarden } from '@/store/GardenProvider';

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: Smartphone,
    title: 'ARCore 측정 앱 열기',
    description: '안드로이드 폰에서 방 측정 앱을 열어요.',
  },
  {
    icon: Ruler,
    title: '방 모서리와 창문 측정',
    description: '바닥 모서리를 차례로 찍고, 창문은 네 꼭짓점을 찍어요.',
  },
  {
    icon: Send,
    title: "'저장한 방 서버 전송'",
    description: '서버 주소와 LUMAP 계정(이메일·비밀번호)을 넣고 보내요.',
  },
  {
    icon: CloudDownload,
    title: '여기서 방 불러오기',
    description: '같은 계정으로 로그인한 뒤 아래 버튼을 눌러요.',
  },
];

/**
 * 공간 측정 안내.
 * 방 측정은 별도 ARCore 앱(안드로이드)이 하고 서버에 올린다(POST /rooms/import-ar).
 * 이 화면은 그 순서를 안내하고, 서버에 올라간 방을 불러온다(GET /rooms).
 */
export default function RoomScanScreen() {
  const { state, actions } = useGarden();
  const auth = useAuth();
  const { room, sync } = state;
  const signedIn = auth.status === 'signedIn';
  const loading = sync.status === 'loading';

  const footer = signedIn ? (
    <>
      <PrimaryButton
        title={loading ? '불러오는 중…' : '서버에서 방 불러오기'}
        icon={CloudDownload}
        disabled={loading}
        onPress={actions.reloadFromServer}
      />
      {room.server ? (
        <SecondaryButton title="내 공간 보기" icon={MapIcon} variant="ghost" size="md" onPress={() => router.navigate('/space')} />
      ) : null}
    </>
  ) : (
    <PrimaryButton title="로그인하고 방 불러오기" icon={LogIn} onPress={() => router.push('/login')} />
  );

  return (
    <ScreenContainer header={<TopBar title="공간 측정" />} footer={footer}>
      <AppText variant="label" color={Colors.primary} style={styles.eyebrow}>
        Room measurement
      </AppText>
      <AppText variant="title" style={styles.title}>
        방 측정은 ARCore 앱에서 해요
      </AppText>
      <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
        측정한 방을 서버로 보내면, LUMAP이 그 방을 불러와 빛 지도를 만들어요.
      </AppText>

      <Card padding={Spacing.xl} radius={Radius.xl} style={styles.section}>
        {STEPS.map((s, i) => (
          <View key={s.title} style={[styles.step, i < STEPS.length - 1 && styles.stepGap]}>
            <View style={styles.stepNo}>
              <AppText variant="captionStrong" color={Colors.white}>
                {`${i + 1}`}
              </AppText>
            </View>
            <View style={styles.flex}>
              <View style={styles.stepTitle}>
                <s.icon size={15} color={Colors.primary} strokeWidth={1.9} />
                <AppText variant="bodyStrong">{s.title}</AppText>
              </View>
              <AppText variant="caption" color={Colors.textSecondary}>
                {s.description}
              </AppText>
            </View>
          </View>
        ))}
      </Card>

      {/* 지금 앱에 있는 방 */}
      <Card tone={room.server ? 'green' : 'muted'} bordered={!room.server} shadow={false} padding={Spacing.lg} radius={Radius.lg} style={styles.section}>
        <View style={styles.roomRow}>
          <View style={styles.flex}>
            <AppText variant="captionStrong" color={Colors.textSecondary}>
              지금 앱의 방
            </AppText>
            <AppText variant="h3">{room.name}</AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              {roomSizeLabel(room)} · 창문 {room.windows.length}개
            </AppText>
          </View>
          <StatusChip label={room.server ? '서버 방' : '예시 방'} tone={room.server ? 'green' : 'neutral'} size="sm" />
        </View>
        <AppText variant="small" color={sync.status === 'error' ? Colors.clayDeep : Colors.textSecondary} style={styles.syncText}>
          {syncText(signedIn, sync.status, sync.message, !!room.server)}
        </AppText>
      </Card>

      <View style={[styles.section, styles.note]}>
        <TriangleAlert size={15} color={Colors.textTertiary} strokeWidth={1.9} />
        <AppText variant="small" color={Colors.textTertiary} style={styles.flex}>
          ARCore 측정은 안드로이드만 지원해요. 폰과 서버 PC가 같은 Wi‑Fi에 있어야 보낼 수 있어요.
        </AppText>
      </View>
    </ScreenContainer>
  );
}

function syncText(signedIn: boolean, status: string, message: string | null, hasServerRoom: boolean): string {
  if (!signedIn) return '로그인 전이라 예시 방을 보여주고 있어요.';
  if (status === 'loading') return '서버에서 방을 불러오는 중이에요…';
  if (status === 'error') return `불러오지 못했어요 · ${message ?? '알 수 없는 오류'}`;
  if (!hasServerRoom) return '서버에 측정한 방이 아직 없어요. ARCore 앱에서 먼저 보내 주세요.';
  return '서버에서 가장 최근에 보낸 방을 쓰고 있어요.';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  eyebrow: {
    marginTop: Spacing.sm,
  },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.xl,
  },
  step: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  stepGap: {
    marginBottom: Spacing.lg,
  },
  stepNo: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  syncText: {
    marginTop: Spacing.sm,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
});
