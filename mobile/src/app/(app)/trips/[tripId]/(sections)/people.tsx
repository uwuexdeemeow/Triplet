import { Feather } from '@expo/vector-icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import {
  tripKeys,
  useMe,
  useMembers,
  useTripInvitations,
  type Invitation,
  type Member,
  type UserPublic,
} from '@/api/trips';
import { Avatar as PersonAvatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';
import { Muted } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { useWideLayout } from '@/utils/layout';

type Role = 'owner' | 'member' | 'viewer';

const ROLES: { role: Role; label: string; description: string }[] = [
  { role: 'owner', label: 'Owner', description: 'Can invite people and change the trip' },
  { role: 'member', label: 'Member', description: 'Can save links and plan' },
  { role: 'viewer', label: 'Viewer', description: 'Can only look' },
];

function roleLabel(role: string): string {
  return ROLES.find((item) => item.role === role)?.label ?? role;
}

export default function PeopleScreen() {
  const styles = useStyles();
  const wide = useWideLayout();
  const { colors } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const me = useMe();
  const members = useMembers(id);
  const invitations = useTripInvitations(id);
  const [openId, setOpenId] = useState<number | null>(null);

  const myRole = members.data?.find((member) => member.user_id === me.data?.id)?.role;
  const isOwner = myRole === 'owner';
  const ownerCount = members.data?.filter((member) => member.role === 'owner').length ?? 0;
  const pending = invitations.data?.filter((invitation) => invitation.status === 'pending') ?? [];

  const refresh = () => {
    members.refetch();
    invitations.refetch();
  };

  if (members.isPending || me.isPending) return <ActivityIndicator color={colors.accent} style={styles.loading} />;

  if (members.isError || me.isError) {
    return (
      <View style={styles.list}>
        <FormMessage message={(members.error ?? me.error)?.message ?? null} />
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.list, wide && styles.listWide]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={members.isRefetching} onRefresh={refresh} tintColor={colors.accent} />}>
      {isOwner ? <InviteForm tripId={id} /> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {members.data.length} {members.data.length === 1 ? 'person' : 'people'}
        </Text>
        <View style={styles.card}>
          {members.data.map((member, index) => (
            <MemberRow
              key={member.user_id}
              tripId={id}
              member={member}
              isMe={member.user_id === me.data.id}
              // Owners manage everyone else. Leaving is at the bottom of the screen.
              canManage={isOwner && member.user_id !== me.data.id}
              isLastOwner={member.role === 'owner' && ownerCount <= 1}
              open={openId === member.user_id}
              onToggle={() => setOpenId(openId === member.user_id ? null : member.user_id)}
              first={index === 0}
            />
          ))}
        </View>
      </View>

      {pending.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Waiting for an answer</Text>
          <View style={styles.card}>
            {pending.map((invitation, index) => (
              <PendingRow key={invitation.id} tripId={id} invitation={invitation} canCancel={isOwner} first={index === 0} />
            ))}
          </View>
        </View>
      ) : null}

      {!isOwner ? (
        <Muted style={styles.note}>Only owners can invite people or change what others can do.</Muted>
      ) : null}

      <LeaveTrip tripId={id} myId={me.data.id} isLastOwner={isOwner && ownerCount <= 1} />
    </ScrollView>
  );
}

