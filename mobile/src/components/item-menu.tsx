import { Feather } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Glass } from '@/components/glass';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { select, success } from '@/utils/haptics';

type IconName = ComponentProps<typeof Feather>['name'];

export type MenuAction = {
  label: string;
  icon: IconName;
  onPress: () => void;
};

type ItemMenuProps = {
  visible: boolean;
  onClose: () => void;
  // The item's name, shown at the top
  title: string;
  subtitle?: string;
  // Plain actions, like "Edit plan" or "Open post"
  actions?: MenuAction[];
  rename?: {
    value: string;
    placeholder?: string;
    hint?: string;
    // Rejects with an Error whose message is shown
    onSave: (name: string) => Promise<unknown>;
    // Whether an empty name is allowed (e.g. to go back to the original title)
    allowEmpty?: boolean;
  };
  remove?: {
    // e.g. "Delete this plan?"
    question: string;
    detail?: string;
    onDelete: () => Promise<unknown>;
  };
};

type Mode = 'menu' | 'rename' | 'delete';

/**
 * What a long press opens: the item's actions, then Rename and Delete, which switch the sheet
 * to a name field or a confirmation in place.
 */
export function ItemMenu(props: ItemMenuProps) {
  // Re-mounted each time it opens, so it always starts on the menu
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose} statusBarTranslucent>
      {props.visible ? <MenuSheet {...props} /> : null}
    </Modal>
  );
}

function MenuSheet({ onClose, title, subtitle, actions = [], rename, remove }: ItemMenuProps) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState(rename?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      success();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    const value = name.trim();
    if (!value && !rename?.allowEmpty) {
      setError('Give it a name');
      return;
    }
    run(() => rename!.onSave(value));
  };

  return (
    <View style={styles.fill}>
      <Animated.View entering={FadeIn.duration(150)} style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" style={styles.fill} onPress={onClose} />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.bottom} pointerEvents="box-none">
        <Animated.View
          // Slides straight up into place, no bounce
          entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}
          style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Glass style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={2}>
                {mode === 'rename' ? 'Rename' : mode === 'delete' ? remove?.question : title}
              </Text>
              {mode === 'menu' && subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
              {mode === 'delete' && remove?.detail ? <Text style={styles.subtitle}>{remove.detail}</Text> : null}
            </View>

            {mode === 'menu' ? (
              <View style={styles.rows}>
                {actions.map((action) => (
                  <Row
                    key={action.label}
                    icon={action.icon}
                    label={action.label}
                    onPress={() => {
                      onClose();
                      action.onPress();
                    }}
                  />
                ))}
                {rename ? (
                  <Row
                    icon="edit-3"
                    label="Rename"
                    onPress={() => {
                      select();
                      setMode('rename');
                    }}
                  />
                ) : null}
                {remove ? (
                  <Row
                    icon="trash-2"
                    label="Delete"
                    danger
                    onPress={() => {
                      select();
                      setMode('delete');
                    }}
                  />
                ) : null}
              </View>
            ) : null}

            {mode === 'rename' ? (
              <View style={styles.form}>
                <TextInput
                  accessibilityLabel="New name"
                  value={name}
                  onChangeText={(value) => {
                    setName(value);
                    setError(null);
                  }}
                  placeholder={rename?.placeholder}
                  placeholderTextColor={colors.muted}
                  autoFocus
                  selectTextOnFocus
                  maxLength={255}
                  returnKeyType="done"
                  onSubmitEditing={saveName}
                  keyboardAppearance={scheme}
                  style={[styles.input, error ? styles.inputError : null]}
                />
                {rename?.hint && !error ? <Text style={styles.hint}>{rename.hint}</Text> : null}
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {mode === 'rename' ? (
              <View style={styles.buttons}>
                <Button label="Back" variant="secondary" onPress={() => setMode('menu')} style={styles.flex} />
                <Button label="Save" loading={busy} onPress={saveName} style={styles.flex} />
              </View>
            ) : null}

            {mode === 'delete' ? (
              <View style={styles.buttons}>
                <Button label="Keep" variant="secondary" onPress={() => setMode('menu')} style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => run(remove!.onDelete)}
                  style={({ pressed }) => [styles.deleteButton, styles.flex, pressed && styles.pressed]}>
                  {busy ? <ActivityIndicator color={colors.onDanger} /> : <Text style={styles.deleteLabel}>Delete</Text>}
                </Pressable>
              </View>
            ) : null}
          </Glass>

          {mode === 'menu' ? (
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => pressed && styles.pressed}>
              <Glass interactive style={styles.cancel}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Glass>
            </Pressable>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Row({ icon, label, onPress, danger = false }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Feather name={icon} size={19} color={danger ? colors.dangerText : colors.ink} />
      <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: `rgba(${colors.shadow}, 0.35)`,
  },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  sheet: {
    borderRadius: 26,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  title: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 18,
    color: colors.ink,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.muted,
  },
  rows: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
  },
  rowPressed: {
    backgroundColor: `rgba(${colors.shadow}, 0.08)`,
  },
  rowLabel: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
  },
  rowDanger: {
    color: colors.dangerText,
  },
  form: {
    paddingHorizontal: spacing.sm,
    gap: 6,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radii.input,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  inputError: {
    borderColor: colors.danger,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  error: {
    paddingHorizontal: spacing.md,
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.dangerText,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  deleteButton: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.onDanger,
  },
  cancel: {
    minHeight: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.accent,
  },
  pressed: {
    opacity: 0.8,
  },
}));
