import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { tripKeys, useTrips, type TripSummary } from '@/api/trips';
import { Button } from '@/components/button';
import { PressableScale } from '@/components/pressable-scale';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { sharedLink } from '@/share/share-intent';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { formatDateRange, tripPhase } from '@/utils/dates';
import { success } from '@/utils/haptics';
import { isSupportedLink, UNSUPPORTED_LINK } from '@/utils/links';

const PLATFORMS: [RegExp, string][] = [
  [/tiktok\.com/i, 'TikTok'],
  [/youtube\.com|youtu\.be/i, 'YouTube'],
  [/instagram\.com/i, 'Instagram'],
];

function platformOf(url: string): string {
  const known = PLATFORMS.find(([pattern]) => pattern.test(url))?.[1];
  if (known) return known;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

function saveError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return 'You can only look at this trip. Ask its owner to make you a member.';
  if (error instanceof ApiError && error.status === 422) return UNSUPPORTED_LINK;
  return error instanceof Error ? error.message : 'That didn’t work. Try again.';
}

// "Save to a trip": opened when something is shared to Triplet from another app
export default function ShareScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const trips = useTrips();
  const [saved, setSaved] = useState<TripSummary | null>(null);

  const url = sharedLink(shareIntent);
  const title = shareIntent.meta?.title ?? null;

  const save = useMutation({
    mutationFn: (trip: TripSummary) => api(`/trips/${trip.id}/links`, { method: 'POST', body: { url } }),
    onSuccess: (_, trip) => {
      success();
      setSaved(trip);
      queryClient.invalidateQueries({ queryKey: tripKeys.links(trip.id) });
      queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
    },
  });

  const close = () => {
    resetShareIntent();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const openTrip = (trip: TripSummary) => {
    resetShareIntent();
    router.replace({ pathname: '/trips/[tripId]/saved', params: { tripId: String(trip.id) } });
  };

  // Trips that are on now or coming up first, then past ones
  const sorted = [...(trips.data ?? [])]
    .filter((trip) => trip.start_date && trip.end_date)
    .map((trip) => ({ trip, phase: tripPhase(trip.start_date!, trip.end_date!) }))
    .sort((a, b) => {
      const rank = (phase: string) => (phase === 'now' ? 0 : phase === 'upcoming' ? 1 : 2);
      return rank(a.phase.phase) - rank(b.phase.phase) || a.trip.start_date!.localeCompare(b.trip.start_date!);
    });

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title={saved ? 'Saved' : 'Save to a trip'} icon="close" onBack={close} />

        {!url ? (
          <View style={styles.state}>
            <FormMessage message="There’s no link in what you shared. Use the Share button on a TikTok, YouTube or Instagram post, then choose Triplet." />
            <Button label="Close" variant="secondary" onPress={close} />
          </View>
        ) : !isSupportedLink(url) ? (
          <View style={styles.state}>
            <FormMessage message={`${UNSUPPORTED_LINK} Use the Share button on a TikTok, YouTube or Instagram post, then choose Triplet.`} />
            <Button label="Close" variant="secondary" onPress={close} />
          </View>
        ) : (
          <>
            <View style={styles.preview}>
              <View style={styles.previewIcon}>
                <Feather name="film" size={20} color={colors.accent} />
              </View>
              <View style={styles.previewText}>
                <Text style={styles.previewSource}>{platformOf(url)}</Text>
                <Text style={styles.previewTitle} numberOfLines={2}>
                  {title ?? url}
                </Text>
              </View>
            </View>

            {saved ? (
              <View style={styles.done}>
                <View style={styles.doneIcon}>
                  <Feather name="check" size={26} color={colors.onAccent} />
                </View>
                <Text style={styles.doneTitle}>Saved to {saved.title}</Text>
                <Text style={styles.doneText}>
                  Triplet is watching the video and pulling out the places it mentions. They’ll show up in the Saved tab in a
                  minute.
                </Text>
                <Button label="Open trip" onPress={() => openTrip(saved)} />
                <Button label="Done" variant="secondary" onPress={close} />
              </View>
            ) : trips.isPending ? (
              <ActivityIndicator color={colors.accent} style={styles.loading} />
            ) : trips.isError ? (
              <View style={styles.state}>
                <FormMessage message={trips.error.message} />
                <Button label="Try again" variant="secondary" onPress={() => trips.refetch()} />
              </View>
            ) : sorted.length === 0 ? (
              <View style={styles.state}>
                <Text style={styles.doneText}>You don’t have a trip to save this to yet.</Text>
                <Button label="Create a trip" onPress={() => router.push('/trips/new')} />
              </View>
            ) : (
              <View style={styles.list}>
                <Text style={styles.listTitle}>Which trip?</Text>
                <FormMessage message={save.error ? saveError(save.error) : null} />
                {sorted.map(({ trip, phase }) => {
                  const saving = save.isPending && save.variables?.id === trip.id;
                  return (
                    <PressableScale
                      key={trip.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Save to ${trip.title}`}
                      disabled={save.isPending}
                      onPress={() => save.mutate(trip)}
                      scaleTo={0.98}
                      style={[styles.trip, phase.phase === 'past' && styles.tripPast]}>
                      <View style={styles.tripText}>
                        <Text style={styles.tripTitle} numberOfLines={1}>
                          {trip.title}
                        </Text>
                        <Text style={styles.tripMeta} numberOfLines={1}>
                          {trip.destination} · {formatDateRange(trip.start_date!, trip.end_date!)}
                        </Text>
                      </View>
                      {saving ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : (
                        <Feather name="plus-circle" size={22} color={colors.accent} />
                      )}
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </>
        )}

        {!saved && url ? (
          <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
            <Text style={styles.cancelLabel}>Not now</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.lg,
  },
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  previewIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  previewText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  previewSource: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    color: colors.muted,
  },
  previewTitle: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  list: {
    gap: spacing.sm,
  },
  listTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  trip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  tripPast: {
    opacity: 0.7,
  },
  tripText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tripTitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
  },
  tripMeta: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  done: {
    gap: spacing.md,
    alignItems: 'stretch',
  },
  doneIcon: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  doneTitle: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 22,
    textAlign: 'center',
    color: colors.ink,
  },
  doneText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.muted,
  },
  cancel: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
  },
}));
