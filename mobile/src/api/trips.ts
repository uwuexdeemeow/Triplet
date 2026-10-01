import { useQuery } from '@tanstack/react-query';

import { api, type Schemas } from '@/api/client';

export type Trip = Schemas['TripResponse'];
// A trip in the trips list, with counts of what's in it
export type TripSummary = Schemas['TripSummaryResponse'];
export type Member = Schemas['MemberResponse'];
export type Itinerary = Schemas['ItineraryResponse'];
export type ItineraryDay = Schemas['ItineraryDay'];
export type ItineraryActivity = Schemas['ItineraryActivity'];
export type DayWeather = Schemas['DayWeather'];
export type TravelLeg = Schemas['TravelLeg'];
export type SlotSuggestion = Schemas['SlotSuggestion'];
export type PlanDraft = Schemas['PlanDraftResponse'];
export type PlanDraftItem = Schemas['PlanDraftItem'];
export type SavedLink = Schemas['SavedLinkResponse'];
export type TripPlace = Schemas['TripPlaceResponse'];
export type Invitation = Schemas['InvitationResponse'];
export type User = Schemas['UserResponse'];
// Someone else, as search shows them: no email
export type UserPublic = Schemas['UserPublic'];
export type Expense = Schemas['ExpenseResponse'];
export type BudgetSummary = Schemas['BudgetSummary'];
export type BudgetEstimate = Schemas['BudgetEstimate'];
// Where the group sleeps for some nights; each day starts and ends at one
export type Stay = Schemas['StayResponse'];
// A stay as the plan shows it, without its price or booking reference
export type StayStop = Schemas['StayStop'];
// What a booking screenshot says, for the stay form to start from
export type StayDraft = Schemas['StayDraft'];
// A flight into, out of or during the trip
export type Flight = Schemas['FlightResponse'];
// A take-off or landing as a day's plan shows it, without its price or booking reference
export type ItineraryFlight = Schemas['ItineraryFlight'];
// What an e-ticket says, for the flight form to start from: every flight on it
export type FlightDraft = Schemas['FlightDraft'];
export type FlightDrafts = Schemas['FlightDrafts'];
export type Airport = Schemas['AirportResult'];

// One place for query keys, so screens invalidate the same caches they read
export const tripKeys = {
  all: ['trips'] as const,
  trip: (tripId: number) => ['trips', tripId] as const,
  members: (tripId: number) => ['trips', tripId, 'members'] as const,
  itinerary: (tripId: number) => ['trips', tripId, 'itinerary'] as const,
  links: (tripId: number) => ['trips', tripId, 'links'] as const,
  places: (tripId: number) => ['trips', tripId, 'places'] as const,
  invitations: (tripId: number) => ['trips', tripId, 'invitations'] as const,
  expenses: (tripId: number) => ['trips', tripId, 'expenses'] as const,
  budget: (tripId: number) => ['trips', tripId, 'budget'] as const,
  stays: (tripId: number) => ['trips', tripId, 'stays'] as const,
  flights: (tripId: number) => ['trips', tripId, 'flights'] as const,
  // Invitations sent to the signed-in user, across all trips
  myInvitations: ['invitations'] as const,
  me: ['me'] as const,
};

// Extraction runs in the background on the server, so check again every few seconds until it's done
const POLL_MS = 3000;

export function isProcessing(link: SavedLink): boolean {
  return link.status === 'pending' || link.status === 'processing';
}

export function useTrips() {
  return useQuery({
    queryKey: tripKeys.all,
    queryFn: () => api<TripSummary[]>('/trips'),
  });
}

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

export function useLinks(tripId: number) {
  return useQuery({
    queryKey: tripKeys.links(tripId),
    queryFn: () => api<SavedLink[]>(`/trips/${tripId}/links`, { query: { limit: 100 } }),
    refetchInterval: (query) => (query.state.data?.some(isProcessing) ? POLL_MS : false),
  });
}

// Every place found in the trip's links, with which activities it's planned as
export function usePlaces(tripId: number, { polling = false } = {}) {
  return useQuery({
    queryKey: tripKeys.places(tripId),
    queryFn: () => api<TripPlace[]>(`/trips/${tripId}/places`),
    // Addresses and opening hours fill in after the places appear, so keep checking meanwhile
    refetchInterval: (query) =>
      polling || query.state.data?.some((place) => place.details_status === 'pending') ? POLL_MS : false,
  });
}

export function useMe() {
  return useQuery({
    queryKey: tripKeys.me,
    queryFn: () => api<User>('/users/me'),
  });
}

// Includes answered invitations, so screens filter for the pending ones
export function useTripInvitations(tripId: number, { enabled = true } = {}) {
  return useQuery({
    queryKey: tripKeys.invitations(tripId),
    queryFn: () => api<Invitation[]>(`/trips/${tripId}/invitations`),
    enabled,
  });
}

export function useMyInvitations() {
  return useQuery({
    queryKey: tripKeys.myInvitations,
    queryFn: () => api<Invitation[]>('/invitations'),
  });
}

export function useExpenses(tripId: number) {
  return useQuery({
    queryKey: tripKeys.expenses(tripId),
    queryFn: () => api<Expense[]>(`/trips/${tripId}/expenses`, { query: { limit: 100 } }),
  });
}

// Rough cost of the whole trip, day by day. Under the budget key, so anything that refreshes the budget refreshes this.
export function useBudgetEstimate(tripId: number) {
  return useQuery({
    queryKey: [...tripKeys.budget(tripId), 'estimate'],
    queryFn: () => api<BudgetEstimate>(`/trips/${tripId}/budget/estimate`),
  });
}

// Totals, spending by category and who has paid what
export function useBudget(tripId: number) {
  return useQuery({
    queryKey: tripKeys.budget(tripId),
    queryFn: () => api<BudgetSummary>(`/trips/${tripId}/budget`),
  });
}

// The trip's hotels, in date order
export function useStays(tripId: number) {
  return useQuery({
    queryKey: tripKeys.stays(tripId),
    queryFn: () => api<Stay[]>(`/trips/${tripId}/stays`),
  });
}

// The trip's flights, in order of take-off
export function useFlights(tripId: number) {
  return useQuery({
    queryKey: tripKeys.flights(tripId),
    queryFn: () => api<Flight[]>(`/trips/${tripId}/flights`),
  });
}
