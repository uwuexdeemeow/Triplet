import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { api, type Schemas } from '@/api/client';
import { tripKeys, type Trip } from '@/api/trips';
import { Button } from '@/components/button';
import { CurrencyField } from '@/components/currency-field';
import { DateField } from '@/components/date-time-field';
import { DestinationField } from '@/components/destination-field';
import { TripMap } from '@/components/place-map';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { TextField } from '@/components/text-field';
import { radii, spacing } from '@/theme/tokens';
import { addDays, todayString } from '@/utils/dates';
import { parseAmount, tripSchema, type TripValues } from '@/trips/validation';

export default function NewTripScreen() {
  const queryClient = useQueryClient();
  const today = todayString();

  const { control, handleSubmit, setValue, getValues } = useForm<TripValues>({
    resolver: zodResolver(tripSchema),
    defaultValues: {
      title: '',
      destinations: [],
      startDate: addDays(today, 7),
      endDate: addDays(today, 11),
      budget: '',
      currency: 'USD',
    },
  });

  // The end date picker can't go before the chosen start date
  const startDate = useWatch({ control, name: 'startDate' });

  const destinations = useWatch({ control, name: 'destinations' });
  // A place typed but not yet turned into a bubble; creating the trip adds it
  const [destinationText, setDestinationText] = useState('');

  // The first place's currency, e.g. JPY for Tokyo. A picked suggestion comes with it; a place
  // typed as is gets looked up.
  const first = destinations[0];
  const localCurrency = useQuery({
    queryKey: ['trips', 'currency', first?.name.toLowerCase() ?? ''],
    queryFn: () => api<Schemas['CurrencySuggestion']>('/trips/currency', { query: { destination: first!.name } }),
    enabled: !!first && !first.currency,
    staleTime: Infinity,
    retry: false,
  });
  const suggestedCurrency = first?.currency ?? localCurrency.data?.currency ?? null;

  // Show every place picked so far on a small map
  const pins = destinations.flatMap((place) =>
    place.latitude != null && place.longitude != null ? [{ latitude: place.latitude, longitude: place.longitude }] : [],
  );

  // Follow the destination until the user picks a currency themselves
  const pickedCurrency = useRef(false);
  useEffect(() => {
    if (suggestedCurrency && !pickedCurrency.current) setValue('currency', suggestedCurrency, { shouldValidate: true });
  }, [suggestedCurrency, setValue]);

  const createTrip = useMutation({
    mutationFn: (values: TripValues) =>
      api<Trip>('/trips', {
        method: 'POST',
        body: {
          title: values.title.trim(),
          destinations: values.destinations.map(({ name, address, latitude, longitude, country_code }) => ({
            name,
            address,
            latitude,
            longitude,
            country_code,
          })),
          start_date: values.startDate,
          end_date: values.endDate,
          budget: parseAmount(values.budget),
          currency: values.currency,
        },
      }),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
      // Replace the form so Back from the new trip goes to the list, not the form
      router.replace({ pathname: '/trips/[tripId]', params: { tripId: String(trip.id) } });
    },
  });

  const onSubmit = () => {
    const typed = destinationText.trim();
    if (typed) {
      setValue('destinations', [...getValues('destinations'), { name: typed }], { shouldValidate: true });
      setDestinationText('');
    }
    handleSubmit((values) => createTrip.mutate(values))();
  };

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
          name="destinations"
          render={({ field, fieldState }) => (
            <DestinationField
              label="Destinations"
              hint="Going to more than one place? Add each one. They help find the right places when you save TikToks."
              value={field.value}
              onChange={field.onChange}
              text={destinationText}
              onChangeText={setDestinationText}
              error={fieldState.error?.message}
            />
          )}
        />

        {pins.length ? (
          // Just a preview: the trip's own map is the one to explore
          <View style={styles.map} pointerEvents="none" accessibilityLabel={`Map of ${destinations.map((place) => place.name).join(', ')}`}>
            <TripMap places={[]} selectedId={null} onSelect={() => {}} fallbackArea={pins} compact />
          </View>
        ) : null}

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
                <CurrencyField
                  label="Currency"
                  value={field.value}
                  onChange={(code) => {
                    pickedCurrency.current = true;
                    field.onChange(code);
                  }}
                  suggested={suggestedCurrency}
                  suggestedFor={first?.name}
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
  map: {
    height: 180,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
});
