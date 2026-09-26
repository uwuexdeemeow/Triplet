import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { api, ApiError } from '@/api/client';
import { tripKeys, useLinks, usePlaces, useTrip } from '@/api/trips';
import { Button } from '@/components/button';
import { TimeField } from '@/components/date-time-field';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Muted } from '@/components/text';
import { TextField } from '@/components/text-field';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { parseAmount } from '@/trips/validation';
import { addMinutes, dayOfMonth, eachDay, formatShortDate, toActivityTime, todayString, weekdayShort } from '@/utils/dates';
import { detailsCredit, hoursOn, needsCheck } from '@/utils/places';

const schema = z
  .object({
    day: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    estimatedCost: z
      .string()
      .trim()
      .refine((value) => value === '' || parseAmount(value)! >= 0, { message: 'Enter an amount, like 1500' }),
  })
  .refine((values) => values.endTime >= values.startTime, {
    message: 'It can’t end before it starts',
    path: ['endTime'],
  });

type Values = z.infer<typeof schema>;

export default function AddPlaceScreen() {
  const { tripId, placeId } = useLocalSearchParams<{ tripId: string; placeId: string }>();
  const id = Number(tripId);
  const queryClient = useQueryClient();

  const trip = useTrip(id);
  const places = usePlaces(id);
  const links = useLinks(id);
  const place = places.data?.find((item) => item.id === Number(placeId));
  const link = links.data?.find((item) => item.id === place?.link_id);

  const days = trip.data?.start_date && trip.data.end_date ? eachDay(trip.data.start_date, trip.data.end_date) : [];
  const today = todayString();

  const { control, handleSubmit, setValue, getValues } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      day: days.includes(today) ? today : (trip.data?.start_date ?? ''),
      startTime: '12:00',
      endTime: '13:00',
      estimatedCost: '',
    },
  });
  // Falls back like the Plan tab if the trip hadn't loaded when the form opened
  const pickedDay = useWatch({ control, name: 'day' });
  const day = days.includes(pickedDay) ? pickedDay : days.includes(today) ? today : days[0];

  const addToPlan = useMutation({
    mutationFn: (values: Values) =>
      api(`/trips/${id}/links/${place!.link_id}/activity`, {
        method: 'POST',
        body: {
          // The backend fills in the title, address, notes and map pin from the place
          place_id: place!.id,
          start_time: toActivityTime(day, values.startTime),
          end_time: toActivityTime(day, values.endTime),
          estimated_cost: parseAmount(values.estimatedCost),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
      router.back();
    },
  });

  if (!place) {
    return (
      <Screen>
        <ScreenHeader title="Add to plan" icon="close" />
        {places.isPending ? (
          <ActivityIndicator color={colors.teal} style={styles.loading} />
        ) : (
          <FormMessage message="This place couldn’t be found. It may have been removed." />
        )}
      </Screen>
    );
  }

  const hours = day ? hoursOn(place, day) : null;
  const closed = hours === 'Closed';
  const credit = detailsCredit(place);
  const location = place.address ?? [place.city, place.country].filter(Boolean).join(', ');

  const errorMessage =
    addToPlan.error instanceof ApiError && addToPlan.error.status === 403
      ? 'Viewers can’t change the plan. Ask the trip owner to make you a member.'
      : (addToPlan.error?.message ?? null);

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title={place.name} icon="close" />

        <View style={styles.meta}>
          <View style={styles.chips}>
            {place.category ? (
              <View style={[styles.chip, styles.chipTeal]}>
                <Text style={[styles.chipText, styles.chipTealText]}>{capitalize(place.category)}</Text>
              </View>
            ) : null}
            {place.city ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{[place.city, place.country].filter(Boolean).join(', ')}</Text>
              </View>
            ) : null}
          </View>
          {link?.author_name ? <Muted>From @{link.author_name}</Muted> : null}
        </View>

        <View style={styles.locationCard}>
          <Feather name="map-pin" size={20} color={needsCheck(place) ? colors.coralText : colors.teal} />
          <View style={styles.locationText}>
            <Text style={styles.locationAddress}>{location || 'No address yet'}</Text>
            {needsCheck(place) ? (
              <Text style={styles.locationWarning}>We couldn’t confirm where this is. You can check it later.</Text>
            ) : null}
            {day && hours ? (
              <View style={styles.hoursRow}>
                <Feather name="clock" size={14} color={closed ? colors.coralText : colors.muted} />
                <Text style={[styles.hoursText, closed && styles.hoursClosed]}>
                  {closed ? `Closed on ${formatShortDate(day)}` : `Open ${formatShortDate(day)} · ${hours}`}
                </Text>
              </View>
            ) : place.hours_from_post ? (
              <View style={styles.hoursRow}>
                <Feather name="clock" size={14} color={colors.muted} />
                <Text style={styles.hoursText}>The post says: {place.hours_from_post}</Text>
              </View>
            ) : null}
            {credit ? <Text style={styles.credit}>{credit}</Text> : null}
          </View>
        </View>

        <FormMessage message={errorMessage} />

        <Controller
          control={control}
          name="day"
          render={({ field }) => (
            <View style={styles.field}>
              <Text style={styles.label}>Day</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
                {days.map((date) => {
                  const selected = date === day;
                  const closedThatDay = hoursOn(place, date) === 'Closed';
                  return (
                    <Pressable
                      key={date}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${formatShortDate(date)}${closedThatDay ? ', closed' : ''}`}
                      onPress={() => field.onChange(date)}
                      style={[styles.dayChip, selected && styles.dayChipSelected]}>
                      <Text style={[styles.dayName, selected && styles.dayNameSelected]}>{weekdayShort(date)}</Text>
                      <Text
                        style={[
                          styles.dayNumber,
                          selected && styles.dayNumberSelected,
                          closedThatDay && !selected && styles.dayNumberClosed,
                        ]}>
                        {dayOfMonth(date)}
                      </Text>
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
                  const [h1, m1] = field.value.split(':').map(Number);
                  const [h2, m2] = getValues('endTime').split(':').map(Number);
                  const length = h2 * 60 + m2 - (h1 * 60 + m1);
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
              hint={place.price_range ? `The post says: ${place.price_range}` : undefined}
              placeholder="e.g. 1500"
              keyboardType="decimal-pad"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Button
          label={day ? `Add to ${formatShortDate(day)}` : 'Add to plan'}
          loading={addToPlan.isPending}
          onPress={handleSubmit((values) => addToPlan.mutate(values))}
        />
      </View>
    </Screen>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  container: {
    gap: 18,
  },
  loading: {
    marginTop: spacing.xl,
  },
  meta: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: colors.muted,
  },
  chipTeal: {
    backgroundColor: colors.tealSoft,
  },
  chipTealText: {
    color: colors.teal,
  },
  locationCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
  },
  locationText: {
    flex: 1,
    gap: 4,
  },
  locationAddress: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  locationWarning: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.coralText,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hoursText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  hoursClosed: {
    fontFamily: fonts.bold,
    color: colors.coralText,
  },
  credit: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
  },
  field: {
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
  dayNumberClosed: {
    color: colors.coralText,
    textDecorationLine: 'line-through',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
});
