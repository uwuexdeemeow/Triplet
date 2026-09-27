import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View, type TextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { loginSchema, type LoginValues } from '@/auth/validation';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signIn } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const { control, handleSubmit, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      await signIn(email, password);
      // The root layout switches to the app once signed in
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? "That email and password don't match."
          : error instanceof Error
            ? error.message
            : 'Something went wrong.',
      );
    }
  });

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Feather name="map-pin" size={28} color={colors.onAccent} />
          </View>
          <Heading style={styles.wordmark}>Triplet</Heading>
          <Body style={styles.tagline}>Turn the TikToks you save into a real trip.</Body>
        </View>

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
                returnKeyType="next"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onSubmitEditing={() => passwordRef.current?.focus()}
                error={fieldState.error?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                ref={passwordRef}
                label="Password"
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onSubmitEditing={onSubmit}
                error={fieldState.error?.message}
              />
            )}
          />

          <Link href="/forgot-password" style={styles.forgot}>
            Forgot password?
          </Link>

          <Button label="Log in" loading={formState.isSubmitting} onPress={onSubmit} />
        </View>
      </View>

      <Text style={styles.footer}>
        New to Triplet?{' '}
        <Link href="/signup" style={styles.link}>
          Create an account
        </Link>
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    gap: 40,
    paddingTop: spacing.xxl,
  },
  brand: {
    gap: 14,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 40,
    lineHeight: 44,
  },
  tagline: {
    fontSize: 18,
    lineHeight: 26,
    color: colors.muted,
  },
  form: {
    gap: 18,
  },
  forgot: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.sm,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  footer: {
    marginTop: spacing.xxl,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  link: {
    fontFamily: fonts.bold,
    color: colors.accent,
  },
}));