function InviteForm({ tripId }: { tripId: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const members = useMembers(tripId);

  // Typing a name suggests people you've travelled with before; typing an email invites anyone
  const query = email.trim();
  const byName = query.length >= 2 && !query.includes('@');
  const suggestions = useQuery({
    queryKey: ['users', 'search', query],
    queryFn: () => api<UserPublic[]>('/users/search', { query: { q: query, limit: 5 } }),
    enabled: byName,
    placeholderData: keepPreviousData,
  });
  const onTrip = new Set(members.data?.map((member) => member.user_id));
  const people = byName ? (suggestions.data ?? []).filter((person) => !onTrip.has(person.id)) : [];

  const invite = useMutation({
    mutationFn: (target: { email: string } | { user_id: number; name: string }) =>
      api(`/trips/${tripId}/invitations`, {
        method: 'POST',
        body: 'email' in target ? { email: target.email } : { user_id: target.user_id },
      }),
    onSuccess: (_, target) => {
      setEmail('');
      setSentTo('email' in target ? target.email : target.name);
      queryClient.invalidateQueries({ queryKey: tripKeys.invitations(tripId) });
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.status === 400
          ? 'That’s your own email.'
          : err instanceof ApiError && err.status === 409
            ? err.message.includes('member')
              ? 'They’re already on this trip.'
              : 'They’ve already been invited.'
            : err.message,
      ),
  });

  const submit = () => {
    const value = email.trim().toLowerCase();
    setError(null);
    setSentTo(null);
    if (!value.includes('@') && people.length === 1) {
      invite.mutate({ user_id: people[0].id, name: people[0].name });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(
        byName
          ? 'Pick someone from the list, or enter their email address.'
          : 'Enter their email address, like sam@example.com',
      );
      return;
    }
    invite.mutate({ email: value });
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formLabel}>Invite a friend</Text>
      <View style={styles.formRow}>
        <TextInput
          accessibilityLabel="Friend’s name or email address"
          accessibilityHint="Names find people you've been on a trip with"
          placeholder="Name or email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="send"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={submit}
          style={[styles.input, error ? styles.inputError : null]}
        />
        <Button label="Invite" loading={invite.isPending} onPress={submit} style={styles.inviteButton} />
      </View>
      {people.length > 0 ? (
        <View style={styles.suggestions} accessibilityRole="list">
          {people.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={`Invite ${person.name}`}
              disabled={invite.isPending}
              onPress={() => {
                setError(null);
                setSentTo(null);
                invite.mutate({ user_id: person.id, name: person.name });
              }}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
              <PersonAvatar name={person.name} url={person.avatar_url} size={32} />
              <Text style={styles.suggestionName} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={styles.suggestionAction}>Invite</Text>
            </Pressable>
          ))}
        </View>
      ) : byName && suggestions.isFetched && !suggestions.isPlaceholderData ? (
        <Muted>No one by that name from your other trips. Use their email instead.</Muted>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {sentTo ? (
        <FormMessage
          tone="success"
          message={
            sentTo.includes('@')
              ? `Invite sent to ${sentTo}. They'll get an email; if they're new to Triplet, it asks them to sign up first.`
              : `Invite sent to ${sentTo}. They'll see it in their Invites tab.`
          }
        />
      ) : null}
    </View>
  );
}

function Avatar({ name, url, faded = false }: { name: string; url?: string | null; faded?: boolean }) {
  const styles = useStyles();
  return (
    <PersonAvatar
      name={name}
      url={url}
      size={40}
      style={faded && styles.avatarFaded}
      textStyle={[styles.avatarText, faded && styles.avatarTextFaded]}
    />
  );
}

