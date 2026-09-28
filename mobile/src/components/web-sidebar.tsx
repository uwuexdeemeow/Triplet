import { Feather } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useMe, useMyInvitations } from '@/api/trips';
import { Avatar } from '@/components/avatar';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type Item = {
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
  href: Href;
  // Which paths count as being on this page
  matches: (pathname: string) => boolean;
};

const ITEMS: Item[] = [
  { label: 'Trips', icon: 'briefcase', href: '/', matches: (path) => path === '/' || path.startsWith('/trips') },
  { label: 'Invites', icon: 'mail', href: '/invites', matches: (path) => path.startsWith('/invites') },
  { label: 'Settings', icon: 'user', href: '/profile', matches: (path) => path.startsWith('/profile') },
];

/**
 * The website's navigation on a big screen, in place of the phone's bottom tabs.
 * Inside a trip it folds down to icons so the plan and its map get the room.
 */
export function WebSidebar({ compact: always = false }: { compact?: boolean }) {
  const pathname = usePathname();
  // Slim on a tablet-sized window, and inside a trip so the plan gets the room
  const compact = always || (pathname.startsWith('/trips/') && pathname !== '/trips/new');
  const styles = useStyles();
  const { colors } = useTheme();
  const me = useMe();
  const invitations = useMyInvitations();
  const pending = invitations.data?.length ?? 0;

  return (
    <View role="navigation" style={[styles.sidebar, compact && styles.sidebarCompact]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Triplet, your trips"
        onPress={() => router.navigate('/')}
        style={[styles.brand, compact && styles.brandCompact]}>
        <View style={styles.logo}>
          <Feather name="map-pin" size={18} color={colors.onAccent} />
        </View>
        {compact ? null : <Text style={styles.wordmark}>Triplet</Text>}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New trip"
        onPress={() => router.push('/trips/new')}
        style={({ hovered, pressed }) => [
          styles.newTrip,
          compact && styles.newTripCompact,
          (hovered || pressed) && styles.newTripHover,
        ]}>
        <Feather name="plus" size={compact ? 20 : 16} color={colors.onAccent} />
        {compact ? null : <Text style={styles.newTripLabel}>New trip</Text>}
      </Pressable>

      <View style={styles.items}>
        {ITEMS.map((item) => {
          const active = item.matches(pathname);
          const badge = item.label === 'Invites' && pending > 0 ? pending : 0;
          return (
            <Pressable
              key={item.label}
              accessibilityRole="link"
              accessibilityLabel={badge ? `${item.label}, ${badge} waiting` : item.label}
              accessibilityState={{ selected: active }}
              onPress={() => router.navigate(item.href)}
              style={({ hovered }) => [
                styles.item,
                compact && styles.itemCompact,
                active ? styles.itemActive : hovered && styles.itemHover,
              ]}>
              <Feather name={item.icon} size={compact ? 20 : 18} color={active ? colors.accent : colors.muted} />
              {compact ? null : <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{item.label}</Text>}
              {badge ? (
                <View style={[styles.badge, compact && styles.badgeCompact]}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {me.data ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${me.data.name}, settings`}
          onPress={() => router.navigate('/profile')}
          style={({ hovered }) => [styles.me, compact && styles.meCompact, hovered && styles.itemHover]}>
          <Avatar name={me.data.name} url={me.data.avatar_url} size={36} />
          {compact ? null : (
            <View style={styles.meText}>
              <Text style={styles.meName} numberOfLines={1}>
                {me.data.name}
              </Text>
              <Text style={styles.meEmail} numberOfLines={1}>
                {me.data.email}
              </Text>
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  sidebar: {
    width: 248,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.xl,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    backgroundColor: colors.surface,
  },
  sidebarCompact: {
    width: 72,
    paddingHorizontal: 0,
    alignItems: 'center',
    gap: spacing.md,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.sm,
  },
  brandCompact: {
    paddingHorizontal: 0,
    marginBottom: spacing.md,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: fonts.bold,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  newTrip: {
    height: 44,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  newTripCompact: {
    width: 44,
    borderRadius: 22,
  },
  newTripHover: {
    backgroundColor: colors.accentStrong,
  },
  newTripLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.onAccent,
  },
  items: {
    gap: spacing.xs,
  },
  item: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemCompact: {
    width: 44,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  itemActive: {
    backgroundColor: colors.accentSoft,
  },
  itemHover: {
    backgroundColor: colors.chip,
  },
  itemLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.muted,
  },
  itemLabelActive: {
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCompact: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.onAccent,
  },
  me: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: spacing.sm,
    borderRadius: radii.card,
  },
  meCompact: {
    padding: 4,
  },
  meText: {
    flex: 1,
    minWidth: 0,
  },
  meName: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  meEmail: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
}));
