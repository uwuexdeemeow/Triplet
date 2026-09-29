import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';

import { api, ApiError, type Schemas } from '@/api/client';
import { tripKeys, useMe, useMembers, useTrip, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { DestinationField, type PickedDestination } from '@/components/destination-field';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Muted } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { parseAmount } from '@/trips/validation';
import { addDays, formatShortDate } from '@/utils/dates';

export default function TripSettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
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
            <ActivityIndicator color={colors.accent} style={styles.loading} />
          )
        ) : (
          <>
            {/* Owners and members can rename, viewers can only look */}
            {role === 'viewer' ? (
              <Muted>Viewers can’t change the trip. Ask the trip owner to make you a member.</Muted>
            ) : (
              <TripDetails trip={trip.data} />
            )}
            {role === 'owner' ? <GuestAccess trip={trip.data} /> : null}
            {role === 'owner' ? <DeleteTrip trip={trip.data} /> : null}
          </>
        )}
      </View>
    </Screen>
  );
}

// A trip made before trips had several places only has a name; it becomes the first bubble
function startingDestinations(trip: Trip): PickedDestination[] {
  if (trip.destinations?.length) return trip.destinations;
  return trip.destination ? [{ name: trip.destination }] : [];
}

// Whether the places differ from what's saved: names, their order, or a pin
function sameDestinations(a: PickedDestination[], b: PickedDestination[]) {
  const key = (list: PickedDestination[]) => JSON.stringify(list.map((d) => [d.name, d.address ?? null, d.latitude ?? null, d.longitude ?? null]));
  return key(a) === key(b);
}

// The name, places and budget, which owners and members can change
function TripDetails({ trip }: { trip: Trip }) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(trip.title);
  const [destinations, setDestinations] = useState<PickedDestination[]>(() => startingDestinations(trip));
  const [destinationText, setDestinationText] = useState('');
  const [budget, setBudget] = useState(trip.budget != null ? String(trip.budget) : '');
  const [errors, setErrors] = useState<{ title?: string; destinations?: string; budget?: string; form?: string }>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: { title: string; budget: number | null; destinations?: PickedDestination[] }) =>
      api<Trip>(`/trips/${trip.id}`, { method: 'PATCH', body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.trip(trip.id), updated);
      // The trips list shows the name, and the Budget tab the budget
      queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
      queryClient.invalidateQueries({ queryKey: tripKeys.budget(trip.id) });
      // Keep the pins the server looked up for places typed without a suggestion
      setDestinations(startingDestinations(updated));
      setSaved(true);
    },
    onError: (err) => setErrors({ form: err.message }),
  });

  const submit = () => {
    const value = title.trim();
    const amount = parseAmount(budget);
    // A place typed but not yet turned into a bubble counts too
    const typed = destinationText.trim();
    const places = typed ? [...destinations, { name: typed }] : destinations;
    if (typed) {
      setDestinations(places);
      setDestinationText('');
    }
    const next: typeof errors = {};
    if (!value) next.title = 'Give the trip a name';
    if (!places.length) next.destinations = 'Where are you going?';
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) next.budget = 'Enter an amount, like 150000';
    setErrors(next);
    setSaved(false);
    if (next.title || next.destinations || next.budget) return;
    // Only send the places when they changed, so unchanged ones aren't looked up again
    const placesChanged = !sameDestinations(places, startingDestinations(trip));
    save.mutate({
      title: value,
      budget: amount,
      ...(placesChanged
        ? { destinations: places.map(({ name, address, latitude, longitude, country_code }) => ({ name, address, latitude, longitude, country_code })) }
        : {}),
    });
  };

  const unchanged =
    title.trim() === trip.title &&
    parseAmount(budget) === (trip.budget ?? null) &&
    !destinationText.trim() &&
    sameDestinations(destinations, startingDestinations(trip));

  return (
    <View style={styles.section}>
      <FormMessage message={errors.form ?? null} />
      <TextField
        label="Trip name"
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          setSaved(false);
        }}
        returnKeyType="done"
        maxLength={255}
        error={errors.title}
      />
      <DestinationField
        label="Destinations"
        hint="Changing these changes where the map opens and which places come first when you search."
        value={destinations}
        onChange={(value) => {
          setDestinations(value);
          setSaved(false);
        }}
        text={destinationText}
        onChangeText={(value) => {
          setDestinationText(value);
          setSaved(false);
        }}
        error={errors.destinations}
      />
      <TextField
        label={`Budget (${trip.currency}, optional)`}
        hint="The Budget tab tracks spending against this. Leave it empty for no budget."
        placeholder="e.g. 150000"
        keyboardType="decimal-pad"
        value={budget}
        onChangeText={(value) => {
          setBudget(value);
          setSaved(false);
        }}
        onSubmitEditing={submit}
        error={errors.budget}
      />
      {saved ? <FormMessage tone="success" message="Saved. Everyone on the trip sees the change." /> : null}
      <Button label="Save changes" loading={save.isPending} disabled={unchanged} onPress={submit} />
    </View>
  );
}

type GuestAccessInfo = Schemas['GuestAccessResponse'];
type Expiry = 'never' | 'tripEnd' | 'week';

