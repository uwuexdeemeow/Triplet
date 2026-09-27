import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useItinerary, useTrip, type ItineraryActivity, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { TimeField } from '@/components/date-time-field';
import { LocationField, type Pin } from '@/components/location-field';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { activitySchema, parseAmount, type ActivityValues } from '@/trips/validation';
import { activityClock, addMinutes, dayOfMonth, eachDay, toActivityTime, weekdayShort } from '@/utils/dates';

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
    return (
      <Screen>
        <View style={styles.container}>
          <ScreenHeader title={title} icon="close" />
          <FormMessage message="This plan couldn’t be found. It may have been deleted." />
        </View>
      </Screen>
    );
  }

  if (!trip.data || (editing && !found)) {
    return (
      <Screen>
        <View style={styles.container}>
          <ScreenHeader title={title} icon="close" />
          {trip.isError ? (
            <FormMessage message={trip.error.message} />
          ) : (
            <ActivityIndicator color={colors.accent} style={styles.loading} />
          )}
        </View>
      </Screen>
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
  const id = trip.id;
  const queryClient = useQueryClient();
  const activity = existing?.activity;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tripDays = trip.start_date && trip.end_date ? eachDay(trip.start_date, trip.end_date) : [];
  // Keep a plan's own day selectable even if the trip's dates have since changed
  const days = existing && !tripDays.includes(existing.day) ? [...tripDays, existing.day].sort() : tripDays;

  const { control, handleSubmit, setValue, getValues } = useForm<ActivityValues>({
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
  const title = useWatch({ control, name: 'title' });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
    // Saved places know which plans they're in, and the budget counts plan costs
    queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(id) });
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
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title={activity ? 'Edit plan' : 'Add activity'} icon="close" />
        <FormMessage message={errorMessage} />

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

        <View style={styles.row}>
          <Controller
            control={control}
            name="startTime"
            render={({ field }) => (
              <TimeField
                label="From"
                value={field.value}
                onChange={(value) => {
                  // Keep the same length when the start moves, defaulting to an hour
                  const length = minutesBetween(field.value, getValues('endTime'));
                  field.onChange(value);
                  setValue('endTime', addMinutes(value, length > 0 ? length : 60));
                }}
              />
            )}
          />
          <Controller
            control={control}
            name="endTime"
            render={({ field, fieldState }) => (
              <TimeField label="To" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
        </View>

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

        <Button label={activity ? 'Save' : 'Add to plan'} loading={save.isPending} onPress={onSubmit} />

        {activity ? (
          confirmDelete ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>
                Delete {activity.title}?{activity.place_id != null ? ' The saved place stays in the Saved tab.' : ''}
              </Text>
              <View style={styles.confirmButtons}>
                <Button label="Keep" variant="secondary" onPress={() => setConfirmDelete(false)} style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  disabled={remove.isPending}
                  onPress={() => remove.mutate()}
                  style={[styles.deleteButton, styles.flex]}>
                  <Text style={styles.deleteLabel}>{remove.isPending ? 'Deleting…' : 'Delete'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={styles.deleteLink}>
              <Text style={styles.deleteLinkLabel}>Delete plan</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </Screen>
  );
}

function minutesBetween(start: string, end: string): number {
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };
  return toMinutes(end) - toMinutes(start);
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 20,
  },
  loading: {
    marginTop: spacing.xl,
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
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
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
