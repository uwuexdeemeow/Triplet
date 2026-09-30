import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import type { GuestActivity, GuestTrip } from '@/api/guest';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { TimeRangeField } from '@/components/time-range-field';
import { makeStyles } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { activitySchema, parseAmount, type ActivityValues } from '@/trips/validation';
import { activityClock, dayOfMonth, eachDay, toActivityTime, weekdayShort } from '@/utils/dates';

type Props = {
  token: string;
  trip: GuestTrip;
  /** Editing this plan, on this day; left out, a new plan */
  existing?: { day: string; activity: GuestActivity };
  /** A new plan starts on this day */
  day?: string;
  /** Only when the owner shows costs to guests */
  showCosts: boolean;
  onDone: () => void;
  onCancel: () => void;
  /** The guest token stopped working */
  onExpired: () => void;
};

// Adding or changing a plan on a shared trip, for guests the owner lets edit. Simpler than the members'
// form: guests can't search places or drop pins, as those need an account.
export function GuestPlanForm({ token, trip, day, existing, showCosts, onDone, onCancel, onExpired }: Props) {
  const styles = useStyles();
  const activity = existing?.activity;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tripDays = trip.start_date && trip.end_date ? eachDay(trip.start_date, trip.end_date) : [];
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
          location: '',
          day: day ?? trip.start_date ?? '',
          startTime: '12:00',
          endTime: '13:00',
          estimatedCost: '',
        },
  });
  const [startTime, endTime] = useWatch({ control, name: ['startTime', 'endTime'] });

  const handleError = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) onExpired();
  };

  const save = useMutation({
    mutationFn: (values: ActivityValues) => {
      const body = {
        title: values.title.trim(),
        location: values.location.trim(),
        start_time: toActivityTime(values.day, values.startTime),
        end_time: toActivityTime(values.day, values.endTime),
        // Left out when costs are hidden, so a cost the guest can't see isn't cleared
        ...(showCosts ? { estimated_cost: parseAmount(values.estimatedCost) } : {}),
      };
      return activity
        ? api(`/guest/activities/${activity.id}`, { method: 'PATCH', body, token })
        : api('/guest/activities', { method: 'POST', body, token });
    },
    onSuccess: onDone,
    onError: handleError,
  });

  const remove = useMutation({
    mutationFn: () => api(`/guest/activities/${activity!.id}`, { method: 'DELETE', token }),
    onSuccess: onDone,
    onError: handleError,
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const error = save.error ?? remove.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'The trip owner has stopped guests changing the plan.'
      : error instanceof ApiError && error.status === 404
        ? 'This plan couldn’t be found. It may have been deleted.'
        : (error?.message ?? null);

  return (
    <View style={styles.container}>
      <Heading>{activity ? 'Edit plan' : 'Add a plan'}</Heading>
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
          <TextField
            label="Where"
            placeholder="e.g. Tokyo Tower"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
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

      {showCosts ? (
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
      ) : null}

      <View style={styles.buttons}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.flex} />
        <Button label={activity ? 'Save' : 'Add to plan'} loading={save.isPending} onPress={onSubmit} style={styles.flex} />
      </View>

      {activity ? (
        confirmDelete ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>Delete {activity.title} for everyone on the trip?</Text>
            <View style={styles.buttons}>
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
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
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
