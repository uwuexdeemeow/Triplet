import { Feather } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api } from '@/api/client';
import type { Airport } from '@/api/trips';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing, touchTarget } from '@/theme/tokens';

// An airport as a flight keeps it: picked from the list (with its code and pin), or just typed
export type AirportValue = {
  name: string;
  code: string | null;
  latitude: number | null;
  longitude: number | null;
};

export const NO_AIRPORT: AirportValue = { name: '', code: null, latitude: null, longitude: null };

// Wait for a pause in typing before searching
const DEBOUNCE_MS = 250;

/** An airport, found by code ("HND"), name ("Haneda") or city ("Tokyo"). */
export function AirportField({
  tripId,
  label,
  value,
  onChange,
  error,
}: {
  tripId: number;
  label: string;
  value: AirportValue;
  onChange: (value: AirportValue) => void;
  error?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(value.name.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value.name]);

  const results = useQuery({
    queryKey: ['trips', tripId, 'airports', query],
    queryFn: () => api<Airport[]>(`/trips/${tripId}/flights/airports`, { query: { q: query } }),
    enabled: open && query.length >= 2,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Picked from the list: show it as chosen, with a way to pick another
  if (value.code) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.chosen}>
          <View style={styles.code}>
            <Text style={styles.codeText}>{value.code}</Text>
          </View>
          <Text style={styles.chosenName} numberOfLines={2}>
            {value.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change ${label.toLowerCase()}`}
            hitSlop={8}
            onPress={() => {
              setOpen(true);
              onChange(NO_AIRPORT);
            }}>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const list = open && query.length >= 2 ? (results.data ?? []) : [];

  return (
    <View style={styles.container}>
      <TextField
        label={label}
        placeholder="Code, airport or city, e.g. HND or Tokyo"
        value={value.name}
        onChangeText={(text) => {
          setOpen(true);
          onChange({ ...NO_AIRPORT, name: text });
        }}
        autoCorrect={false}
        autoCapitalize="words"
        error={error}
      />
      {open && query.length >= 2 && (list.length > 0 || results.isFetching) ? (
        <View style={styles.results} accessibilityRole="list">
          {list.map((airport, index) => (
            <Pressable
              key={airport.code}
              accessibilityRole="button"
              accessibilityLabel={`${airport.name}, ${airport.code}`}
              onPress={() => {
                setOpen(false);
                onChange({ name: airport.name, code: airport.code, latitude: airport.latitude, longitude: airport.longitude });
              }}
              style={({ pressed }) => [styles.result, index > 0 && styles.divider, pressed && styles.pressed]}>
              <Text style={styles.resultCode}>{airport.code}</Text>
              <View style={styles.resultText}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {airport.name}
                </Text>
                <Text style={styles.resultCity} numberOfLines={1}>
                  {[airport.city, airport.country].filter(Boolean).join(', ')}
                </Text>
              </View>
            </Pressable>
          ))}
          {results.isFetching && list.length === 0 ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
        </View>
      ) : value.name.trim() ? (
        <View style={styles.noPin}>
          <Feather name="alert-circle" size={13} color={colors.secondText} />
          <Text style={styles.noPinText}>Pick it from the list, so the plan can find the way there.</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  code: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
  },
  codeText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    letterSpacing: 0.5,
    color: colors.accentStrong,
  },
  chosenName: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
  change: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.accent,
  },
  results: {
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    overflow: 'hidden',
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  pressed: {
    opacity: 0.7,
  },
  resultCode: {
    width: 40,
    fontFamily: fonts.bold,
    fontSize: 14,
    letterSpacing: 0.5,
    color: colors.accent,
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  resultName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  resultCity: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  loading: {
    paddingVertical: spacing.md,
  },
  noPin: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  noPinText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondText,
  },
}));
