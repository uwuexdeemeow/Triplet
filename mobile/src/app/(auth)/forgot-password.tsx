import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { api } from '@/api/client';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/auth/validation';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const styles = useStyles();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await api('/auth/password-reset/request', { method: 'POST', body: { email }, auth: false });
      setSentTo(email);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Something went wrong.');
    }
  });

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.intro}>
          <Heading>Reset your password</Heading>
          <Body style={styles.muted}>We’ll email you a link to choose a new one.</Body>
        </View>

        {sentTo ? (
          // Same message whether or not the account exists, like the backend
          <FormMessage
            tone="success"
            message={`If ${sentTo} has a Triplet account, a reset link is on its way. It works for 30 minutes.`}
          />
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
            <Button label="Send reset link" loading={formState.isSubmitting} onPress={onSubmit} />
          </View>
        )}

        <Link href="/login" style={styles.back}>
          Back to log in
        </Link>
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
  back: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accent,
  },
}));