// When a guest code stops working, as the API's expires_at
function expiryDate(expiry: Expiry, trip: Trip): string | null {
  if (expiry === 'tripEnd' && trip.end_date) return `${addDays(trip.end_date, 1)}T00:00:00Z`;
  if (expiry === 'week') return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

// A code and PIN that let people without an account see the plan, but not change it
function GuestAccess({ trip }: { trip: Trip }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const key = ['trips', trip.id, 'guest-access'];
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [expiry, setExpiry] = useState<Expiry>(trip.end_date ? 'tripEnd' : 'never');
  const [pinError, setPinError] = useState<string | null>(null);
  // Only known right after it's set; the server keeps a hash
  const [newPin, setNewPin] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  const access = useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await api<GuestAccessInfo>(`/trips/${trip.id}/guest-access`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

  const save = useMutation({
    mutationFn: (body: { pin: string; expires_at: string | null }) =>
      api<GuestAccessInfo>(`/trips/${trip.id}/guest-access`, { method: 'PUT', body }),
    onSuccess: (updated, body) => {
      queryClient.setQueryData(key, updated);
      setNewPin(body.pin);
      setPin('');
      setEditing(false);
    },
  });

  const turnOff = useMutation({
    mutationFn: () => api(`/trips/${trip.id}/guest-access`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData(key, null);
      setNewPin(null);
    },
  });

  const submit = () => {
    if (!/^\d{4,12}$/.test(pin)) {
      setPinError('Use 4 to 12 digits');
      return;
    }
    setPinError(null);
    save.mutate({ pin, expires_at: expiryDate(expiry, trip) });
  };

  const share = (code: string) => {
    const lines = [
      `See our “${trip.title}” plan on Triplet: choose “View their trip” on the log in screen.`,
      `Code: ${code}`,
      newPin ? `PIN: ${newPin}` : 'I’ll send you the PIN separately.',
    ];
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  const current = access.data;
  const expired = current?.expires_at != null && new Date(current.expires_at).getTime() <= openedAt;
  const expiryOptions: { value: Expiry; label: string }[] = [
    ...(trip.end_date ? [{ value: 'tripEnd' as const, label: 'Until the trip ends' }] : []),
    { value: 'week', label: 'For a week' },
    { value: 'never', label: 'No end date' },
  ];

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Guest access</Text>
      <Muted>
        Share a code and PIN so people without Triplet can see the plan. They can’t change anything, and a new code
        stops the old one working.
      </Muted>

      {access.isPending ? (
        <ActivityIndicator color={colors.accent} />
      ) : access.isError ? (
        <FormMessage message={access.error.message} />
      ) : current && !editing ? (
        <View style={styles.guestCard}>
          <Text style={styles.guestLabel}>Trip code</Text>
          <Text selectable style={styles.guestCode}>
            {current.access_code}
          </Text>
          {newPin ? (
            <Text style={styles.guestMeta}>
              PIN <Text style={styles.guestPin}>{newPin}</Text>. Note it down, it won’t be shown again.
            </Text>
          ) : null}
          <Text style={[styles.guestMeta, expired && styles.guestExpired]}>
            {current.expires_at
              ? `${expired ? 'Stopped working' : 'Works until'} ${formatShortDate(current.expires_at.slice(0, 10))}`
              : 'Works until you turn it off'}
          </Text>
          <FormMessage message={turnOff.error?.message ?? null} />
          <Button label="Share code" onPress={() => share(current.access_code)} />
          <View style={styles.buttons}>
            <Button label="New code or PIN" variant="secondary" onPress={() => setEditing(true)} style={styles.flex} />
            <Button
              label="Turn off"
              variant="secondary"
              loading={turnOff.isPending}
              onPress={() => turnOff.mutate()}
              style={styles.flex}
            />
          </View>
        </View>
      ) : (
        <View style={styles.section}>
          <TextField
            label="PIN for guests"
            hint="4 to 12 digits. Guests need it with the code."
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            value={pin}
            onChangeText={setPin}
            onSubmitEditing={submit}
            error={pinError ?? undefined}
          />
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {expiryOptions.map((option) => {
              const selected = option.value === expiry;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setExpiry(option.value)}
                  style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <FormMessage message={save.error?.message ?? null} />
          <View style={styles.buttons}>
            {current ? (
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={styles.flex} />
            ) : null}
            <Button
              label={current ? 'Make new code' : 'Turn on guest access'}
              loading={save.isPending}
              onPress={submit}
              style={styles.flex}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function DeleteTrip({ trip }: { trip: Trip }) {
  const styles = useStyles();
  const { colors } = useTheme();
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
                <ActivityIndicator color={colors.onDanger} />
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

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.xl,
  },
  loading: {
    marginTop: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  guestCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  guestLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.muted,
  },
  guestCode: {
    fontFamily: fonts.bold,
    fontSize: 28,
    letterSpacing: 3,
    color: colors.ink,
  },
  guestMeta: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  guestPin: {
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  guestExpired: {
    color: colors.dangerText,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  chipSelected: {
    backgroundColor: colors.accent,
  },
  chipLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  chipLabelSelected: {
    color: colors.onAccent,
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
