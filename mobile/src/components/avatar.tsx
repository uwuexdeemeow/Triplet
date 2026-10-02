import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { resolveApiUrl } from '@/api/client';
import { Buddy } from '@/appearance/buddy';
import { COLOURS, mix } from '@/appearance/looks';
import { makeStyles } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

type AvatarProps = {
  name: string;
  url?: string | null;
  // A buddy drawing, shown when there's no photo
  buddy?: string | null;
  // Picks the colour a buddy is drawn in, so each person keeps theirs
  userId?: number;
  size?: number;
  // e.g. faded for someone who hasn't accepted yet
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/** Someone's colour, the same on every screen, for their buddy. */
export function personColour(userId: number | undefined, name: string): string {
  const seed = userId ?? [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COLOURS[seed % COLOURS.length].hex;
}

/** Someone's profile photo, their buddy, or the first letter of their name, in that order. */
export function Avatar({ name, url, buddy, userId, size = 40, style, textStyle }: AvatarProps) {
  const styles = useStyles();
  const source = resolveApiUrl(url);
  // Fall back to the initial if the photo can't load, e.g. it was just removed
  const [failed, setFailed] = useState<string | null>(null);
  const circle = { width: size, height: size, borderRadius: size / 2 };
  const showPhoto = source && failed !== source;
  const colour = personColour(userId, name);
  const tint = !showPhoto && buddy ? { backgroundColor: mix(colour, '#FFFFFF', 0.85) } : null;

  return (
    <View style={[styles.avatar, circle, tint, style]}>
      {showPhoto ? (
        <Image
          source={source}
          style={circle}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
          onError={() => setFailed(source)}
        />
      ) : buddy ? (
        <Buddy buddy={buddy} accent={colour} size={Math.round(size * 0.92)} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.42 }, textStyle]}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.accentSoft,
  },
  initial: {
    fontFamily: fonts.semibold,
    color: colors.accentStrong,
  },
}));
