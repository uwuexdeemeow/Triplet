import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { tripKeys, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { DateField } from '@/components/date-time-field';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { spacing } from '@/theme/tokens';
import { addDays, todayString } from '@/utils/dates';
import { parseAmount, tripSchema, type TripValues } from '@/trips/validation';

export default function NewTripScreen() {
  const queryClient = useQueryClient();
  const today = todayString();

  const { control, handleSubmit, setValue, getValues } = useForm<TripValues>({
    resolver: zodResolver(tripSchema),
    defaultValues: {
      title: '',
      destination: '',
      startDate: addDays(today, 7),
      endDate: addDays(today, 11),
      budget: '',
      currency: 'USD',
    },
  });

  // The end date picker can't go before the chosen start date
  const startDate = useWatch({ control, name: 'startDate' });

  const createTrip = useMutation({
    mutationFn: (values: TripValues) =>
      api<Trip>('/trips', {
        method: 'POST',
        body: {
          title: values.title.trim(),
          destination: values.destination.trim(),
          start_date: values.startDate,
          end_date: values.endDate,
          budget: parseAmount(values.budget),
          currency: values.currency.trim().toUpperCase(),
        },
      }),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
      // Replace the form so Back from the new trip goes to the list, not the form
      router.replace({ pathname: '/trips/[tripId]', params: { tripId: String(trip.id) } });
    },
  });

  const onSubmit = handleSubmit((values) => createTrip.mutate(values));

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title="New trip" icon="close" />
        <FormMessage message={createTrip.error?.message ?? null} />

        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="Trip name"
              placeholder="e.g. Tokyo with friends"
              returnKeyType="next"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="destination"
          render={({ field, fieldState }) => (
            <TextField
              label="Destination"
              hint="Also used to find the right places when you save TikToks"
              placeholder="e.g. Tokyo"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <View style={styles.row}>
          <Controller
            control={control}
            name="startDate"
            render={({ field }) => (
              <DateField
                label="From"
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  // Keep the end date on or after the new start date
                  if (getValues('endDate') < value) setValue('endDate', value);
                }}
              />
            )}
          />
          <Controller
            control={control}
            name="endDate"
            render={({ field, fieldState }) => (
              <DateField
                label="To"
                value={field.value}
                minimumDate={startDate}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.budget}>
            <Controller
              control={control}
              name="budget"
              render={({ field, fieldState }) => (
                <TextField
                  label="Budget (optional)"
                  placeholder="e.g. 150000"
                  keyboardType="decimal-pad"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
          <View style={styles.currency}>
            <Controller
              control={control}
              name="currency"
              render={({ field, fieldState }) => (
                <TextField
                  label="Currency"
                  autoCapitalize="characters"
                  maxLength={3}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          </View>
        </View>

        <Button label="Create trip" loading={createTrip.isPending} onPress={onSubmit} />
      </View>
    </Screen>
  );
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
  budget: {
    flex: 2,
  },
  currency: {
    flex: 1,
  },
});
