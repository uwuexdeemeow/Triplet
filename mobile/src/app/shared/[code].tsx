import { useQueryClient } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { api, ApiError, type Schemas } from '@/api/client';
import { guestKeys, useGuestItinerary, useGuestLookup, useGuestTrip } from '@/api/guest';
import { useSession } from '@/auth/session';
import { clearGuestToken, loadGuestToken, saveGuestToken } from '@/auth/token-storage';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { TextField } from '@/components/text-field';
import { TripReadOnly } from '@/components/trip-read-only';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

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

  // Costs come back empty unless the owner shows them, so they only appear when there are some
  return (
    <TripReadOnly
      trip={trip.data}
      days={itinerary.data.days}
      currency={trip.data.currency}
      directions
      emptyMessage="Nothing’s planned yet. Check back later."
    />
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
