import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

import { AppText } from './AppText';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 탭 화면 상단의 감성 헤더 (eyebrow + serif 타이틀 + 설명) */
export function PageHeader({ eyebrow, title, subtitle, right, style }: PageHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.texts}>
        {eyebrow ? (
          <AppText variant="eyebrow" color={Colors.textSecondary} numberOfLines={1}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="display" style={eyebrow ? styles.titleWithEyebrow : undefined}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  texts: {
    flex: 1,
  },
  titleWithEyebrow: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  right: {
    paddingTop: Spacing.xs,
  },
});
