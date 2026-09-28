import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, setAuthHandlers, type Schemas } from '@/api/client';
import {
  clearGuestToken,
  clearSession,
  hasSavedSession,
  loadGuestToken,
  loadRefreshToken,
  REFRESH_IN_COOKIE,
  saveGuestToken,
  saveSession,
} from '@/auth/token-storage';
import { forgetSignup, pendingSignup, rememberSignup } from '@/auth/verification';

// Guests opened one trip with its code and PIN, and can only look at it
type Status = 'loading' | 'signedIn' | 'signedOut' | 'guest';
type Tokens = Schemas['Token'];

type Session = {
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  confirmSignup: (code: string) => Promise<void>;
  enterAsGuest: (accessCode: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
};

// The access token only lives in memory; the refresh token is kept in secure storage on phones,
// and in a cookie scripts can't read on the website
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let isGuest = false;

/**
 * Swap the stored refresh token for a new pair of tokens.
 *
 * Refresh tokens are single use and the backend signs the user out everywhere if an old one
 * is replayed, so parallel callers must share one request instead of each sending their own.
 */
function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      if (!(await hasSavedSession())) return null;
      const refreshToken = await loadRefreshToken();

      try {
        const tokens = await api<Tokens>('/auth/refresh', {
          method: 'POST',
          body: REFRESH_IN_COOKIE ? undefined : { refresh_token: refreshToken },
          auth: false,
          refreshCookie: REFRESH_IN_COOKIE,
        });
        accessToken = tokens.access_token;
        await saveSession(tokens.refresh_token);
        return accessToken;
      } catch (error) {
        // Only a rejected token ends the session, being offline shouldn't log the user out
        if (error instanceof ApiError && error.status === 401) {
          accessToken = null;
          await clearSession();
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
        // A guest's token can't be renewed; once it expires they enter the code again
        if (isGuest) {
          isGuest = false;
          accessToken = null;
          await clearGuestToken();
          setStatus('signedOut');
          return null;
        }
        const token = await refreshSession();
        if (!token && !(await hasSavedSession())) setStatus('signedOut');
        return token;
      },
    });

    (async () => {
      if (!(await hasSavedSession())) {
        const guestToken = await loadGuestToken();
        if (guestToken) {
          accessToken = guestToken;
          isGuest = true;
        }
        if (!cancelled) setStatus(guestToken ? 'guest' : 'signedOut');
        return;
      }
      await refreshSession();
      // Still signed in unless the backend rejected the token
      const stillSignedIn = await hasSavedSession();
      if (!cancelled) setStatus(stillSignedIn ? 'signedIn' : 'signedOut');
    })();

    return () => {
      cancelled = true;
      setAuthHandlers(null);
    };
  }, []);

  const startSession = useCallback(
    async (tokens: Tokens) => {
      accessToken = tokens.access_token;
      isGuest = false;
      await clearGuestToken();
      await saveSession(tokens.refresh_token);
      queryClient.clear();
      setStatus('signedIn');
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const tokens = await api<Tokens>('/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
        refreshCookie: REFRESH_IN_COOKIE,
      });
      await startSession(tokens);
    },
    [startSession],
  );

  // The code from the sign-up email creates the account and signs straight in
  const confirmSignup = useCallback(
    async (code: string) => {
      const pending = pendingSignup();
      if (!pending) throw new Error('Sign up again to get a new code.');
      const tokens = await api<Tokens>('/auth/verify-email/code', {
        method: 'POST',
        body: { signup_token: pending.token, code },
        auth: false,
        refreshCookie: REFRESH_IN_COOKIE,
      });
      forgetSignup();
      await startSession(tokens);
    },
    [startSession],
  );

  // Signing up doesn't sign in: the account is only created once the emailed code is entered
  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { signup_token } = await api<Schemas['SignupResponse']>('/auth/signup', {
      method: 'POST',
      body: { name, email, password },
      auth: false,
    });
    rememberSignup(email.trim().toLowerCase(), signup_token);
  }, []);

  const enterAsGuest = useCallback(
    async (accessCode: string, pin: string) => {
      const tokens = await api<Tokens>('/guest/access', {
        method: 'POST',
        body: { access_code: accessCode, pin },
        auth: false,
      });
      accessToken = tokens.access_token;
      isGuest = true;
      await saveGuestToken(tokens.access_token);
      queryClient.clear();
      setStatus('guest');
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    if (isGuest) {
      isGuest = false;
      accessToken = null;
      await clearGuestToken();
      queryClient.clear();
      setStatus('signedOut');
      return;
    }

    const refreshToken = await loadRefreshToken();
    accessToken = null;
    await clearSession();
    queryClient.clear();
    setStatus('signedOut');

    if (refreshToken || REFRESH_IN_COOKIE) {
      // Best effort: the local sign out already happened even if this fails
      api('/auth/logout', {
        method: 'POST',
        body: REFRESH_IN_COOKIE ? undefined : { refresh_token: refreshToken },
        auth: false,
        refreshCookie: REFRESH_IN_COOKIE,
      }).catch(() => {});
    }
  }, [queryClient]);

  const value = useMemo(
    () => ({ status, signIn, signUp, confirmSignup, enterAsGuest, signOut }),
    [status, signIn, signUp, confirmSignup, enterAsGuest, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
