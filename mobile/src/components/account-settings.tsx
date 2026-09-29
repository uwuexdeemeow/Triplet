import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api } from '@/api/client';
import { tripKeys, type User } from '@/api/trips';
import { checkPassword } from '@/auth/password-strength';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { CodeField } from '@/components/code-field';
import { PasswordMeter } from '@/components/password-meter';
import { FormMessage } from '@/components/screen';
import { Muted } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type Panel = 'email' | 'password' | null;

/** Email and password. Each opens in place, one at a time. */
export function AccountSettings({ user }: { user: User }) {
  const styles = useStyles();
  const [open, setOpen] = useState<Panel>(null);
  const toggle = (panel: Panel) => setOpen((current) => (current === panel ? null : panel));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Account</Text>
      <View style={styles.card}>
        <Row
          label="Email"
          value={user.email}
          detail={user.pending_email ? `Waiting for you to confirm ${user.pending_email}` : undefined}
          action={user.pending_email ? 'Enter code' : 'Change'}
          expanded={open === 'email'}
          onPress={() => toggle('email')}>
          <EmailForm user={user} onDone={() => setOpen(null)} />
        </Row>
        <Row
          label="Password"
          value={user.has_password ? '••••••••' : 'Not set: you sign in with Google or Apple'}
          action={user.has_password ? 'Change' : 'Set'}
          expanded={open === 'password'}
          onPress={() => toggle('password')}
          divider>
          {user.has_password ? (
            <PasswordForm user={user} onDone={() => setOpen(null)} />
          ) : (
            <SetPasswordForm user={user} onDone={() => setOpen(null)} />
          )}
        </Row>
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  detail,
  action,
  expanded,
  onPress,
  divider = false,
  children,
}: {
  label: string;
  value: string;
  detail?: string;
  action: string;
  expanded: boolean;
  onPress: () => void;
  divider?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.row, divider && styles.divider]}>
      <View style={styles.rowTop}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
          {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? `Cancel changing your ${label.toLowerCase()}` : `Change your ${label.toLowerCase()}`}
          accessibilityState={{ expanded }}
          onPress={onPress}
          style={styles.rowButton}>
          <Text style={styles.rowAction}>{expanded ? 'Cancel' : action}</Text>
        </Pressable>
      </View>
      {expanded ? <View style={styles.form}>{children}</View> : null}
    </View>
  );
}

// A new email only takes over once the code sent to it is entered here
function EmailForm({ user, onDone }: { user: User; onDone: () => void }) {
  const queryClient = useQueryClient();
  // Straight to the code if a change is already waiting for one
  const [step, setStep] = useState<'address' | 'code'>(user.pending_email ? 'code' : 'address');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { email: string; current_password: string }) =>
      api<User>('/users/me', { method: 'PATCH', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.me, updated);
      setPassword('');
      setStep('code');
    },
    onError: (err) => setError(err.message),
  });

  const confirm = useMutation({
    mutationFn: (value: string) => api<User>('/users/me/email/verify', { method: 'POST', body: { code: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.me, updated);
      // Member lists show emails
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
      onDone();
    },
    onError: (err) => setError(err.message),
  });

  // Changing the email is confirmed with the current password, so an account needs one first
  if (!user.has_password && step === 'address') {
    return <Muted>Changing your email needs a password, so nobody else can do it from your phone. Set one below first.</Muted>;
  }

  if (step === 'code') {
    const submitCode = () => {
      setError(null);
      if (code.length !== 6) return setError('Enter all 6 digits');
      confirm.mutate(code);
    };
    return (
      <>
        <Muted>
          We emailed a 6-digit code to {user.pending_email ?? 'your new address'}. Enter it here to switch. It works for
          15 minutes.
        </Muted>
        <CodeField value={code} onChangeText={setCode} onSubmit={submitCode} error={error} autoFocus />
        <Button label="Confirm new email" loading={confirm.isPending} onPress={submitCode} />
        <Button
          label="Send a new code, or use another address"
          variant="text"
          onPress={() => {
            setError(null);
            setCode('');
            setEmail(user.pending_email ?? '');
            setStep('address');
          }}
        />
      </>
    );
  }

  const submit = () => {
    const value = email.trim().toLowerCase();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setError('Enter a valid email, like sam@example.com');
    if (value === user.email.toLowerCase()) return setError('That’s already your email.');
    if (!password) return setError('Enter your current password.');
    save.mutate({ email: value, current_password: password });
  };

  return (
    <>
      <TextField
        label="New email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
      />
      <TextField
        label="Current password"
        hint="So nobody else can change it if you leave your phone unlocked."
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      <FormMessage message={error} />
      <Button label="Email me a code" loading={save.isPending} onPress={submit} />
      <Muted>We’ll email a code to the new address. Your email only changes once you enter it.</Muted>
    </>
  );
}

