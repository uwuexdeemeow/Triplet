import { forwardRef, useId } from 'react';
import { Text, TextInput, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii } from '@/theme/tokens';

type CodeFieldProps = {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  error?: string | null;
  autoFocus?: boolean;
};

/**
 * The six-digit code from an email. Phones offer to fill it from the email, and pasting
 * "123 456" or "123-456" keeps just the digits.
 */
export const CodeField = forwardRef<TextInput, CodeFieldProps>(function CodeField(
  { label = 'Code', value, onChangeText, onSubmit, error, autoFocus },
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
        value={value}
        onChangeText={(text) => onChangeText(text.replace(/\D/g, '').slice(0, 6))}
        onSubmitEditing={onSubmit}
        placeholder="000000"
        placeholderTextColor={colors.inputBorder}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        keyboardAppearance={scheme}
        autoFocus={autoFocus}
        returnKeyType="done"
        maxLength={9}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
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
    minHeight: 60,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    fontFamily: fonts.bold,
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.dangerText,
  },
}));
