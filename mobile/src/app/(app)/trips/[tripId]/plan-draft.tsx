import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, type PlanDraft, type PlanDraftItem } from '@/api/trips';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Body, Muted } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { activityClock, formatLongDate } from '@/utils/dates';
import { success } from '@/utils/haptics';

// A suggested day and time for every saved place, to check and add in one go
export default function PlanDraftScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const queryClient = useQueryClient();
  // Places the user unticked; everything else gets added
  const [left, setLeft] = useState<Set<number>>(() => new Set());

  const draft = useQuery({
    queryKey: [...tripKeys.trip(id), 'plan-draft'],
    queryFn: () => api<PlanDraft>(`/trips/${id}/plan-draft`, { method: 'POST' }),
    // Always a fresh draft, since the plan may have changed
    gcTime: 0,
  });

  const kept = draft.data?.items.filter((item) => !left.has(item.place_id)) ?? [];

  const apply = useMutation({
    mutationFn: (items: PlanDraftItem[]) =>
      api(`/trips/${id}/plan-draft/apply`, {
        method: 'POST',
        body: {
          items: items.map(({ place_id, start_time, end_time }) => ({ place_id, start_time, end_time })),
        },
      }),
    onSuccess: () => {
      success();
      queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.places(id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
      router.back();
    },
  });

  const toggle = (placeId: number) =>
    setLeft((current) => {
      const next = new Set(current);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });

  // Group by day, in order
  const days: { date: string; items: PlanDraftItem[] }[] = [];
  for (const item of draft.data?.items ?? []) {
    const date = item.start_time.slice(0, 10);
    const last = days[days.length - 1];
    if (last?.date === date) last.items.push(item);
    else days.push({ date, items: [item] });
  }

  const errorMessage =
    apply.error instanceof ApiError && apply.error.status === 403
      ? 'Viewers can’t change the plan. Ask the trip owner to make you a member.'
      : (apply.error?.message ?? null);

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title="Plan everyone’s saves" icon="close" />

        {draft.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Muted>Fitting your saved places around opening hours and travel…</Muted>
          </View>
        ) : draft.isError ? (
          <View style={styles.section}>
            <FormMessage message={draft.error.message} />
            <Button label="Try again" variant="secondary" onPress={() => draft.refetch()} />
          </View>
        ) : (
          <>
            <Body style={styles.intro}>
              {draft.data.items.length === 0
                ? 'Everything saved is already in the plan, or couldn’t fit.'
                : `Here’s where ${draft.data.items.length === 1 ? 'it' : `the ${draft.data.items.length} places`} could go. Untick anything you don’t want, then add the rest. You can move plans afterwards.`}
              {draft.data.merged_count > 0
                ? ` ${draft.data.merged_count} ${draft.data.merged_count === 1 ? 'place was' : 'places were'} saved by more than one person and ${draft.data.merged_count === 1 ? 'is' : 'are'} only listed once.`
                : ''}
            </Body>

            {days.map((day) => (
              <View key={day.date} style={styles.section}>
                <Text style={styles.dayTitle}>{formatLongDate(day.date)}</Text>
                {day.items.map((item) => {
                  const selected = !left.has(item.place_id);
                  return (
                    <Pressable
                      key={item.place_id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => toggle(item.place_id)}
                      style={({ pressed }) => [styles.item, !selected && styles.itemOff, pressed && styles.pressed]}>
                      <View style={[styles.check, selected && styles.checkOn]}>
                        {selected ? <Feather name="check" size={14} color={colors.onAccent} /> : null}
                      </View>
                      <View style={styles.itemText}>
                        <Text style={styles.itemTitle}>{item.name}</Text>
                        <Text style={styles.itemDetail}>
                          {activityClock(item.start_time)} – {activityClock(item.end_time)} · {item.reason}
                        </Text>
                        {item.saved_by.length > 0 ? (
                          <Text style={styles.itemSavers}>Saved by {item.saved_by.join(', ')}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {draft.data.skipped.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.dayTitle}>Not added</Text>
                {draft.data.skipped.map((item) => (
                  <View key={item.place_id} style={styles.skipped}>
                    <Text style={styles.itemTitle}>{item.name}</Text>
                    <Text style={styles.itemDetail}>{item.reason}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <FormMessage message={errorMessage} />
            {draft.data.items.length > 0 ? (
              <Button
                label={kept.length === 0 ? 'Nothing ticked' : `Add ${kept.length} to the plan`}
                disabled={kept.length === 0}
                loading={apply.isPending}
                onPress={() => apply.mutate(kept)}
              />
            ) : (
              <Button label="Done" variant="secondary" onPress={() => router.back()} />
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.xl,
  },
  loading: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  intro: {
    color: colors.muted,
  },
  section: {
    gap: spacing.sm,
  },
  dayTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  itemOff: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.75,
  },
  check: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  itemDetail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  itemSavers: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.accentStrong,
  },
  skipped: {
    gap: 2,
    padding: spacing.md,
    borderRadius: radii.input,
    backgroundColor: colors.chip,
  },
}));
