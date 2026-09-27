import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';

import { useMyInvitations } from '@/api/trips';
import { useTheme } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

// The phone's own tab bar: Liquid Glass on iOS 26, Material on Android.
// The website uses _layout.web.tsx.
export default function TabsLayout() {
  const { colors } = useTheme();
  const invitations = useMyInvitations();
  const pending = invitations.data?.length ?? 0;

  return (
    <NativeTabs
      tintColor={colors.accent}
      iconColor={{ default: colors.muted, selected: colors.accent }}
      labelStyle={{ fontFamily: fonts.medium, fontSize: 11 }}
      badgeBackgroundColor={colors.danger}
      // iOS draws its own glass behind the tabs; Android gets the app's surface colour
      backgroundColor={Platform.OS === 'android' ? colors.surface : undefined}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Trips</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'suitcase', selected: 'suitcase.fill' }} md="luggage" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="invites">
        <NativeTabs.Trigger.Label>Invites</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'envelope', selected: 'envelope.fill' }} md="mail" />
        {pending > 0 ? <NativeTabs.Trigger.Badge>{String(pending)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          md="account_circle"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
