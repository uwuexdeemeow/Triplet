import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Glass } from '@/components/glass';
import { useTheme } from '@/theme/theme';
import { tap } from '@/utils/haptics';

type FabProps = {
  // What it does, for screen readers, e.g. "Add expense"
  label: string;
  onPress: () => void;
  icon?: ComponentProps<typeof Feather>['name'];
  // Distance from the bottom of the screen
  bottom?: number;
};

/** The round + button in the corner of a screen: accent-tinted glass. */
export function Fab({ label, onPress, icon = 'plus', bottom = 28 }: FabProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.position, { bottom }, pressed && styles.pressed]}>
      <Glass interactive tintColor={colors.accent} style={styles.button}>
        <Feather name={icon} size={26} color={colors.onAccent} />
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  position: {
    position: 'absolute',
    right: 20,
    borderRadius: 29,
  },
  button: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    transform: [{ scale: 0.94 }],
  },
});
