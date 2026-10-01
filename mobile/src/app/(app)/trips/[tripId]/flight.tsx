import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useFlights, useTrip, type Flight, type FlightDraft, type FlightDrafts, type Trip } from '@/api/trips';
import { AirportField, NO_AIRPORT, type AirportValue } from '@/components/airport-field';
import { Button } from '@/components/button';
import { DateField, TimeField } from '@/components/date-time-field';
import { FieldRow, FormActions, FormScreen, FormSection } from '@/components/form-layout';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { flightSchema, parseAmount, type FlightValues } from '@/trips/validation';
import { activityClock, activityDay, addDays, formatShortDate, toActivityTime } from '@/utils/dates';
import { pickAndReadTicket } from '@/utils/screenshot-upload';

type Params = {
  tripId: string;
  // Editing an existing flight
  flightId?: string;
  // Adding one from the plan: flying in on the first day, or home on the last
  kind?: 'arrival' | 'departure';
};

// Adds a flight, or edits one when opened with a flightId
export default function FlightScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<Params>();
  const id = Number(params.tripId);
  const trip = useTrip(id);
  const flights = useFlights(id);

  const editing = params.flightId !== undefined;
  const existing = editing ? flights.data?.find((flight) => flight.id === Number(params.flightId)) : undefined;
  const title = editing ? 'Edit flight' : 'Add a flight';

  if (editing && flights.isSuccess && !existing) {
    return <FormScreen title={title} message="This flight couldn’t be found. It may have been deleted." />;
  }

  if (!trip.data || (editing && !existing)) {
    const error = trip.error ?? flights.error;
    return (
      <FormScreen title={title} message={error?.message ?? null}>
        {error ? null : <ActivityIndicator color={colors.accent} style={styles.loading} />}
      </FormScreen>
    );
  }

  // Mounted once the data is here, so the fields start with the right values
  return <FlightForm trip={trip.data} existing={existing} kind={params.kind} title={title} />;
}

function airportOf(name: string | null | undefined, code: string | null | undefined, latitude?: number | null, longitude?: number | null): AirportValue {
  return { name: name ?? '', code: code ?? null, latitude: latitude ?? null, longitude: longitude ?? null };
}

function valuesFrom(draft: Flight | FlightDraft, fallbackDay: string): FlightValues {
  return {
    flightNumber: draft.flight_number ?? '',
    from: airportOf(draft.from_name, draft.from_code, draft.from_latitude, draft.from_longitude),
    departDate: draft.departs_at ? activityDay(draft.departs_at) : fallbackDay,
    departTime: draft.departs_at ? activityClock(draft.departs_at) : '09:00',
    to: airportOf(draft.to_name, draft.to_code, draft.to_latitude, draft.to_longitude),
    arriveDate: draft.arrives_at ? activityDay(draft.arrives_at) : fallbackDay,
    arriveTime: draft.arrives_at ? activityClock(draft.arrives_at) : '15:00',
    cost: draft.cost != null ? String(draft.cost) : '',
    confirmation: draft.confirmation ?? '',
  };
}

function bodyFrom(values: FlightValues, airline: string | null) {
  return {
    flight_number: values.flightNumber.trim() || null,
    airline,
    from_name: values.from.name.trim(),
    from_code: values.from.code,
    from_latitude: values.from.latitude,
    from_longitude: values.from.longitude,
    to_name: values.to.name.trim(),
    to_code: values.to.code,
    to_latitude: values.to.latitude,
    to_longitude: values.to.longitude,
    departs_at: toActivityTime(values.departDate, values.departTime),
    arrives_at: toActivityTime(values.arriveDate, values.arriveTime),
    cost: parseAmount(values.cost),
    confirmation: values.confirmation.trim() || null,
  };
}

