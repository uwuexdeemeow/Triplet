import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { DRAWINGS } from '@/appearance/drawings';
import { castOf, mix } from '@/appearance/looks';
import { spriteXml } from '@/appearance/pixel-art';
import { SvgImage } from '@/appearance/svg-image';

/** A flat buddy as an SVG document. Sticker buddies get a white edge, like a real sticker. */
export function buddyXml(buddy: string, accent: string): string | null {
  const drawing = DRAWINGS[buddy];
  if (!drawing) return null;
  const body = drawing.replaceAll('@A', accent).replaceAll('@L', mix(accent, '#FFFFFF', 0.7));
  // The edge is the same shapes in white, drawn thick underneath
  const edge =
    castOf(buddy) === 'stickers'
      ? `<g fill="#FFFFFF" stroke="#FFFFFF" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">${body.replace(/ (fill|stroke|stroke-width|stroke-linecap)="[^"]*"/g, '')}</g>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 76 76">${edge}${body}</svg>`;
}

type BuddyProps = {
  buddy: string;
  // The trip's colour, or the person's for an avatar
  accent: string;
  size: number;
  style?: StyleProp<ViewStyle>;
};

/** A buddy from any cast, `size` points square: 8-bit sprites stay crisp, the rest are drawings. */
export const Buddy = memo(function Buddy({ buddy, accent, size, style }: BuddyProps) {
  const sprite = spriteXml(buddy, accent);
  if (sprite) {
    // Whole points per pixel, so every pixel is the same size
    const unit = Math.max(1, Math.floor(size / Math.max(sprite.width, sprite.height)));
    return (
      <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }, style]}>
        <SvgImage xml={sprite.xml} width={sprite.width * unit} height={sprite.height * unit} />
      </View>
    );
  }
  const xml = buddyXml(buddy, accent);
  if (!xml) return null;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <SvgImage xml={xml} width={size} height={size} />
    </View>
  );
});
