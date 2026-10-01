import { ActivityIndicator, Text } from 'react-native';

import { useInDialog } from '@/components/dialog-context';
import { PressableScale, type PressableScaleProps } from '@/components/pressable-scale';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing, touchTarget } from '@/theme/tokens';
import { tap } from '@/utils/haptics';

type Variant = 'primary' | 'secondary' | 'text';

type ButtonProps = Omit<PressableScaleProps, 'children'> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  // "compact" for desktop dialogs and toolbars, where full phone-sized buttons look oversized.
  // Inside a dialog it's the default.
  size?: 'regular' | 'compact';
};

export function Button({ label, variant = 'primary', loading = false, size: sizeProp, disabled, style, ...props }: ButtonProps) {
  const styles = useStyles();
  const inDialog = useInDialog();
  const size = sizeProp ?? (inDialog ? 'compact' : 'regular');
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      // A light tap for the main action on a screen
      feedback={variant === 'primary' ? tap : undefined}
      style={[
        styles.base,
        styles[variant],
        size === 'compact' && styles.compact,
        // A desktop button is as wide as its label, not the whole column
        inDialog && styles.natural,
        isDisabled && styles.disabled,
        style,
      ]}
      {...props}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.accent} />
      ) : (
        <Text style={[styles.label, size === 'compact' && styles.compactLabel, variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel]}>
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    minHeight: 52,
    minWidth: touchTarget,
    paddingHorizontal: 20,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  text: {
    minHeight: touchTarget,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
  compact: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.input,
  },
  natural: {
    alignSelf: 'flex-start',
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  compactLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  primaryLabel: {
    color: colors.onAccent,
  },
  secondaryLabel: {
    color: colors.accent,
  },
}));
