import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api } from '@/api/client';
import { tripKeys, useMe, useMembers, useTrip, type Trip } from '@/api/trips';
import { Buddy } from '@/appearance/buddy';
import {
  CASTS,
  COLOURS,
  DEFAULT_APPEARANCE,
  EMOJI,
  PATTERNS,
  SCENES,
  STYLES,
  buddyName,
  colourHex,
  hasBuddies,
  mix,
  type TripAppearance,
} from '@/appearance/looks';
import { TripBanner, patternXml } from '@/appearance/trip-banner';
import { FormActions, FormScreen, FormSection, useFormDialog } from '@/components/form-layout';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing, touchTarget } from '@/theme/tokens';
import { pickAndUploadTripCover } from '@/utils/profile-photo';
import { SvgImage } from '@/appearance/svg-image';

const TITLE = 'Make it yours';

/** How the trip looks to everyone in it: its style, colour, and the buddy or pattern that goes with it. */
export default function CustomizeTripScreen() {
  const { tripId, from } = useLocalSearchParams<{ tripId: string; from?: string }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const { colors } = useTheme();

  // Opened from a trip card, the trip page isn't open underneath, so closing returns home
  const close = () => {
    if (from === 'home') router.dismissTo('/');
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (trip.isPending) {
    return (
      <FormScreen title={TITLE} onClose={close}>
        <ActivityIndicator color={colors.accent} />
      </FormScreen>
    );
  }
  if (trip.isError) return <FormScreen title={TITLE} message={trip.error.message} onClose={close} />;
  return <CustomizeForm trip={trip.data} close={close} />;
}

function CustomizeForm({ trip, close }: { trip: Trip; close: () => void }) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const dialog = useFormDialog();
  const [look, setLook] = useState<TripAppearance>(trip.appearance ?? DEFAULT_APPEARANCE);
  const change = (update: Partial<TripAppearance>) => setLook((current) => ({ ...current, ...update }));

  // Viewers can see the trip but not change it, so they only get the preview
  const members = useMembers(trip.id);
  const me = useMe();
  const role = members.data?.find((member) => member.user_id === me.data?.id)?.role;
  const canEdit = role !== 'viewer';

  const updated = (next: Trip | null) => {
    if (!next) return;
    queryClient.setQueryData(tripKeys.trip(trip.id), next);
    // The trip cards on the home page show it too
    queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
  };

  const save = useMutation({
    mutationFn: () => api<Trip>(`/trips/${trip.id}/appearance`, { method: 'PUT', body: look }),
    onSuccess: (next) => {
      updated(next);
      close();
    },
  });
  const cover = useMutation({ mutationFn: () => pickAndUploadTripCover(trip.id), onSuccess: updated });
  const removeCover = useMutation({
    mutationFn: () => api<Trip>(`/trips/${trip.id}/cover`, { method: 'DELETE' }),
    onSuccess: updated,
  });
  const coverUrl = queryClient.getQueryData<Trip>(tripKeys.trip(trip.id))?.cover_url ?? trip.cover_url;

  const accent = colourHex(look.colour);
  const style = STYLES.find((item) => item.id === look.style) ?? STYLES[0];

  return (
    <FormScreen
      title={TITLE}
      onClose={close}
      subtitle={canEdit ? 'Everyone on the trip sees this' : 'Only people who can edit the trip can change how it looks'}
      message={(save.error ?? cover.error ?? removeCover.error)?.message ?? null}
      actions={
        canEdit ? <FormActions label="Save" onSave={() => save.mutate()} saving={save.isPending} onCancel={close} /> : undefined
      }>
      <TripBanner
        trip={{ ...trip, cover_url: coverUrl }}
        appearance={look}
        style={[styles.preview, dialog && styles.previewWide]}
      />

      {canEdit ? (
        <>
          <FormSection title="Style" description={style.blurb}>
            <Choices label="Style">
              {STYLES.map((item) => (
                <Chip
                  key={item.id}
                  label={item.name}
                  selected={look.style === item.id}
                  onPress={() => change({ style: item.id })}
                />
              ))}
            </Choices>
          </FormSection>

          <FormSection title="Colour" description={COLOURS.find((item) => item.id === look.colour)?.name}>
            <Choices label="Colour">
              {COLOURS.map((item) => (
                <Swatch
                  key={item.id}
                  label={item.name}
                  selected={look.colour === item.id}
                  onPress={() => change({ colour: item.id })}>
                  <View style={[styles.swatchFill, { backgroundColor: item.hex }]} />
                </Swatch>
              ))}
            </Choices>
          </FormSection>

          {look.style === 'pixel' ? (
            <FormSection title="Scene">
              <Choices label="Scene">
                {SCENES.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.name}
                    selected={look.scene === item.id}
                    onPress={() => change({ scene: item.id })}
                  />
                ))}
              </Choices>
            </FormSection>
          ) : null}

          {hasBuddies(look.style) ? <BuddyPicker look={look} accent={accent} onChange={change} /> : null}

          {look.style === 'pattern' ? (
            <>
              <FormSection title="Pattern">
                <Choices label="Pattern">
                  {PATTERNS.map((item) => (
                    <Swatch
                      key={item.id}
                      label={item.name}
                      square
                      selected={look.pattern === item.id}
                      onPress={() => change({ pattern: item.id })}>
                      <View style={[styles.swatchFill, styles.square, { backgroundColor: accent }]}>
                        <SvgImage xml={patternXml(item.id, 44, 44)} width={44} height={44} />
                      </View>
                    </Swatch>
                  ))}
                </Choices>
              </FormSection>
              <FormSection title="Or an emoji" description="It repeats across the banner">
                <Choices label="Emoji">
                  {EMOJI.map((item) => (
                    <Swatch
                      key={item}
                      label={item}
                      square
                      selected={look.pattern === 'emoji' && look.emoji === item}
                      onPress={() => change({ pattern: 'emoji', emoji: item })}>
                      <View style={[styles.swatchFill, styles.square, styles.emojiTile]}>
                        <Text style={styles.emoji}>{item}</Text>
                      </View>
                    </Swatch>
                  ))}
                </Choices>
              </FormSection>
            </>
          ) : null}

          {look.style === 'photo' ? (
            <FormSection title="Photo" description="Saved straight away, and tinted to the trip’s colour">
              <View style={styles.photoActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={cover.isPending}
                  onPress={() => cover.mutate()}
                  style={({ pressed, hovered }) => [styles.photoButton, (pressed || hovered) && styles.photoButtonActive]}>
                  {cover.isPending ? <ActivityIndicator color={accent} /> : <Feather name="image" size={18} color={accent} />}
                  <Text style={[styles.photoLabel, { color: accent }]}>
                    {coverUrl ? 'Choose another photo' : 'Choose a photo'}
                  </Text>
                </Pressable>
                {coverUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={removeCover.isPending}
                    onPress={() => removeCover.mutate()}
                    style={styles.removeButton}>
                    <Text style={styles.removeLabel}>Remove photo</Text>
                  </Pressable>
                ) : null}
              </View>
            </FormSection>
          ) : null}
        </>
      ) : null}
    </FormScreen>
  );
}

