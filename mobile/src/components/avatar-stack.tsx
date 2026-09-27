import { Text, View } from 'react-native';

import { makeStyles } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

type AvatarStackProps = {
  people: { user_id: number; name: string }[];
  // Everyone on the trip, so "+2" can cover the ones not shown
  total: number;
  size?: number;
};

/** Overlapping initials for who's on a trip, e.g. A R S +2. */
export function AvatarStack({ people, total, size = 28 }: AvatarStackProps) {
  const styles = useStyles();
  const extra = total - people.length;
  const circle = { width: size, height: size, borderRadius: size / 2 };
  const text = { fontSize: size * 0.42 };

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${total} ${total === 1 ? 'person' : 'people'}: ${people.map((person) => person.name).join(', ')}${extra > 0 ? ` and ${extra} more` : ''}`}>
      {people.map((person, index) => (
        <View key={person.user_id} style={[styles.avatar, circle, index > 0 && { marginLeft: -size * 0.3 }]}>
          <Text style={[styles.initial, text]}>{person.name.trim().charAt(0).toUpperCase() || '?'}</Text>
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.avatar, styles.extra, circle, { marginLeft: -size * 0.3 }]}>
          <Text style={[styles.extraText, text]}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    // A ring in the card's colour separates the overlapping circles
    borderWidth: 2,
    borderColor: colors.surface,
  },
  initial: {
    fontFamily: fonts.semibold,
    color: colors.accentStrong,
  },
  extra: {
    backgroundColor: colors.chip,
  },
  extraText: {
    fontFamily: fonts.semibold,
    color: colors.muted,
  },
}));