// Changing the password signs out every device, so sign this one straight back in
function PasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { signIn } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: async (body: { password: string; current_password: string }) => {
      await api<User>('/users/me', { method: 'PATCH', body });
      await signIn(user.email, body.password);
    },
    onSuccess: () => {
      setDone(true);
      setCurrent('');
      setNext('');
    },
    onError: (err) =>
      setError(
        err.message === 'Invalid credentials' ? 'That password is too easy to guess. Try adding another word or two.' : err.message,
      ),
  });

  const submit = () => {
    setError(null);
    setDone(false);
    if (!current) return setError('Enter your current password.');
    if (next.length < 8 || next.length > 64) return setError('Use 8 to 64 characters.');
    if (!checkPassword(next, user.name, user.email).strongEnough) {
      return setError('That password is too easy to guess. Try adding another word or two.');
    }
    save.mutate({ password: next, current_password: current });
  };

  if (done) {
    return (
      <>
        <FormMessage tone="success" message="Password changed. Your other devices have been signed out." />
        <Button label="Done" variant="secondary" onPress={onDone} />
      </>
    );
  }

  return (
    <>
      <TextField
        label="Current password"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        value={current}
        onChangeText={setCurrent}
      />
      <TextField
        label="New password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={next}
        onChangeText={setNext}
        onSubmitEditing={submit}
      />
      <PasswordMeter password={next} name={user.name} email={user.email} />
      <FormMessage message={error} />
      <Button label="Change password" loading={save.isPending} onPress={submit} />
    </>
  );
}

// Accounts made with Google or Apple start without a password. Setting one first takes a code sent
// to the account's email, so someone using a phone left unlocked can't give themselves a password.
function SetPasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sendCode = useMutation({
    mutationFn: () => api('/users/me/password/code', { method: 'POST' }),
    onSuccess: () => setSent(true),
    onError: (err) => setError(err.message),
  });

  const save = useMutation({
    mutationFn: (body: { code: string; password: string }) => api<User>('/users/me/password', { method: 'POST', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.me, updated);
      onDone();
    },
    onError: (err) =>
      setError(
        err.message === 'Invalid credentials' ? 'That password is too easy to guess. Try adding another word or two.' : err.message,
      ),
  });

  if (!sent) {
    return (
      <>
        <Muted>
          A password lets you sign in with your email too, and is needed to change your email or delete your account.
          We’ll email a code to {user.email} first to check it’s you.
        </Muted>
        <FormMessage message={error} />
        <Button label="Email me a code" loading={sendCode.isPending} onPress={() => sendCode.mutate()} />
      </>
    );
  }

  const submit = () => {
    setError(null);
    if (code.length !== 6) return setError('Enter all 6 digits from the email.');
    if (next.length < 8 || next.length > 64) return setError('Use 8 to 64 characters.');
    if (!checkPassword(next, user.name, user.email).strongEnough) {
      return setError('That password is too easy to guess. Try adding another word or two.');
    }
    save.mutate({ code, password: next });
  };

  return (
    <>
      <Muted>Enter the code we emailed to {user.email}. It works for 15 minutes.</Muted>
      <CodeField value={code} onChangeText={setCode} autoFocus />
      <TextField
        label="New password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={next}
        onChangeText={setNext}
        onSubmitEditing={submit}
      />
      <PasswordMeter password={next} name={user.name} email={user.email} />
      <FormMessage message={error} />
      <Button label="Set password" loading={save.isPending} onPress={submit} />
    </>
  );
}

// Everything goes: trips only you were on, your saves, photo and sign-ins. It can't be undone.
// Kept at the bottom of the profile, away from everyday settings.
export function DeleteAccount({ user }: { user: User }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const onToggle = () => setOpen((value) => !value);

  const remove = useMutation({
    mutationFn: () => api('/users/me', { method: 'DELETE', body: { password } }),
    onSuccess: () => signOut(),
  });

  return (
    <View style={styles.danger}>
      <Text style={styles.dangerTitle}>Delete account</Text>
      <Text style={styles.dangerText}>
        This removes your account, your photo and your place on every trip. Trips other people are on stay for them. It
        can’t be undone.
      </Text>
      {open && !user.has_password ? (
        <Muted>Deleting your account is confirmed with your password. Set one under Account above first.</Muted>
      ) : null}
      {open && user.has_password ? (
        <View style={styles.form}>
          <TextField
            label="Your password"
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            autoFocus
          />
          <FormMessage message={remove.error?.message ?? null} />
          <View style={styles.buttons}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setPassword('');
                onToggle();
              }}
              style={styles.flex}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !password || remove.isPending }}
              disabled={!password || remove.isPending}
              onPress={() => remove.mutate()}
              style={({ pressed }) => [styles.deleteButton, styles.flex, !password && styles.disabled, pressed && styles.pressed]}>
              {remove.isPending ? (
                <ActivityIndicator color={colors.onDanger} />
              ) : (
                <Text style={styles.deleteLabel}>Delete forever</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={onToggle} style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}>
          <Text style={styles.openLabel}>Delete my account…</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
  },
  row: {
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.muted,
  },
  rowValue: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
  },
  rowDetail: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.secondText,
  },
  rowButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  rowAction: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accent,
  },
  form: {
    gap: spacing.md,
  },
  danger: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  dangerTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.dangerText,
  },
  dangerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  openButton: {
    minHeight: 48,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.dangerText,
  },
  deleteButton: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.onDanger,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.75,
  },
}));
