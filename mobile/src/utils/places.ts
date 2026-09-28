import type { SavedLink, TripPlace } from '@/api/trips';
import { formatShortDate, parseDate, todayString } from '@/utils/dates';

const PLATFORMS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  google_maps: 'Google Maps',
  screenshot: 'Screenshot',
};

// For plans, which only know their post's platform: "tiktok" -> "TikTok", anything else -> "a saved post"
export function platformLabel(platform: string | null | undefined): string {
  return (platform && PLATFORMS[platform]) || 'a saved post';
}

export function platformName(link: SavedLink): string {
  if (PLATFORMS[link.platform]) return PLATFORMS[link.platform];
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

// "5 ramen shops every ramen lover should visit", falling back to the summary or the address
// The name the user gave the post wins over the post's own title
export function linkTitle(link: SavedLink): string {
  return link.custom_title || link.title || link.summary || link.place_name || link.url;
}

// opening_hours has seven entries, Monday first. JavaScript's getDay() starts on Sunday.
export function hoursOn(place: TripPlace, date: string): string | null {
  if (!place.opening_hours || place.opening_hours.length !== 7) return null;
  // Days the user left blank are unknown, not closed
  return place.opening_hours[(parseDate(date).getDay() + 6) % 7] || null;
}

// The lookup couldn't give a reliable address, so the user should check or fill it in.
// Once the user has saved the place themselves, it's theirs and counts as checked.
export function needsCheck(place: TripPlace): boolean {
  if (place.user_edited) return false;
  return place.needs_review || ['not_found', 'limit_reached', 'failed', 'skipped'].includes(place.details_status);
}

// Why the details are missing, in words, or null when the lookup found them
export function missingDetailsReason(place: TripPlace): string | null {
  switch (place.details_status) {
    case 'limit_reached':
      return 'Today’s free place lookups are used up, so add the details yourself.';
    case 'not_found':
      return 'We couldn’t find this place on the map, so add the details yourself.';
    case 'failed':
      return 'The place lookup didn’t work this time, so add the details yourself.';
    case 'skipped':
      return 'Add the address and opening hours yourself.';
    default:
      return null;
  }
}

export type PlaceDetail = { text: string; tone: 'muted' | 'accent' | 'attention' };

// One line about where a place stands: planned, still loading, needs checking, or today's hours
export function placeDetail(place: TripPlace, plannedDay: string | undefined): PlaceDetail {
  if ((place.activity_ids?.length ?? 0) > 0) {
    return { text: plannedDay ? `In the plan · ${formatShortDate(plannedDay)}` : 'In the plan', tone: 'accent' };
  }
  if (place.details_status === 'pending') return { text: 'Looking up the address…', tone: 'muted' };
  if (needsCheck(place)) return { text: 'Check the location', tone: 'attention' };
  const today = hoursOn(place, todayString());
  if (today) return { text: today === 'Closed' ? 'Closed today' : `Open today · ${today}`, tone: 'muted' };
  return { text: place.address ?? place.city ?? '', tone: 'muted' };
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function detailsCredit(place: TripPlace): string | null {
  if (place.details_source === 'osm') return 'Place details © OpenStreetMap contributors';
  if (place.details_source === 'google') return 'Place details from Google';
  return null;
}
