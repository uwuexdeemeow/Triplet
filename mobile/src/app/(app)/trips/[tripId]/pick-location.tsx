import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api } from '@/api/client';
import { tripKeys, usePlaces, useTrip } from '@/api/trips';
import { LocationPicker, type PickedLocation } from '@/components/location-picker';
import { colors } from '@/theme/tokens';

// Pins a saved place: the chosen spot is saved to the place straight away
export default function PickLocationScreen() {
  const { tripId, placeId } = useLocalSearchParams<{ tripId: string; placeId: string }>();
  const id = Number(tripId);
  const queryClient = useQueryClient();
  const trip = useTrip(id);
  const places = usePlaces(id);
  const place = places.data?.find((item) => item.id === Number(placeId));

  const save = useMutation({
    mutationFn: (location: PickedLocation) =>
      api(`/trips/${id}/places/${placeId}`, {
        method: 'PATCH',
        body: {
          latitude: location.latitude,
          longitude: location.longitude,
          // Only a search result comes with a trustworthy address for the new spot
          ...(location.address ? { address: location.address } : {}),
          ...(location.googlePlaceId ? { google_place_id: location.googlePlaceId } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.links(id) });
      router.back();
    },
  });

  if (!place) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.teal} />
      </View>
    );
  }

  return (
    <LocationPicker
      tripId={id}
      title={place.name}
      initialPin={place.latitude != null && place.longitude != null ? { latitude: place.latitude, longitude: place.longitude } : null}
      initialQuery={place.name}
      destination={trip.data?.destination}
      saving={save.isPending}
      error={save.error?.message ?? null}
      onConfirm={(location) => save.mutate(location)}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
  },
});
