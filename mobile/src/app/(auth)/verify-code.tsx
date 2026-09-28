import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { CodeField } from '@/components/code-field';
import { ResendConfirmation } from '@/components/resend-confirmation';
import { Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// After signing up (or logging in to an unconfirmed account): enter the emailed code to get in
export default function VerifyCodeScreen() {
  const styles = useStyles();
  const { confirmSignup } = useSession();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (code.length !== 6) {
      setError('Enter all 6 digits');
      return;
    }
    setError(null);
    setChecking(true);
    try {
      await confirmSignup(email, code);
      // The root layout switches to the app once signed in
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setChecking(false);
    }
  };

  // Opened without an email (e.g. a bookmarked address): start again from sign-up
  if (!email) return <Redirect href="/signup" />;

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.intro}>
          <Heading>Check your email</Heading>
          <Body style={styles.muted}>
            We sent a 6-digit code to <Text style={styles.strong}>{email}</Text>. Enter it to finish signing up. It
            works for 15 minutes.
          </Body>
        </View>

        <View style={styles.form}>
          <CodeField value={code} onChangeText={setCode} onSubmit={submit} error={error} autoFocus />
          <Button label="Confirm and continue" loading={checking} onPress={submit} />
          <ResendConfirmation email={email} label="Send a new code" />
        </View>

        <Body style={styles.muted}>
          Can’t find it? Check your spam folder. Wrong address?{' '}
          <Link href="/signup" style={styles.link}>
            Sign up again
          </Link>
        </Body>
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
  strong: {
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  form: {
    gap: 18,
  },
  link: {
    fontFamily: fonts.bold,
    color: colors.accent,
  },
}));
