import { router, useLocalSearchParams } from 'expo-router';

import { useTrip } from '@/api/trips';
import { LocationPicker } from '@/components/location-picker';
import { mainDestination } from '@/trips/destinations';
import { setPickedLocation } from '@/utils/picked-location';

// Chooses where an activity happens. Nothing is saved here: the activity form picks the spot up.
export default function PickActivityLocationScreen() {
  const { tripId, query, title, latitude, longitude } = useLocalSearchParams<{
    tripId: string;
    query?: string;
    title?: string;
    latitude?: string;
    longitude?: string;
  }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const hasPin = latitude !== undefined && longitude !== undefined && latitude !== '' && longitude !== '';

  return (
    <LocationPicker
      tripId={id}
      title={title || query || 'Where is it?'}
      initialPin={hasPin ? { latitude: Number(latitude), longitude: Number(longitude) } : null}
      initialQuery={query ?? ''}
      destination={mainDestination(trip.data)}
      onConfirm={(location) => {
        setPickedLocation(location);
        router.back();
      }}
    />
  );
}
