import { useQuery } from '@tanstack/react-query';

import { api, type Schemas } from '@/api/client';

export type Trip = Schemas['TripResponse'];
export type Member = Schemas['MemberResponse'];
export type Itinerary = Schemas['ItineraryResponse'];
export type ItineraryActivity = Schemas['ItineraryActivity'];

// One place for query keys, so screens invalidate the same caches they read
export const tripKeys = {
  all: ['trips'] as const,
  trip: (tripId: number) => ['trips', tripId] as const,
  members: (tripId: number) => ['trips', tripId, 'members'] as const,
  itinerary: (tripId: number) => ['trips', tripId, 'itinerary'] as const,
};

export function useTrip(tripId: number) {
  return useQuery({
    queryKey: tripKeys.trip(tripId),
    queryFn: () => api<Trip>(`/trips/${tripId}`),
  });
}

export function useMembers(tripId: number) {
  return useQuery({
    queryKey: tripKeys.members(tripId),
    queryFn: () => api<Member[]>(`/trips/${tripId}/members`),
  });
}

export function useItinerary(tripId: number) {
  return useQuery({
    queryKey: tripKeys.itinerary(tripId),
    queryFn: () => api<Itinerary>(`/trips/${tripId}/itinerary`),
  });
}
