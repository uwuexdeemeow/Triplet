import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import type { ItineraryActivity, StayStop, TravelLeg } from '@/api/trips';
import { ItemMenu } from '@/components/item-menu';
import { PressableScale } from '@/components/pressable-scale';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Muted } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { activityClock, dayOfMonth, formatLongDate, weekdayShort } from '@/utils/dates';
import { hasPin, openDirections, type Stop } from '@/utils/directions';
import { select, warn } from '@/utils/haptics';
import { formatMoney } from '@/utils/money';
import { platformLabel } from '@/utils/places';

// A day's plans as members and guests both see them: the day chips, the travel between plans, each
// plan's card, and the hotels the day starts and ends at. What editing does is passed in, as members
// and guests save through different APIs.

// One end of a trip between stops: a plan, or a hotel as a plan-shaped stop
type Endpoint = Pick<ItineraryActivity, 'title' | 'location' | 'latitude' | 'longitude'>;

export function stayEndpoint(stay: StayStop): Endpoint {
  return { title: stay.name, location: stay.address ?? '', latitude: stay.latitude, longitude: stay.longitude };
}

export function DayChips({
  days,
  selected,
  planned,
  onSelect,
  inset = 20,
}: {
  days: string[];
  selected: string;
  // Days with plans get a dot
  planned: Set<string>;
  onSelect: (day: string) => void;
  // Side padding, to line up with the content below
  inset?: number;
}) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.days, { paddingHorizontal: inset }]}
      style={styles.daysScroller}>
      {days.map((date) => {
        const isSelected = date === selected;
        return (
          <Pressable
            key={date}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${formatLongDate(date)}${planned.has(date) ? ', has plans' : ''}`}
            onPress={() => {
              select();
              onSelect(date);
            }}
            style={[styles.dayChip, isSelected && styles.dayChipSelected]}>
            <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>{weekdayShort(date)}</Text>
            <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>{dayOfMonth(date)}</Text>
            {planned.has(date) ? <View style={[styles.dot, isSelected && styles.dotSelected]} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// Under a day's plans, when they can be edited
export function EditHint({ wide }: { wide?: boolean }) {
  const styles = useStyles();
  return (
    <Muted style={styles.hint}>
      {wide
        ? 'Click a plan to edit it, or press and hold for more.'
        : `Tap a plan to edit it, or press and hold for more.${Platform.OS === 'web' ? '' : ' Swipe right to delete.'}`}
    </Muted>
  );
}

// Between two plans: roughly how long the trip takes at that time of day, and when to set off.
// Tapping it opens the route between them in the maps app.
export function TravelConnector({ leg, from, to }: { leg: TravelLeg; from?: Endpoint; to: Endpoint }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const how = leg.mode === 'walk' ? 'walk' : 'by train or taxi';
  const parts = [
    `~${leg.minutes} min ${how}`,
    `${leg.km} km`,
    leg.note,
    leg.leave_by ? `leave${from ? ` ${from.title}` : ''} by ${activityClock(leg.leave_by)}` : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`About ${leg.minutes} minutes ${how}, ${leg.km} kilometres${leg.note ? `, ${leg.note}` : ''}${leg.leave_by ? `. Leave by ${activityClock(leg.leave_by)}` : ''}`}
      accessibilityHint="Opens the route in your maps app"
      disabled={!from}
      onPress={() => from && openDirections(stopFor(to), stopFor(from), leg.mode === 'walk' ? 'walk' : 'transit')}
      style={({ pressed, hovered }) => [styles.travel, (pressed || hovered) && styles.travelActive]}>
      <View style={styles.travelLine} />
      <Feather name={leg.mode === 'walk' ? 'user' : 'navigation'} size={12} color={leg.note ? colors.secondText : colors.muted} />
      <Text style={[styles.travelText, leg.note ? styles.travelBusy : null]} numberOfLines={2}>
        {parts.join(' · ')}
      </Text>
      {from ? <Text style={styles.travelLink}>Route</Text> : null}
    </Pressable>
  );
}

function stopFor(activity: Endpoint): Stop {
  return { name: activity.title, address: activity.location, latitude: activity.latitude, longitude: activity.longitude };
}

/**
 * A hotel the day starts or ends at. "start" is where you woke up; "end" is where you sleep, which is
 * a check-in when it's a different hotel from the morning's (or the first night).
 */
export function StayRow({
  stay,
  role,
  onPress,
  area,
}: {
  stay: StayStop;
  role: 'start' | 'back' | 'check-in';
  // Left out, the stay can't be changed from here
  onPress?: () => void;
  // Where the trip is, so directions to a hotel without a pin search there
  area?: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const label = role === 'start' ? 'Start the day at' : role === 'back' ? 'Back to' : 'Check in at';
  return (
    <View style={styles.row}>
      <View style={[styles.timeColumn, styles.stayIconColumn]}>
        <View style={styles.stayIcon}>
          <Feather name={role === 'start' ? 'sun' : 'moon'} size={14} color={colors.accentStrong} />
        </View>
      </View>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`${label} ${stay.name}`}
        accessibilityHint={onPress ? 'Opens the stay to edit it' : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed, hovered }) => [styles.stayCard, onPress && (pressed || hovered) && styles.stayCardActive]}>
        <View style={styles.stayText}>
          <Text style={styles.stayLabel}>{label}</Text>
          <Text style={styles.stayName} numberOfLines={1}>
            {stay.name}
          </Text>
        </View>
        {!hasPin(stay) && onPress ? (
          // Without a pin the maps app would only be guessing, so ask for the spot instead
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens the stay to pick where it is"
            onPress={onPress}
            hitSlop={6}
            style={({ pressed, hovered }) => [styles.badge, styles.badgeAction, (pressed || hovered) && styles.badgeActionActive]}>
            <Feather name="map-pin" size={12} color={colors.accentStrong} />
            <Text style={[styles.badgeText, styles.badgeActionText]}>Set the location</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Directions to ${stay.name}`}
            accessibilityHint="Opens your maps app"
            onPress={() => openDirections({ ...stopFor(stayEndpoint(stay)), area })}
            hitSlop={6}
            style={({ pressed, hovered }) => [styles.badge, styles.badgeAction, (pressed || hovered) && styles.badgeActionActive]}>
            <Feather name="navigation" size={12} color={colors.accentStrong} />
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}

// At the end of a day with no hotel booked that night, for people who can add one
export function AddStayPrompt({ onPress }: { onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.timeColumn} />
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed, hovered }) => [styles.addStay, (pressed || hovered) && styles.stayCardActive]}>
        <Feather name="moon" size={14} color={colors.accent} />
        <Text style={styles.addStayLabel}>Where are you staying tonight?</Text>
      </Pressable>
    </View>
  );
}

