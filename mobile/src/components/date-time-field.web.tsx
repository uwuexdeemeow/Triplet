import { Feather } from '@expo/vector-icons';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { makeStyles, shadow, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { addDays, parseDate, toDateString, todayString } from '@/utils/dates';

// The browser's own date and time inputs look different in every browser and clash with the
// app, so the website draws its own: a month calendar, and a time you can type or pick.

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  minimumDate?: string;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Opens a floating panel under the field, closing on a click outside or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const container = useRef<View>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const element = container.current as unknown as HTMLElement | null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The panel lives outside the field (see FloatingPanel), so check both
      if (element && !element.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, setOpen, container, panel };
}

/**
 * The dropdown, drawn on top of the whole page. On the web every React Native view is its own
 * layer, so a dropdown inside the form would sit under whatever comes after the field. This
 * one is attached to the page and placed under the field, or above it when there's no room.
 */
function FloatingPanel({
  anchor,
  panel,
  children,
}: {
  anchor: React.RefObject<View | null>;
  panel: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const field = anchor.current as unknown as HTMLElement | null;
    const element = panel.current;
    if (!field || !element) return;

    const GAP = 4;
    const EDGE = 8;
    const place = () => {
      const box = field.getBoundingClientRect();
      const height = element.offsetHeight;
      const width = Math.max(element.offsetWidth, box.width);
      const roomBelow = window.innerHeight - box.bottom - GAP;
      const above = roomBelow < height && box.top - GAP >= height;
      element.style.setProperty('min-width', `${box.width}px`);
      element.style.setProperty('top', `${above ? box.top - GAP - height : box.bottom + GAP}px`);
      element.style.setProperty('left', `${Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE))}px`);
      element.style.setProperty('visibility', 'visible');
    };

    place();
    // Follow the field when the page or a scrolling form moves
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, panel]);

  return createPortal(
    // Hidden until placed, so it never flashes in the wrong spot
    <div ref={panel} style={{ position: 'fixed', top: 0, left: 0, zIndex: 1000, visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

function Field({
  label,
  labelId,
  error,
  open,
  container,
  panelRef,
  children,
  panel,
}: {
  label: string;
  labelId: string;
  error?: string;
  open: boolean;
  container: React.RefObject<View | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
  panel: ReactNode;
}) {
  const styles = useStyles();
  const input = useRef<View>(null);

  return (
    <View ref={container} style={styles.field}>
      <Text nativeID={labelId} style={styles.label}>
        {label}
      </Text>
      <View ref={input}>{children}</View>
      {open ? (
        <FloatingPanel anchor={input} panel={panelRef}>
          <View style={styles.panel}>{panel}</View>
        </FloatingPanel>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

// ---------- Date ----------

// "Fri 2 Oct 2026"
function formatFieldDate(value: string): string {
  const date = parseDate(value);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${weekday} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
}

// The days to show for a month: Monday-first weeks, with blanks before the 1st
function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const blanks = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: days }, (_, index) => toDateString(new Date(year, month, index + 1))),
  ];
}

export function DateField({ label, value, onChange, error, minimumDate }: FieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const labelId = useId();
  const { open, setOpen, container, panel: panelRef } = usePopover();
  const selected = value ? parseDate(value) : new Date();
  const [shown, setShown] = useState({ year: selected.getFullYear(), month: selected.getMonth() });
  const today = todayString();

  const openCalendar = () => {
    // Always open on the chosen month
    setShown({ year: selected.getFullYear(), month: selected.getMonth() });
    setOpen(!open);
  };

  const moveMonth = (step: number) =>
    setShown(({ year, month }) => {
      const next = new Date(year, month + step, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const grid = monthGrid(shown.year, shown.month);
  // No going back past the month of the earliest allowed day
  const canGoBack = !minimumDate || addDays(toDateString(new Date(shown.year, shown.month, 1)), -1) >= minimumDate;

  return (
    <Field
      label={label}
      labelId={labelId}
      error={error}
      open={open}
      container={container}
      panelRef={panelRef}
      panel={
        <View style={styles.calendar}>
          <View style={styles.calendarHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              disabled={!canGoBack}
              onPress={() => moveMonth(-1)}
              style={({ hovered }) => [styles.navButton, hovered && styles.hover, !canGoBack && styles.disabled]}>
              <Feather name="chevron-left" size={18} color={colors.ink} />
            </Pressable>
            <Text style={styles.monthTitle} accessibilityRole="header">
              {MONTHS[shown.month]} {shown.year}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={() => moveMonth(1)}
              style={({ hovered }) => [styles.navButton, hovered && styles.hover]}>
              <Feather name="chevron-right" size={18} color={colors.ink} />
            </Pressable>
          </View>

          <View style={styles.week}>
            {WEEKDAY_HEADERS.map((day) => (
              <Text key={day} style={styles.weekday}>
                {day}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {grid.map((day, index) => {
              if (!day) return <View key={`blank-${index}`} style={styles.cell} />;
              const isSelected = day === value;
              const isToday = day === today;
              const blocked = !!minimumDate && day < minimumDate;
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={formatFieldDate(day)}
                  accessibilityState={{ selected: isSelected, disabled: blocked }}
                  disabled={blocked}
                  onPress={() => {
                    onChange(day);
                    setOpen(false);
                  }}
                  style={({ hovered }) => [
                    styles.cell,
                    styles.day,
                    hovered && !isSelected && styles.hover,
                    isToday && !isSelected && styles.today,
                    isSelected && styles.daySelected,
                    blocked && styles.disabled,
                  ]}>
                  <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{parseDate(day).getDate()}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      }>
      <Pressable
        accessibilityRole="button"
        aria-labelledby={labelId}
        accessibilityState={{ expanded: open }}
        onPress={openCalendar}
        style={({ hovered }) => [styles.input, hovered && styles.inputHover, open && styles.inputOpen, error ? styles.inputError : null]}>
        <Feather name="calendar" size={18} color={colors.muted} />
        <Text style={styles.value}>{value ? formatFieldDate(value) : 'Choose a date'}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
    </Field>
  );
}

// ---------- Time ----------

// Every 15 minutes, "00:00" to "23:45"
const SLOTS = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
const SLOT_HEIGHT = 40;

/** "9", "930", "9:30", "9.30", "9pm", "9:30 pm" -> "HH:MM", or null if it isn't a time. */
export function parseTime(text: string): string | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const period = match[3]?.[0];
  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === 'p' && hours !== 12) hours += 12;
    if (period === 'a' && hours === 12) hours = 0;
  }
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function TimeField({ label, value, onChange, error }: Omit<FieldProps, 'minimumDate'>) {
  const styles = useStyles();
  const { colors } = useTheme();
  const labelId = useId();
  const { open, setOpen, container, panel: panelRef } = usePopover();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const list = useRef<ScrollView>(null);

  // Scroll the list so the current time sits near the top
  useEffect(() => {
    if (!open) return;
    const nearest = SLOTS.findIndex((slot) => slot >= value);
    const index = nearest === -1 ? SLOTS.length - 1 : nearest;
    requestAnimationFrame(() => list.current?.scrollTo({ y: Math.max(0, (index - 2) * SLOT_HEIGHT), animated: false }));
  }, [open, value]);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseTime(draft);
    if (parsed) {
      onChange(parsed);
      setInvalid(false);
    } else {
      setInvalid(draft.trim() !== '');
    }
    setDraft(null);
  };

  const shownError = invalid ? 'Enter a time like 9:30 or 21:00' : error;

  return (
    <Field
      label={label}
      labelId={labelId}
      error={shownError}
      open={open}
      container={container}
      panelRef={panelRef}
      panel={
        <ScrollView ref={list} style={styles.slots} keyboardShouldPersistTaps="handled">
          {SLOTS.map((slot) => {
            const selected = slot === value;
            return (
              <Pressable
                key={slot}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onChange(slot);
                  setDraft(null);
                  setInvalid(false);
                  setOpen(false);
                }}
                style={({ hovered }) => [styles.slot, hovered && !selected && styles.hover, selected && styles.slotSelected]}>
                <Text style={[styles.slotText, selected && styles.dayTextSelected]}>{slot}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      }>
      <View style={[styles.input, open && styles.inputOpen, shownError ? styles.inputError : null]}>
        <Feather name="clock" size={18} color={colors.muted} />
        <TextInput
          aria-labelledby={labelId}
          accessibilityLabel={label}
          value={draft ?? value}
          onChangeText={(text) => {
            setDraft(text);
            setInvalid(false);
          }}
          onFocus={() => setOpen(true)}
          onBlur={commit}
          onSubmitEditing={() => {
            commit();
            setOpen(false);
          }}
          placeholder="12:00"
          placeholderTextColor={colors.muted}
          style={[styles.value, styles.timeInput]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide times' : 'Show times'}
          onPress={() => setOpen(!open)}
          style={styles.chevron}>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
        </Pressable>
      </View>
    </Field>
  );
}

const useStyles = makeStyles((colors) => ({
  field: {
    flex: 1,
    gap: 6,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
  },
  inputHover: {
    borderColor: colors.muted,
  },
  inputOpen: {
    borderColor: colors.accent,
  },
  inputError: {
    borderColor: colors.danger,
  },
  value: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  timeInput: {
    minWidth: 0,
    height: 48,
    // The whole field shows focus with its teal border instead
    outlineWidth: 0,
  },
  chevron: {
    height: 40,
    justifyContent: 'center',
  },
  panel: {
    padding: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    boxShadow: `0 10px 30px ${shadow(colors, 0.16)}`,
  },
  calendar: {
    width: 296,
    gap: spacing.xs,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
  },
  monthTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: {
    flexDirection: 'row',
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.muted,
    paddingVertical: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 2,
  },
  day: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  today: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  daySelected: {
    backgroundColor: colors.accent,
  },
  dayText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  dayTextSelected: {
    fontFamily: fonts.bold,
    color: colors.onAccent,
  },
  hover: {
    backgroundColor: colors.chip,
  },
  disabled: {
    opacity: 0.3,
  },
  slots: {
    maxHeight: SLOT_HEIGHT * 6,
  },
  slot: {
    height: SLOT_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  slotSelected: {
    backgroundColor: colors.accent,
  },
  slotText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.dangerText,
  },
}));
