import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, ApiError, type Schemas } from '@/api/client';
import { guestKeys, useGuestItinerary, useGuestLookup, useGuestTrip, type GuestActivity } from '@/api/guest';
import { useSession } from '@/auth/session';
import { clearGuestToken, loadGuestToken, saveGuestToken } from '@/auth/token-storage';
import { Button } from '@/components/button';
import { GuestPlanForm } from '@/components/guest-plan-form';
import { FormMessage, Screen } from '@/components/screen';
import { ActivityRow, DayChips, EditHint, TravelConnector, type ActivityActions } from '@/components/plan-rows';
import { Body, Heading, Muted, Title } from '@/components/text';
import { TextField } from '@/components/text-field';
import { WeatherLine } from '@/components/weather-line';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { eachDay, formatDateRange, formatLongDate, formatShortDate, todayString } from '@/utils/dates';
import { formatMoney } from '@/utils/money';

// Opened from a trip's link: /shared/<code>. Asks for the PIN, then shows the plan. Outside the
// signed-in and signed-out groups, so it looks the same to everyone, and the guest token it gets
// belongs to this page: a signed-in person who opens a friend's link stays signed in.
export default function SharedTripScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { code: param } = useLocalSearchParams<{ code?: string }>();
  const code = (param ?? '').trim().toUpperCase();
  const lookup = useGuestLookup(code);
  // undefined while it's read from storage; null when there isn't one (or it stopped working)
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    loadGuestToken(code).then((stored) => current && setToken(stored));
    return () => {
      current = false;
    };
  }, [code]);

  const expired = () => {
    clearGuestToken(code);
    setToken(null);
  };

  const gone = lookup.error instanceof ApiError && lookup.error.status === 404;

  return (
    <Screen>
      <View style={styles.container}>
        {lookup.isPending || token === undefined ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : gone ? (
          <View style={styles.state}>
            <Heading>Link not working</Heading>
            <Body style={styles.muted}>
              This link or code doesn’t work. It may have been replaced, turned off or run out. Ask whoever sent it for a
              new one.
            </Body>
            <Link href="/shared" style={styles.link}>
              Enter a different code
            </Link>
          </View>
        ) : lookup.isError ? (
          <View style={styles.state}>
            <FormMessage message={lookup.error.message} />
            <Button label="Try again" variant="secondary" onPress={() => lookup.refetch()} />
          </View>
        ) : lookup.data.trip_id != null ? (
          <MemberNotice title={lookup.data.title} tripId={lookup.data.trip_id} />
        ) : token ? (
          <TripView code={code} token={token} onExpired={expired} />
        ) : (
          <PinStep code={code} title={lookup.data.title} onToken={setToken} />
        )}
        <Footer />
      </View>
    </Screen>
  );
}

// Someone signed in who is on the trip doesn't need the PIN
function MemberNotice({ title, tripId }: { title: string; tripId: number }) {
  const styles = useStyles();
  return (
    <View style={styles.state}>
      <Heading>{title}</Heading>
      <Body style={styles.muted}>You’re on this trip, so you don’t need the PIN.</Body>
      <Button
        label="Open it in your trips"
        onPress={() => router.replace({ pathname: '/trips/[tripId]', params: { tripId: String(tripId) } })}
      />
    </View>
  );
}