function MemberRow({
  tripId,
  member,
  isMe,
  canManage,
  isLastOwner,
  open,
  onToggle,
  first,
}: {
  tripId: number;
  member: Member;
  isMe: boolean;
  canManage: boolean;
  isLastOwner: boolean;
  open: boolean;
  onToggle: () => void;
  first: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const changeRole = useMutation({
    mutationFn: (role: Role) => api(`/trips/${tripId}/members/${member.user_id}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tripKeys.members(tripId) }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/trips/${tripId}/members/${member.user_id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tripKeys.members(tripId) }),
  });

  const error = changeRole.error ?? remove.error;

  const summary = (
    <>
      <Avatar name={member.name} url={member.avatar_url} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {member.name}
          {isMe ? <Text style={styles.you}> (you)</Text> : null}
        </Text>
        <Muted numberOfLines={1}>{member.email}</Muted>
      </View>
      <View style={[styles.rolePill, member.role === 'owner' && styles.rolePillOwner]}>
        <Text style={[styles.rolePillText, member.role === 'owner' && styles.rolePillTextOwner]}>{roleLabel(member.role)}</Text>
      </View>
      {canManage ? <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} /> : null}
    </>
  );

  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      {canManage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint="Change what they can do, or remove them"
          onPress={() => {
            setConfirmRemove(false);
            onToggle();
          }}
          style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
          {summary}
        </Pressable>
      ) : (
        <View style={styles.rowMain}>{summary}</View>
      )}

      {open && canManage ? (
        <View style={styles.manage}>
          <View accessibilityRole="radiogroup" style={styles.roleOptions}>
            {ROLES.map(({ role, label, description }) => {
              const selected = member.role === role;
              // The server refuses to leave a trip without an owner
              const locked = isLastOwner && role !== 'owner';
              return (
                <Pressable
                  key={role}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: locked || changeRole.isPending }}
                  disabled={selected || locked || changeRole.isPending}
                  onPress={() => changeRole.mutate(role)}
                  style={[styles.roleOption, selected && styles.roleOptionSelected, locked && styles.disabled]}>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.roleLabel}>{label}</Text>
                    <Text style={styles.roleDescription}>{description}</Text>
                  </View>
                  {changeRole.isPending && changeRole.variables === role ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <FormMessage message={error?.message ?? null} />

          {confirmRemove ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>Remove {member.name} from the trip? You can invite them again later.</Text>
              <View style={styles.confirmButtons}>
                <Button label="Keep" variant="secondary" onPress={() => setConfirmRemove(false)} style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  disabled={remove.isPending}
                  onPress={() => remove.mutate()}
                  style={[styles.dangerButton, styles.flex]}>
                  <Text style={styles.dangerLabel}>{remove.isPending ? 'Removing…' : 'Remove'}</Text>
                </Pressable>
              </View>
            </View>
          ) : !isLastOwner ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirmRemove(true)} style={styles.textButton}>
              <Text style={styles.dangerText}>Remove from trip</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PendingRow({
  tripId,
  invitation,
  canCancel,
  first,
}: {
  tripId: number;
  invitation: Invitation;
  canCancel: boolean;
  first: boolean;
}) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api(`/trips/${tripId}/invitations/${invitation.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tripKeys.invitations(tripId) }),
  });

  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <View style={styles.rowMain}>
        {/* Names only show once someone joins, so a pending invite is just the address */}
        <Avatar name={invitation.invitee_email} faded />
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {invitation.invitee_email}
          </Text>
          <Muted numberOfLines={1}>Invited · waiting to join</Muted>
        </View>
        {canCancel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Cancel the invite to ${invitation.invitee_email}`}
            disabled={cancel.isPending}
            onPress={() => cancel.mutate()}
            style={styles.textButton}>
            <Text style={styles.dangerText}>{cancel.isPending ? 'Cancelling…' : 'Cancel'}</Text>
          </Pressable>
        ) : (
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>Invited</Text>
          </View>
        )}
      </View>
      <FormMessage message={cancel.error?.message ?? null} />
    </View>
  );
}

function LeaveTrip({ tripId, myId, isLastOwner }: { tripId: number; myId: number; isLastOwner: boolean }) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);

  const leave = useMutation({
    mutationFn: () => api(`/trips/${tripId}/members/${myId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: tripKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: tripKeys.all, exact: true });
      router.replace('/');
    },
  });

  if (isLastOwner) {
    return (
      <Muted style={styles.note}>
        You’re the only owner. To leave, make someone else an owner first.
      </Muted>
    );
  }

  return confirm ? (
    <View style={styles.confirm}>
      <Text style={styles.confirmText}>Leave this trip? You’ll need a new invite to come back.</Text>
      <FormMessage message={leave.error?.message ?? null} />
      <View style={styles.confirmButtons}>
        <Button label="Stay" variant="secondary" onPress={() => setConfirm(false)} style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          disabled={leave.isPending}
          onPress={() => leave.mutate()}
          style={[styles.dangerButton, styles.flex]}>
          <Text style={styles.dangerLabel}>{leave.isPending ? 'Leaving…' : 'Leave'}</Text>
        </Pressable>
      </View>
    </View>
  ) : (
    <Pressable accessibilityRole="button" onPress={() => setConfirm(true)} style={styles.leave}>
      <Text style={styles.dangerText}>Leave trip</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  listWide: {
    maxWidth: 760,
    paddingTop: spacing.xl,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  loading: {
    marginTop: spacing.xxl,
  },
  form: {
    gap: spacing.sm,
  },
  formLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
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
  inviteButton: {
    minHeight: 48,
    paddingHorizontal: 18,
  },
  suggestions: {
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  suggestionName: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
  suggestionAction: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.accent,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.dangerText,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.chip,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowName: {
    fontFamily: fonts.bold,
    fontSize: 15.5,
    color: colors.ink,
  },
  you: {
    fontFamily: fonts.body,
    color: colors.muted,
  },
  avatarFaded: {
    backgroundColor: colors.chip,
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accentStrong,
  },
  avatarTextFaded: {
    color: colors.muted,
  },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  rolePillOwner: {
    backgroundColor: colors.accentSoft,
  },
  rolePillText: {
    fontFamily: fonts.semibold,
    fontSize: 12.5,
    color: colors.muted,
  },
  rolePillTextOwner: {
    color: colors.accentStrong,
  },
  manage: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  roleOptions: {
    gap: spacing.sm,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.input,
  },
  roleOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  roleLabel: {
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.ink,
  },
  roleDescription: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  disabled: {
    opacity: 0.45,
  },
  note: {
    textAlign: 'center',
  },
  textButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
  },
  leave: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.dangerText,
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
  dangerButton: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerLabel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.onDanger,
  },
  pressed: {
    opacity: 0.75,
  },
}));
