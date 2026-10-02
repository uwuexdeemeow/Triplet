import type { Schemas } from '@/api/client';

/*
 * What a trip can look like. The server keeps the same lists (appearance.py) and only saves
 * these, so add to both together.
 */

export type TripAppearance = Schemas['TripAppearance'];
export type StyleId = TripAppearance['style'];
export type ColourId = TripAppearance['colour'];
export type SceneId = TripAppearance['scene'];
export type PatternId = TripAppearance['pattern'];
export type BuddyStyle = keyof TripAppearance['buddies'];

export const COLOURS: { id: ColourId; name: string; hex: string }[] = [
  { id: 'harbour', name: 'Harbour', hex: '#2B5A8C' },
  { id: 'lagoon', name: 'Lagoon', hex: '#1F7A7A' },
  { id: 'matcha', name: 'Matcha', hex: '#4F7A3A' },
  { id: 'clay', name: 'Clay', hex: '#B0532F' },
  { id: 'plum', name: 'Plum', hex: '#6E4A8C' },
  { id: 'sakura', name: 'Sakura', hex: '#A84870' },
  { id: 'amber', name: 'Amber', hex: '#8F6214' },
  { id: 'slate', name: 'Slate', hex: '#4A5562' },
];

export const STYLES: { id: StyleId; name: string; blurb: string }[] = [
  { id: 'pixel', name: '8-bit scene', blurb: 'A pixel city, beach or peaks' },
  { id: 'poster', name: 'Travel poster', blurb: 'Flat hills, a big sun, poster type' },
  { id: 'postcard', name: 'Postcard', blurb: 'Greetings from, with a stamp' },
  { id: 'stickers', name: 'Stickers', blurb: 'Travel stickers on the trip colour' },
  { id: 'pattern', name: 'Pattern', blurb: 'A pattern, or an emoji on repeat' },
  { id: 'topo', name: 'Topo lines', blurb: 'Contour lines and the coordinates' },
  { id: 'ticket', name: 'Boarding pass', blurb: 'Made from the trip’s flight' },
  { id: 'solid', name: 'Solid colour', blurb: 'Just the colour' },
  { id: 'photo', name: 'Your photo', blurb: 'A photo, tinted to the colour' },
];

export const SCENES: { id: SceneId; name: string }[] = [
  { id: 'city', name: 'City lights' },
  { id: 'beach', name: 'Beach day' },
  { id: 'mountains', name: 'Peaks' },
];

// Each style with buddies has its own cast, drawn the same way as the style
export const CASTS: Record<BuddyStyle, { name: string; buddies: { id: string; name: string }[] }> = {
  pixel: {
    name: '8-bit buddies',
    buddies: [
      { id: 'backpacker', name: 'Backpacker' },
      { id: 'cat', name: 'Suitcase cat' },
      { id: 'robot', name: 'Robo' },
      { id: 'ghost', name: 'Boo' },
      { id: 'frog', name: 'Hopper' },
      { id: 'plane', name: 'Jet' },
    ],
  },
  poster: {
    name: 'Poster animals',
    buddies: [
      { id: 'fox', name: 'Fox' },
      { id: 'whale', name: 'Whale' },
      { id: 'owl', name: 'Owl' },
      { id: 'bear', name: 'Bear' },
      { id: 'penguin', name: 'Penguin' },
      { id: 'capybara', name: 'Capybara' },
    ],
  },
  postcard: {
    name: 'Stamp drawings',
    buddies: [
      { id: 'balloon', name: 'Balloon' },
      { id: 'lighthouse', name: 'Lighthouse' },
      { id: 'tram', name: 'Tram' },
      { id: 'sailboat', name: 'Sailboat' },
      { id: 'swallow', name: 'Swallow' },
      { id: 'biplane', name: 'Biplane' },
    ],
  },
  stickers: {
    name: 'Sticker pals',
    buddies: [
      { id: 'suitcase', name: 'Suitcase' },
      { id: 'onigiri', name: 'Onigiri' },
      { id: 'coffee', name: 'Coffee' },
      { id: 'sun', name: 'Sunny' },
      { id: 'cloud', name: 'Cloud' },
      { id: 'camera', name: 'Snap' },
    ],
  },
};

