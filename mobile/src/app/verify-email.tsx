import { useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

function confirmError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'This link has expired or was already used. Log in to get a new one.';
    if (error.status === 409) return 'Another account already uses this email, so it can’t be moved to yours.';
    if (error.status === 429) return 'Too many tries. Wait a while, then open the link again.';
    return error.message;
  }
  return 'Something went wrong. Check your connection and open the link again.';
}

// Opened from the email link: /verify-email?token=... Outside the signed-in and signed-out groups,
// because it confirms both new accounts and a signed-in user's new email address.
export default function VerifyEmailScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [state, setState] = useState<State>({ kind: 'working' });
  // Links work once, so a second run of the effect (in development) mustn't send it again
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token }, auth: false })
      .then(() => {
        setState({ kind: 'done' });
        // A changed email shows on the profile straight away
        queryClient.invalidateQueries();
      })
      .catch((error: unknown) => setState({ kind: 'failed', message: confirmError(error) }));
  }, [token, queryClient]);

  const signedIn = status === 'signedIn';
  const next = () => router.replace(signedIn ? '/' : '/login');

  if (!token) {
    return (
      <Screen>
        <View style={styles.container}>
          <Heading>Link not valid</Heading>
          <FormMessage message="This link is missing its code. Open the link from the email again." />
          <Link href={signedIn ? '/' : '/login'} style={styles.link}>
            {signedIn ? 'Back to Triplet' : 'Go to log in'}
          </Link>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        {state.kind === 'working' ? (
          <View style={styles.working}>
            <ActivityIndicator color={colors.accent} />
            <Body style={styles.muted}>Confirming your email…</Body>
          </View>
        ) : state.kind === 'done' ? (
          <>
            <View style={styles.intro}>
              <Heading>Email confirmed</Heading>
              <Body style={styles.muted}>
                {signedIn ? 'Your account now uses this address.' : 'You’re all set. Log in to start planning.'}
              </Body>
            </View>
            <Button label={signedIn ? 'Back to Triplet' : 'Log in'} onPress={next} />
          </>
        ) : (
          <>
            <Heading>Couldn’t confirm</Heading>
            <FormMessage message={state.message} />
            <Button label={signedIn ? 'Back to Triplet' : 'Go to log in'} variant="secondary" onPress={next} />
          </>
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 28,
    paddingTop: spacing.xl,
  },
  intro: {
    gap: spacing.sm,
  },
  working: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  muted: {
    color: colors.muted,
  },
  link: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accent,
  },
}));
