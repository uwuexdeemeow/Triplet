const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The API sends dates as "2026-10-01". Parsing them as local dates avoids timezone shifts.
export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Date -> "2026-10-01"
export function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayString(): string {
  return toDateString(new Date());
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

// Every date from start to end, inclusive
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end && days.length < 366; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function weekdayShort(value: string): string {
  return WEEKDAYS[parseDate(value).getDay()];
}

export function dayOfMonth(value: string): number {
  return parseDate(value).getDate();
}

// "Friday 2 October"
export function formatLongDate(value: string): string {
  const date = parseDate(value);
  return `${WEEKDAYS_LONG[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// "Fri 2 Oct"
export function formatShortDate(value: string): string {
  const date = parseDate(value);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}`;
}

// "Thu 1 – Mon 5 October", or "Thu 30 September – Mon 5 October" across months
export function formatDateRange(start: string, end: string): string {
  const from = parseDate(start);
  const to = parseDate(end);
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();

  const fromText = `${WEEKDAYS[from.getDay()]} ${from.getDate()}${sameMonth ? '' : ` ${MONTHS[from.getMonth()]}`}`;
  const toText = `${WEEKDAYS[to.getDay()]} ${to.getDate()} ${MONTHS[to.getMonth()]}`;
  return `${fromText} – ${toText}`;
}


/*
 * Activity times are the local time at the destination: "12:00 at Ichiran" means noon in
 * Tokyo, whatever timezone the phone is in. They're sent to the API as UTC ("...T12:00:00Z")
 * and read back with UTC getters, so the wall-clock time never shifts. The backend groups
 * activities into days by the same UTC date, so days line up too.
 */

// ("2026-10-02", "12:00") -> "2026-10-02T12:00:00Z"
export function toActivityTime(day: string, time: string): string {
  return `${day}T${time}:00Z`;
}

// "2026-10-02T12:00:00Z" -> "12:00"
export function activityClock(value: string): string {
  const date = new Date(value);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

// "12:00" + 60 minutes -> "13:00", stopping at the end of the day
export function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number);
  const total = Math.min(hours * 60 + mins + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type TripPhase =
  | { phase: 'upcoming'; daysToGo: number }
  | { phase: 'now'; day: number; length: number }
  | { phase: 'past'; daysAgo: number };

// Where a trip stands today: how long until it starts, which day of it this is, or how long ago it ended
export function tripPhase(start: string, end: string, today = new Date()): TripPhase {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const from = parseDate(start).getTime();
  const to = parseDate(end).getTime();
  const days = (a: number, b: number) => Math.round((a - b) / 86_400_000);

  if (midnight < from) return { phase: 'upcoming', daysToGo: days(from, midnight) };
  if (midnight <= to) return { phase: 'now', day: days(midnight, from) + 1, length: days(to, from) + 1 };
  return { phase: 'past', daysAgo: days(midnight, to) };
}

// "Oct" for a calendar tile
export function monthShort(value: string): string {
  return MONTHS[parseDate(value).getMonth()].slice(0, 3);
}
