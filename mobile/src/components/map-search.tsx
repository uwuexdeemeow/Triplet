import { Feather } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { api, type Schemas } from '@/api/client';
import { makeStyles, shadow, useTheme } from '@/theme/theme';
import { fonts, spacing, touchTarget } from '@/theme/tokens';

export type SearchResult = Schemas['PlaceSearchResult'];

// Wait for a pause in typing before searching
const DEBOUNCE_MS = 350;

type MapSearchProps = {
  tripId: number;
  onPick: (result: SearchResult & { latitude: number; longitude: number }) => void;
  // Lets the map hide things the results would cover
  onOpenChange?: (open: boolean) => void;
};

/** A search box floating over the map: addresses and places, nearest to the trip first. */
export function MapSearch({ tripId, onPick, onOpenChange }: MapSearchProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  // Same query as the "Where" field's suggestions, so they share answers
  const results = useQuery({
    queryKey: ['trips', tripId, 'suggest', query],
    queryFn: () => api<SearchResult[]>(`/trips/${tripId}/places/suggest`, { query: { q: query } }),
    enabled: open && query.length >= 2,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const list = (open && query.length >= 2 ? (results.data ?? []) : []).filter(
    (result): result is SearchResult & { latitude: number; longitude: number } =>
      result.latitude != null && result.longitude != null,
  );

  const pick = (result: SearchResult & { latitude: number; longitude: number }) => {
    setText(result.name);
    setOpenState(false);
    Keyboard.dismiss();
    onPick(result);
  };

  const clear = () => {
    setText('');
    setQuery('');
    setOpenState(false);
  };

  const showPanel = open && text.trim().length >= 2;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Feather name="search" size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search for an address or place"
          placeholder="Search an address or place"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          value={text}
          onChangeText={(value) => {
            setText(value);
            setOpenState(true);
          }}
          onFocus={() => {
            if (text.trim().length >= 2) setOpenState(true);
          }}
          // Enter takes the best match
          onSubmitEditing={() => {
            if (list[0]) pick(list[0]);
          }}
          style={styles.input}
        />
        {results.isFetching && open ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        {text ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={clear} style={styles.clear}>
            <Feather name="x" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {showPanel ? (
        <View style={styles.results}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.resultsScroll}>
            {list.map((result, index) => (
              <Pressable
                key={`${result.latitude},${result.longitude},${index}`}
                accessibilityRole="button"
                accessibilityLabel={[result.name, result.address].filter(Boolean).join(', ')}
                onPress={() => pick(result)}
                style={({ pressed }) => [styles.result, index > 0 && styles.resultDivider, pressed && styles.resultPressed]}>
                <Feather name="map-pin" size={16} color={colors.accent} />
                <View style={styles.resultText}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {result.name}
                  </Text>
                  {result.address ? (
                    <Text style={styles.resultAddress} numberOfLines={1}>
                      {result.address}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
            {list.length === 0 && !results.isFetching ? (
              <Text style={styles.empty}>
                {results.isError ? 'Search isn’t working right now. Try again in a moment.' : `No results for “${query}”.`}
              </Text>
            ) : null}
          </ScrollView>
          <Text style={styles.credit}>Search © OpenStreetMap contributors</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: 12,
    backgroundColor: colors.surface,
    boxShadow: `0 2px 10px ${shadow(colors, 0.1)}`,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  clear: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  results: {
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    boxShadow: `0 4px 14px ${shadow(colors, 0.12)}`,
  },
  resultsScroll: {
    maxHeight: 300,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
  },
  resultDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  resultPressed: {
    backgroundColor: colors.accentSoft,
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
  resultAddress: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  empty: {
    padding: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  credit: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    backgroundColor: colors.bg,
  },
}));
