import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { TopBar } from '@/components/common/TopBar';
import { Colors, Spacing } from '@/constants/theme';

export interface ScanNoticeProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onClose: () => void;
  children?: ReactNode;
}

/** 스캔 전 권한/센서 안내 (카메라 화면과 같은 어두운 톤) */
export function ScanNotice({ icon: Icon, title, description, onClose, children }: ScanNoticeProps) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <TopBar title="창밖 환경 스캔" tone="dark" backIcon="close" onBack={onClose} />
      <View style={styles.body}>
        <View style={styles.icon}>
          <Icon size={30} color={Colors.white} strokeWidth={1.6} />
        </View>
        <AppText variant="h1" color={Colors.white} align="center">
          {title}
        </AppText>
        <AppText variant="body" color="rgba(255,255,255,0.72)" align="center" style={styles.description}>
          {description}
        </AppText>
        <View style={styles.actions}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111A14',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingBottom: Spacing.huge,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  description: {
    marginTop: Spacing.sm,
    lineHeight: 23,
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: Spacing.xxl,
    gap: Spacing.sm,
  },
});
