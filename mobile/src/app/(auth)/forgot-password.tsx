import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';

import { api } from '@/api/client';
import { checkPassword } from '@/auth/password-strength';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/auth/validation';
import { Button } from '@/components/button';
import { CodeField } from '@/components/code-field';
import { PasswordMeter } from '@/components/password-meter';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// Two steps: ask for a code, then enter it with a new password
export default function ForgotPasswordScreen() {
  const styles = useStyles();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const sendCode = async (email: string) => {
    await api('/auth/password-reset/request', { method: 'POST', body: { email }, auth: false });
  };

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      const address = email.trim().toLowerCase();
      await sendCode(address);
      setSentTo(address);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong.');
    }
  });

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.intro}>
          <Heading>Reset your password</Heading>
          <Body style={styles.muted}>
            {sentTo ? (
              // Same wording whether or not the account exists, like the backend
              <>
                If <Text style={styles.strong}>{sentTo}</Text> has a Triplet account, we’ve emailed it a 6-digit code.
                It works for 15 minutes.
              </>
            ) : (
              'We’ll email you a code to choose a new password.'
            )}
          </Body>
        </View>

        {sentTo ? (
          <NewPasswordForm email={sentTo} onResend={() => sendCode(sentTo)} onStartOver={() => setSentTo(null)} />
        ) : (
          <View style={styles.form}>
            <FormMessage message={formError} />
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <TextField
                  label="Email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  onSubmitEditing={onSubmit}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Button label="Email me a code" loading={formState.isSubmitting} onPress={onSubmit} />
          </View>
        )}

        <Link href="/login" style={styles.back}>
          Back to log in
        </Link>
      </View>
    </Screen>
  );
}

function NewPasswordForm({
  email,
  onResend,
  onStartOver,
}: {
  email: string;
  onResend: () => Promise<void>;
  onStartOver: () => void;
}) {
  const styles = useStyles();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (code.length !== 6) return setError('Enter all 6 digits of the code');
    if (password.length < 8 || password.length > 64) return setError('Use 8 to 64 characters for your password');
    if (!checkPassword(password, '', email).strongEnough) {
      return setError('That password is too easy to guess. Try adding another word or two.');
    }
    setSaving(true);
    try {
      await api('/auth/password-reset/confirm', {
        method: 'POST',
        body: { email, code, new_password: password },
        auth: false,
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'Invalid credentials'
          ? 'That password is too easy to guess. Try adding another word or two.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <View style={styles.form}>
        <FormMessage tone="success" message="Your password has been changed. Log in with the new one." />
        <Button label="Go to log in" onPress={() => router.replace('/login')} />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <FormMessage message={error} />
      <FormMessage tone="success" message={notice} />
      <CodeField value={code} onChangeText={setCode} autoFocus />
      <TextField
        label="New password"
        hint="8 to 64 characters. A few random words works well."
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      <PasswordMeter password={password} name="" email={email} />
      <Button label="Change password" loading={saving} onPress={submit} />
      <Button
        label="Send a new code"
        variant="text"
        onPress={async () => {
          setError(null);
          try {
            await onResend();
            setNotice('A new code is on its way. Older codes no longer work.');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.');
          }
        }}
      />
      <Button label="Use a different email" variant="text" onPress={onStartOver} />
    </View>
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
  back: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accent,
  },
}));
