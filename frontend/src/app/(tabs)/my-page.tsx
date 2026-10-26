import { router } from 'expo-router';
import {
  Bell,
  BellRing,
  CircleHelp,
  CloudSun,
  Droplets,
  Leaf,
  ListRestart,
  LogIn,
  LogOut,
  Map as MapIcon,
  PlayCircle,
  RefreshCw,
  ScanLine,
  Settings,
  Smile,
  Sprout,
  Trash2,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { Card } from '@/components/common/Card';
import { PageHeader } from '@/components/common/PageHeader';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SettingRow } from '@/components/common/SettingRow';
import { useToast } from '@/components/common/Toast';
import { APP_NAME, APP_VERSION } from '@/constants/app';
import { CHARACTER_COPY } from '@/constants/labels';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/store/AuthProvider';
import { useGarden, type SyncState } from '@/store/GardenProvider';
import { diffInDays, parseISODate } from '@/utils/date';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="label" color={Colors.textSecondary} style={styles.groupTitle}>
        {title}
      </AppText>
      <Card padding={0} radius={Radius.lg} style={styles.groupCard}>
        {children}
      </Card>
    </View>
  );
}

function syncSubtitle(sync: SyncState, plantCount: number): string {
  if (sync.status === 'loading') return '서버에서 받는 중…';
  if (sync.status === 'error') return `받지 못했어요 · ${sync.message ?? ''} · 눌러서 다시 시도`;
  const skipped = sync.skipped ? ` · 앱에 없는 종 ${sync.skipped}개 제외` : '';
  return `서버 식물 ${plantCount}개${skipped}`;
}

export default function MyPageScreen() {
  const { state, today, actions } = useGarden();
  const auth = useAuth();
  const toast = useToast();
  const { user, plants, room, notifications } = state;

  const days = diffInDays(today, parseISODate(user.joinedAt));
  const avgScore = plants.length
    ? Math.round(plants.reduce((sum, p) => sum + p.analysis.current.score, 0) / plants.length)
    : 0;
  const soon = () => toast.show('다음 업데이트에서 만나요 🌱', 'leaf');

  return (
    <ScreenContainer>
      <PageHeader eyebrow="Profile" title="My Page" />

      <Card padding={Spacing.xl} radius={Radius.xl} style={styles.profile}>
        <View style={styles.profileRow}>
          <Avatar name={user.nameEn} size={64} />
          <View style={styles.flex}>
            <AppText variant="heading">{user.name}</AppText>
            <AppText variant="caption" color={Colors.textSecondary}>
              {user.email}
            </AppText>
            <View style={styles.summaryPill}>
              <Leaf size={12} color={Colors.primary} strokeWidth={2} />
              <AppText variant="small" color={Colors.deepGreen} style={styles.summaryText}>
                {plants.length} Plants · 1 Space
              </AppText>
            </View>
          </View>
        </View>
        <View style={styles.stats}>
          <Stat label="Plants" value={`${plants.length}`} />
          <View style={styles.statDivider} />
          <Stat label="Avg. fit" value={`${avgScore}%`} />
          <View style={styles.statDivider} />
          <Stat label="Days" value={`${days}`} />
        </View>
      </Card>

      <Group title="Account">
        {auth.status === 'signedIn' && auth.user ? (
          <>
            <SettingRow icon={RefreshCw} title="서버 동기화" subtitle={syncSubtitle(state.sync, plants.length)} tone="green" onPress={actions.reloadFromServer} />
            <SettingRow
              icon={LogOut}
              title="로그아웃"
              subtitle="데모 데이터로 돌아가요"
              tone="neutral"
              onPress={async () => {
                await auth.signOut();
                toast.show('로그아웃했어요', 'leaf');
              }}
              showDivider={false}
            />
          </>
        ) : (
          <SettingRow
            icon={LogIn}
            title="로그인 / 회원가입"
            subtitle={auth.status === 'restoring' ? '로그인 정보를 확인하고 있어요' : '지금은 데모 데이터예요. 로그인하면 서버에 저장돼요'}
            tone="green"
            onPress={() => router.push('/login')}
            showDivider={false}
          />
        )}
      </Group>

      <Group title="Space & Plants">
        <SettingRow icon={MapIcon} title="내 공간 관리" subtitle={`${room.name} · ${room.orientationLabel} · 창문 ${room.windows.length}개`} onPress={() => router.navigate('/space')} />
        <SettingRow icon={Sprout} title="내 식물 관리" value={`${plants.length}개`} onPress={() => router.navigate('/plants')} />
        <SettingRow icon={ScanLine} title="공간 다시 스캔" tone="sun" onPress={() => router.push('/room-scan')} showDivider={false} />
      </Group>

      <Group title="Notifications">
        <SettingRow
          icon={Droplets}
          title="물주기 알림"
          subtitle="물 줄 날 아침 9시에 알려드려요"
          tone="water"
          toggleValue={notifications.watering}
          onToggle={() => actions.toggleNotification('watering')}
        />
        <SettingRow
          icon={CloudSun}
          title="환경 알림"
          subtitle="햇빛·온도 변화가 크면 알려드려요"
          tone="sun"
          toggleValue={notifications.environment}
          onToggle={() => actions.toggleNotification('environment')}
        />
        <SettingRow icon={Bell} title="알림 설정" tone="neutral" onPress={soon} showDivider={false} />
      </Group>

      <Group title="General">
        <SettingRow icon={Settings} title="앱 설정" tone="neutral" onPress={soon} />
        <SettingRow icon={CircleHelp} title="도움말" tone="neutral" onPress={soon} showDivider={false} />
      </Group>

      <Group title="Demo tools">
        <SettingRow
          icon={Smile}
          title="캐릭터 상태 바꿔보기"
          subtitle="HOME 캐릭터를 길게 눌러도 바뀌어요"
          value={state.characterOverride ? CHARACTER_COPY[state.characterOverride].label : '자동'}
          tone="clay"
          onPress={() => {
            actions.cycleCharacter();
            toast.show('캐릭터 상태를 바꿨어요. HOME에서 확인해보세요', 'leaf');
          }}
        />
        <SettingRow icon={PlayCircle} title="온보딩 다시 보기" tone="green" onPress={actions.restartOnboarding} />
        <SettingRow
          icon={Trash2}
          title="빈 식물 목록 보기"
          subtitle="Empty State 시연용"
          tone="neutral"
          onPress={() => {
            actions.clearPlants();
            toast.show('식물 목록을 비웠어요', 'leaf');
          }}
        />
        <SettingRow
          icon={ListRestart}
          title="데모 데이터 초기화"
          tone="neutral"
          onPress={() => {
            actions.resetDemo();
            toast.show('처음 상태로 되돌렸어요', 'leaf');
          }}
          showDivider={false}
        />
      </Group>

      <View style={styles.footer}>
        <BellRing size={14} color={Colors.textTertiary} strokeWidth={1.6} />
        <AppText variant="small" color={Colors.textTertiary}>
          {APP_NAME} · v{APP_VERSION}
        </AppText>
      </View>
    </ScreenContainer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="value" style={styles.statValue}>
        {value}
      </AppText>
      <AppText variant="label" color={Colors.textTertiary} style={styles.statLabel}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  profile: {
    marginTop: Spacing.xl,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: Spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lightGreen,
  },
  summaryText: {
    fontWeight: '700',
  },
  stats: {
    flexDirection: 'row',
    marginTop: Spacing.xl,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 26,
  },
  statLabel: {
    fontSize: 10,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  group: {
    marginTop: Spacing.xxl,
  },
  groupTitle: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  groupCard: {
    overflow: 'hidden',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.xxl,
  },
});
