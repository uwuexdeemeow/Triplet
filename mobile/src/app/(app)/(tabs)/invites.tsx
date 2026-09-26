import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Body, Heading } from '@/components/text';
import { colors, spacing } from '@/theme/tokens';

// Built in the "Budget, People and Invites" step
export default function InvitesScreen() {
  return (
    <Screen scroll={false}>
      <View style={styles.container}>
        <Heading>Invites</Heading>
        <Body style={styles.muted}>Trip invitations from friends will show up here.</Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  muted: {
    color: colors.muted,
  },
});
