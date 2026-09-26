import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, setAuthHandlers, type Schemas } from '@/api/client';
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from '@/auth/token-storage';

type Status = 'loading' | 'signedIn' | 'signedOut';
type Tokens = Schemas['Token'];

type Session = {
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

// The access token only lives in memory; the refresh token is kept in secure storage
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Swap the stored refresh token for a new pair of tokens.
 *
 * Refresh tokens are single use and the backend signs the user out everywhere if an old one
 * is replayed, so parallel callers must share one request instead of each sending their own.
 */
function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await loadRefreshToken();
      if (!refreshToken) return null;

      try {
        const tokens = await api<Tokens>('/auth/refresh', {
          method: 'POST',
          body: { refresh_token: refreshToken },
          auth: false,
        });
        accessToken = tokens.access_token;
        if (tokens.refresh_token) await saveRefreshToken(tokens.refresh_token);
        return accessToken;
      } catch (error) {
        // Only a rejected token ends the session, being offline shouldn't log the user out
        if (error instanceof ApiError && error.status === 401) {
          accessToken = null;
          await clearRefreshToken();
        }
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    setAuthHandlers({
      getAccessToken: () => accessToken,
      refreshAccessToken: async () => {
        const token = await refreshSession();
        if (!token && !(await loadRefreshToken())) setStatus('signedOut');
        return token;
      },
    });

    (async () => {
      if (!(await loadRefreshToken())) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      await refreshSession();
      // Still signed in unless the backend rejected the token
      const stillSignedIn = (await loadRefreshToken()) !== null;
      if (!cancelled) setStatus(stillSignedIn ? 'signedIn' : 'signedOut');
    })();

    return () => {
      cancelled = true;
      setAuthHandlers(null);
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await api<Tokens>('/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      accessToken = tokens.access_token;
      if (tokens.refresh_token) await saveRefreshToken(tokens.refresh_token);
      queryClient.clear();
      setStatus('signedIn');
    },
    [queryClient],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      await api('/auth/signup', { method: 'POST', body: { name, email, password }, auth: false });
      await signIn(email, password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    const refreshToken = await loadRefreshToken();
    accessToken = null;
    await clearRefreshToken();
    queryClient.clear();
    setStatus('signedOut');

    if (refreshToken) {
      // Best effort: the local sign out already happened even if this fails
      api('/auth/logout', { method: 'POST', body: { refresh_token: refreshToken }, auth: false }).catch(() => {});
    }
  }, [queryClient]);

  const value = useMemo(() => ({ status, signIn, signUp, signOut }), [status, signIn, signUp, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
