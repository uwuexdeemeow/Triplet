import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useMe, useMembers, useTrip, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Muted } from '@/components/text';
import { TextField } from '@/components/text-field';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function TripSettingsScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const me = useMe();
  const members = useMembers(id);

  const role = members.data?.find((member) => member.user_id === me.data?.id)?.role;

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title="Trip settings" icon="close" />
        {!trip.data || !role ? (
          trip.isError ? (
            <FormMessage message={trip.error.message} />
          ) : (
            <ActivityIndicator color={colors.teal} style={styles.loading} />
          )
        ) : (
          <>
            {/* Owners and members can rename, viewers can only look */}
            {role === 'viewer' ? (
              <Muted>Viewers can’t change the trip. Ask the trip owner to make you a member.</Muted>
            ) : (
              <RenameTrip trip={trip.data} />
            )}
            {role === 'owner' ? <DeleteTrip trip={trip.data} /> : null}
          </>
        )}
      </View>
    </Screen>
  );
}

function RenameTrip({ trip }: { trip: Trip }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(trip.title);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rename = useMutation({
    mutationFn: (value: string) => api<Trip>(`/trips/${trip.id}`, { method: 'PATCH', body: { title: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.trip(trip.id), updated);
      // The trips list shows the name too
      queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
      setSaved(true);
    },
    onError: (err) => setError(err.message),
  });

  const submit = () => {
    const value = title.trim();
    setSaved(false);
    if (!value) {
      setError('Give the trip a name');
      return;
    }
    if (value.length > 255) {
      setError('Use at most 255 characters');
      return;
    }
    setError(null);
    rename.mutate(value);
  };

  const unchanged = title.trim() === trip.title;

  return (
    <View style={styles.section}>
      <TextField
        label="Trip name"
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          setSaved(false);
        }}
        onSubmitEditing={submit}
        returnKeyType="done"
        maxLength={255}
        error={error ?? undefined}
      />
      {saved ? <FormMessage tone="success" message="Saved. Everyone on the trip sees the new name." /> : null}
      <Button label="Save name" loading={rename.isPending} disabled={unchanged} onPress={submit} />
    </View>
  );
}

function DeleteTrip({ trip }: { trip: Trip }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const remove = useMutation({
    mutationFn: () => api(`/trips/${trip.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      // Leave the trip's screens before dropping its data, so nothing tries to reload it
      router.dismissTo('/');
      queryClient.removeQueries({ queryKey: tripKeys.trip(trip.id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
    },
  });

  // Deleting can't be undone, so the name has to be typed out first
  const matches = typed.trim().toLowerCase() === trip.title.trim().toLowerCase();
  const errorMessage =
    remove.error instanceof ApiError && remove.error.status === 403
      ? 'Only the trip’s owners can delete it.'
      : (remove.error?.message ?? null);

  return (
    <View style={styles.danger}>
      <Text style={styles.dangerTitle}>Delete trip</Text>
      <Text style={styles.dangerText}>
        This deletes the trip for everyone on it: its plan, saved posts and places, expenses and the list of people. It
        can’t be undone.
      </Text>

      {open ? (
        <View style={styles.confirm}>
          <TextField
            label={`Type “${trip.title}” to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <FormMessage message={errorMessage} />
          <View style={styles.buttons}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setOpen(false);
                setTyped('');
              }}
              style={styles.flex}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !matches || remove.isPending }}
              disabled={!matches || remove.isPending}
              onPress={() => remove.mutate()}
              style={({ pressed }) => [styles.deleteButton, styles.flex, !matches && styles.disabled, pressed && styles.pressed]}>
              {remove.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.deleteLabel}>Delete forever</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}>
          <Text style={styles.openLabel}>Delete this trip…</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  loading: {
    marginTop: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  danger: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.coral,
    backgroundColor: colors.coralSoft,
  },
  dangerTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.coralText,
  },
  dangerText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  confirm: {
    gap: spacing.md,
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
    borderColor: colors.coral,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.coralText,
  },
  deleteButton: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.white,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.75,
  },
});
