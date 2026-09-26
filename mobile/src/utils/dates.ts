const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The API sends dates as "2026-10-01". Parsing them as local dates avoids timezone shifts.
export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
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

// "In 5 days", "Tomorrow", "Happening now" or null once the trip is over
export function tripCountdown(start: string, end: string, today = new Date()): string | null {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((parseDate(start).getTime() - midnight.getTime()) / 86_400_000);

  if (days > 1) return `In ${days} days`;
  if (days === 1) return 'Tomorrow';
  if (parseDate(end).getTime() >= midnight.getTime()) return 'Happening now';
  return null;
}
