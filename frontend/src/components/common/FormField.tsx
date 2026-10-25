import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Colors, FontFamily, Radius, Spacing } from '@/constants/theme';

import { AppText } from './AppText';

export interface FormFieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function FormField({ label, hint, required, children, style }: FormFieldProps) {
  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <AppText variant="bodyStrong">{label}</AppText>
        {required ? (
          <AppText variant="small" color={Colors.primary}>
            필수
          </AppText>
        ) : null}
      </View>
      {hint ? (
        <AppText variant="caption" color={Colors.textSecondary} style={styles.hint}>
          {hint}
        </AppText>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={Colors.textTertiary}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: Spacing.xxl,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  hint: {
    marginTop: 2,
  },
  body: {
    marginTop: Spacing.md,
  },
  input: {
    height: 54,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
    color: Colors.text,
    fontFamily: FontFamily.sans,
  },
});
