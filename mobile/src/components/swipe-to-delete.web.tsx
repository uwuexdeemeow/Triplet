import { Feather } from '@expo/vector-icons';
import { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SwipeToDeleteProps } from '@/components/swipe-to-delete';
import { colors, fonts, spacing } from '@/theme/tokens';

// Phones and tablets can't hover, so the button stays visible there.
// The static web export renders without a window, where it counts as "can hover".
const NO_HOVER = '(hover: none)';

function subscribeToHover(onChange: () => void) {
  const query = window.matchMedia(NO_HOVER);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function cannotHover() {
  return window.matchMedia(NO_HOVER).matches;
}

/**
 * Dragging a card with a mouse feels clumsy, so the website shows a delete button instead:
 * in the corner when the card is hovered or focused, and always on touch screens. It asks
 * before deleting, since a click is easier to make by accident than a swipe.
 */
export function SwipeToDelete({ children, label, onDelete }: SwipeToDeleteProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const touch = useSyncExternalStore(subscribeToHover, cannotHover, () => false);

  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } catch {
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  const visible = touch || hovered || focused || confirming;

  return (
    <View onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      {children}
      <View style={styles.corner} pointerEvents="box-none">
        {confirming ? (
          <View style={styles.confirm} accessibilityRole="alert">
            <Text style={styles.confirmText}>Delete?</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(false)}
              disabled={deleting}
              style={({ hovered: over }) => [styles.confirmButton, over && styles.cancelHover]}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={remove}
              disabled={deleting}
              style={({ hovered: over }) => [styles.confirmButton, styles.deleteButton, over && styles.deleteHover]}>
              {deleting ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.deleteLabel}>Delete</Text>}
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => setConfirming(true)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={({ hovered: over }) => [styles.trash, over && styles.trashHover, { opacity: visible ? 1 : 0 }]}>
            <Feather name="trash-2" size={16} color={colors.coralText} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  corner: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  trash: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  trashHover: {
    backgroundColor: colors.coralSoft,
    borderColor: colors.coral,
  },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 4,
    paddingLeft: 12,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.coral,
    // A soft lift so it reads as floating over the card
    boxShadow: '0 4px 14px rgba(29, 27, 24, 0.12)',
  },
  confirmText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
    marginRight: 4,
  },
  confirmButton: {
    minWidth: 64,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelHover: {
    backgroundColor: colors.chip,
  },
  cancelLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    color: colors.ink,
  },
  deleteButton: {
    backgroundColor: colors.coral,
  },
  deleteHover: {
    backgroundColor: colors.coralText,
  },
  deleteLabel: {
    fontFamily: fonts.bold,
    fontSize: 13.5,
    color: colors.white,
  },
});