// "SQ 634: SIN → HND, Wed 30 Sep 22:30"
function legSummary(draft: FlightDraft): string {
  const route = `${draft.from_code ?? draft.from_name ?? '?'} → ${draft.to_code ?? draft.to_name ?? '?'}`;
  const when = draft.departs_at ? `, ${formatShortDate(activityDay(draft.departs_at))} ${activityClock(draft.departs_at)}` : '';
  return `${draft.flight_number ? `${draft.flight_number}: ` : ''}${route}${when}`;
}

function FlightForm({
  trip,
  existing,
  kind,
  title,
}: {
  trip: Trip;
  existing: Flight | undefined;
  kind?: 'arrival' | 'departure';
  title: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const id = trip.id;
  const queryClient = useQueryClient();
  // An e-ticket with several flights, e.g. there and back
  const [ticket, setTicket] = useState<FlightDrafts | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [airline, setAirline] = useState<string | null>(existing?.airline ?? null);

  // Flying in lands on the first day; flying home leaves on the last
  const defaultDay = kind === 'departure' ? (trip.end_date ?? '') : (trip.start_date ?? '');
  const { control, handleSubmit, reset } = useForm<FlightValues>({
    resolver: zodResolver(flightSchema),
    defaultValues: existing
      ? valuesFrom(existing, defaultDay)
      : {
          flightNumber: '',
          from: NO_AIRPORT,
          departDate: defaultDay,
          departTime: kind === 'departure' ? '18:00' : '08:00',
          to: NO_AIRPORT,
          arriveDate: defaultDay,
          arriveTime: kind === 'departure' ? '23:00' : '14:00',
          cost: '',
          confirmation: '',
        },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.flights(id) });
    // Days start and end at the airports, and the budget counts the price
    queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(id) });
  };

  const fillFrom = (draft: FlightDraft) => {
    reset(valuesFrom(draft, defaultDay));
    setAirline(draft.airline ?? null);
  };

  const readTicket = useMutation({
    mutationFn: () => pickAndReadTicket(id),
    onSuccess: (drafts) => {
      if (!drafts) return;
      setNotes(drafts.notes ?? []);
      if (drafts.flights.length === 1) {
        setTicket(null);
        fillFrom(drafts.flights[0]);
      } else {
        setTicket(drafts);
      }
    },
  });

  // Every flight on the ticket at once, each as it was read
  const addAll = useMutation({
    mutationFn: async (drafts: FlightDraft[]) => {
      for (const draft of drafts) {
        await api(`/trips/${id}/flights`, { method: 'POST', body: bodyFrom(valuesFrom(draft, defaultDay), draft.airline ?? null) });
      }
    },
    onSuccess: () => {
      refresh();
      router.back();
    },
    // Some may have saved before one failed
    onError: refresh,
  });

  const save = useMutation({
    mutationFn: (values: FlightValues) => {
      const body = bodyFrom(values, airline);
      return existing
        ? api(`/trips/${id}/flights/${existing.id}`, { method: 'PATCH', body })
        : api(`/trips/${id}/flights`, { method: 'POST', body });
    },
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/trips/${id}/flights/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const error = save.error ?? remove.error ?? readTicket.error ?? addAll.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'Viewers can’t change the trip’s flights. Ask the trip owner to make you a member.'
      : (error?.message ?? null);

  // The two ends of the flight look the same: an airport, then a day and time on its clock
  const end = (side: 'from' | 'to') => {
    const date = side === 'from' ? 'departDate' : 'arriveDate';
    const time = side === 'from' ? 'departTime' : 'arriveTime';
    return (
      <View style={styles.end}>
        <Controller
          control={control}
          name={side}
          render={({ field, fieldState }) => (
            <AirportField
              tripId={id}
              label={side === 'from' ? 'From' : 'To'}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <View style={styles.when}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={date}
              render={({ field, fieldState }) => (
                <DateField
                  label={side === 'from' ? 'Leaves' : 'Lands'}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  // Flights out often leave the day before the trip starts
                  minimumDate={trip.start_date ? addDays(trip.start_date, -2) : undefined}
                />
              )}
            />
          </View>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={time}
              render={({ field }) => <TimeField label="Time there" value={field.value} onChange={field.onChange} />}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <FormScreen
      title={title}
      message={errorMessage}
      actions={
        <FormActions
          label={existing ? 'Save' : 'Add flight'}
          onSave={onSubmit}
          saving={save.isPending}
          remove={
            existing
              ? {
                  label: 'Remove flight',
                  question: 'Remove this flight?',
                  detail: 'Your plans stay.',
                  onConfirm: () => remove.mutate(),
                  pending: remove.isPending,
                  pendingLabel: 'Removing…',
                }
              : undefined
          }
        />
      }>
      {!existing ? (
        <FormSection title="Start from" description="Let Triplet read the flights off your e-ticket. A return ticket adds both.">
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Pick a screenshot of your e-ticket or booking, and Triplet fills in the flights"
            disabled={readTicket.isPending}
            onPress={() => readTicket.mutate()}
            style={({ pressed, hovered }) => [styles.starter, (pressed || hovered) && styles.starterActive]}>
            {readTicket.isPending ? <ActivityIndicator color={colors.accent} /> : <Feather name="image" size={18} color={colors.accent} />}
            <View style={styles.starterText}>
              <Text style={styles.starterTitle}>{readTicket.isPending ? 'Reading your ticket…' : 'Read an e-ticket screenshot'}</Text>
              <Text style={styles.starterDetail}>From the airline, a booking site or a confirmation email</Text>
            </View>
          </Pressable>

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

        {ticket ? (
          <View style={styles.ticket}>
            <Text style={styles.label}>{ticket.flights.length} flights on this ticket</Text>
            {ticket.flights.map((draft, index) => (
              <View key={index} style={styles.leg}>
                <Text style={styles.legText}>{legSummary(draft)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Fill in ${legSummary(draft)} below`}
                  hitSlop={6}
                  onPress={() => fillFrom(draft)}>
                  <Text style={styles.legAction}>Fill in</Text>
                </Pressable>
              </View>
            ))}
            <Button
              label={`Add all ${ticket.flights.length} flights`}
              loading={addAll.isPending}
              onPress={() => addAll.mutate(ticket.flights)}
            />
            <Text style={styles.hint}>Or fill one in below, check it, and add it on its own.</Text>
          </View>
        ) : null}
        </FormSection>
      ) : null}

      <FormSection title="Flight">
        <FieldRow columns={2}>
        <Controller
          control={control}
          name="flightNumber"
          render={({ field, fieldState }) => (
            <TextField
              label="Flight number (optional)"
              placeholder="e.g. SQ 638"
              autoCapitalize="characters"
              autoCorrect={false}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        </FieldRow>
      </FormSection>

      <FormSection title="Leaves" description="Pick the airport from the list, so the plan can find the way there.">
        {end('from')}
      </FormSection>

      <FormSection title="Lands">
        {end('to')}
        <Text style={styles.hint}>Times are each airport’s local time, as on your ticket.</Text>
      </FormSection>

      <FormSection title="Booking">
        <FieldRow>

        <Controller
          control={control}
          name="cost"
          render={({ field, fieldState }) => (
            <TextField
              label={`Price (optional, ${trip.currency})`}
              hint="For this flight, for everyone. It goes in the trip’s cost estimate."
              placeholder="e.g. 60000"
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
              placeholder="e.g. K7Q2LM"
              autoCapitalize="characters"
              autoCorrect={false}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        </FieldRow>
      </FormSection>
    </FormScreen>
  );
}

const useStyles = makeStyles((colors) => ({
  loading: {
    marginTop: spacing.xl,
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
  ticket: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  leg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  legText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
  },
  legAction: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.accent,
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
  end: {
    gap: spacing.md,
  },
  when: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
}));
