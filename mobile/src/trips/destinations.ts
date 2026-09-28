import type { Schemas } from '@/api/client';

export type Destination = Schemas['Destination'];

// The first place a trip goes, e.g. "Tokyo" for a Tokyo and Kyoto trip, for finding where to
// open a map. Trips from before there could be several only have `destination`.
export function mainDestination(trip: Pick<Schemas['TripResponse'], 'destination' | 'destinations'> | undefined) {
  if (!trip) return undefined;
  return trip.destinations?.[0]?.name ?? trip.destination;
}
