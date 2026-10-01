import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Children, useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { DialogContext, useInDialog } from '@/components/dialog-context';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing, touchTarget } from '@/theme/tokens';
import { useWideLayout } from '@/utils/layout';

/*
 * Adding and editing screens, laid out for where they're used:
 * - phones (and the app on any size): a full-screen sheet, one field under another
 * - the website on a tablet or computer: a dialog over the page it was opened from, with sections
 *   that have their label beside the fields, related fields side by side, and Cancel and Save in a
 *   footer bar
 * Forms describe their parts with FormSection, FieldRow and FormActions, and each draws itself
 * for the layout it's in.
 */

/** Whether forms open as dialogs: the website, on a tablet-sized window or bigger. */
// Their stack screens are transparent then, so the page they were opened from shows behind (see
// formPresentation)
export function useFormDialog(): boolean {
  // Called unconditionally, so hooks stay in the same order on every platform
  const wide = useWideLayout();
  return Platform.OS === 'web' && wide;
}

export { useInDialog };

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function FormScreen({
  title,
  subtitle,
  actions,
  size = 'regular',
  scroll = true,
  message = null,
  onClose = close,
  children,
}: {
  title: string;
  subtitle?: string;
  // An error to show above the fields, e.g. from saving
  message?: string | null;
  // Usually FormActions: a footer bar in a dialog, the buttons at the end on a phone
  actions?: ReactNode;
  // "wide" for screens with a lot on them, like trip settings
  size?: 'regular' | 'wide';
  // Off for screens that scroll part of themselves, like a chat with its box at the bottom
  scroll?: boolean;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const dialog = useFormDialog();

  // Escape closes the dialog, as on any website
  useEffect(() => {
    if (!dialog || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  if (!dialog) {
    return (
      <Screen scroll={scroll}>
        <View style={[styles.phone, !scroll && styles.flex]}>
          <ScreenHeader title={title} subtitle={subtitle} icon="close" onBack={onClose} />
          <FormMessage message={message} />
          {children}
          {actions}
        </View>
      </Screen>
    );
  }

  return (
    <DialogContext value>
      <View style={styles.overlay}>
        {/* Clicking outside the dialog closes it */}
        <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.backdrop} />
        <View
          role="dialog"
          aria-modal
          aria-label={title}
          style={[styles.dialog, size === 'wide' ? styles.dialogWide : null, !scroll && styles.dialogTall]}>
          <View style={styles.header}>
            <View style={styles.titles}>
              <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ hovered }) => [styles.close, hovered && styles.closeHover]}>
              <Feather name="x" size={18} color={colors.ink} />
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
              {message ? (
                <View style={styles.message}>
                  <FormMessage message={message} />
                </View>
              ) : null}
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.bodyContent, styles.bodyFixed]}>
              <FormMessage message={message} />
              {children}
            </View>
          )}
          {actions ? <View style={styles.footer}>{actions}</View> : null}
        </View>
      </View>
    </DialogContext>
  );
}

/**
 * A group of fields. In a dialog its title and description sit in a column beside the fields,
 * like a settings page; on a phone the fields simply follow each other.
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const styles = useStyles();
  if (!useInDialog()) return <View style={styles.stack}>{children}</View>;

  return (
    <View style={styles.section}>
      <View style={styles.sectionLabel}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      </View>
      <View style={styles.sectionFields}>{children}</View>
    </View>
  );
}

/**
 * Fields that belong together, side by side in a dialog and one under another on a phone.
 * `columns` keeps a lone short field (like a price) from stretching across the whole dialog.
 */
export function FieldRow({ children, columns }: { children: ReactNode; columns?: number }) {
  const styles = useStyles();
  const items = Children.toArray(children);
  if (!useInDialog()) return <View style={styles.stack}>{children}</View>;
  const empty = Math.max(0, (columns ?? items.length) - items.length);
  return (
    <View style={styles.row}>
      {items.map((child, index) => (
        <View key={index} style={styles.rowItem}>
          {child}
        </View>
      ))}
      {Array.from({ length: empty }, (_, index) => (
        <View key={`empty-${index}`} style={styles.rowItem} />
      ))}
    </View>
  );
}

/**
 * Save, and for things that exist, delete with a confirmation. In a dialog: a footer bar with
 * delete on the left and Cancel and Save on the right. On a phone: a full-width Save, with the
 * delete link under it.
 */
