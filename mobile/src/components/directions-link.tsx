import { Feather } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';
import { openDirections, type Stop } from '@/utils/directions';

// "Directions": opens the maps app with the route there from wherever the person is
export function DirectionsLink({ to }: { to: Stop }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Directions to ${to.name}`}
      accessibilityHint="Opens your maps app"
      hitSlop={8}
      onPress={() => openDirections(to)}
      style={({ pressed, hovered }) => [styles.link, (pressed || hovered) && styles.active]}>
      <Feather name="navigation" size={14} color={colors.accent} />
      <Text style={styles.label}>Directions</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: spacing.xs,
  },
  active: {
    opacity: 0.7,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.accent,
  },
}));
