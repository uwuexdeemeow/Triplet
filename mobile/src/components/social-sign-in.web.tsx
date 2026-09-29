import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { api, ApiError, type Schemas } from '@/api/client';
import { useSession } from '@/auth/session';
import { FormMessage } from '@/components/screen';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// The website's version: Google's own "Continue with Google" button (Google Identity Services).
// Apple's website sign-in isn't set up. The phones use social-sign-in.tsx.

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';

type GoogleId = {
  initialize: (options: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

// Loads Google's script once for the whole site
let scriptLoading: Promise<GoogleId> | null = null;
function loadGoogle(): Promise<GoogleId> {
  if (!scriptLoading) {
    scriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      script.onload = () => (window.google ? resolve(window.google.accounts.id) : reject(new Error('Google didn’t load')));
      script.onerror = () => {
        scriptLoading = null;
        reject(new Error('Google sign-in couldn’t load. Check your connection, or use your email.'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptLoading;
}

export function SocialSignInButtons() {
  const styles = useStyles();
  const { scheme } = useTheme();
  const { signInWithProvider } = useSession();
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Whether Google sign-in is on, and with which client, is the server's setting
  const options = useQuery({
    queryKey: ['auth', 'sign-in-options'],
    queryFn: () => api<Schemas['SignInOptions']>('/auth/sign-in-options', { auth: false }),
    staleTime: Infinity,
    retry: false,
  });
  const clientId = options.data?.google_client_id ?? null;

  const signedIn = useEffectEvent(async (credential: string) => {
    setError(null);
    try {
      await signInWithProvider({ provider: 'google', id_token: credential });
      // The root layout switches to the app once signed in
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'That didn’t work. Try again, or use your email.');
    }
  });

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled || !button.current) return;
        google.initialize({
          client_id: clientId,
          callback: (response: { credential?: string }) => {
            if (response.credential) signedIn(response.credential);
          },
          // The browser's own sign-in prompt where supported, which needs no pop-up window
          use_fedcm_for_button: true,
          itp_support: true,
        });
        button.current.replaceChildren();
        google.renderButton(button.current, {
          type: 'standard',
          theme: scheme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          // Google's button can't stretch, so match the form's width up to its 400px limit
          width: Math.min(400, Math.round(button.current.getBoundingClientRect().width) || 400),
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, scheme]);

  if (!clientId) return null;

  return (
    <View style={styles.container}>
      <FormMessage message={error} />
      <div
        ref={button}
        style={{
          width: '100%',
          minHeight: 44,
          display: 'flex',
          justifyContent: 'center',
          // Google draws its button in a frame. With the page in dark mode the browser paints that
          // frame's background white, which shows as a border; a light scheme keeps it see-through.
          // The button still uses its own dark style.
          colorScheme: 'light',
        }}
      />
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>or with email</Text>
        <View style={styles.line} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  or: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
}));
