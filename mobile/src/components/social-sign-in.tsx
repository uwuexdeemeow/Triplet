import { AntDesign } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { appleAvailable, googleAvailable, signInWithApple, signInWithGoogle, type SocialSignIn } from '@/auth/social';
import { FormMessage } from '@/components/screen';
import { PressableScale } from '@/components/pressable-scale';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

/**
 * "Continue with Apple" and "Continue with Google", above the email form on the log-in and
 * sign-up screens. Each only shows where it works and is set up; with neither, nothing shows.
 */
export function SocialSignInButtons() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const { signInWithProvider } = useSession();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const google = googleAvailable();

  useEffect(() => {
    appleAvailable().then(setApple);
  }, []);

  if (!apple && !google) return null;

  const run = async (provider: 'apple' | 'google', start: () => Promise<SocialSignIn | null>) => {
    setBusy(provider);
    setError(null);
    try {
      const signIn = await start();
      // Closing the sheet isn't an error
      if (signIn) await signInWithProvider(signIn);
      // The root layout switches to the app once signed in
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'That didn’t work. Try again, or use your email.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <FormMessage message={error} />
      {apple ? (
        <View>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              scheme === 'dark'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={radii.button}
            onPress={() => run('apple', signInWithApple)}
            style={styles.appleButton}
          />
          {busy === 'apple' ? <ActivityIndicator color={colors.accent} style={styles.busy} /> : null}
        </View>
      ) : null}
      {google ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ busy: busy === 'google' }}
          disabled={busy !== null}
          onPress={() => run('google', signInWithGoogle)}
          style={styles.googleButton}>
          {busy === 'google' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <AntDesign name="google" size={18} color={colors.ink} />
              <Text style={styles.googleLabel}>Continue with Google</Text>
            </>
          )}
        </PressableScale>
      ) : null}

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
  appleButton: {
    height: 52,
  },
  busy: {
    position: 'absolute',
    right: 16,
    top: 16,
  },
  googleButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  googleLabel: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
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
