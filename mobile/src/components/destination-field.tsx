import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { api, type Schemas } from '@/api/client';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing, touchTarget } from '@/theme/tokens';
import { select } from '@/utils/haptics';

// A place picked from the suggestions, or typed as is (then it has only a name, and the server
// looks up the rest)
export type PickedDestination = Schemas['DestinationSuggestion'];

// Same as the backend's MAX_DESTINATIONS
export const MAX_DESTINATIONS = 10;

const DEBOUNCE_MS = 300;

type DestinationFieldProps = {
  label: string;
  hint?: string;
  value: PickedDestination[];
  onChange: (destinations: PickedDestination[]) => void;
  // What's typed but not yet added, so the form can add it when it's submitted
  text: string;
  onChangeText: (text: string) => void;
  error?: string;
};

function samePlace(a: PickedDestination, b: PickedDestination) {
  return a.name.toLowerCase() === b.name.toLowerCase() && (a.address ?? '') === (b.address ?? '');
}

/**
 * Where a trip goes. Typing suggests cities, islands, regions and countries; picking one, or
 * pressing Enter, turns it into a bubble, and the field is ready for the next place.
 */
export function DestinationField({ label, hint, value, onChange, text, onChangeText, error }: DestinationFieldProps) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState('');

  // Ask for suggestions once typing pauses
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const suggestions = useQuery({
    queryKey: ['trips', 'destinations', query.toLowerCase()],
    queryFn: () => api<PickedDestination[]>('/trips/destinations', { query: { q: query } }),
    enabled: query.length >= 2,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const typing = text.trim();
  // Only suggestions for what's typed now, not for what was typed before the pause
  const list = typing.length >= 2 && query === typing ? (suggestions.data ?? []).filter((s) => !value.some((v) => samePlace(v, s))) : [];
  const full = value.length >= MAX_DESTINATIONS;

  const add = (destination: PickedDestination) => {
    select();
    if (!value.some((existing) => samePlace(existing, destination))) onChange([...value, destination]);
    onChangeText('');
  };

  // Enter adds the top suggestion when it's what's being typed ("kyoto" → Kyoto, Japan), and
  // otherwise the text as typed
  const addTyped = () => {
    if (!typing) return;
    const top = list[0];
    add(top && top.name.toLowerCase().startsWith(typing.toLowerCase()) ? top : { name: typing });
  };

  const remove = (index: number) => {
    select();
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.field}>
      <Text nativeID={`${id}-label`} style={styles.label}>
        {label}
      </Text>

      <View style={[styles.box, focused && styles.boxFocused, error ? styles.boxError : null]}>
        {value.map((destination, index) => (
          <View key={`${destination.name}-${destination.address ?? ''}`} style={styles.bubble}>
            <Feather name="map-pin" size={13} color={colors.accentStrong} />
            <Text style={styles.bubbleText} numberOfLines={1}>
              {destination.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${destination.name}`}
              hitSlop={10}
              onPress={() => remove(index)}>
              <Feather name="x" size={14} color={colors.accentStrong} />
            </Pressable>
          </View>
        ))}
        {!full ? (
          <TextInput
            accessibilityLabel={value.length ? `Add another ${label.toLowerCase()}` : label}
            aria-labelledby={`${id}-label`}
            value={text}
            onChangeText={onChangeText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={addTyped}
            // Stay in the field after Enter, ready for the next place
            submitBehavior="submit"
            onKeyPress={(event) => {
              // Backspace in an empty field takes off the last bubble
              if (event.nativeEvent.key === 'Backspace' && !text && value.length) remove(value.length - 1);
            }}
            placeholder={value.length ? 'Add another place' : 'e.g. Tokyo'}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            autoCorrect={false}
            keyboardAppearance={scheme}
            style={styles.input}
          />
        ) : null}
      </View>

      {list.length || (suggestions.isFetching && typing.length >= 2) ? (
        <View style={styles.suggestions} accessibilityRole="list">
          {list.map((suggestion, index) => (
            <Pressable
              key={`${suggestion.latitude},${suggestion.longitude},${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Add ${[suggestion.name, suggestion.address].filter(Boolean).join(', ')}`}
              onPress={() => add(suggestion)}
              style={({ pressed }) => [styles.suggestion, index > 0 && styles.suggestionDivider, pressed && styles.pressed]}>
              <Feather name="map-pin" size={16} color={colors.accent} style={styles.suggestionIcon} />
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {suggestion.name}
                </Text>
                {suggestion.address ? (
                  <Text style={styles.suggestionAddress} numberOfLines={1}>
                    {suggestion.address}
                  </Text>
                ) : null}
              </View>
              <Feather name="plus" size={18} color={colors.muted} />
            </Pressable>
          ))}
          {suggestions.isFetching && !list.length ? (
            <ActivityIndicator color={colors.accent} style={styles.suggestionsLoading} />
          ) : null}
          <Text style={styles.credit}>Suggestions © OpenStreetMap contributors</Text>
        </View>
      ) : null}

      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : full ? (
        <Text style={styles.hint}>That’s the most places one trip can have.</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  field: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  box: {
    minHeight: 52,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
  },
  boxFocused: {
    borderColor: colors.accent,
  },
  boxError: {
    borderColor: colors.danger,
  },
  bubble: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 32,
    paddingLeft: 10,
    paddingRight: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  bubbleText: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accentStrong,
  },
  input: {
    flexGrow: 1,
    minWidth: 120,
    minHeight: 34,
    paddingHorizontal: 6,
    paddingVertical: 0,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  suggestions: {
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  suggestionIcon: {
    width: 16,
  },
  suggestionText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  suggestionName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  suggestionAddress: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  suggestionsLoading: {
    paddingVertical: spacing.md,
  },
  credit: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    backgroundColor: colors.bg,
  },
  pressed: {
    opacity: 0.7,
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
