import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { api, ApiError, resolveApiUrl } from '@/api/client';
import {
  isProcessing,
  tripKeys,
  useItinerary,
  useLinks,
  useMe,
  useMembers,
  usePlaces,
  type SavedLink,
  type TripPlace,
} from '@/api/trips';
import { Enter } from '@/components/enter';
import { Button } from '@/components/button';
import { ItemMenu } from '@/components/item-menu';
import { PressableScale } from '@/components/pressable-scale';
import { FormMessage } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Body, Muted, Title } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { warn } from '@/utils/haptics';
import { useLayoutSize, useWideLayout } from '@/utils/layout';
import { usePullToRefresh } from '@/utils/pull-to-refresh';
import { isSupportedLink, UNSUPPORTED_LINK } from '@/utils/links';
import { linkTitle, needsCheck, placeDetail, platformName } from '@/utils/places';
import { pickAndUploadScreenshot } from '@/utils/screenshot-upload';

export default function SavedScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const queryClient = useQueryClient();

  const links = useLinks(id);
  const anyProcessing = links.data?.some(isProcessing) ?? false;
  const places = usePlaces(id, { polling: anyProcessing });
  const itinerary = useItinerary(id);
  const me = useMe();
  const members = useMembers(id);
  const role = members.data?.find((member) => member.user_id === me.data?.id)?.role;
  const canEdit = role === 'owner' || role === 'member';
  // Cards start collapsed. Kept here so polling refetches don't close them again.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // Big screens: which post is open on the right
  const [pickedId, setPickedId] = useState<number | null>(null);
  const wide = useWideLayout();
  const size = useLayoutSize();

  const toggle = (linkId: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });

  // Which day each planned activity is on, for "In the plan · Fri 2 Oct"
  const activityDays = new Map<number, string>();
  for (const day of itinerary.data?.days ?? []) {
    for (const activity of day.activities) activityDays.set(activity.id, day.date);
  }

  // Places to stay aren't planned as outings, and neither is someone's copy of a place already
  // planned (the same name, like the planner's "Already in the plan from another save")
  const sameName = (name: string) =>
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const plannedNames = new Set(
    places.data?.filter((place) => place.activity_ids.length > 0).map((place) => sameName(place.name)),
  );
  const unplanned =
    places.data?.filter(
      (place) =>
        place.activity_ids.length === 0 && place.category !== 'accommodation' && !plannedNames.has(sameName(place.name)),
    ).length ?? 0;

  const refresh = () => Promise.all([links.refetch(), places.refetch(), itinerary.refetch()]);
  // The list also re-checks every few seconds while a post is processed; only a pull shows the spinner
  const pull = usePullToRefresh(refresh);

  const placesFor = (link: SavedLink) =>
    // Prefer the places list, which knows what's planned, then fall back to the link's own copy
    places.data?.filter((place) => place.link_id === link.id) ?? (link.places as TripPlace[]);

  // Big screens: the posts down the left, the one you picked open on the right
  if (wide && links.data && links.data.length > 0) {
    const picked = links.data.find((link) => link.id === pickedId) ?? links.data[0];
    return (
      <View style={styles.wide}>
        <ScrollView
          style={[styles.wideList, size === 'tablet' && styles.wideListTablet]}
          contentContainerStyle={styles.wideListContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />}>
          <SaveLinkForm tripId={id} onSaved={() => queryClient.invalidateQueries({ queryKey: tripKeys.links(id) })} />
          {canEdit && unplanned > 0 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityHint="Suggests a day and time for each saved place, for you to check before adding"
              onPress={() => router.push({ pathname: '/trips/[tripId]/plan-draft', params: { tripId } })}
              scaleTo={0.98}
              style={styles.planAll}>
              <Feather name="zap" size={20} color={colors.onAccent} />
              <View style={styles.planAllText}>
                <Text style={styles.planAllTitle}>Plan everyone’s saves</Text>
                <Text style={styles.planAllDetail}>
                  {unplanned} saved {unplanned === 1 ? 'place isn’t' : 'places aren’t'} in the plan yet
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.onAccent} />
            </PressableScale>
          ) : null}
          <Muted style={styles.hint}>
            {links.data.length} {links.data.length === 1 ? 'post' : 'posts'}. Click one to see its places.
          </Muted>
          {links.data.map((link) => (
            <View key={link.id} style={[styles.pickable, link.id === picked.id && styles.picked]}>
              <LinkCard
                tripId={id}
                link={link}
                places={placesFor(link)}
                activityDays={activityDays}
                expanded={false}
                onToggle={() => setPickedId(link.id)}
                canEdit={canEdit}
              />
            </View>
          ))}
        </ScrollView>
        <ScrollView style={styles.wideDetail} contentContainerStyle={styles.wideDetailContent}>
          <LinkCard
            key={picked.id}
            tripId={id}
            link={picked}
            places={placesFor(picked)}
            activityDays={activityDays}
            expanded
            onToggle={() => {}}
            canEdit={canEdit}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />}>
      <SaveLinkForm tripId={id} onSaved={() => queryClient.invalidateQueries({ queryKey: tripKeys.links(id) })} />

      {links.isPending ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : links.isError ? (
        <View style={styles.state}>
          <FormMessage message={links.error.message} />
          <Button label="Try again" variant="secondary" onPress={refresh} />
        </View>
      ) : links.data.length === 0 ? (
        <View style={styles.empty}>
          <Title>Nothing saved yet</Title>
          <Body style={styles.muted}>
            Paste a TikTok link above. We’ll watch the video and pull out the places it mentions.
          </Body>
        </View>
      ) : (
        <>
          {canEdit && unplanned > 0 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityHint="Suggests a day and time for each saved place, for you to check before adding"
              onPress={() => router.push({ pathname: '/trips/[tripId]/plan-draft', params: { tripId } })}
              scaleTo={0.98}
              style={styles.planAll}>
              <Feather name="zap" size={20} color={colors.onAccent} />
              <View style={styles.planAllText}>
                <Text style={styles.planAllTitle}>Plan everyone’s saves</Text>
                <Text style={styles.planAllDetail}>
                  {unplanned} saved {unplanned === 1 ? 'place isn’t' : 'places aren’t'} in the plan yet
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.onAccent} />
            </PressableScale>
          ) : null}
          <Muted style={styles.hint}>
            Tap a post to see its places, or press and hold to rename or delete it.
          </Muted>
          {links.data.map((link, index) => (
            <Enter key={link.id} index={index}>
              <LinkCard
                tripId={id}
                link={link}
                places={placesFor(link)}
                activityDays={activityDays}
                expanded={expanded.has(link.id)}
                onToggle={() => toggle(link.id)}
                canEdit={canEdit}
              />
            </Enter>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function SaveLinkForm({ tripId, onSaved }: { tripId: number; onSaved: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveLink = useMutation({
    mutationFn: (value: string) => api(`/trips/${tripId}/links`, { method: 'POST', body: { url: value } }),
    onSuccess: () => {
      setUrl('');
      onSaved();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Viewers can’t save links. Ask the trip owner to make you a member.'
          : err instanceof ApiError && err.status === 422
            ? UNSUPPORTED_LINK
            : err.message,
      ),
  });

  const submit = () => {
    // Enter in the box works even while the Save button is busy, so ignore repeats here
    if (saveLink.isPending) return;
    const value = url.trim();
    setError(null);
    if (!/^https?:\/\/\S+$/i.test(value)) {
      setError('Paste a full link, starting with https://');
      return;
    }
    if (!isSupportedLink(value)) {
      setError(UNSUPPORTED_LINK);
      return;
    }
    saveLink.mutate(value);
  };

  const screenshot = useMutation({
    mutationFn: () => pickAndUploadScreenshot(tripId),
    onSuccess: (saved) => {
      if (saved) onSaved();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Viewers can’t add screenshots. Ask the trip owner to make you a member.'
          : err.message,
      ),
  });

  return (
    <View style={styles.form}>
      <View style={styles.formRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a screenshot"
          accessibilityHint="Pick a screenshot of a post, a map or a list, and Triplet finds the places in it"
          disabled={screenshot.isPending}
          onPress={() => {
            setError(null);
            screenshot.mutate();
          }}
          style={({ pressed, hovered }) => [styles.shotButton, (pressed || hovered) && styles.shotButtonActive]}>
          {screenshot.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Feather name="image" size={20} color={colors.accent} />
          )}
        </Pressable>
        <TextInput
          accessibilityLabel="Paste a TikTok, Instagram or YouTube link"
          placeholder="Paste a TikTok, Instagram or YouTube link"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          value={url}
          onChangeText={setUrl}
          onSubmitEditing={submit}
          style={[styles.input, error ? styles.inputError : null]}
        />
        <Button label="Save" loading={saveLink.isPending} onPress={submit} style={styles.saveButton} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function LinkCard({
  tripId,
  link,
  places,
  activityDays,
  expanded,
  onToggle,
  canEdit,
}: {
  tripId: number;
  link: SavedLink;
  places: TripPlace[];
  activityDays: Map<number, string>;
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const retry = useMutation({
    mutationFn: () => api(`/trips/${tripId}/links/${link.id}/refresh`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tripKeys.links(tripId) }),
  });

  // Deleting a post deletes the places found in it. Planned activities stay in the plan.
  const remove = useMutation({
    mutationFn: () => api(`/trips/${tripId}/links/${link.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.links(tripId) });
      queryClient.invalidateQueries({ queryKey: tripKeys.places(tripId) });
      queryClient.invalidateQueries({ queryKey: tripKeys.itinerary(tripId) });
    },
  });

  const source = [link.author_name ? `@${link.author_name}` : null, platformName(link)].filter(Boolean).join(' · ');
  const canExpand = places.length > 0;
  const plannedCount = places.filter((place) => (place.activity_ids?.length ?? 0) > 0).length;
  const checkCount = places.filter((place) => !(place.activity_ids?.length ?? 0) && needsCheck(place)).length;
  const summary = [plannedCount ? `${plannedCount} in the plan` : null, checkCount ? `${checkCount} to check` : null]
    .filter(Boolean)
    .join(' · ');

  const top = (
    <View style={styles.cardTop}>
      {link.thumbnail_url ? (
        <Image
          // Screenshots are served by the API itself, at a path
          source={{ uri: resolveApiUrl(link.thumbnail_url) ?? undefined }}
          style={styles.thumbnail}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
      )}
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {linkTitle(link)}
        </Text>
        <Muted numberOfLines={1}>{source}</Muted>
        <View style={styles.statusRow}>
          <LinkStatus link={link} placeCount={places.length} />
          {canExpand ? <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} /> : null}
        </View>
        {!expanded && summary ? (
          <Text style={[styles.summary, checkCount > 0 && styles.placeDetailAttention]}>{summary}</Text>
        ) : null}
        {link.status === 'failed' ? (
          <View style={styles.failed}>
            {link.error ? <Muted>{link.error}</Muted> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => retry.mutate()}
              disabled={retry.isPending}
              style={styles.retry}>
              <Text style={styles.retryLabel}>{retry.isPending ? 'Trying…' : 'Try again'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );

  const content = (
    <>
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={canExpand ? { expanded } : undefined}
          accessibilityHint={`${canExpand ? (expanded ? 'Hides its places. ' : 'Shows its places. ') : ''}Press and hold for more options.`}
          onPress={canExpand ? onToggle : undefined}
          // Press and hold for Rename, Delete and more
          onLongPress={() => {
            warn();
            setMenuOpen(true);
          }}
          delayLongPress={350}
          style={({ pressed }) => pressed && canExpand && styles.pressed}>
          {top}
        </Pressable>

        {expanded && canExpand ? (
          <View style={styles.places}>
            {places.map((place) => (
              <PlaceRow key={place.id} tripId={tripId} place={place} activityDays={activityDays} />
            ))}
          </View>
        ) : null}

        {remove.error ? <FormMessage message={remove.error.message} /> : null}
      </View>

      <ItemMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={linkTitle(link)}
        subtitle={source}
        actions={[
          {
            label: link.platform === 'screenshot' ? 'Open screenshot' : 'Open post',
            icon: 'external-link',
            onPress: () => Linking.openURL(resolveApiUrl(link.url) ?? link.url),
          },
          ...(canEdit && !isProcessing(link)
            ? [{ label: 'Find places again', icon: 'refresh-cw' as const, onPress: () => retry.mutate() }]
            : []),
        ]}
        rename={
          canEdit
            ? {
                value: link.custom_title ?? linkTitle(link),
                placeholder: link.title ?? 'Name this post',
                hint: 'Leave it empty to go back to the post’s own title.',
                allowEmpty: true,
                onSave: async (name) => {
                  await api(`/trips/${tripId}/links/${link.id}`, { method: 'PATCH', body: { custom_title: name || null } });
                  queryClient.invalidateQueries({ queryKey: tripKeys.links(tripId) });
                },
              }
            : undefined
        }
        remove={
          canEdit
            ? {
                question: 'Delete this post?',
                detail:
                  places.length > 0
                    ? `Its ${places.length} ${places.length === 1 ? 'place goes' : 'places go'} too. Plans made from them stay in the plan.`
                    : undefined,
                onDelete: () => remove.mutateAsync(),
              }
            : undefined
        }
      />
    </>
  );

  // Only people who can change the trip get swipe-to-delete
  return canEdit ? (
    <SwipeToDelete label={`Delete ${linkTitle(link)} and its places`} onDelete={() => remove.mutateAsync()}>
      {content}
    </SwipeToDelete>
  ) : (
    content
  );
}

function LinkStatus({ link, placeCount }: { link: SavedLink; placeCount: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (isProcessing(link)) {
    return (
      <View style={[styles.pill, styles.pillNeutral]}>
        <ActivityIndicator size="small" color={colors.muted} />
        <Text style={[styles.pillText, styles.pillNeutralText]}>Finding places…</Text>
      </View>
    );
  }
  if (link.status === 'failed') {
    return (
      <View style={[styles.pill, styles.pillWarning]}>
        <Text style={[styles.pillText, styles.pillWarningText]}>Couldn’t read this post</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, placeCount > 0 ? styles.pillSuccess : styles.pillNeutral]}>
      <Text style={[styles.pillText, placeCount > 0 ? styles.pillSuccessText : styles.pillNeutralText]}>
        {placeCount === 0 ? 'No places found' : `${placeCount} ${placeCount === 1 ? 'place' : 'places'} found`}
      </Text>
    </View>
  );
}

function PlaceRow({ tripId, place, activityDays }: { tripId: number; place: TripPlace; activityDays: Map<number, string> }) {
  const styles = useStyles();
  const plannedDay = place.activity_ids?.map((activityId) => activityDays.get(activityId)).find(Boolean);
  const planned = (place.activity_ids?.length ?? 0) > 0;
  const detail = placeDetail(place, plannedDay);

  const params = { tripId: String(tripId), placeId: String(place.id) };
  const check = !planned && needsCheck(place);

  return (
    <View style={styles.placeRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review ${place.name}`}
        accessibilityHint="Opens the place so you can check or edit it"
        onPress={() => router.push({ pathname: '/trips/[tripId]/places/[placeId]', params })}
        style={({ pressed }) => [styles.placeText, pressed && styles.pressed]}>
        <Text style={styles.placeName}>{place.name}</Text>
        {detail.text ? (
          <Text
            numberOfLines={1}
            style={[
              styles.placeDetail,
              detail.tone === 'accent' && styles.placeDetailAccent,
              detail.tone === 'attention' && styles.placeDetailAttention,
            ]}>
            {detail.text}
          </Text>
        ) : null}
      </Pressable>
      {check ? (
        // Fix the location first, the Review screen can then add it to the plan
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review ${place.name}`}
          onPress={() => router.push({ pathname: '/trips/[tripId]/places/[placeId]', params })}
          style={({ pressed }) => [styles.addButton, styles.reviewButton, pressed && styles.pressed]}>
          <Text style={[styles.addLabel, styles.reviewLabel]}>Review</Text>
        </Pressable>
      ) : !planned ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${place.name} to the plan`}
          onPress={() => router.push({ pathname: '/trips/[tripId]/add-place', params })}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
          <Text style={styles.addLabel}>Add to plan</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Big screens: list and detail side by side
  wide: {
    flex: 1,
    flexDirection: 'row',
  },
  wideList: {
    width: 440,
    flexGrow: 0,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  wideListTablet: {
    width: 340,
  },
  wideListContent: {
    padding: 20,
    gap: spacing.md,
  },
  pickable: {
    borderRadius: radii.card + 2,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  picked: {
    borderColor: colors.accent,
  },
  wideDetail: {
    flex: 1,
  },
  wideDetailContent: {
    padding: 36,
    width: '100%',
    maxWidth: 760,
  },
  planAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
  },
  planAllText: {
    flex: 1,
    gap: 2,
  },
  planAllTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.onAccent,
  },
  planAllDetail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.onAccent,
    opacity: 0.85,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  form: {
    gap: 6,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  inputError: {
    borderColor: colors.danger,
  },
  saveButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.input,
  },
  shotButton: {
    width: 48,
    height: 48,
    borderRadius: radii.input,
    borderWidth: 1.5,
    borderColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shotButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.dangerText,
  },
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
  },
  empty: {
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  muted: {
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardTop: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: 14,
  },
  thumbnail: {
    width: 48,
    height: 64,
    borderRadius: 10,
    backgroundColor: colors.ink,
  },
  thumbnailEmpty: {
    backgroundColor: colors.chip,
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  pillText: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
  },
  pillNeutral: {
    backgroundColor: colors.chip,
  },
  pillNeutralText: {
    color: colors.muted,
  },
  pillSuccess: {
    backgroundColor: colors.accentSoft,
  },
  pillSuccessText: {
    color: colors.accent,
  },
  pillWarning: {
    backgroundColor: colors.dangerSoft,
  },
  pillWarningText: {
    color: colors.dangerText,
  },
  failed: {
    gap: 2,
  },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
  },
  retryLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.accent,
  },
  places: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  placeText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  placeName: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
  placeDetail: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
  },
  placeDetailAccent: {
    fontFamily: fonts.bold,
    color: colors.accent,
  },
  placeDetailAttention: {
    fontFamily: fonts.bold,
    color: colors.secondText,
  },
  addButton: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
  },
  addLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.accent,
  },
  reviewButton: {
    borderColor: colors.second,
  },
  reviewLabel: {
    color: colors.secondText,
  },
  pressed: {
    opacity: 0.75,
  },
  hint: {
    fontSize: 13,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summary: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.accent,
  },
}));
