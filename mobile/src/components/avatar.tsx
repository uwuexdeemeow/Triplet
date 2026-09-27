import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { resolveApiUrl } from '@/api/client';
import { makeStyles } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

type AvatarProps = {
  name: string;
  url?: string | null;
  size?: number;
  // e.g. faded for someone who hasn't accepted yet
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

/** Someone's profile photo, or the first letter of their name when they haven't added one. */
export function Avatar({ name, url, size = 40, style, textStyle }: AvatarProps) {
  const styles = useStyles();
  const source = resolveApiUrl(url);
  // Fall back to the initial if the photo can't load, e.g. it was just removed
  const [failed, setFailed] = useState<string | null>(null);
  const circle = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.avatar, circle, style]}>
      {source && failed !== source ? (
        <Image
          source={source}
          style={circle}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
          onError={() => setFailed(source)}
        />
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
