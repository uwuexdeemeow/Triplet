import { useQuery } from '@tanstack/react-query';

import { api, type Schemas } from '@/api/client';

export type GuestTrip = Schemas['TripResponse'];
export type GuestItinerary = Schemas['GuestItineraryResponse'];
export type GuestActivity = GuestItinerary['days'][number]['activities'][number];
export type GuestLookup = Schemas['GuestLookup'];

// A guest's token only opens one trip, and belongs to the page that got it, not to the session
export const guestKeys = {
  lookup: (code: string) => ['guest', code, 'lookup'] as const,
  trip: (code: string) => ['guest', code, 'trip'] as const,
  itinerary: (code: string) => ['guest', code, 'itinerary'] as const,
};

// Which trip a code is for (its title only), so the page can ask for the PIN by name
export function useGuestLookup(code: string) {
  return useQuery({
    queryKey: guestKeys.lookup(code),
    queryFn: () => api<GuestLookup>(`/guest/lookup/${encodeURIComponent(code)}`),
    retry: false,
  });
}

export function useGuestTrip(code: string, token: string | null) {
  return useQuery({
    queryKey: guestKeys.trip(code),
    queryFn: () => api<GuestTrip>('/guest/trip', { token: token! }),
    enabled: !!token,
    retry: false,
  });
}

export function useGuestItinerary(code: string, token: string | null) {
  return useQuery({
    queryKey: guestKeys.itinerary(code),
    queryFn: () => api<GuestItinerary>('/guest/itinerary', { token: token! }),
    enabled: !!token,
    retry: false,
  });
}
