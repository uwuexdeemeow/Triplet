import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useTrip } from '@/api/trips';
import { Button } from '@/components/button';
import { TimeField } from '@/components/date-time-field';
import { LocationField, type Pin } from '@/components/location-field';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { colors, fonts, spacing } from '@/theme/tokens';
import { activitySchema, parseAmount, type ActivityValues } from '@/trips/validation';
import { addMinutes, dayOfMonth, eachDay, toActivityTime, weekdayShort } from '@/utils/dates';

export default function AddActivityScreen() {
  // Opened from the map, it also gets the dropped pin and what's there
  const { tripId, day, latitude, longitude, location, address } = useLocalSearchParams<{
    tripId: string;
    day?: string;
    latitude?: string;
    longitude?: string;
    location?: string;
    address?: string;
  }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const queryClient = useQueryClient();

  const days = trip.data?.start_date && trip.data.end_date ? eachDay(trip.data.start_date, trip.data.end_date) : [];

  const { control, handleSubmit, setValue, getValues } = useForm<ActivityValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      title: '',
      location: location ?? '',
      day: day ?? trip.data?.start_date ?? '',
      startTime: '12:00',
      endTime: '13:00',
      estimatedCost: '',
    },
  });

  // Where the activity is on the map: from a suggestion or dropped on the map picker
  const [pin, setPin] = useState<Pin | null>(
    latitude && longitude ? { latitude: Number(latitude), longitude: Number(longitude), address: address || null } : null,
  );
  const title = useWatch({ control, name: 'title' });

  const addActivity = useMutation({
    mutationFn: (values: ActivityValues) =>
      api(`/trips/${id}/activities`, {
        method: 'POST',
        body: {
          title: values.title.trim(),
          location: values.location.trim(),
          start_time: toActivityTime(values.day, values.startTime),
          end_time: toActivityTime(values.day, values.endTime),
          estimated_cost: parseAmount(values.estimatedCost),
          latitude: pin?.latitude ?? null,
          longitude: pin?.longitude ?? null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
      router.back();
    },
  });

  const onSubmit = handleSubmit((values) => addActivity.mutate(values));

  const errorMessage =
    addActivity.error instanceof ApiError && addActivity.error.status === 403
      ? 'Viewers can’t change the plan. Ask the trip owner to make you a member.'
      : (addActivity.error?.message ?? null);

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title="Add activity" icon="close" />
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
              label={`Estimated cost (optional${trip.data?.currency ? `, ${trip.data.currency}` : ''})`}
              placeholder="e.g. 1500"
              keyboardType="decimal-pad"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Button label="Add to plan" loading={addActivity.isPending} onPress={onSubmit} />
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

const styles = StyleSheet.create({
  container: {
    gap: 20,
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
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipSelected: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  dayName: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.muted,
  },
  dayNameSelected: {
    color: colors.tealSoft,
  },
  dayNumber: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  dayNumberSelected: {
    color: colors.white,
  },
});
