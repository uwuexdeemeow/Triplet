import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api } from '@/api/client';
import { tripKeys, type User } from '@/api/trips';
import { checkPassword } from '@/auth/password-strength';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { PasswordMeter } from '@/components/password-meter';
import { FormMessage } from '@/components/screen';
import { Muted } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type Panel = 'email' | 'password' | 'delete' | null;

/** Email, password and deleting the account. Each opens in place, one at a time. */
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
          action="Change"
          expanded={open === 'email'}
          onPress={() => toggle('email')}>
          <EmailForm user={user} onDone={() => setOpen(null)} />
        </Row>
        <Row
          label="Password"
          value="••••••••"
          action="Change"
          expanded={open === 'password'}
          onPress={() => toggle('password')}
          divider>
          <PasswordForm user={user} onDone={() => setOpen(null)} />
        </Row>
      </View>

      <DeleteAccount open={open === 'delete'} onToggle={() => toggle('delete')} />
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

// A new email only takes over once it's confirmed from its own inbox
function EmailForm({ user, onDone }: { user: User; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { email: string; current_password: string }) =>
      api<User>('/users/me', { method: 'PATCH', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.me, updated);
      onDone();
    },
    onError: (err) => setError(err.message),
  });

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
      <Button label="Send confirmation link" loading={save.isPending} onPress={submit} />
      <Muted>We’ll email a link to the new address. Your email only changes once you open it.</Muted>
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

// Everything goes: trips you own alone, your saves, photo and sign-ins. It can't be undone.
function DeleteAccount({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const [password, setPassword] = useState('');

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
      {open ? (
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
