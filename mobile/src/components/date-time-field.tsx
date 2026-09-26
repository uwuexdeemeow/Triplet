import RNDateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii } from '@/theme/tokens';
import { formatShortDate, parseDate, toDateString } from '@/utils/dates';

type FieldProps = {
  label: string;
  // "2026-10-01" for dates, "12:00" for times
  value: string;
  onChange: (value: string) => void;
  error?: string;
  minimumDate?: string;
};

function timeToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function dateToTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function PickerField({ label, value, onChange, error, minimumDate, mode }: FieldProps & { mode: 'date' | 'time' }) {
  const current = mode === 'date' ? parseDate(value) : timeToDate(value);
  const handleValue = (date: Date) => onChange(mode === 'date' ? toDateString(date) : dateToTime(date));
  const minimum = minimumDate ? parseDate(minimumDate) : undefined;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'ios' ? (
        // iOS shows a compact button that opens the native picker in a popover
        <RNDateTimePicker
          value={current}
          mode={mode}
          display="compact"
          minimumDate={minimum}
          themeVariant="light"
          accentColor={colors.teal}
          onValueChange={(_, date) => handleValue(date)}
          style={styles.iosPicker}
        />
      ) : (
        // Android opens its picker as a dialog
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${mode === 'date' ? formatShortDate(value) : value}`}
          accessibilityHint={`Opens a ${mode} picker`}
          onPress={() =>
            DateTimePickerAndroid.open({
              value: current,
              mode,
              is24Hour: true,
              minimumDate: minimum,
              onValueChange: (_, date) => handleValue(date),
            })
          }
          style={[styles.input, error ? styles.inputError : null]}>
          <Text style={styles.value}>{mode === 'date' ? formatShortDate(value) : value}</Text>
        </Pressable>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function DateField(props: FieldProps) {
  return <PickerField {...props} mode="date" />;
}

export function TimeField(props: Omit<FieldProps, 'minimumDate'>) {
  return <PickerField {...props} mode="time" />;
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
    flex: 1,
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
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  inputError: {
    borderColor: colors.coral,
  },
  value: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  iosPicker: {
    alignSelf: 'flex-start',
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.coralText,
  },
});
