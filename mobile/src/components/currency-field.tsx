import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, SectionList, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { COMMON_CURRENCIES, CURRENCIES, currencySymbol, searchCurrencies } from '@/utils/currencies';
import { select } from '@/utils/haptics';

type CurrencyFieldProps = {
  label: string;
  value: string;
  onChange: (code: string) => void;
  // The destination's own currency, listed first, e.g. JPY for Tokyo
  suggested?: string | null;
  suggestedFor?: string;
  error?: string;
};

// Looks like the other fields; tapping it opens a searchable list of currencies
export function CurrencyField({ label, value, onChange, suggested, suggestedFor, error }: CurrencyFieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const symbol = currencySymbol(value);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${CURRENCIES[value] ?? value}`}
        accessibilityHint="Opens a list of currencies"
        onPress={() => {
          select();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.input, error ? styles.inputError : null, pressed && styles.pressed]}>
        <Text style={styles.value} numberOfLines={1}>
          {symbol ? <Text style={styles.symbol}>{symbol} </Text> : null}
          {value}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        {open ? (
          <CurrencySheet
            value={value}
            suggested={suggested}
            suggestedFor={suggestedFor}
            onClose={() => setOpen(false)}
            onPick={(code) => {
              onChange(code);
              setOpen(false);
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

type Section = { title: string; data: string[] };

function CurrencySheet({
  value,
  suggested,
  suggestedFor,
  onClose,
  onPick,
}: {
  value: string;
  suggested?: string | null;
  suggestedFor?: string;
  onClose: () => void;
  onPick: (code: string) => void;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const sections = useMemo<Section[]>(() => {
    if (query.trim()) return [{ title: '', data: searchCurrencies(query) }];

    const top = suggested && CURRENCIES[suggested] ? [suggested] : [];
    const common = COMMON_CURRENCIES.filter((code) => !top.includes(code));
    const list: Section[] = [];
    if (top.length) list.push({ title: suggestedFor ? `Used in ${suggestedFor}` : 'Suggested', data: top });
    list.push({ title: 'Common', data: common });
    list.push({ title: 'All currencies', data: Object.keys(CURRENCIES) });
    return list;
  }, [query, suggested, suggestedFor]);

  return (
    <View style={styles.fill}>
      <Animated.View entering={FadeIn.duration(150)} style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close currencies" style={styles.fill} onPress={onClose} />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}
          style={[styles.sheetWrap, { paddingTop: insets.top + spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          pointerEvents="box-none">
          <Glass style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Currency</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={onClose}>
                <Feather name="x" size={20} color={colors.muted} />
              </Pressable>
            </View>

            <View style={styles.search}>
              <Feather name="search" size={17} color={colors.muted} />
              <TextInput
                accessibilityLabel="Search currencies"
                value={query}
                onChangeText={setQuery}
                placeholder="Search, e.g. yen or EUR"
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                keyboardAppearance={scheme}
                style={styles.searchInput}
              />
            </View>

            <SectionList
              sections={sections}
              keyExtractor={(code, index) => `${code}-${index}`}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              stickySectionHeadersEnabled={false}
              initialNumToRender={20}
              style={styles.list}
              renderSectionHeader={({ section }) =>
                section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null
              }
              renderItem={({ item }) => (
                <CurrencyRow code={item} selected={item === value} onPress={() => onPick(item)} />
              )}
              ListEmptyComponent={<Text style={styles.empty}>No currency matches “{query.trim()}”</Text>}
            />
          </Glass>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function CurrencyRow({ code, selected, onPress }: { code: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const symbol = currencySymbol(code);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${CURRENCIES[code]}, ${code}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Text style={styles.code}>{code}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {CURRENCIES[code]}
        {symbol ? <Text style={styles.rowSymbol}>  {symbol}</Text> : null}
      </Text>
      {selected ? <Feather name="check" size={18} color={colors.accent} /> : null}
    </Pressable>
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
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inputError: {
    borderColor: colors.danger,
  },
  pressed: {
    opacity: 0.8,
  },
  value: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  symbol: {
    color: colors.muted,
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.dangerText,
  },
  fill: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: `rgba(${colors.shadow}, 0.35)`,
  },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    paddingHorizontal: spacing.md,
    width: '100%',
    maxWidth: 520,
    maxHeight: '100%',
    alignSelf: 'center',
  },
  sheet: {
    borderRadius: 26,
    padding: spacing.sm,
    gap: spacing.xs,
    // Tall enough to browse, but never past the top of the screen
    height: 560,
    maxHeight: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  title: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 18,
    color: colors.ink,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: radii.input,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  list: {
    flex: 1,
  },
  sectionTitle: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
  },
  rowPressed: {
    backgroundColor: `rgba(${colors.shadow}, 0.08)`,
  },
  code: {
    width: 44,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  name: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  rowSymbol: {
    color: colors.muted,
  },
  empty: {
    padding: spacing.md,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
}));
