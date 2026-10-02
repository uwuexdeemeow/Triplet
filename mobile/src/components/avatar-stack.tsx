import { Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { makeStyles } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

type AvatarStackProps = {
  people: { user_id: number; name: string; avatar_url?: string | null; avatar_buddy?: string | null }[];
  // Everyone on the trip, so "+2" can cover the ones not shown
  total: number;
  size?: number;
};

/** Overlapping photos (or initials) for who's on a trip, e.g. A R S +2. */
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
        <Avatar
          key={person.user_id}
          name={person.name}
          url={person.avatar_url}
          buddy={person.avatar_buddy}
          userId={person.user_id}
          size={size}
          style={[styles.ring, index > 0 && { marginLeft: -size * 0.3 }]}
        />
      ))}
      {extra > 0 ? (
        <View style={[styles.ring, styles.extra, circle, { marginLeft: -size * 0.3 }]}>
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
  // A ring in the card's colour separates the overlapping circles
  ring: {
    borderWidth: 2,
    borderColor: colors.surface,
  },
  extra: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip,
  },
  extraText: {
    fontFamily: fonts.semibold,
    color: colors.muted,
  },
}));
