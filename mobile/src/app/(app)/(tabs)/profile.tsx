import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useMe, type User } from '@/api/trips';
import { useSession } from '@/auth/session';
import { nameSchema } from '@/auth/validation';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading, Muted, Title } from '@/components/text';
import { TextField } from '@/components/text-field';
import type { ThemePreference } from '@/theme/preference';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const me = useMe();

  // Revokes every refresh token for the account, then signs out here too
  const signOutEverywhere = useMutation({
    mutationFn: () => api('/auth/logout-all', { method: 'POST' }),
    onSuccess: () => signOut(),
  });

  return (
    <Screen>
      <View style={styles.container}>
        <Heading>Profile</Heading>

        <View style={styles.card}>
          {me.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : me.isError ? (
            <FormMessage message={me.error.message} />
          ) : (
            <NameEditor user={me.data} />
          )}
        </View>

        <AppearancePicker />

        <View style={styles.actions}>
          <Button label="Log out" variant="secondary" onPress={signOut} />
          <Button
            label="Log out on all devices"
            variant="text"
            loading={signOutEverywhere.isPending}
            onPress={() => signOutEverywhere.mutate()}
          />
          <FormMessage message={signOutEverywhere.error?.message ?? null} />
        </View>

        <Body style={styles.note}>Changing your email and photo comes later.</Body>
      </View>
    </Screen>
  );
}

// Your name is what friends see on the trip's People tab
function NameEditor({ user }: { user: User }) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (value: string) => api<User>('/users/me', { method: 'PATCH', body: { name: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.me, updated);
      // Member lists show names, so refresh every trip's copy
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
      setEditing(false);
    },
    onError: (err) =>
      setError(err instanceof ApiError && err.status === 422 ? 'Use letters and numbers only, no spaces' : err.message),
  });

  const submit = () => {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your name');
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  };

  if (!editing) {
    return (
      <View style={styles.nameRow}>
        <View style={styles.nameText}>
          <Title>{user.name}</Title>
          <Muted>{user.email}</Muted>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your name"
          onPress={() => {
            setName(user.name);
            setError(null);
            setEditing(true);
          }}
          style={styles.editButton}>
          <Text style={styles.editLabel}>Edit</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <TextField
        label="Name"
        hint="Letters and numbers only. Friends see this on your trips."
        autoFocus
        autoCapitalize="none"
        returnKeyType="done"
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        error={error ?? undefined}
      />
      <View style={styles.editorButtons}>
        <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={styles.flex} />
        <Button label="Save" loading={save.isPending} onPress={submit} style={styles.flex} />
      </View>
    </View>
  );
}

const APPEARANCES: { value: ThemePreference; label: string; icon: ComponentProps<typeof Feather>['name'] }[] = [
  { value: 'system', label: 'Match phone', icon: 'smartphone' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

// Light, dark, or whatever the phone (or browser) is set to
function AppearancePicker() {
  const styles = useStyles();
  const { colors, preference, setPreference } = useTheme();

  return (
    <View style={styles.appearance}>
      <Text style={styles.appearanceLabel}>Appearance</Text>
      <View accessibilityRole="radiogroup" style={styles.segments}>
        {APPEARANCES.map(({ value, label, icon }) => {
          const selected = preference === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setPreference(value)}
              style={[styles.segment, selected && styles.segmentSelected]}>
              <Feather name={icon} size={16} color={selected ? colors.ink : colors.muted} />
              <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  appearance: {
    gap: spacing.sm,
  },
  appearanceLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  segments: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.chip,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: radii.input - 2,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  segmentLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  segmentLabelSelected: {
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  container: {
    gap: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: 4,
  },
  actions: {
    gap: spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  nameText: {
    flex: 1,
    gap: 4,
  },
  editButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  editLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accent,
  },
  editor: {
    gap: spacing.md,
  },
  editorButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  note: {
    color: colors.muted,
    fontSize: 14,
  },
}));
