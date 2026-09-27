import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import { api, ApiError } from '@/api/client';
import { tripKeys, useLinks, usePlaces, type TripPlace } from '@/api/trips';
import { Button } from '@/components/button';
import { MiniMap } from '@/components/place-map';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Muted } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { detailsCredit, missingDetailsReason, needsCheck, WEEKDAYS } from '@/utils/places';

const CATEGORIES = ['food', 'cafe', 'bar', 'nightlife', 'attraction', 'nature', 'shopping', 'activity', 'accommodation', 'other'] as const;

const schema = z.object({
  name: z.string().trim().min(1, 'Give the place a name').max(255),
  category: z.enum(CATEGORIES).nullable(),
  address: z.string().trim().max(500),
  website: z
    .string()
    .trim()
    .refine((value) => value === '' || /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(value), {
      message: 'Enter a web address, like example.com',
    }),
  phone: z.string().trim().max(50),
  notes: z.string(),
  days: z.array(z.object({ hours: z.string().max(100), closed: z.boolean() })).length(7),
});

type Values = z.infer<typeof schema>;

export default function ReviewPlaceScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { tripId, placeId } = useLocalSearchParams<{ tripId: string; placeId: string }>();
  const places = usePlaces(Number(tripId));
  const place = places.data?.find((item) => item.id === Number(placeId));

  if (!place) {
    return (
      <Screen>
        <ScreenHeader title="Review place" />
        {places.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : (
          <FormMessage message="This place couldn’t be found. It may have been removed." />
        )}
      </Screen>
    );
  }

  // Mount the form only once the place is loaded, so its fields start with the right values
  return <ReviewForm tripId={Number(tripId)} place={place} />;
}