/** What someone who can change the plan can do to one. Left out, the plan is view-only. */
export type ActivityActions = {
  onEdit: () => void;
  onRename: (title: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  // Said under "Delete this plan?"
  deleteDetail?: string;
  // Opens somewhere to pin the plan on the map, offered instead of directions when it has no pin
  onSetLocation?: () => void;
};

export function ActivityRow({
  activity,
  titles,
  currency,
  paid,
  stop,
  actions,
  area,
}: {
  activity: ItineraryActivity;
  // The day's plans by id, to name the ones this overlaps
  titles: Map<number, string>;
  // Left out, no costs are shown
  currency?: string;
  // Total of the expenses linked to this plan, if any
  paid?: number;
  // The plan's number in the day, shown when the side map is visible
  stop?: number;
  actions?: ActivityActions;
  // Where the trip is, so directions to a plan without a pin search there
  area?: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const canEdit = !!actions;

  const remove = useMutation({ mutationFn: () => actions!.onDelete() });

  const conflicts = activity.conflicts_with ?? [];
  const warnings = activity.warnings ?? [];
  const details = [
    `Until ${activityClock(activity.end_time)}`,
    activity.location,
    // What was actually spent wins over the estimate; the estimate comes back if those expenses are deleted
    !currency
      ? null
      : paid
        ? `Paid ${formatMoney(paid, currency)}`
        : activity.estimated_cost != null
          ? activity.estimated_cost === 0
            ? 'Free'
            : `About ${formatMoney(activity.estimated_cost, currency)}`
          : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const card = (
    <PressableScale
      accessibilityRole="button"
      accessibilityHint={canEdit ? 'Opens the plan to edit it. Press and hold for more options.' : undefined}
      disabled={!canEdit}
      onPress={actions?.onEdit}
      // Press and hold for Edit, Rename and Delete
      onLongPress={() => {
        warn();
        setMenuOpen(true);
      }}
      delayLongPress={350}
      scaleTo={0.98}
      style={[styles.card, conflicts.length > 0 && styles.cardConflict]}>
      <Text style={styles.cardTitle}>{activity.title}</Text>
      <Text style={styles.cardDetails} numberOfLines={2}>
        {details}
      </Text>
      {activity.description ? (
        <Text style={styles.cardDescription} numberOfLines={3}>
          {activity.description}
        </Text>
      ) : null}
      {warnings.map((warning) => {
        const closed = warning.kind === 'closed';
        return (
          <View key={warning.kind} style={[styles.warning, closed ? styles.warningDanger : styles.warningCheck]}>
            <Feather
              name={warning.kind === 'tight_travel' ? 'navigation' : 'clock'}
              size={13}
              color={closed ? colors.dangerText : colors.secondText}
            />
            <Text style={[styles.warningText, { color: closed ? colors.dangerText : colors.secondText }]}>
              {warning.message}
            </Text>
          </View>
        );
      })}
      <View style={styles.badges}>
        {!hasPin(activity) && actions?.onSetLocation ? (
          // Without a pin the maps app would only be guessing from the typed place, so ask for the spot instead
          <Pressable
            accessibilityRole="link"
            accessibilityHint="Opens the plan to pick where it is on the map"
            onPress={actions.onSetLocation}
            hitSlop={6}
            style={({ pressed, hovered }) => [styles.badge, styles.badgeAction, (pressed || hovered) && styles.badgeActionActive]}>
            <Feather name="map-pin" size={12} color={colors.accentStrong} />
            <Text style={[styles.badgeText, styles.badgeActionText]}>Set the location</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Directions to ${activity.title}`}
            accessibilityHint="Opens your maps app"
            onPress={() => openDirections({ ...stopFor(activity), area })}
            hitSlop={6}
            style={({ pressed, hovered }) => [styles.badge, styles.badgeAction, (pressed || hovered) && styles.badgeActionActive]}>
            <Feather name="navigation" size={12} color={colors.accentStrong} />
            <Text style={[styles.badgeText, styles.badgeActionText]}>Directions</Text>
          </Pressable>
        )}
        {activity.source_link_id != null ? (
          <View style={styles.badge}>
            <Feather name="link" size={12} color={colors.muted} />
            <Text style={styles.badgeText}>From {platformLabel(activity.source_platform)}</Text>
          </View>
        ) : null}
        {conflicts.map((otherId) => (
          <View key={otherId} style={[styles.badge, styles.badgeConflict]}>
            <Feather name="alert-triangle" size={12} color={colors.dangerText} />
            <Text style={[styles.badgeText, styles.badgeConflictText]}>Overlaps {titles.get(otherId) ?? 'another plan'}</Text>
          </View>
        ))}
      </View>
      {remove.error ? <Text style={styles.deleteError}>{remove.error.message}</Text> : null}
    </PressableScale>
  );

  return (
    <View style={styles.row}>
      <View style={styles.timeColumn}>
        <Text style={styles.time}>{activityClock(activity.start_time)}</Text>
        {/* The same number as its pin on the side map */}
        {stop ? (
          <View style={styles.stop} accessible accessibilityLabel={`Stop ${stop}`}>
            <Text style={styles.stopText}>{stop}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.swipe}>
        {actions ? (
          <SwipeToDelete label={`Delete ${activity.title}`} radius={16} onDelete={() => remove.mutateAsync()}>
            {card}
          </SwipeToDelete>
        ) : (
          card
        )}
      </View>
      {actions ? (
        <ItemMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          title={activity.title}
          subtitle={details}
          actions={[{ label: 'Edit plan', icon: 'sliders', onPress: actions.onEdit }]}
          rename={{
            value: activity.title,
            placeholder: 'e.g. Lunch at Menya Itto',
            onSave: async (title) => {
              await actions.onRename(title);
            },
          }}
          remove={{
            question: 'Delete this plan?',
            detail: actions.deleteDetail,
            onDelete: () => remove.mutateAsync(),
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  daysScroller: {
    flexGrow: 0,
  },
  days: {
    paddingTop: spacing.xs,
    paddingBottom: 14,
    gap: spacing.sm,
  },
  dayChip: {
    width: 58,
    height: 68,
    borderRadius: 12,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dayName: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
  },
  dayNameSelected: {
    color: colors.accentSoft,
  },
  dayNumber: {
    fontFamily: fonts.bold,
    fontSize: 19,
    color: colors.ink,
  },
  dayNumberSelected: {
    color: colors.onAccent,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  dotSelected: {
    backgroundColor: colors.onAccent,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  timeColumn: {
    width: 48,
    gap: 6,
  },
  stop: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  stopText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.onAccent,
  },
  time: {
    width: 48,
    paddingTop: 14,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
  swipe: {
    flex: 1,
  },
  deleteError: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.dangerText,
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    gap: 3,
  },
  cardConflict: {
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  cardDetails: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  cardDescription: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    marginTop: 4,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.muted,
  },
  badgeConflict: {
    backgroundColor: colors.dangerSoft,
  },
  badgeAction: {
    backgroundColor: colors.accentSoft,
  },
  badgeActionActive: {
    opacity: 0.75,
  },
  badgeActionText: {
    color: colors.accentStrong,
  },
  badgeConflictText: {
    color: colors.dangerText,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  warningDanger: {
    backgroundColor: colors.dangerSoft,
  },
  warningCheck: {
    backgroundColor: colors.secondSoft,
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },
  travel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Lines up under the cards, past the time column
    paddingLeft: 48 + spacing.md + 14,
    marginBottom: spacing.sm,
  },
  travelLine: {
    position: 'absolute',
    left: 48 + spacing.md + 5,
    top: -spacing.md,
    bottom: -spacing.sm,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.chip,
  },
  travelText: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.muted,
  },
  // Rush hour or a late taxi: the trip takes longer than usual
  travelBusy: {
    color: colors.secondText,
  },
  travelActive: {
    opacity: 0.7,
  },
  stayIconColumn: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  stayIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  stayCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
  },
  stayCardActive: {
    opacity: 0.75,
  },
  stayText: {
    flex: 1,
    gap: 1,
  },
  stayLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.accentStrong,
  },
  stayName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  addStay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentMuted,
  },
  addStayLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  travelLink: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.accent,
  },
}));
