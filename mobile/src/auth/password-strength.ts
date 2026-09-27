import zxcvbn from 'zxcvbn';

// The backend accepts a password when zxcvbn scores it 3 or more, checking the lowercased
// password against the user's name and the start of their email. Same check here, so the
// meter and the server agree.
export const MIN_SCORE = 3;

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  strongEnough: boolean;
  label: string;
  // What to do about it, from zxcvbn's feedback
  tip: string | null;
};

const LABELS = ['Very easy to guess', 'Easy to guess', 'Could be stronger', 'Strong', 'Very strong'];

export function checkPassword(password: string, name = '', email = ''): PasswordStrength {
  const emailPrefix = email.split('@')[0] ?? '';
  const inputs = [name.trim().toLowerCase(), emailPrefix.trim().toLowerCase()].filter(Boolean);
  const result = zxcvbn(password.toLowerCase(), inputs);
  const score = result.score;
  const strongEnough = score >= MIN_SCORE;

  let tip: string | null = null;
  if (!strongEnough) {
    tip =
      result.feedback.warning ||
      result.feedback.suggestions[0] ||
      'Add another word or two that aren’t about you.';
  }

  return { score, strongEnough, label: LABELS[score], tip };
}

// Common misspellings of popular email domains
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'icoud.com': 'icloud.com',
};

/** A corrected address when the domain looks like a typo, otherwise null. */
export function suggestEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return null;
  const fix = DOMAIN_TYPOS[value.slice(at + 1)];
  return fix ? `${value.slice(0, at)}@${fix}` : null;
}
