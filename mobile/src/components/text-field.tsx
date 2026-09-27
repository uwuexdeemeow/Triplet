import { forwardRef, useId } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii } from '@/theme/tokens';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, style, ...props },
  ref,
) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const id = useId();

  return (
    <View style={styles.field}>
      <Text nativeID={`${id}-label`} style={styles.label}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        aria-labelledby={`${id}-label`}
        placeholderTextColor={colors.muted}
        // iOS: a dark keyboard in dark mode
        keyboardAppearance={scheme}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...props}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  field: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.dangerText,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
}));
