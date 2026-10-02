import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { tripKeys, useMe, type User } from "@/api/trips";
import { Buddy } from "@/appearance/buddy";
import { AVATAR_BUDDIES, mix } from "@/appearance/looks";
import { useSession } from "@/auth/session";
import { nameSchema } from "@/auth/validation";
import { AccountSettings, DeleteAccount } from "@/components/account-settings";
import { Avatar, personColour } from "@/components/avatar";
import { Button } from "@/components/button";
import { FormMessage, Screen } from "@/components/screen";
import { Heading, Muted, Title } from "@/components/text";
import { TextField } from "@/components/text-field";
import type { ThemePreference } from "@/theme/preference";
import { makeStyles, useTheme } from "@/theme/theme";
import { fonts, radii, spacing } from "@/theme/tokens";
import { useLayoutSize } from "@/utils/layout";
import { pickAndUploadProfilePhoto } from "@/utils/profile-photo";

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { signOut } = useSession();
  const me = useMe();
  // The settings page with its section list needs a desktop's width; tablets keep the single column
  const wide = useLayoutSize() === "desktop";
  const scrollRef = useRef<ScrollView>(null);
  // Where each section starts, so the list on the left can jump to it
  const offsets = useRef<Record<string, number>>({});

  // Revokes every refresh token for the account, then signs out here too
  const signOutEverywhere = useMutation({
    mutationFn: () => api("/auth/logout-all", { method: "POST" }),
    onSuccess: () => signOut(),
  });

  if (wide) {
    const sections: { key: string; label: string; content: ReactNode }[] = [
      {
        key: "profile",
        label: "Profile",
        content: (
          <View style={styles.card}>
            {me.isPending ? (
              <ActivityIndicator color={colors.accent} />
            ) : me.isError ? (
              <FormMessage message={me.error.message} />
            ) : (
              <>
                <PhotoEditor user={me.data} />
                <NameEditor user={me.data} />
                <BuddyPicker user={me.data} />
              </>
            )}
          </View>
        ),
      },
      {
        key: "account",
        label: "Account",
        content: me.data ? <AccountSettings user={me.data} /> : null,
      },
      { key: "appearance", label: "Appearance", content: <AppearancePicker /> },
      {
        key: "devices",
        label: "Signed-in devices",
        content: (
          <View style={[styles.card, styles.devices]}>
            <View style={styles.devicesText}>
              <Title>Signed-in devices</Title>
              <Muted>
                Log out here, or everywhere at once if you’ve lost a phone.
              </Muted>
            </View>
            <View style={styles.devicesButtons}>
              <Button label="Log out" variant="secondary" onPress={signOut} />
              <Button
                label="Log out everywhere"
                variant="text"
                loading={signOutEverywhere.isPending}
                onPress={() => signOutEverywhere.mutate()}
              />
            </View>
            <FormMessage message={signOutEverywhere.error?.message ?? null} />
          </View>
        ),
      },
      {
        key: "delete",
        label: "Delete account",
        content: me.data ? <DeleteAccount user={me.data} /> : null,
      },
    ];

    return (
      <SafeAreaView style={styles.widePage} edges={["top", "left", "right"]}>
        <ScrollView
          ref={scrollRef}
          style={styles.widePage}
          contentContainerStyle={styles.wideContent}
        >
          <View style={styles.wideNav}>
            <Heading style={styles.wideHeading}>Settings</Heading>
            {sections.map((section) => (
              <Pressable
                key={section.key}
                accessibilityRole="link"
                onPress={() =>
                  scrollRef.current?.scrollTo({
                    y: offsets.current[section.key] ?? 0,
                    animated: true,
                  })
                }
                style={({ hovered }) => [
                  styles.navItem,
                  hovered && styles.navItemHover,
                ]}
              >
                <Text
                  style={[
                    styles.navLabel,
                    section.key === "delete" && styles.navLabelDanger,
                  ]}
                >
                  {section.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.wideSections}>
            {sections.map((section) => (
              <View
                key={section.key}
                onLayout={(event) => {
                  offsets.current[section.key] = event.nativeEvent.layout.y;
                }}
              >
                {section.content}
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        <Heading>Profile</Heading>

        <View style={styles.card}>
          {me.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : me.isError ? (
            <FormMessage message={me.error.message} />
          ) : (
            <>
              <PhotoEditor user={me.data} />
              <NameEditor user={me.data} />
              <BuddyPicker user={me.data} />
            </>
          )}
        </View>

        {me.data ? <AccountSettings user={me.data} /> : null}

        <AppearancePicker />

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

        {me.data ? <DeleteAccount user={me.data} /> : null}
      </View>
    </Screen>
  );
}

// Your photo shows next to your name on trips, instead of your initial
function PhotoEditor({ user }: { user: User }) {
  const styles = useStyles();
  const queryClient = useQueryClient();

  const updated = (next: User | null) => {
    if (!next) return;
    queryClient.setQueryData(tripKeys.me, next);
    // Trip cards and People tabs show everyone's photos
    queryClient.invalidateQueries({ queryKey: tripKeys.all });
  };

  const change = useMutation({
    mutationFn: pickAndUploadProfilePhoto,
    onSuccess: updated,
  });
  const remove = useMutation({
    mutationFn: () => api<User>("/users/me/avatar", { method: "DELETE" }),
    onSuccess: updated,
  });
  const busy = change.isPending || remove.isPending;

  return (
    <View style={styles.photo}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          user.avatar_url ? "Change your photo" : "Add a photo"
        }
        disabled={busy}
        onPress={() => change.mutate()}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Avatar
          name={user.name}
          url={user.avatar_url}
          buddy={user.avatar_buddy}
          userId={user.id}
          size={72}
        />
        {busy ? (
          <View style={styles.photoBusy}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </Pressable>
      <View style={styles.photoActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => change.mutate()}
          style={styles.editButton}
        >
          <Text style={styles.editLabel}>
            {user.avatar_url ? "Change photo" : "Add a photo"}
          </Text>
        </Pressable>
        {user.avatar_url ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => remove.mutate()}
            style={styles.editButton}
          >
            <Text style={styles.removeLabel}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      <FormMessage message={(change.error ?? remove.error)?.message ?? null} />
    </View>
  );
}

// A buddy to show instead of your initial, on the map, in Ask and next to your name
function BuddyPicker({ user }: { user: User }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const colour = personColour(user.id, user.name);

  const save = useMutation({
    mutationFn: (buddy: string | null) =>
      api<User>("/users/me", {
        method: "PATCH",
        body: { avatar_buddy: buddy },
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(tripKeys.me, next);
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
    },
  });
  // Show the choice straight away, before the server answers
  const current = save.isPending ? save.variables : user.avatar_buddy;

  return (
    <View style={styles.buddies}>
      <View>
        <Title>Your buddy</Title>
        <Muted>
          {user.avatar_url
            ? "Shown if you remove your photo."
            : "Shown instead of your initial, next to your name on trips."}
        </Muted>
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Your buddy"
        style={styles.buddyGrid}
      >
        {AVATAR_BUDDIES.map((buddy) => {
          const selected = current === buddy.id;
          return (
            <Pressable
              key={buddy.id}
              accessibilityRole="radio"
              accessibilityLabel={buddy.name}
              aria-checked={selected}
              onPress={() => save.mutate(buddy.id)}
              style={[styles.buddy, selected && styles.buddySelected]}
            >
              <View
                style={[
                  styles.buddyFill,
                  { backgroundColor: mix(colour, "#FFFFFF", 0.85) },
                ]}
              >
                <Buddy buddy={buddy.id} accent={colour} size={40} />
              </View>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel="Just my initial"
          aria-checked={!current}
          onPress={() => save.mutate(null)}
          style={[styles.buddy, !current && styles.buddySelected]}
        >
          <View style={[styles.buddyFill, { backgroundColor: colors.chip }]}>
            <Text style={styles.buddyInitial}>
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </Text>
          </View>
        </Pressable>
      </View>
      <FormMessage message={save.error?.message ?? null} />
    </View>
  );
}

// Your name is what friends see on the trip's People tab
function NameEditor({ user }: { user: User }) {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (value: string) =>
      api<User>("/users/me", { method: "PATCH", body: { name: value } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(tripKeys.me, updated);
      // Member lists show names, so refresh every trip's copy
      queryClient.invalidateQueries({ queryKey: tripKeys.all });
      setEditing(false);
    },
    onError: (err) => setError(err.message),
  });

  const submit = () => {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your name");
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  };

  if (!editing) {
    return (
      <View style={styles.nameRow}>
        <View style={styles.nameText}>
          <Title>{user.name}</Title>
          <Muted>{user.email}</Muted>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your name"
          onPress={() => {
            setName(user.name);
            setError(null);
            setEditing(true);
          }}
          style={styles.editButton}
        >
          <Text style={styles.editLabel}>Edit</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <TextField
        label="Name"
        hint="Friends see this on your trips."
        autoFocus
        autoCapitalize="words"
        returnKeyType="done"
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        error={error ?? undefined}
      />
      <View style={styles.editorButtons}>
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => setEditing(false)}
          style={styles.flex}
        />
        <Button
          label="Save"
          loading={save.isPending}
          onPress={submit}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

const APPEARANCES: {
  value: ThemePreference;
  label: string;
  icon: ComponentProps<typeof Feather>["name"];
}[] = [
  // On the website "system" means the computer's own light or dark setting
  Platform.OS === "web"
    ? { value: "system", label: "Match system", icon: "monitor" }
    : { value: "system", label: "Match phone", icon: "smartphone" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

// Light, dark, or whatever the phone (or browser) is set to
function AppearancePicker() {
  const styles = useStyles();
  const { colors, preference, setPreference } = useTheme();

  return (
    <View style={styles.appearance}>
      <Text style={styles.appearanceLabel}>Appearance</Text>
      <View accessibilityRole="radiogroup" style={styles.segments}>
        {APPEARANCES.map(({ value, label, icon }) => {
          const selected = preference === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => setPreference(value)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Feather
                name={icon}
                size={16}
                color={selected ? colors.ink : colors.muted}
              />
              <Text
                style={[
                  styles.segmentLabel,
                  selected && styles.segmentLabelSelected,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Big screens: a settings page with its sections listed on the left
  widePage: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  wideContent: {
    flexDirection: "row",
    gap: 48,
    paddingHorizontal: 56,
    paddingVertical: 40,
  },
  wideNav: {
    width: 200,
    gap: spacing.xs,
  },
  wideHeading: {
    marginBottom: spacing.lg,
  },
  navItem: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input - 2,
    justifyContent: "center",
  },
  navItemHover: {
    backgroundColor: colors.chip,
  },
  navLabel: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
  },
  navLabelDanger: {
    color: colors.dangerText,
  },
  wideSections: {
    flex: 1,
    maxWidth: 720,
    gap: spacing.xl,
  },
  devices: {
    gap: spacing.md,
  },
  devicesText: {
    gap: 4,
  },
  devicesButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  appearance: {
    gap: spacing.sm,
  },
  appearanceLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  segments: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.chip,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderRadius: radii.input - 2,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  segmentLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  segmentLabelSelected: {
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  container: {
    gap: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: 4,
  },
  actions: {
    gap: spacing.sm,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  nameText: {
    flex: 1,
    gap: 4,
  },
  editButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  editLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.accent,
  },
  editor: {
    gap: spacing.md,
  },
  photo: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  buddies: {
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  buddyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  // A ring shows the one you picked
  buddy: {
    width: 56,
    height: 56,
    borderRadius: 28,
    padding: 3,
    borderWidth: 2.5,
    borderColor: "transparent",
  },
  buddySelected: {
    borderColor: colors.ink,
  },
  buddyFill: {
    flex: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  buddyInitial: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.muted,
  },
  photoBusy: {
    position: "absolute",
    inset: 0,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginLeft: -spacing.sm,
  },
  removeLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.dangerText,
  },
  pressed: {
    opacity: 0.75,
  },
  editorButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
}));