function PinStep({ code, title, onToken }: { code: string; title: string; onToken: (token: string) => void }) {
  const styles = useStyles();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<{ field?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!/^[A-Za-z0-9]{4,12}$/.test(pin)) {
      setError({ field: 'The PIN is 4 to 12 letters and numbers' });
      return;
    }
    setError({});
    setSubmitting(true);
    try {
      const entered = await api<Schemas['GuestToken']>('/guest/access', {
        method: 'POST',
        body: { access_code: code, pin },
        auth: false,
      });
      await saveGuestToken(code, entered.access_token);
      onToken(entered.access_token);
    } catch (err) {
      setError({
        form:
          err instanceof ApiError && err.status === 401
            ? err.message === 'Guest access has expired'
              ? 'This link has run out. Ask the trip owner for a new one.'
              : 'That PIN isn’t right. Check the capitals.'
            : err instanceof Error
              ? err.message
              : 'Something went wrong.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.state}>
      <Heading>{title}</Heading>
      <Body style={styles.muted}>Enter the PIN the trip’s owner sent you to see their plan. You don’t need an account.</Body>
      <FormMessage message={error.form ?? null} />
      <TextField
        label="PIN"
        hint="Letters and numbers. Capitals matter."
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        maxLength={12}
        value={pin}
        onChangeText={setPin}
        onSubmitEditing={submit}
        error={error.field}
      />
      <Button label="View trip" loading={submitting} onPress={submit} />
    </View>
  );
}

function TripView({ code, token, onExpired }: { code: string; token: string; onExpired: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const trip = useGuestTrip(code, token);
  const itinerary = useGuestItinerary(code, token);
  // The plan being added or changed, for guests the owner lets edit
  const [form, setForm] = useState<{ existing?: { day: string; activity: GuestActivity } } | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  // A day later the token stops working: ask for the PIN again
  const stopped = [trip.error, itinerary.error].some((error) => error instanceof ApiError && error.status === 401);
  useEffect(() => {
    if (stopped) {
      queryClient.removeQueries({ queryKey: guestKeys.trip(code) });
      queryClient.removeQueries({ queryKey: guestKeys.itinerary(code) });
      onExpired();
    }
  }, [stopped, code, queryClient, onExpired]);

  if (trip.isPending || itinerary.isPending || stopped) {
    return <ActivityIndicator color={colors.accent} style={styles.loading} />;
  }
  if (trip.isError || itinerary.isError) {
    return (
      <View style={styles.state}>
        <FormMessage message={(trip.error ?? itinerary.error)?.message ?? null} />
        <Button
          label="Try again"
          variant="secondary"
          onPress={() => {
            trip.refetch();
            itinerary.refetch();
          }}
        />
      </View>
    );
  }

  const canEdit = itinerary.data.allow_edits;
  const { show_costs: showCosts } = itinerary.data;
  const currency = trip.data.currency;

  const gone = () => {
    setForm(null);
    queryClient.removeQueries({ queryKey: guestKeys.trip(code) });
    queryClient.removeQueries({ queryKey: guestKeys.itinerary(code) });
    onExpired();
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: guestKeys.itinerary(code) });
  // Saves as the guest; a token that's stopped working asks for the PIN again
  const send = async (path: string, options: { method: 'PATCH' | 'DELETE'; body?: object }) => {
    try {
      await api(path, { ...options, token });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) gone();
      // The owner turned editing off: show the plan without the edit controls
      if (error instanceof ApiError && error.status === 403) refresh();
      throw error;
    }
    refresh();
  };

  const tripDays = trip.data.start_date && trip.data.end_date ? eachDay(trip.data.start_date, trip.data.end_date) : [];
  // Plans can sit outside the trip's dates if they changed, so those days still show
  const days = [...new Set([...tripDays, ...itinerary.data.days.map((item) => item.date)])].sort();
  const today = todayString();
  const selectedDay = pickedDay && days.includes(pickedDay) ? pickedDay : days.includes(today) ? today : days[0];
  const day = itinerary.data.days.find((item) => item.date === selectedDay);
  const activities = day?.activities ?? [];
  const titles = new Map(activities.map((activity) => [activity.id, activity.title]));

  if (form && canEdit) {
    return (
      <GuestPlanForm
        token={token}
        trip={trip.data}
        day={selectedDay}
        existing={form.existing}
        showCosts={showCosts}
        onDone={() => {
          setForm(null);
          refresh();
        }}
        onCancel={() => setForm(null)}
        onExpired={gone}
      />
    );
  }

  const guestActions = (activity: GuestActivity): ActivityActions => ({
    onEdit: () => setForm({ existing: { day: selectedDay, activity } }),
    onRename: (title) => send(`/guest/activities/${activity.id}`, { method: 'PATCH', body: { title } }),
    onDelete: () => send(`/guest/activities/${activity.id}`, { method: 'DELETE' }),
  });

  return (
    <View style={styles.plan}>
      <View style={styles.titles}>
        <Heading>{trip.data.title}</Heading>
        <Muted>
          {[trip.data.destination, trip.data.start_date && trip.data.end_date ? formatDateRange(trip.data.start_date, trip.data.end_date) : null]
            .filter(Boolean)
            .join(' · ')}
        </Muted>
      </View>

      {!selectedDay ? (
        <Body style={styles.muted}>
          {canEdit ? 'Nothing’s planned yet. Add the first plan.' : 'Nothing’s planned yet. Check back later.'}
        </Body>
      ) : (
        <>
          <DayChips
            days={days}
            selected={selectedDay}
            planned={new Set(itinerary.data.days.filter((item) => item.activities.length).map((item) => item.date))}
            onSelect={setPickedDay}
            inset={0}
          />
          <View style={styles.dayHeader}>
            <Title>{formatLongDate(selectedDay)}</Title>
            {/* Costs come back empty unless the owner shows them */}
            {showCosts && day?.estimated_cost ? (
              <Text style={styles.dayCost}>About {formatMoney(day.estimated_cost, currency)}</Text>
            ) : null}
          </View>
          {day?.weather ? <WeatherLine weather={day.weather} /> : null}

          {activities.length === 0 ? (
            <Body style={[styles.muted, styles.empty]}>Nothing planned for this day yet.</Body>
          ) : (
            <>
              {activities.map((activity, index) => (
                <View key={activity.id}>
                  {activity.travel_from_previous ? (
                    <TravelConnector leg={activity.travel_from_previous} from={activities[index - 1]} to={activity} />
                  ) : null}
                  <ActivityRow
                    activity={activity}
                    titles={titles}
                    currency={showCosts ? currency : undefined}
                    actions={canEdit ? guestActions(activity) : undefined}
                  />
                </View>
              ))}
              {canEdit ? <EditHint /> : null}
            </>
          )}

          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setForm({})}
              style={({ hovered }) => [styles.addPlan, hovered && styles.addPlanHover]}>
              <Feather name="plus" size={16} color={colors.accent} />
              <Text style={styles.addPlanLabel}>Add a plan to {formatShortDate(selectedDay)}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function Footer() {
  const styles = useStyles();
  const { status } = useSession();

  return (
    <View style={styles.footer}>
      {status === 'signedOut' ? (
        <>
          <Body style={styles.muted}>Plan your own trips with friends, all in one place.</Body>
          <Link href="/signup" style={styles.link}>
            Plan your own trips with Triplet
          </Link>
        </>
      ) : (
        <Link href="/" style={styles.link}>
          Back to Triplet
        </Link>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  loading: {
    marginTop: spacing.xl,
  },
  state: {
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  muted: {
    color: colors.muted,
  },
  plan: {
    gap: spacing.md,
  },
  titles: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  dayCost: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  empty: {
    paddingVertical: spacing.xl,
  },
  addPlan: {
    marginLeft: 48 + spacing.md,
    height: 44,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  addPlanHover: {
    backgroundColor: colors.accentSoft,
  },
  addPlanLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  footer: {
    gap: spacing.xs,
    paddingTop: spacing.lg,
  },
  link: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accent,
  },
}));
