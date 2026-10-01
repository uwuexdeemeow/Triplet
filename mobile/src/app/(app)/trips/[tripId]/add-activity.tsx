import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useItinerary, useTrip, type ItineraryActivity, type Trip } from '@/api/trips';
import { TimeRangeField } from '@/components/time-range-field';
import { LocationField, type Pin } from '@/components/location-field';
import { FieldRow, FormActions, FormScreen, FormSection } from '@/components/form-layout';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';
import { activitySchema, parseAmount, type ActivityValues } from '@/trips/validation';
import { activityClock, dayOfMonth, eachDay, toActivityTime, weekdayShort } from '@/utils/dates';

type Params = {
  tripId: string;
  // Editing an existing plan
  activityId?: string;
  day?: string;
  // Opened from the map, it also gets the dropped pin and what's there
  latitude?: string;
  longitude?: string;
  location?: string;
  address?: string;
};

// Adds a plan, or edits one when opened with an activityId
export default function ActivityScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<Params>();
  const id = Number(params.tripId);
  const trip = useTrip(id);
  const itinerary = useItinerary(id);

  const editing = params.activityId !== undefined;
  const found = editing
    ? itinerary.data?.days
        .map((day) => ({ day: day.date, activity: day.activities.find((item) => item.id === Number(params.activityId)) }))
        .find((match) => match.activity)
    : undefined;

  const title = editing ? 'Edit plan' : 'Add activity';

  if (editing && itinerary.isSuccess && !found) {
    return <FormScreen title={title} message="This plan couldn’t be found. It may have been deleted." />;
  }

  if (!trip.data || (editing && !found)) {
    return (
      <FormScreen title={title} message={trip.isError ? trip.error.message : null}>
        {trip.isError ? null : <ActivityIndicator color={colors.accent} style={styles.loading} />}
      </FormScreen>
    );
  }

  // Mounted once the data is here, so the fields start with the right values
  return <ActivityForm trip={trip.data} params={params} existing={found as { day: string; activity: ItineraryActivity } | undefined} />;
}

function ActivityForm({
  trip,
  params,
  existing,
}: {
  trip: Trip;
  params: Params;
  existing: { day: string; activity: ItineraryActivity } | undefined;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const id = trip.id;
  const queryClient = useQueryClient();
  const activity = existing?.activity;

  const tripDays = trip.start_date && trip.end_date ? eachDay(trip.start_date, trip.end_date) : [];
  // Keep a plan's own day selectable even if the trip's dates have since changed
  const days = existing && !tripDays.includes(existing.day) ? [...tripDays, existing.day].sort() : tripDays;

  const { control, handleSubmit, setValue } = useForm<ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: activity
      ? {
          title: activity.title,
          location: activity.location,
          day: existing!.day,
          startTime: activityClock(activity.start_time),
          endTime: activityClock(activity.end_time),
          estimatedCost: activity.estimated_cost != null ? String(activity.estimated_cost) : '',
        }
      : {
          title: '',
          location: params.location ?? '',
          day: params.day ?? trip.start_date ?? '',
          startTime: '12:00',
          endTime: '13:00',
          estimatedCost: '',
        },
  });

  // Where the activity is on the map: from a suggestion or dropped on the map picker
  const [pin, setPin] = useState<Pin | null>(() => {
    if (activity?.latitude != null && activity.longitude != null) {
      return { latitude: activity.latitude, longitude: activity.longitude, address: null };
    }
    if (!activity && params.latitude && params.longitude) {
      return { latitude: Number(params.latitude), longitude: Number(params.longitude), address: params.address || null };
    }
    return null;
  });
  const [title, location] = useWatch({ control, name: ['title', 'location'] });
  const [startTime, endTime] = useWatch({ control, name: ['startTime', 'endTime'] });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
    // Saved places know which plans they're in, and the budget counts plan costs
    queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(id) });
    // Deleting a plan unlinks its expenses
    queryClient.invalidateQueries({ queryKey: tripKeys.expenses(id) });
  };

  const save = useMutation({
    mutationFn: (values: ActivityValues) => {
      const body = {
        title: values.title.trim(),
        location: values.location.trim(),
        start_time: toActivityTime(values.day, values.startTime),
        end_time: toActivityTime(values.day, values.endTime),
        estimated_cost: parseAmount(values.estimatedCost),
        latitude: pin?.latitude ?? null,
        longitude: pin?.longitude ?? null,
      };
      return activity
        ? api(`/trips/${id}/activities/${activity.id}`, { method: 'PATCH', body })
        : api(`/trips/${id}/activities`, { method: 'POST', body });
    },
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/trips/${id}/activities/${activity!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const error = save.error ?? remove.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'Viewers can’t change the plan. Ask the trip owner to make you a member.'
      : (error?.message ?? null);

  return (
    <FormScreen
      title={activity ? 'Edit plan' : 'Add activity'}
      message={errorMessage}
      actions={
        <FormActions
          label={activity ? 'Save' : 'Add to plan'}
          onSave={onSubmit}
          saving={save.isPending}
          remove={
            activity
              ? {
                  label: 'Delete plan',
                  question: `Delete ${activity.title}?`,
                  detail: activity.place_id != null ? 'The saved place stays in the Saved tab.' : undefined,
                  onConfirm: () => remove.mutate(),
                  pending: remove.isPending,
                }
              : undefined
          }
        />
      }>
      <FormSection title="What and where" description="Pick the place from the suggestions or the map, so travel times work.">
        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="What"
              placeholder="e.g. Lunch at Menya Itto"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="location"
          render={({ field, fieldState }) => (
            <LocationField
              tripId={id}
              label="Where"
              placeholder="Start typing a place, e.g. Tokyo Tower"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              pin={pin}
              onPinChange={setPin}
              title={title}
            />
          )}
        />

        {location.trim() && !pin ? (
          // A typed name alone can't be routed to: the maps app would guess, often somewhere else entirely
          <View style={styles.noPin}>
            <Feather name="alert-circle" size={13} color={colors.secondText} />
            <Text style={styles.noPinText}>
              No map pin yet. Pick a suggestion or choose on the map, so directions and travel times go to the right place.
            </Text>
          </View>
        ) : null}
      </FormSection>

      <FormSection title="Day and time">
        <Controller
          control={control}
          name="day"
          render={({ field }) => (
            <View style={styles.dayField}>
              <Text style={styles.label}>Day</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
                {days.map((date) => {
                  const selected = date === field.value;
                  return (
                    <Pressable
                      key={date}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => field.onChange(date)}
                      style={[styles.dayChip, selected && styles.dayChipSelected]}>
                      <Text style={[styles.dayName, selected && styles.dayNameSelected]}>{weekdayShort(date)}</Text>
                      <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{dayOfMonth(date)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        />

        <Controller
          control={control}
          name="endTime"
          render={({ fieldState }) => (
            <TimeRangeField
              start={startTime}
              end={endTime}
              onChange={(nextStart, nextEnd) => {
                setValue('startTime', nextStart, { shouldDirty: true });
                setValue('endTime', nextEnd, { shouldDirty: true, shouldValidate: true });
              }}
              error={fieldState.error?.message}
            />
          )}
        />

      </FormSection>

      <FormSection title="Cost" description="Roughly, for the whole group. It goes in the trip’s cost estimate.">
        <FieldRow columns={2}>
        <Controller
          control={control}
          name="estimatedCost"
          render={({ field, fieldState }) => (
            <TextField
              label={`Estimated cost (optional, ${trip.currency})`}
              placeholder="e.g. 1500"
              keyboardType="decimal-pad"
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
  dayChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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
}));
