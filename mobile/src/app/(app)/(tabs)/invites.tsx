import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError } from '@/api/client';
import { tripKeys, useMyInvitations, type Invitation } from '@/api/trips';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { Body, Heading, Muted, Title } from '@/components/text';
import { colors, fonts, spacing } from '@/theme/tokens';
import { formatDateRange } from '@/utils/dates';

export default function InvitesScreen() {
  const invitations = useMyInvitations();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList
        data={invitations.data ?? []}
        keyExtractor={(invitation) => String(invitation.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={invitations.isRefetching} onRefresh={invitations.refetch} tintColor={colors.teal} />
        }
        ListHeaderComponent={<Heading>Invites</Heading>}
        ListEmptyComponent={
          invitations.isPending ? (
            <ActivityIndicator color={colors.teal} style={styles.loading} />
          ) : invitations.isError ? (
            <View style={styles.state}>
              <FormMessage message={invitations.error.message} />
              <Button label="Try again" variant="secondary" onPress={() => invitations.refetch()} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="mail" size={32} color={colors.muted} />
              <Title>No invites right now</Title>
              <Body style={styles.muted}>
                When a friend invites you to their trip, it shows up here. They’ll need the email you signed up with.
              </Body>
            </View>
          )
        }
        renderItem={({ item }) => <InviteCard invitation={item} />}
      />
    </SafeAreaView>
  );
}

function InviteCard({ invitation }: { invitation: Invitation }) {
  const queryClient = useQueryClient();

  const answer = useMutation({
    mutationFn: (choice: 'accept' | 'decline') =>
      api<Invitation>(`/invitations/${invitation.id}/${choice}`, { method: 'POST' }),
    onSuccess: (_, choice) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.myInvitations });
      if (choice === 'accept') {
        queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
        router.push({ pathname: '/trips/[tripId]', params: { tripId: String(invitation.trip_id) } });
      }
    },
    onError: (error) => {
      // Cancelled or already answered somewhere else: the list is out of date
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        queryClient.invalidateQueries({ queryKey: tripKeys.myInvitations });
      }
    },
  });

  const dates =
    invitation.trip_start_date && invitation.trip_end_date
      ? formatDateRange(invitation.trip_start_date, invitation.trip_end_date)
      : null;

  return (
    <View style={styles.card}>
      <Muted>{invitation.invited_by_name ? `${invitation.invited_by_name} invited you to` : 'You’re invited to'}</Muted>
      <Text style={styles.title}>{invitation.trip_title}</Text>
      <View style={styles.meta}>
        <Feather name="map-pin" size={14} color={colors.muted} />
        <Muted>{[invitation.trip_destination, dates].filter(Boolean).join(' · ')}</Muted>
      </View>

      <FormMessage
        message={
          answer.error instanceof ApiError && answer.error.status === 404
            ? 'This invite was cancelled.'
            : (answer.error?.message ?? null)
        }
      />

      <View style={styles.buttons}>
        <Button
          label="Decline"
          variant="secondary"
          loading={answer.isPending && answer.variables === 'decline'}
          disabled={answer.isPending}
          onPress={() => answer.mutate('decline')}
          style={styles.flex}
        />
        <Button
          label="Join trip"
          loading={answer.isPending && answer.variables === 'accept'}
          disabled={answer.isPending}
          onPress={() => answer.mutate('accept')}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  loading: {
    marginTop: spacing.xxl,
  },
  state: {
    gap: spacing.md,
  },
  empty: {
    paddingTop: spacing.xl,
    gap: spacing.sm,
    alignItems: 'center',
  },
  muted: {
    color: colors.muted,
    textAlign: 'center',
  },
  card: {
    padding: spacing.lg,
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
  },
  title: {
    fontFamily: fonts.displaySemi,
    fontSize: 24,
    color: colors.ink,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
