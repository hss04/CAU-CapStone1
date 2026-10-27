import { Check } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

import { AppText } from './AppText';

export interface AnalysisStep {
  key: string;
  label: string;
  status: 'pending' | 'active' | 'done';
  /** 실제로 알 수 있는 진행 정보만 (예: 3/14일 완료). 임의의 % 금지 */
  detail?: string;
}

export interface AnalysisStepsProps {
  title: string;
  caption?: string;
  steps: AnalysisStep[];
  /** 카드 없이 목록만 (이미 카드 안에 넣을 때) */
  bare?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * 계산을 기다리는 동안 실제 처리 단계를 보여준다.
 * 진행률을 알 수 없는 계산이라 퍼센트 대신 '지금 어떤 단계인지'만 알린다.
 */
export function AnalysisSteps({ title, caption, steps, bare = false, style }: AnalysisStepsProps) {
  return (
    <View style={[!bare && styles.card, style]} accessibilityRole="progressbar" accessibilityLabel={title}>
      <AppText variant="bodyStrong">{title}</AppText>
      {caption ? (
        <AppText variant="caption" color={Colors.textSecondary} style={styles.caption}>
          {caption}
        </AppText>
      ) : null}
      <View style={styles.list}>
        {steps.map((step) => (
          <View key={step.key} style={styles.row}>
            <StepMark status={step.status} />
            <AppText
              variant={step.status === 'active' ? 'captionStrong' : 'caption'}
              color={step.status === 'pending' ? Colors.textTertiary : Colors.text}
              style={styles.label}>
              {step.label}
            </AppText>
            {step.detail ? (
              <AppText variant="small" color={Colors.textSecondary}>
                {step.detail}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function StepMark({ status }: { status: AnalysisStep['status'] }) {
  if (status === 'active') {
    return (
      <View style={styles.mark}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }
  if (status === 'done') {
    return (
      <View style={[styles.mark, styles.done]}>
        <Check size={12} color={Colors.white} strokeWidth={3} />
      </View>
    );
  }
  return (
    <View style={styles.mark}>
      <View style={styles.pending} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  caption: {
    marginTop: 2,
  },
  list: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  label: {
    flex: 1,
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: {
    backgroundColor: Colors.primary,
  },
  pending: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.mutedGreen,
  },
});
