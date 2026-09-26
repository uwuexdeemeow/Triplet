import { createElement, useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii } from '@/theme/tokens';

// The native picker doesn't support the web, so the web build uses the browser's own inputs

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  minimumDate?: string;
};

const inputStyle = {
  minHeight: 52,
  boxSizing: 'border-box',
  padding: '0 14px',
  border: `1.5px solid ${colors.inputBorder}`,
  borderRadius: radii.input,
  backgroundColor: colors.card,
  fontFamily: `${fonts.body}, system-ui, sans-serif`,
  fontSize: 16,
  color: colors.ink,
  width: '100%',
};

function WebField({ label, value, onChange, error, minimumDate, type }: FieldProps & { type: 'date' | 'time' }) {
  const id = useId();

  return (
    <View style={styles.field}>
      {createElement('label', { htmlFor: id, style: { fontFamily: `${fonts.semibold}, sans-serif`, fontSize: 14, color: colors.ink } }, label)}
      {createElement('input', {
        id,
        type,
        value,
        min: minimumDate,
        required: true,
        'aria-invalid': error ? true : undefined,
        onChange: (event: { target: { value: string } }) => {
          if (event.target.value) onChange(event.target.value);
        },
        style: { ...inputStyle, borderColor: error ? colors.coral : colors.inputBorder },
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function DateField(props: FieldProps) {
  return <WebField {...props} type="date" />;
}

export function TimeField(props: Omit<FieldProps, 'minimumDate'>) {
  return <WebField {...props} type="time" />;
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
    flex: 1,
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.coralText,
  },
});
