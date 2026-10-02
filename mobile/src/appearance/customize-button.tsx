import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles } from '@/theme/theme';
import { fonts, radii } from '@/theme/tokens';
import { tap } from '@/utils/haptics';

/** Opens the trip's look, from on top of its banner. */
export function CustomizeButton({ tripId, title, style }: { tripId: number; title: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Customize ${title}`}
      // A bigger tap area than it looks, without covering more of the banner
      hitSlop={8}
      onPress={() => {
        tap();
        // From the home page, so closing goes back there rather than into the trip
        router.push({ pathname: '/trips/[tripId]/customize', params: { tripId: String(tripId), from: 'home' } });
      }}
      style={({ pressed, hovered }) => [styles.button, (pressed || hovered) && styles.active, style]}>
      <Feather name="edit-2" size={13} color="#16181D" />
      <Text style={styles.label}>Customize</Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  // The same in either theme: it sits on the banner, not the page
  button: {
    position: 'absolute',
    top: 10,
    right: 10,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  active: {
    backgroundColor: '#FFFFFF',
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: '#16181D',
  },
}));
