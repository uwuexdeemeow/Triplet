// Design tokens from the "Travel postcard" foundations board.

export const colors = {
  paper: '#F6F1E9',
  card: '#FFFFFF',
  ink: '#1D1B18',
  muted: '#5E5850',
  line: '#E3DBCF',
  inputBorder: '#D6CCBD',
  chip: '#EFE8DC',
  teal: '#1F6F6B',
  tealDark: '#16524F',
  tealSoft: '#DCEBE8',
  coral: '#B8472F',
  coralText: '#9C3A25',
  coralSoft: '#F6E0D8',
  white: '#FFFFFF',
} as const;

export const fonts = {
  display: 'Fraunces_700Bold',
  displaySemi: 'Fraunces_600SemiBold',
  body: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  input: 12,
  button: 14,
  card: 20,
  pill: 999,
} as const;

// Minimum size for anything tappable
export const touchTarget = 44;
