import type { SavedLink, TripPlace } from '@/api/trips';
import { parseDate } from '@/utils/dates';

const PLATFORMS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  google_maps: 'Google Maps',
};

export function platformName(link: SavedLink): string {
  if (PLATFORMS[link.platform]) return PLATFORMS[link.platform];
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

// "5 ramen shops every ramen lover should visit", falling back to the summary or the address
export function linkTitle(link: SavedLink): string {
  return link.title || link.summary || link.place_name || link.url;
}

// opening_hours has seven entries, Monday first. JavaScript's getDay() starts on Sunday.
export function hoursOn(place: TripPlace, date: string): string | null {
  if (!place.opening_hours || place.opening_hours.length !== 7) return null;
  return place.opening_hours[(parseDate(date).getDay() + 6) % 7];
}

// The lookup couldn't give a reliable address, so the user should check or fill it in
export function needsCheck(place: TripPlace): boolean {
  return place.needs_review || ['not_found', 'limit_reached', 'failed', 'skipped'].includes(place.details_status);
}

export function detailsCredit(place: TripPlace): string | null {
  if (place.details_source === 'osm') return 'Place details © OpenStreetMap contributors';
  if (place.details_source === 'google') return 'Place details from Google';
  return null;
}
