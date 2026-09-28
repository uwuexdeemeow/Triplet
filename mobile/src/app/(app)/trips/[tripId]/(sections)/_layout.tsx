import { Feather } from '@expo/vector-icons';
import { router, Slot, useLocalSearchParams, usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMe, useMembers, useTrip } from '@/api/trips';
import { FormMessage } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing, touchTarget } from '@/theme/tokens';
import { formatDateRange } from '@/utils/dates';
import { useLayoutSize, useShowsMapPanel, useWideLayout } from '@/utils/layout';

const SECTIONS = [
  { label: 'Plan', pathname: '/trips/[tripId]', suffix: '' },
  { label: 'Map', pathname: '/trips/[tripId]/map', suffix: '/map' },
  { label: 'Saved', pathname: '/trips/[tripId]/saved', suffix: '/saved' },
  { label: 'Budget', pathname: '/trips/[tripId]/budget', suffix: '/budget' },
  { label: 'People', pathname: '/trips/[tripId]/people', suffix: '/people' },
] as const;

export default function TripSectionsLayout() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const pathname = usePathname();
  const trip = useTrip(id);
  const members = useMembers(id);

  const active = SECTIONS.find((section) => section.suffix && pathname.endsWith(section.suffix)) ?? SECTIONS[0];
  const wide = useWideLayout();
  const size = useLayoutSize();
  // With the map beside the plan, it doesn't need its own tab (unless you're already on it)
  const mapPanel = useShowsMapPanel();
  const sections = SECTIONS.filter((section) => !(mapPanel && section.label === 'Map' && active !== section));
  const me = useMe();
  const isOwner = members.data?.some((member) => member.user_id === me.data?.id && member.role === 'owner') ?? false;
  const openSettings = () => router.push({ pathname: '/trips/[tripId]/settings', params: { tripId } });

  const tabs = (
    <View accessibilityRole="tablist" style={wide ? styles.segments : styles.tabs}>
      {sections.map((section) => {
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
            style={({ hovered }) =>
              wide
                ? [styles.segment, selected ? styles.segmentSelected : hovered && styles.segmentHover]
                : [styles.tab, selected && styles.tabSelected]
            }>
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{section.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const subtitle = trip.data
    ? [
        trip.data.start_date && trip.data.end_date ? formatDateRange(trip.data.start_date, trip.data.end_date) : null,
        members.data ? `${members.data.length} ${members.data.length === 1 ? 'person' : 'people'}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  if (wide) {
    return (
      // Keeps the header clear of the status bar on a real tablet
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.wideHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to trips"
            onPress={() => router.replace('/')}
            style={({ hovered }) => [styles.back, hovered && styles.backHover]}>
            <Feather name="chevron-left" size={20} color={colors.ink} />
          </Pressable>
          <View style={styles.wideTitles}>
            <Text accessibilityRole="header" style={styles.wideTitle} numberOfLines={1}>
              {trip.data?.title ?? ' '}
            </Text>
            {subtitle ? <Text style={styles.wideSubtitle}>{subtitle}</Text> : null}
          </View>
          {tabs}
          <View style={styles.wideActions}>
            {/* Tablets are too narrow for it next to the tabs; it's in trip settings either way */}
            {isOwner && size === 'desktop' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens trip settings, where you can turn on a guest code"
                onPress={openSettings}
                style={({ hovered }) => [styles.outline, hovered && styles.outlineHover]}>
                <Text style={styles.outlineLabel}>Share guest code</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Trip settings"
              onPress={openSettings}
              style={({ hovered }) => [styles.settings, styles.settingsWide, hovered && styles.backHover]}>
              <Feather name="settings" size={18} color={colors.ink} />
            </Pressable>
          </View>
        </View>
        {trip.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
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
                accessibilityHint="Rename the trip, set its budget, share a guest code or delete it"
                onPress={openSettings}
                style={({ pressed }) => [styles.settings, pressed && styles.pressed]}>
                <Feather name="settings" size={20} color={colors.ink} />
              </Pressable>
            ) : null
          }
        />

        {tabs}
      </View>

      {trip.isPending ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
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

const useStyles = makeStyles((colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
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
  // Plain text tabs with a thin underline under the current one
  tabs: {
    flexDirection: 'row',
    gap: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tab: {
    minHeight: 40,
    justifyContent: 'center',
    // Sits over the row's bottom line
    marginBottom: -1,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabSelected: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    fontFamily: fonts.medium,
    fontSize: 14.5,
    color: colors.muted,
  },
  tabLabelSelected: {
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  loading: {
    marginTop: spacing.xxl,
  },
  // Big screens: one header row with the tabs as a segmented control
  wideHeader: {
    height: 72,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backHover: {
    backgroundColor: colors.line,
  },
  wideTitles: {
    flexShrink: 1,
    minWidth: 0,
  },
  wideTitle: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  wideSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  segments: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    marginLeft: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  segment: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: 9,
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: colors.chip,
  },
  segmentHover: {
    backgroundColor: colors.bg,
  },
  wideActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 10,
  },
  outline: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.accentMuted,
    justifyContent: 'center',
  },
  outlineHover: {
    backgroundColor: colors.accentSoft,
  },
  outlineLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  settingsWide: {
    width: 40,
    height: 40,
    borderRadius: 10,
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
}));
