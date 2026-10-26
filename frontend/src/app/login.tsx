import { LogIn, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { FormField, TextField } from '@/components/common/FormField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { ScreenContainer } from '@/components/common/ScreenContainer';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { useToast } from '@/components/common/Toast';
import { TopBar, goBackOrHome } from '@/components/common/TopBar';
import { DEV_TOOLS_ENABLED } from '@/constants/app';
import { Colors, Spacing } from '@/constants/theme';
import { ApiError } from '@/services/api/client';
import { API_BASE_URL } from '@/services/api/config';
import { useAuth } from '@/store/AuthProvider';

type Mode = 'signIn' | 'signUp';

const MIN_PASSWORD = 8;

/** 로그인 / 회원가입 — 로그인하면 식물이 서버에 저장된다 */
export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordOk = isSignUp ? password.length >= MIN_PASSWORD : password.length > 0;
  const canSubmit = emailOk && passwordOk && (!isSignUp || nickname.trim().length > 0) && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (isSignUp) await signUp(email, password, nickname);
      else await signIn(email, password);
      toast.show(isSignUp ? '가입하고 로그인했어요 🌱' : '로그인했어요 🌱', 'leaf');
      goBackOrHome();
    } catch (e) {
      setError(friendlyError(e, mode));
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenContainer
        header={<TopBar title={isSignUp ? '회원가입' : '로그인'} backIcon="close" />}
        footer={
          <PrimaryButton
            title={isSignUp ? '가입하기' : '로그인'}
            icon={isSignUp ? UserPlus : LogIn}
            disabled={!canSubmit}
            loading={submitting}
            onPress={submit}
          />
        }>
        <AppText variant="label" color={Colors.primary} style={styles.eyebrow}>
          Account
        </AppText>
        <AppText variant="title" style={styles.title}>
          {isSignUp ? '처음 오셨군요' : '다시 만나서 반가워요'}
        </AppText>
        <AppText variant="body" color={Colors.textSecondary} style={styles.subtitle}>
          로그인하면 등록한 식물이 서버에 저장돼요.
        </AppText>

        <SegmentedControl
          options={[
            { value: 'signIn', label: '로그인' },
            { value: 'signUp', label: '회원가입' },
          ]}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          style={styles.segment}
        />

        <FormField label="이메일" required>
          <TextField
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
        </FormField>

        <FormField label="비밀번호" required hint={isSignUp ? `${MIN_PASSWORD}자 이상` : undefined}>
          <TextField
            value={password}
            onChangeText={setPassword}
            placeholder="비밀번호"
            secureTextEntry
            autoCapitalize="none"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            textContentType={isSignUp ? 'newPassword' : 'password'}
            returnKeyType="done"
            onSubmitEditing={canSubmit ? submit : undefined}
          />
        </FormField>

        {isSignUp ? (
          <FormField label="닉네임" required>
            <TextField value={nickname} onChangeText={setNickname} placeholder="예) 지우" maxLength={50} />
          </FormField>
        ) : null}

        {error ? (
          <AppText variant="captionStrong" color="#C0473F" style={styles.error}>
            {error}
          </AppText>
        ) : null}

        {DEV_TOOLS_ENABLED ? (
          <AppText variant="small" color={Colors.textTertiary} style={styles.server}>
            서버 {API_BASE_URL}
          </AppText>
        ) : null}
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

function friendlyError(e: unknown, mode: Mode): string {
  if (!(e instanceof ApiError)) return '알 수 없는 오류가 났어요. 다시 시도해 주세요.';
  if (e.isNetwork) return `서버에 연결할 수 없어요. 서버가 켜져 있는지 확인해 주세요.\n(${API_BASE_URL})`;
  if (e.status === 401) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (e.status === 409 && mode === 'signUp') return '이미 가입된 이메일이에요. 로그인해 주세요.';
  if (e.status === 422) return `입력값을 확인해 주세요. (${e.message})`;
  return e.message;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  eyebrow: {
    marginTop: Spacing.sm,
  },
  title: {
    marginTop: Spacing.sm,
  },
  subtitle: {
    marginTop: Spacing.sm,
  },
  segment: {
    marginTop: Spacing.xl,
  },
  error: {
    marginTop: Spacing.lg,
  },
  server: {
    marginTop: Spacing.xl,
  },
});
