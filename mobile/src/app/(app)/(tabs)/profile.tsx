import { useMutation, useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api, type Schemas } from '@/api/client';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { Body, Heading, Muted, Title } from '@/components/text';
import { colors, radii, spacing } from '@/theme/tokens';

type User = Schemas['UserResponse'];

export default function ProfileScreen() {
  const { signOut } = useSession();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/users/me') });

  // Revokes every refresh token for the account, then signs out here too
  const signOutEverywhere = useMutation({
    mutationFn: () => api('/auth/logout-all', { method: 'POST' }),
    onSuccess: () => signOut(),
  });

  return (
    <Screen>
      <View style={styles.container}>
        <Heading>Profile</Heading>

        <View style={styles.card}>
          {me.isPending ? (
            <ActivityIndicator color={colors.teal} />
          ) : me.isError ? (
            <FormMessage message={me.error.message} />
          ) : (
            <>
              <Title>{me.data.name}</Title>
              <Muted>{me.data.email}</Muted>
            </>
          )}
        </View>

        <View style={styles.actions}>
          <Button label="Log out" variant="secondary" onPress={signOut} />
          <Button
            label="Log out on all devices"
            variant="text"
            loading={signOutEverywhere.isPending}
            onPress={() => signOutEverywhere.mutate()}
          />
          <FormMessage message={signOutEverywhere.error?.message ?? null} />
        </View>

        <Body style={styles.note}>Editing your name, email and photo comes later.</Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: 4,
  },
  actions: {
    gap: spacing.sm,
  },
  note: {
    color: colors.muted,
    fontSize: 14,
  },
});
