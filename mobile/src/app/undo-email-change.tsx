import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

type State = { kind: 'asking' } | { kind: 'working' } | { kind: 'done'; message: string } | { kind: 'failed'; message: string };

function undoError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many tries. Wait a while, then open the link again.';
    return error.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}

// Opened from "Your Triplet email was changed", sent to the old address. Outside the signed-in
// and signed-out groups, since whoever opens it may be either. It waits for a tap, because some
// email security scanners open links by themselves.
export default function UndoEmailChangeScreen() {
  const styles = useStyles();
  const { status, signOut } = useSession();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [state, setState] = useState<State>(token ? { kind: 'asking' } : { kind: 'failed', message: 'This link is missing its code. Open the link from the email again.' });

  const undo = async () => {
    setState({ kind: 'working' });
    try {
      const result = await api<{ detail: string }>('/auth/undo-email-change', { method: 'POST', body: { token }, auth: false });
      // Every device was signed out, this one included
      if (status === 'signedIn') await signOut();
      setState({ kind: 'done', message: result.detail });
    } catch (error) {
      setState({ kind: 'failed', message: undoError(error) });
    }
  };

  return (
    <Screen>
      <View style={styles.container}>
        {state.kind === 'asking' || state.kind === 'working' ? (
          <>
            <View style={styles.intro}>
              <Heading>Undo the email change?</Heading>
              <Body style={styles.muted}>
                Your account goes back to this email, every device is signed out, and any Google or Apple sign-in added
                since is removed. Then you choose a new password, so whoever changed it can’t get back in.
              </Body>
            </View>
            <Button label="Undo the change" loading={state.kind === 'working'} onPress={undo} />
          </>
        ) : state.kind === 'done' ? (
          <>
            <View style={styles.intro}>
              <Heading>Your email is back</Heading>
              <FormMessage tone="success" message={state.message} />
            </View>
            <Button label="Choose a new password" onPress={() => router.replace('/forgot-password')} />
          </>
        ) : (
          <>
            <Heading>Couldn’t undo it</Heading>
            <FormMessage message={state.message} />
            <Button label="Go to Triplet" variant="secondary" onPress={() => router.replace('/')} />
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
  muted: {
    color: colors.muted,
  },
}));
