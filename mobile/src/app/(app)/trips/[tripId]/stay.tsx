import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, usePlaces, useStays, useTrip, type Stay, type StayDraft, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { LocationField, type Pin } from '@/components/location-field';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { parseAmount, staySchema, type StayValues } from '@/trips/validation';
import { addDays, dayOfMonth, eachDay, formatShortDate, weekdayShort } from '@/utils/dates';
import { pickAndReadBooking } from '@/utils/screenshot-upload';

type Params = {
  tripId: string;
  // Editing an existing stay
  stayId?: string;
  // Adding one from a day in the plan: that night is the first
  checkIn?: string;
};

// Adds where the group sleeps for some nights, or edits it when opened with a stayId
export default function StayScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<Params>();
  const id = Number(params.tripId);
  const trip = useTrip(id);
  const stays = useStays(id);

  const editing = params.stayId !== undefined;
  const existing = editing ? stays.data?.find((stay) => stay.id === Number(params.stayId)) : undefined;
  const title = editing ? 'Edit stay' : 'Where are you staying?';

  if (editing && stays.isSuccess && !existing) {
    return (
      <Screen>
        <View style={styles.container}>
          <ScreenHeader title={title} icon="close" />
          <FormMessage message="This stay couldn’t be found. It may have been deleted." />
        </View>
      </Screen>
    );
  }

  if (!trip.data || !stays.data || (editing && !existing)) {
    const error = trip.error ?? stays.error;
    return (
      <Screen>
        <View style={styles.container}>
          <ScreenHeader title={title} icon="close" />
          {error ? <FormMessage message={error.message} /> : <ActivityIndicator color={colors.accent} style={styles.loading} />}
        </View>
      </Screen>
    );
  }

  // Mounted once the data is here, so the fields start with the right values
  return <StayForm trip={trip.data} stays={stays.data} existing={existing} firstNight={params.checkIn} title={title} />;
}