export function hasBuddies(style: StyleId): style is BuddyStyle {
  return style in CASTS;
}

// People's own avatars come from the flat casts, which sit well in the app's plain screens
export const AVATAR_BUDDIES = [...CASTS.poster.buddies, ...CASTS.stickers.buddies];

// The assistant in Ask
export const GUIDE_BUDDY = 'owl';

export function castOf(buddy: string): BuddyStyle | null {
  return (Object.keys(CASTS) as BuddyStyle[]).find((style) => CASTS[style].buddies.some((item) => item.id === buddy)) ?? null;
}

export function buddyName(buddy: string): string {
  const cast = castOf(buddy);
  return (cast && CASTS[cast].buddies.find((item) => item.id === buddy)?.name) || 'None';
}

export const PATTERNS: { id: Exclude<PatternId, 'emoji'>; name: string }[] = [
  { id: 'dots', name: 'Dots' },
  { id: 'waves', name: 'Waves' },
  { id: 'grid', name: 'Grid' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'checks', name: 'Checks' },
  { id: 'zigzag', name: 'Zigzag' },
];

export type Emoji = TripAppearance['emoji'];

export const EMOJI: Emoji[] = [
  '🍜',
  '🗼',
  '🌸',
  '🍣',
  '✈️',
  '🏝️',
  '⛰️',
  '☕',
  '🍦',
  '🌴',
  '📸',
  '🎌',
  '🏖️',
  '🍕',
  '🥐',
  '🌮',
  '🏔️',
  '🎡',
  '🚆',
  '🌊',
  '🍷',
  '🎒',
  '🗺️',
  '⭐',
];

export const DEFAULT_APPEARANCE: TripAppearance = {
  style: 'pixel',
  colour: 'harbour',
  scene: 'city',
  buddies: { pixel: 'robot', poster: 'fox', postcard: 'tram', stickers: 'onigiri' },
  pattern: 'dots',
  emoji: '🍜',
};

export function colourHex(colour: ColourId | undefined): string {
  return (COLOURS.find((item) => item.id === colour) ?? COLOURS[0]).hex;
}

/** `a` moved `t` of the way towards `b`, for tints and shades of the trip colour. */
export function mix(a: string, b: string, t: number): string {
  const parts = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const from = parts(a);
  const to = parts(b);
  return `#${from
    .map((value, index) =>
      Math.round(value + (to[index] - value) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** The trip colour for text and fills, readable in the light or dark theme. */
export function tripColours(appearance: TripAppearance | undefined, scheme: 'light' | 'dark') {
  const accent = colourHex(appearance?.colour);
  return scheme === 'dark'
    ? { text: mix(accent, '#FFFFFF', 0.5), soft: mix(accent, '#121417', 0.72), softText: mix(accent, '#FFFFFF', 0.6) }
    : { text: accent, soft: mix(accent, '#FFFFFF', 0.86), softText: mix(accent, '#000000', 0.25) };
}

// The countdown's numbers are set in the style's own type. Some faces run bigger or smaller
// than Geist, so `scale` evens them out.
export const COUNT_FONTS: Partial<Record<StyleId, { family: string; scale: number }>> = {
  pixel: { family: 'PressStart2P_400Regular', scale: 0.62 },
  poster: { family: 'BebasNeue_400Regular', scale: 1.35 },
  postcard: { family: 'DMSerifDisplay_400Regular', scale: 1 },
  ticket: { family: 'DMMono_500Medium', scale: 0.92 },
  topo: { family: 'DMMono_500Medium', scale: 0.92 },
};
