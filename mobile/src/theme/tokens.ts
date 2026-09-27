// Design tokens. Colours are the "Quiet Harbour" scheme: a greyed navy for plans and buttons,
// muted amber for saved places that need attention, red for errors and deleting.
// Screens read colours through useTheme() / makeStyles() in theme.tsx, so they follow
// the light or dark palette.

export type ColorScheme = 'light' | 'dark';

export type Palette = {
  // Page background, and the surface of cards and inputs on it
  bg: string;
  surface: string;
  // Quiet fills: segmented controls, unselected chips, empty meter tracks
  chip: string;
  line: string;
  inputBorder: string;
  ink: string;
  muted: string;
  // Plans, selection, buttons and links
  accent: string;
  // Accent text on accentSoft, e.g. success messages
  accentStrong: string;
  accentSoft: string;
  // The lighter "still to pay" part of the budget meter
  accentMuted: string;
  // Text and icons on an accent fill
  onAccent: string;
  // Saved places and things that need checking
  second: string;
  secondText: string;
  secondSoft: string;
  // Errors, overlaps, going over budget, and deleting
  danger: string;
  dangerText: string;
  dangerSoft: string;
  onDanger: string;
  // Shadow tint, used with an opacity
  shadow: string;
};

export const palettes: Record<ColorScheme, Palette> = {
  light: {
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    chip: '#EEF0F3',
    line: '#E6E9ED',
    inputBorder: '#8C929B',
    ink: '#16181D',
    muted: '#61666F',
    accent: '#2B5A8C',
    accentStrong: '#1F4570',
    accentSoft: '#E4ECF5',
    accentMuted: '#A9BFD9',
    onAccent: '#FFFFFF',
    second: '#C28A1A',
    secondText: '#7D5A12',
    secondSoft: '#F7EEDA',
    danger: '#B8453A',
    dangerText: '#9C3B31',
    dangerSoft: '#F6E4E1',
    onDanger: '#FFFFFF',
    shadow: '22, 24, 29',
  },
  // Soft contrast on purpose: off-white text on graphite, not white on black
  dark: {
    bg: '#121417',
    surface: '#1A1D21',
    chip: '#23272C',
    line: '#262A30',
    inputBorder: '#646B75',
    ink: '#E4E6E9',
    muted: '#8E949C',
    accent: '#8FB3DC',
    accentStrong: '#B7CDE8',
    accentSoft: '#1E2A38',
    accentMuted: '#3E536B',
    onAccent: '#101820',
    second: '#D8B46A',
    secondText: '#D8B46A',
    secondSoft: '#2E2819',
    danger: '#E08A80',
    dangerText: '#E8A098',
    dangerSoft: '#33201E',
    onDanger: '#1E0E0C',
    shadow: '0, 0, 0',
  },
};

// One family throughout, Geist. "display" is for screen titles and big numbers.
export const fonts = {
  display: 'Geist_600SemiBold',
  displaySemi: 'Geist_600SemiBold',
  body: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
} as const;

// Headings in Geist read better slightly tightened
export const headingTracking = -0.4;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  input: 10,
  button: 12,
  card: 12,
  pill: 999,
} as const;

// Minimum size for anything tappable
export const touchTarget = 44;
