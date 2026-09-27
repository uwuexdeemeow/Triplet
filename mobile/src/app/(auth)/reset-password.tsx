import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { resetPasswordSchema, type ResetPasswordValues } from '@/auth/validation';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// Opened from the email link: triplet://reset-password?token=... (or /reset-password on the web)
export default function ResetPasswordScreen() {
  const styles = useStyles();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await api('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, new_password: password },
        auth: false,
      });
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFormError('This link has expired or was already used. Ask for a new one.');
      } else if (error instanceof ApiError && error.status === 422) {
        setFormError('That password is too easy to guess. Try a longer phrase.');
      } else {
        setFormError(error instanceof Error ? error.message : 'Something went wrong.');
      }
    }
  });

  if (!token) {
    return (
      <Screen>
        <View style={styles.container}>
          <Heading>Link not valid</Heading>
          <FormMessage message="This reset link is missing its code. Open the link from the email again, or ask for a new one." />
          <Link href="/forgot-password" style={styles.link}>
            Get a new link
          </Link>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.intro}>
          <Heading>Choose a new password</Heading>
          <Body style={styles.muted}>You’ll be logged out on your other devices.</Body>
        </View>

        {done ? (
          <>
            <FormMessage tone="success" message="Your password has been changed." />
            <Link href="/login" style={styles.link}>
              Log in
            </Link>
          </>
        ) : (
          <View style={styles.form}>
            <FormMessage message={formError} />
            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <TextField
                  label="New password"
                  hint="8 to 64 characters. A few random words works well."
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="confirm"
              render={({ field, fieldState }) => (
                <TextField
                  label="Confirm new password"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  onSubmitEditing={onSubmit}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Button label="Change password" loading={formState.isSubmitting} onPress={onSubmit} />
          </View>
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
  form: {
    gap: 18,
  },
  link: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accent,
  },
}));