function StayForm({
  trip,
  stays,
  existing,
  firstNight,
  title,
}: {
  trip: Trip;
  stays: Stay[];
  existing: Stay | undefined;
  firstNight?: string;
  title: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const id = trip.id;
  const queryClient = useQueryClient();
  const places = usePlaces(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // What reading a booking found to check, e.g. a converted price
  const [notes, setNotes] = useState<string[]>([]);
  // The saved place it's made from, if one was picked
  const [placeId, setPlaceId] = useState<number | null>(existing?.place_id ?? null);

  const tripDays = trip.start_date && trip.end_date ? eachDay(trip.start_date, trip.end_date) : [];
  // You can check out the morning after the trip's last day
  const checkOutDays = tripDays.length ? [...tripDays.slice(1), addDays(tripDays[tripDays.length - 1], 1)] : [];
  // Nights other stays already have, so the chips can say so
  const takenNights = new Set(
    stays
      .filter((stay) => stay.id !== existing?.id)
      .flatMap((stay) => eachDay(stay.check_in, addDays(stay.check_out, -1))),
  );

  const { control, handleSubmit, setValue } = useForm<StayValues>({
    resolver: zodResolver(staySchema),
    defaultValues: existing
      ? {
          name: existing.name,
          checkIn: existing.check_in,
          checkOut: existing.check_out,
          cost: existing.cost != null ? String(existing.cost) : '',
          confirmation: existing.confirmation ?? '',
        }
      : {
          name: '',
          checkIn: firstNight ?? '',
          checkOut: firstNight ? addDays(firstNight, 1) : '',
          cost: '',
          confirmation: '',
        },
  });
  const [checkIn, checkOut, name] = useWatch({ control, name: ['checkIn', 'checkOut', 'name'] });
  const nights = checkIn && checkOut > checkIn ? eachDay(checkIn, addDays(checkOut, -1)).length : 0;

  const [pin, setPin] = useState<Pin | null>(() =>
    existing?.latitude != null && existing.longitude != null
      ? { latitude: existing.latitude, longitude: existing.longitude, address: existing.address ?? null }
      : null,
  );

  // Hotels saved from posts, to start from
  const savedHotels = (places.data ?? []).filter((place) => place.category === 'accommodation');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.stays(id) });
    // Days start and end at the stays, and the budget counts their price
    queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(id) });
  };

  const fillFrom = (draft: StayDraft) => {
    setPlaceId(null);
    if (draft.name) setValue('name', draft.name, { shouldValidate: true });
    if (draft.check_in) setValue('checkIn', draft.check_in);
    if (draft.check_out) setValue('checkOut', draft.check_out, { shouldValidate: true });
    if (draft.cost != null) setValue('cost', String(draft.cost));
    if (draft.confirmation) setValue('confirmation', draft.confirmation);
    setPin(
      draft.latitude != null && draft.longitude != null
        ? { latitude: draft.latitude, longitude: draft.longitude, address: draft.address ?? null }
        : null,
    );
    setNotes(draft.notes ?? []);
  };

  const readBooking = useMutation({
    mutationFn: () => pickAndReadBooking(id),
    onSuccess: (draft) => {
      if (draft) fillFrom(draft);
    },
  });

  const save = useMutation({
    mutationFn: (values: StayValues) => {
      const body = {
        name: values.name.trim(),
        address: pin?.address ?? null,
        latitude: pin?.latitude ?? null,
        longitude: pin?.longitude ?? null,
        check_in: values.checkIn,
        check_out: values.checkOut,
        cost: parseAmount(values.cost),
        confirmation: values.confirmation.trim() || null,
      };
      return existing
        ? api(`/trips/${id}/stays/${existing.id}`, { method: 'PATCH', body })
        : api(`/trips/${id}/stays`, { method: 'POST', body: { ...body, place_id: placeId } });
    },
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/trips/${id}/stays/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const error = save.error ?? remove.error ?? readBooking.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'Viewers can’t change where the trip stays. Ask the trip owner to make you a member.'
      : (error?.message ?? null);

  const dayChips = (days: string[], selected: string, onPick: (day: string) => void, isTaken: (day: string) => boolean) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
      {days.map((date) => {
        const isSelected = date === selected;
        const taken = isTaken(date);
        return (
          <Pressable
            key={date}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${formatShortDate(date)}${taken ? ', another stay has this night' : ''}`}
            onPress={() => onPick(date)}
            style={[styles.dayChip, taken && styles.dayChipTaken, isSelected && styles.dayChipSelected]}>
            <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>{weekdayShort(date)}</Text>
            <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>{dayOfMonth(date)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title={title} icon="close" />
        <FormMessage message={errorMessage} />

        {!existing ? (
          <View style={styles.starters}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Pick a screenshot of your booking confirmation, and Triplet fills in the hotel, dates and price"
              disabled={readBooking.isPending}
              onPress={() => readBooking.mutate()}
              style={({ pressed, hovered }) => [styles.starter, (pressed || hovered) && styles.starterActive]}>
              {readBooking.isPending ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Feather name="image" size={18} color={colors.accent} />
              )}
              <View style={styles.starterText}>
                <Text style={styles.starterTitle}>{readBooking.isPending ? 'Reading your booking…' : 'Read a booking screenshot'}</Text>
                <Text style={styles.starterDetail}>From Booking.com, Agoda, Airbnb or a confirmation email</Text>
              </View>
            </Pressable>

            {savedHotels.length ? (
              <View style={styles.savedField}>
                <Text style={styles.label}>Or pick a hotel you saved</Text>
                <View style={styles.savedHotels}>
                  {savedHotels.map((place) => {
                    const selected = placeId === place.id;
                    return (
                      <Pressable
                        key={place.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          setPlaceId(place.id);
                          setNotes([]);
                          setValue('name', place.name, { shouldValidate: true });
                          setPin(
                            place.latitude != null && place.longitude != null
                              ? { latitude: place.latitude, longitude: place.longitude, address: place.address ?? null }
                              : null,
                          );
                        }}
                        style={[styles.savedHotel, selected && styles.savedHotelSelected]}>
                        <Feather name="home" size={13} color={selected ? colors.onAccent : colors.muted} />
                        <Text style={[styles.savedHotelLabel, selected && styles.savedHotelLabelSelected]} numberOfLines={1}>
                          {place.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {notes.length ? (
          <View style={styles.notes}>
            {notes.map((note) => (
              <View key={note} style={styles.noteRow}>
                <Feather name="info" size={13} color={colors.secondText} />
                <Text style={styles.noteText}>{note}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <LocationField
              tripId={id}
              label="Hotel"
              placeholder="Start typing its name, e.g. Hotel Gracery"
              value={field.value}
              onChangeText={(text) => {
                // Typing a different hotel isn't the saved one any more
                setPlaceId(null);
                field.onChange(text);
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              pin={pin}
              onPinChange={setPin}
              title={name}
            />
          )}
        />

        {name.trim() && !pin ? (
          // A typed name alone can't be routed to: the maps app would guess, often somewhere else entirely
          <View style={styles.noPin}>
            <Feather name="alert-circle" size={13} color={colors.secondText} />
            <Text style={styles.noPinText}>
              No map pin yet. Pick a suggestion or choose on the map, so directions and travel times go to the right place.
            </Text>
          </View>
        ) : null}

        <Controller
          control={control}
          name="checkIn"
          render={({ field, fieldState }) => (
            <View style={styles.dayField}>
              <Text style={styles.label}>Check in</Text>
              {dayChips(
                tripDays,
                field.value,
                (day) => {
                  field.onChange(day);
                  // Keep at least one night
                  if (!checkOut || checkOut <= day) setValue('checkOut', addDays(day, 1), { shouldValidate: true });
                },
                (day) => takenNights.has(day),
              )}
              {fieldState.error ? <Text style={styles.error}>{fieldState.error.message}</Text> : null}
            </View>
          )}
        />

        <Controller
          control={control}
          name="checkOut"
          render={({ field, fieldState }) => (
            <View style={styles.dayField}>
              <Text style={styles.label}>Check out</Text>
              {dayChips(
                checkOutDays.filter((day) => !checkIn || day > checkIn),
                field.value,
                (day) => field.onChange(day),
                // Checking out that day means sleeping there the night before
                (day) => takenNights.has(addDays(day, -1)),
              )}
              {fieldState.error ? (
                <Text style={styles.error}>{fieldState.error.message}</Text>
              ) : nights ? (
                <Text style={styles.hint}>
                  {nights} {nights === 1 ? 'night' : 'nights'}: {formatShortDate(checkIn)} to {formatShortDate(checkOut)}
                </Text>
              ) : null}
            </View>
          )}
        />

        <Controller
          control={control}
          name="cost"
          render={({ field, fieldState }) => (
            <TextField
              label={`Total price (optional, ${trip.currency})`}
              hint="For all the nights. It goes in the trip’s cost estimate."
              placeholder="e.g. 45000"
              keyboardType="decimal-pad"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="confirmation"
          render={({ field, fieldState }) => (
            <TextField
              label="Booking reference (optional)"
              hint="Only people on the trip see it, not guests."
              placeholder="e.g. 4471.882.019"
              autoCapitalize="characters"
              autoCorrect={false}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Button label={existing ? 'Save' : 'Add stay'} loading={save.isPending} onPress={onSubmit} />

        {existing ? (
          confirmDelete ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>
                Remove {existing.name}? Your plans stay; the days just won’t start and end there.
              </Text>
              <View style={styles.confirmButtons}>
                <Button label="Keep" variant="secondary" onPress={() => setConfirmDelete(false)} style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  disabled={remove.isPending}
                  onPress={() => remove.mutate()}
                  style={[styles.deleteButton, styles.flex]}>
                  <Text style={styles.deleteLabel}>{remove.isPending ? 'Removing…' : 'Remove'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={styles.deleteLink}>
              <Text style={styles.deleteLinkLabel}>Remove stay</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 20,
  },
  loading: {
    marginTop: spacing.xl,
  },
  starters: {
    gap: spacing.lg,
  },
  starter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentMuted,
  },
  starterActive: {
    backgroundColor: colors.accentSoft,
  },
  starterText: {
    flex: 1,
    gap: 2,
  },
  starterTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.accent,
  },
  starterDetail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  savedField: {
    gap: spacing.sm,
  },
  savedHotels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  savedHotel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  savedHotelSelected: {
    backgroundColor: colors.accent,
  },
  savedHotelLabel: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  savedHotelLabelSelected: {
    color: colors.onAccent,
  },
  notes: {
    gap: 6,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.secondSoft,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  noteText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondText,
  },
  noPin: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: -12,
  },
  noPinText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondText,
  },
  dayField: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.dangerText,
  },
  days: {
    gap: spacing.sm,
  },
  dayChip: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Another stay has this night: still pickable, so a mistake there can be fixed by editing it
  dayChipTaken: {
    opacity: 0.45,
  },
  dayChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    opacity: 1,
  },
  dayName: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.muted,
  },
  dayNameSelected: {
    color: colors.accentSoft,
  },
  dayNumber: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  dayNumberSelected: {
    color: colors.onAccent,
  },
  confirm: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  confirmText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.dangerText,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
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
    fontSize: 17,
    color: colors.onDanger,
  },
  deleteLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLinkLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.dangerText,
  },
}));