function ReviewForm({ tripId, place }: { tripId: number; place: TripPlace }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const links = useLinks(tripId);
  const link = links.data?.find((item) => item.id === place.link_id);
  const [editingHours, setEditingHours] = useState(!place.opening_hours);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const planned = (place.activity_ids?.length ?? 0) > 0;

  const { control, handleSubmit, setValue, getFieldState, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: place.name,
      category: (CATEGORIES as readonly string[]).includes(place.category ?? '') ? (place.category as Values['category']) : null,
      address: place.address ?? '',
      website: place.website ?? '',
      phone: place.phone ?? '',
      notes: place.notes ?? '',
      days: WEEKDAYS.map((_, index) => {
        const hours = place.opening_hours?.[index] ?? '';
        return hours === 'Closed' ? { hours: '', closed: true } : { hours, closed: false };
      }),
    },
  });
  const { fields: days } = useFieldArray({ control, name: 'days' });

  // The pin picker saves the pin and address straight away; show its address unless the user typed one
  const serverAddress = useRef(place.address);
  useEffect(() => {
    if (place.address !== serverAddress.current) {
      serverAddress.current = place.address;
      if (!getFieldState('address').isDirty) setValue('address', place.address ?? '');
    }
  }, [place.address, getFieldState, setValue]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.places(tripId) });
    queryClient.invalidateQueries({ queryKey: tripKeys.links(tripId) });
  };

  const save = useMutation({
    mutationFn: (values: Values) => {
      const website = values.website.trim();
      return api(`/trips/${tripId}/places/${place.id}`, {
        method: 'PATCH',
        body: {
          name: values.name.trim(),
          category: values.category,
          address: values.address.trim() || null,
          website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
          phone: values.phone.trim() || null,
          notes: values.notes.trim() || null,
          // Only send hours the user was editing, so looked-up hours aren't replaced by accident
          ...(editingHours ? { opening_hours: toOpeningHours(values.days) } : {}),
        },
      });
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => api(`/trips/${tripId}/places/${place.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  // A failed save shows its message above the form, so there's nothing more to do with the error
  const onSave = handleSubmit(async (values) => {
    if (await trySave(values)) router.back();
  });

  const onSaveAndPlan = handleSubmit(async (values) => {
    if (await trySave(values)) {
      router.replace({ pathname: '/trips/[tripId]/add-place', params: { tripId: String(tripId), placeId: String(place.id) } });
    }
  });

  const trySave = async (values: Values) => {
    try {
      await save.mutateAsync(values);
      return true;
    } catch {
      return false;
    }
  };

  const openPinPicker = () =>
    router.push({ pathname: '/trips/[tripId]/pick-location', params: { tripId: String(tripId), placeId: String(place.id) } });

  const missing = !place.user_edited ? missingDetailsReason(place) : null;
  const credit = detailsCredit(place);
  const error = save.error ?? remove.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'Viewers can’t change places. Ask the trip owner to make you a member.'
      : (error?.message ?? null);

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader
          title="Review place"
          right={
            <Pressable accessibilityRole="button" onPress={onSave} disabled={save.isPending} style={styles.headerSave}>
              <Text style={styles.headerSaveLabel}>{save.isPending ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          }
        />

        {link ? (
          <View style={styles.source}>
            <Feather name="film" size={18} color={colors.muted} />
            <View style={styles.sourceText}>
              <Muted>Found in {link.author_name ? `@${link.author_name}’s` : 'a'} post</Muted>
              {link.summary ? (
                <Text style={styles.sourceSummary} numberOfLines={2}>
                  {link.summary}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {missing ? <FormMessage message={missing} /> : null}
        <FormMessage message={errorMessage} />

        <Controller
          control={control}
          name="name"
          render={({ field, fieldState }) => (
            <TextField
              label="Name"
              hint={place.user_edited ? undefined : 'Suggested from the post'}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="address"
          render={({ field, fieldState }) => (
            <TextField
              label="Address"
              placeholder="Type it, or drop a pin on the map"
              hint={
                needsCheck(place) && place.address
                  ? 'Please check this, the map search wasn’t sure'
                  : place.details_source && !place.user_edited
                    ? 'Found with a map search'
                    : undefined
              }
              multiline
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        {place.latitude != null && place.longitude != null ? (
          <View style={styles.mapBlock}>
            <MiniMap latitude={place.latitude} longitude={place.longitude} />
            <Button label="Adjust pin" variant="secondary" onPress={openPinPicker} />
          </View>
        ) : (
          <Button label="Drop a pin on the map" variant="secondary" onPress={openPinPicker} />
        )}

        <Controller
          control={control}
          name="category"
          render={({ field }) => (
            <View style={styles.field}>
              <Text style={styles.label}>Type</Text>
              <View style={styles.chips}>
                {CATEGORIES.map((category) => {
                  const selected = field.value === category;
                  return (
                    <Pressable
                      key={category}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => field.onChange(selected ? null : category)}
                      style={[styles.chip, selected && styles.chipSelected]}>
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{capitalize(category)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Opening hours</Text>
            {place.opening_hours && !editingHours ? (
              <Pressable accessibilityRole="button" onPress={() => setEditingHours(true)} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>Edit</Text>
              </Pressable>
            ) : null}
          </View>

          {!editingHours && place.opening_hours ? (
            <View style={styles.hoursList}>
              {WEEKDAYS.map((day, index) => (
                <View key={day} style={styles.hoursRow}>
                  <Text style={styles.hoursDay}>{day}</Text>
                  <Text style={[styles.hoursValue, place.opening_hours?.[index] === 'Closed' && styles.hoursClosed]}>
                    {place.opening_hours?.[index] || 'Not known'}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.hoursList}>
              {place.hours_from_post ? (
                <View style={styles.postHours}>
                  <Text style={styles.postHoursText}>The post says “{place.hours_from_post}”</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => days.forEach((_, index) => setValue(`days.${index}`, { hours: place.hours_from_post ?? '', closed: false }, { shouldDirty: true }))}
                    style={styles.postHoursButton}>
                    <Text style={styles.postHoursButtonLabel}>Use for all days</Text>
                  </Pressable>
                </View>
              ) : null}
              {days.map((day, index) => (
                <Controller
                  key={day.id}
                  control={control}
                  name={`days.${index}`}
                  render={({ field }) => (
                    <View style={styles.editRow}>
                      <Text style={styles.editDay}>{WEEKDAYS[index].slice(0, 3)}</Text>
                      <TextInput
                        accessibilityLabel={`${WEEKDAYS[index]} opening hours`}
                        placeholder={field.value.closed ? 'Closed' : 'e.g. 11:00 – 15:00'}
                        placeholderTextColor={colors.muted}
                        editable={!field.value.closed}
                        value={field.value.closed ? '' : field.value.hours}
                        onChangeText={(hours) => field.onChange({ ...field.value, hours })}
                        style={[styles.hoursInput, field.value.closed && styles.hoursInputDisabled]}
                      />
                      <View style={styles.closedToggle}>
                        <Switch
                          accessibilityLabel={`Closed on ${WEEKDAYS[index]}`}
                          value={field.value.closed}
                          onValueChange={(closed) => field.onChange({ ...field.value, closed })}
                          trackColor={{ true: colors.accent, false: colors.inputBorder }}
                        />
                        <Text style={styles.closedLabel}>Closed</Text>
                      </View>
                    </View>
                  )}
                />
              ))}
            </View>
          )}
          {credit && !place.user_edited ? <Text style={styles.credit}>{credit}. Hours can change, so check before you go.</Text> : null}
        </View>

        <Controller
          control={control}
          name="website"
          render={({ field, fieldState }) => (
            <TextField
              label="Website (optional)"
              placeholder="example.com"
              autoCapitalize="none"
              keyboardType="url"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <TextField
              label="Phone (optional)"
              keyboardType="phone-pad"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <TextField
              label="Notes"
              placeholder="e.g. go early, queues get long"
              multiline
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />

        {planned ? (
          <Button label="Save" loading={save.isPending} onPress={onSave} />
        ) : (
          <>
            <Button label="Save and add to plan" loading={save.isPending} onPress={onSaveAndPlan} />
            <Button label="Save for later" variant="secondary" disabled={save.isPending} onPress={onSave} />
          </>
        )}

        {confirmRemove ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>
              Remove {place.name}?{planned ? ' It stays in the plan, just without the link to this post.' : ''}
            </Text>
            <View style={styles.confirmButtons}>
              <Button label="Keep it" variant="secondary" onPress={() => setConfirmRemove(false)} style={styles.flex} />
              <Pressable
                accessibilityRole="button"
                onPress={() => remove.mutate()}
                disabled={remove.isPending}
                style={[styles.removeButton, styles.flex]}>
                <Text style={styles.removeLabel}>{remove.isPending ? 'Removing…' : 'Remove'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmRemove(true)} style={styles.removeLink}>
            <Text style={styles.removeLinkLabel}>Not a real place? Remove it</Text>
          </Pressable>
        )}

        {formState.isSubmitting ? <ActivityIndicator color={colors.accent} /> : null}
      </View>
    </Screen>
  );
}

// Seven entries, Monday first. Blank days stay blank (unknown), and no hours at all means null.
function toOpeningHours(days: Values['days']): string[] | null {
  const hours = days.map((day) => (day.closed ? 'Closed' : day.hours.trim()));
  return hours.every((value) => value === '') ? null : hours;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 18,
  },
  loading: {
    marginTop: spacing.xl,
  },
  headerSave: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  headerSaveLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accent,
  },
  source: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  sourceText: {
    flex: 1,
    gap: 2,
  },
  sourceSummary: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    fontStyle: 'italic',
    color: colors.ink,
  },
  mapBlock: {
    gap: spacing.sm,
  },
  field: {
    gap: 8,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  chipTextSelected: {
    fontFamily: fonts.bold,
    color: colors.onAccent,
  },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  textButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  textButtonLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.accent,
  },
  hoursList: {
    gap: spacing.sm,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  hoursDay: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  hoursValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  hoursClosed: {
    color: colors.dangerText,
  },
  postHours: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: 10,
    borderRadius: radii.input,
    backgroundColor: colors.accentSoft,
  },
  postHoursText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.accentStrong,
  },
  postHoursButton: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  postHoursButtonLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.onAccent,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editDay: {
    width: 36,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  hoursInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  hoursInputDisabled: {
    backgroundColor: colors.chip,
  },
  closedToggle: {
    alignItems: 'center',
  },
  closedLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
  },
  credit: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  confirm: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  confirmText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.dangerText,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  removeButton: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLabel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.onDanger,
  },
  removeLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLinkLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.dangerText,
  },
}));
