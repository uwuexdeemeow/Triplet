import { Feather } from '@expo/vector-icons';
import { router, Slot, useLocalSearchParams, usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMembers, useTrip } from '@/api/trips';
import { FormMessage } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { colors, fonts, radii, spacing, touchTarget } from '@/theme/tokens';
import { formatDateRange } from '@/utils/dates';

const SECTIONS = [
  { label: 'Plan', pathname: '/trips/[tripId]', suffix: '' },
  { label: 'Map', pathname: '/trips/[tripId]/map', suffix: '/map' },
  { label: 'Saved', pathname: '/trips/[tripId]/saved', suffix: '/saved' },
  { label: 'Budget', pathname: '/trips/[tripId]/budget', suffix: '/budget' },
  { label: 'People', pathname: '/trips/[tripId]/people', suffix: '/people' },
] as const;

export default function TripSectionsLayout() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const pathname = usePathname();
  const trip = useTrip(id);
  const members = useMembers(id);

  const active = SECTIONS.find((section) => section.suffix && pathname.endsWith(section.suffix)) ?? SECTIONS[0];

  const subtitle = trip.data
    ? [
        trip.data.start_date && trip.data.end_date ? formatDateRange(trip.data.start_date, trip.data.end_date) : null,
        members.data ? `${members.data.length} ${members.data.length === 1 ? 'person' : 'people'}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <ScreenHeader
          title={trip.data?.title ?? ' '}
          subtitle={subtitle}
          onBack={() => router.replace('/')}
          right={
            trip.data ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Trip settings"
                accessibilityHint="Rename the trip, set its budget or delete it"
                onPress={() => router.push({ pathname: '/trips/[tripId]/settings', params: { tripId } })}
                style={({ pressed }) => [styles.settings, pressed && styles.pressed]}>
                <Feather name="settings" size={20} color={colors.ink} />
              </Pressable>
            ) : null
          }
        />

        <View accessibilityRole="tablist" style={styles.tabs}>
          {SECTIONS.map((section) => {
            const selected = section === active;
            return (
              <Pressable
                key={section.label}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  // Replace so switching sections doesn't pile up back history
                  if (!selected) router.replace({ pathname: section.pathname, params: { tripId } });
                }}
                style={[styles.tab, selected && styles.tabSelected]}>
                <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{section.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {trip.isPending ? (
        <ActivityIndicator color={colors.teal} style={styles.loading} />
      ) : trip.isError ? (
        <View style={styles.error}>
          <FormMessage message={trip.error.message} />
        </View>
      ) : (
        <Slot />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.lg,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    backgroundColor: colors.chip,
    borderRadius: 14,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.input - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: {
    backgroundColor: colors.card,
  },
  tabLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  tabLabelSelected: {
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  loading: {
    marginTop: spacing.xxl,
  },
  settings: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: 999,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    padding: 20,
  },
});
