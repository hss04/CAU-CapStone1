import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setUnauthorizedListener } from '@/services/api/client';
import { fetchMe, login, register } from '@/services/api/endpoints';
import { clearSession, restoreSession, saveSession } from '@/services/api/session';
import type { ApiUser } from '@/types/api';

/**
 * 로그인 상태.
 * 로그인하지 않아도 앱은 데모(Mock) 데이터로 동작하고, 로그인하면 GardenProvider가 서버 데이터로 바꾼다.
 */

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  user: ApiUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** 가입 후 바로 로그인 */
  signUp: (email: string, password: string, nickname: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    let alive = true;
    setUnauthorizedListener(() => {
      setUser(null);
      setStatus('signedOut');
    });

    // 저장된 토큰이 있으면 내 정보를 받아 로그인 상태를 복원한다
    (async () => {
      const session = await restoreSession();
      if (!session) {
        if (alive) setStatus('signedOut');
        return;
      }
      try {
        const me = await fetchMe();
        if (!alive) return;
        setUser(me);
        setStatus('signedIn');
      } catch {
        // 서버가 꺼져 있으면 데모 모드로 시작 (토큰이 거절된 경우는 client가 이미 지웠다)
        if (alive) setStatus('signedOut');
      }
    })();

    return () => {
      alive = false;
      setUnauthorizedListener(null);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const signIn = async (email: string, password: string) => {
      const token = await login({ email: email.trim(), password });
      await saveSession(token.accessToken, token.expiresIn);
      const me = await fetchMe();
      setUser(me);
      setStatus('signedIn');
    };
    return {
      status,
      user,
      signIn,
      signUp: async (email, password, nickname) => {
        await register({ email: email.trim(), password, nickname: nickname.trim() });
        await signIn(email, password);
      },
      signOut: async () => {
        await clearSession();
        setUser(null);
        setStatus('signedOut');
      },
    };
  }, [status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
