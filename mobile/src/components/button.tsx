import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, touchTarget } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'text';

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
};

export function Button({ label, variant = 'primary', loading = false, disabled, style, ...props }: ButtonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        styles[variant],
        state.pressed && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.accent} />
      ) : (
        <Text style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel]}>{label}</Text>
      )}
    </Pressable>
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
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  primaryLabel: {
    color: colors.onAccent,
  },
  secondaryLabel: {
    color: colors.accent,
  },
}));