export function FormActions({
  label,
  onSave,
  saving = false,
  disabled = false,
  remove,
  onCancel = close,
}: {
  label: string;
  onSave: () => void;
  saving?: boolean;
  disabled?: boolean;
  remove?: {
    // e.g. "Delete plan"
    label: string;
    // e.g. "Delete Lunch at Ichiran?"
    question: string;
    // e.g. "The saved place stays in the Saved tab."
    detail?: string;
    onConfirm: () => void;
    pending: boolean;
    // Shown while it goes, e.g. "Removing…"
    pendingLabel?: string;
  };
  onCancel?: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const dialog = useInDialog();
  const [confirming, setConfirming] = useState(false);

  if (dialog) {
    if (remove && confirming) {
      return (
        <View style={styles.footerRow}>
          <View style={styles.footerQuestion}>
            <Text style={styles.confirmText}>{remove.question}</Text>
            {remove.detail ? <Text style={styles.confirmDetail}>{remove.detail}</Text> : null}
          </View>
          <Button label="Keep" variant="secondary" size="compact" onPress={() => setConfirming(false)} />
          <Pressable
            accessibilityRole="button"
            disabled={remove.pending}
            onPress={remove.onConfirm}
            style={({ hovered }) => [styles.dangerButton, hovered && styles.dangerButtonHover]}>
            <Text style={styles.dangerLabel}>{remove.pending ? (remove.pendingLabel ?? 'Deleting…') : remove.label}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.footerRow}>
        {remove ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirming(true)}
            style={({ hovered }) => [styles.dangerLink, hovered && styles.dangerLinkHover]}>
            <Feather name="trash-2" size={15} color={colors.dangerText} />
            <Text style={styles.dangerLinkLabel}>{remove.label}</Text>
          </Pressable>
        ) : null}
        <View style={styles.footerSpacer} />
        <Button label="Cancel" variant="text" size="compact" onPress={onCancel} />
        <Button label={label} size="compact" loading={saving} disabled={disabled} onPress={onSave} style={styles.save} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Button label={label} loading={saving} disabled={disabled} onPress={onSave} />
      {remove ? (
        confirming ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>
              {remove.question}
              {remove.detail ? ` ${remove.detail}` : ''}
            </Text>
            <View style={styles.confirmButtons}>
              <Button label="Keep" variant="secondary" onPress={() => setConfirming(false)} style={styles.flex} />
              <Pressable
                accessibilityRole="button"
                disabled={remove.pending}
                onPress={remove.onConfirm}
                style={[styles.phoneDanger, styles.flex]}>
                <Text style={styles.phoneDangerLabel}>{remove.pending ? (remove.pendingLabel ?? 'Deleting…') : remove.label.split(' ')[0]}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.phoneDeleteLink}>
            <Text style={styles.dangerLinkLabel}>{remove.label}</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  phone: {
    gap: 20,
  },
  stack: {
    gap: 20,
  },
  flex: {
    flex: 1,
  },
  // Dialog
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: `rgba(${colors.shadow}, 0.5)`,
    cursor: 'auto',
  },
  dialog: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '100%',
    borderRadius: 16,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    boxShadow: `0 24px 64px rgba(${colors.shadow}, 0.35)`,
    overflow: 'hidden',
  },
  dialogWide: {
    maxWidth: 920,
  },
  // A screen that scrolls part of itself needs a height to fill
  dialogTall: {
    height: '100%',
    maxHeight: 820,
  },
  bodyFixed: {
    flex: 1,
    minHeight: 0,
    paddingVertical: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 20,
    color: colors.ink,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHover: {
    backgroundColor: colors.chip,
  },
  body: {
    flexShrink: 1,
  },
  message: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg + 1,
  },
  bodyContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
  },
  footerSpacer: {
    flex: 1,
  },
  footerQuestion: {
    flex: 1,
    gap: 2,
  },
  save: {
    minWidth: 120,
  },
  // Sections: label column beside the fields, a line between sections
  section: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    // The first section's line would double up with the header's
    marginTop: -1,
  },
  sectionLabel: {
    width: 180,
    gap: 4,
    paddingTop: 2,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  sectionDescription: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  sectionFields: {
    flex: 1,
    minWidth: 0,
    gap: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  rowItem: {
    flex: 1,
    minWidth: 0,
  },
  // Delete
  dangerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.input,
  },
  dangerLinkHover: {
    backgroundColor: colors.dangerSoft,
  },
  dangerLinkLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.dangerText,
  },
  dangerButton: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.input,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonHover: {
    opacity: 0.9,
  },
  dangerLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.onDanger,
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
  confirmDetail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  phoneDanger: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneDangerLabel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.onDanger,
  },
  phoneDeleteLink: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

/** Stack options for a form screen: a transparent dialog over the page on the website, a sheet in the app. */
export function formPresentation(dialog: boolean) {
  return dialog
    ? ({ presentation: 'transparentModal', contentStyle: { backgroundColor: 'transparent' } } as const)
    : ({ presentation: 'modal' } as const);
}
