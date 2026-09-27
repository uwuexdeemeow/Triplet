import { Feather } from '@expo/vector-icons';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

export type SwipeToDeleteProps = {
  children: ReactNode;
  // e.g. "Delete Lunch at Menya Itto", read out by screen readers
  label: string;
  // Rejects when deleting failed, which closes the swipe again
  onDelete: () => Promise<unknown>;
  // Match the card's corners
  radius?: number;
};

/** Swipe the card right to reveal a Delete button. On the web, see swipe-to-delete.web.tsx. */
export function SwipeToDelete({ children, label, onDelete, radius = 18 }: SwipeToDeleteProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const swipeable = useRef<SwipeableMethods>(null);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } catch {
      swipeable.current?.close();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={2}
      leftThreshold={48}
      overshootLeft={false}
      containerStyle={{ borderRadius: radius }}
      renderLeftActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={deleting}
          onPress={remove}
          style={({ pressed }) => [styles.action, { borderRadius: radius }, pressed && styles.pressed]}>
          {deleting ? (
            <ActivityIndicator color={colors.onDanger} />
          ) : (
            <>
              <Feather name="trash-2" size={20} color={colors.onDanger} />
              <Text style={styles.label}>Delete</Text>
            </>
          )}
        </Pressable>
      )}>
      <View
        // Screen readers can't swipe, so delete is offered as an action too
        accessibilityActions={[{ name: 'delete', label }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') remove();
        }}>
        {children}
      </View>
    </ReanimatedSwipeable>
  );
}

const useStyles = makeStyles((colors) => ({
  action: {
    width: 96,
    marginRight: spacing.sm,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.onDanger,
  },
  pressed: {
    opacity: 0.75,
  },
}));
