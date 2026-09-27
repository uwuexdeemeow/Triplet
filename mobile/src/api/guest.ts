import { useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import type { Itinerary, Trip } from '@/api/trips';

// A guest token only opens one trip, so these endpoints don't take a trip id
export const guestKeys = {
  trip: ['guest', 'trip'] as const,
  itinerary: ['guest', 'itinerary'] as const,
};

export function useGuestTrip() {
  return useQuery({
    queryKey: guestKeys.trip,
    queryFn: () => api<Trip>('/guest/trip'),
  });
}

export function useGuestItinerary() {
  return useQuery({
    queryKey: guestKeys.itinerary,
    queryFn: () => api<Itinerary>('/guest/itinerary'),
  });
}
