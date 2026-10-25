import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

import { AppText } from './AppText';
import { PrimaryButton } from './PrimaryButton';

export interface EmptyStateProps {
  title: string;
  description?: string;
  illustration?: ReactNode;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title,
  description,
  illustration,
  actionLabel,
  actionIcon,
  onAction,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.wrap, style]}>
      {illustration ? <View style={styles.illustration}>{illustration}</View> : null}
      <AppText variant="heading" align="center" style={styles.title}>
        {title}
      </AppText>
      {description ? (
        <AppText variant="body" color={Colors.textSecondary} align="center" style={styles.description}>
          {description}
        </AppText>
      ) : null}
      {actionLabel ? (
        <PrimaryButton
          title={actionLabel}
          icon={actionIcon}
          onPress={onAction}
          fullWidth={false}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.xxxl,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surface,
  },
  illustration: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: Colors.lightGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxl,
    overflow: 'hidden',
  },
  title: {
    marginBottom: Spacing.sm,
  },
  description: {
    maxWidth: 280,
  },
  action: {
    marginTop: Spacing.xxl,
    alignSelf: 'center',
  },
});