function BuddyPicker({
  look,
  accent,
  onChange,
}: {
  look: TripAppearance;
  accent: string;
  onChange: (update: Partial<TripAppearance>) => void;
}) {
  const styles = useStyles();
  if (!hasBuddies(look.style)) return null;
  const castStyle = look.style;
  const cast = CASTS[castStyle];
  const current = look.buddies[castStyle] ?? null;
  const pick = (buddy: string | null) => onChange({ buddies: { ...look.buddies, [castStyle]: buddy } });
  // The tiles sit on the style's own background, so the buddies look as they will on the banner
  const tile =
    castStyle === 'pixel'
      ? mix(accent, '#0B0D12', 0.55)
      : castStyle === 'poster'
        ? mix(accent, '#FFFFFF', 0.8)
        : castStyle === 'postcard'
          ? '#FBF6EC'
          : accent;

  return (
    <FormSection title={`Buddy · ${cast.name}`} description={current ? buddyName(current) : 'No buddy'}>
      <Choices label="Buddy">
        {cast.buddies.map((item) => (
          <Swatch key={item.id} label={item.name} square large selected={current === item.id} onPress={() => pick(item.id)}>
            <View style={[styles.swatchFill, styles.square, styles.buddyTile, { backgroundColor: tile }]}>
              <Buddy buddy={item.id} accent={accent} size={44} />
            </View>
          </Swatch>
        ))}
        <Swatch label="No buddy" square large selected={current === null} onPress={() => pick(null)}>
          <View style={[styles.swatchFill, styles.square, styles.buddyTile, styles.noneTile]}>
            <Text style={styles.noneLabel}>None</Text>
          </View>
        </Swatch>
      </Choices>
    </FormSection>
  );
}

function Choices({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      onPress={onPress}
      style={({ hovered }) => [styles.chip, selected ? styles.chipSelected : hovered && styles.chipHover]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

// A round (or square) choice with a ring around the selected one
function Swatch({
  label,
  selected,
  onPress,
  square = false,
  large = false,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  square?: boolean;
  large?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      onPress={onPress}
      style={[styles.swatch, square && styles.swatchSquare, large && styles.swatchLarge, selected && styles.swatchSelected]}>
      {children}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  preview: {
    height: 160,
    borderRadius: 16,
  },
  previewWide: {
    height: 200,
    marginBottom: spacing.md,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipHover: {
    borderColor: colors.inputBorder,
  },
  chipSelected: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  chipLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  chipLabelSelected: {
    color: colors.bg,
  },
  // Big enough to tap, with room for the ring
  swatch: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    padding: 3,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  swatchSquare: {
    borderRadius: 14,
  },
  swatchLarge: {
    width: 58,
    height: 58,
  },
  swatchSelected: {
    borderColor: colors.ink,
  },
  swatchFill: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
  },
  square: {
    borderRadius: 10,
  },
  emojiTile: {
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 20,
  },
  buddyTile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  noneTile: {
    backgroundColor: colors.chip,
  },
  noneLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  photoButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentMuted,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  photoButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  photoLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  removeButton: {
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  removeLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.dangerText,
  },
}));
