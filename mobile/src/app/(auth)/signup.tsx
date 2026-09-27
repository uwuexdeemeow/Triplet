import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, Text, View, type TextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { suggestEmail } from '@/auth/password-strength';
import { useSession } from '@/auth/session';
import { signupSchema, type SignupValues } from '@/auth/validation';
import { Button } from '@/components/button';
import { PasswordMeter } from '@/components/password-meter';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// The backend keeps its signup errors vague ("Invalid credentials"), so explain them by status code
function signupError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account with this email already exists. Try logging in instead.';
    if (error.status === 422) return 'That password is too easy to guess. Try a longer phrase, or mix in words that aren’t your name or email.';
    return error.message;
  }
  return 'Something went wrong.';
}

export default function SignupScreen() {
  const styles = useStyles();
  const { signUp } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const { control, handleSubmit, formState, setValue } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '' },
    // Check each field when the user leaves it, then again as they fix it
    mode: 'onTouched',
  });
  const [name, email, password] = useWatch({ control, name: ['name', 'email', 'password'] });
  const emailSuggestion = suggestEmail(email);

  const onSubmit = handleSubmit(async ({ name, email, password }) => {
    setFormError(null);
    try {
      await signUp(name, email, password);
    } catch (error) {
      setFormError(signupError(error));
    }
  });

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.intro}>
          <Heading>Create your account</Heading>
          <Body style={styles.muted}>Plan trips with friends from the videos you save.</Body>
        </View>

        <View style={styles.form}>
          <FormMessage message={formError} />

          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <TextField
                label="Name"
                hint="Your name as friends know it"
                autoComplete="name"
                textContentType="name"
                autoCapitalize="words"
                returnKeyType="next"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onSubmitEditing={() => emailRef.current?.focus()}
                error={fieldState.error?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <TextField
                ref={emailRef}
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
          {emailSuggestion ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use ${emailSuggestion} instead`}
              onPress={() => setValue('email', emailSuggestion, { shouldValidate: true })}
              style={styles.suggestion}>
              <Text style={styles.suggestionText}>
                Did you mean <Text style={styles.suggestionEmail}>{emailSuggestion}</Text>?
              </Text>
            </Pressable>
          ) : null}

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                ref={passwordRef}
                label="Password"
                hint="8 to 64 characters. A few random words works well."
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
          <PasswordMeter password={password} name={name} email={email} />

          <Button label="Create account" loading={formState.isSubmitting} onPress={onSubmit} />
        </View>
      </View>

      <Text style={styles.footer}>
        Already have an account?{' '}
        <Link href="/login" style={styles.link}>
          Log in
        </Link>
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    gap: 32,
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
  suggestion: {
    marginTop: -10,
    minHeight: 32,
    justifyContent: 'center',
  },
  suggestionText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  suggestionEmail: {
    fontFamily: fonts.bold,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
}));
