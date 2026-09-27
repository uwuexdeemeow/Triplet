import { useEffect, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { TimeField } from '@/components/date-time-field';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';
import { select } from '@/utils/haptics';

// The day the slider covers, in minutes. Early starts widen it to midnight.
const DAY_START = 6 * 60;
const DAY_END = 23 * 60 + 45;
const STEP = 15;
const THUMB = 28;

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// "1 h 30 min", "45 min", "2 h"
function formatLength(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

type TimeRangeFieldProps = {
  label?: string;
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  error?: string;
};

/**
 * From and to on one track: drag the left handle to move the whole plan (it keeps its length),
 * the right handle to change how long it is. Snaps to 15 minutes, and exact times can still be typed.
 */
export function TimeRangeField({ label = 'When', start, end, onChange, error }: TimeRangeFieldProps) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [exact, setExact] = useState(false);
  // Shown while dragging, before the form hears about it
  const [live, setLive] = useState<{ start: number; end: number } | null>(null);

  const startMinutes = toMinutes(start);
  const endMinutes = Math.max(toMinutes(end), startMinutes);
  const low = Math.min(DAY_START, Math.floor(startMinutes / 60) * 60);
  const high = Math.max(DAY_END, Math.min(24 * 60 - STEP, Math.ceil(endMinutes / STEP) * STEP));
  const span = high - low;

  const from = useSharedValue(startMinutes);
  const to = useSharedValue(endMinutes);
  const origin = useSharedValue(0);
  const length = useSharedValue(0);

  // Follow changes from outside, like typing an exact time
  useEffect(() => {
    from.set(startMinutes);
    to.set(endMinutes);
  }, [from, to, startMinutes, endMinutes]);

  const commit = (a: number, b: number) => {
    setLive(null);
    onChange(toTime(a), toTime(b));
  };
  const step = (a: number, b: number) => {
    select();
    setLive({ start: a, end: b });
  };

  const snap = (minutes: number) => {
    'worklet';
    return Math.round(minutes / STEP) * STEP;
  };

  // Left handle: moves the whole plan
  const moveStart = Gesture.Pan()
    .hitSlop(12)
    .onBegin(() => {
      origin.set(from.get());
      length.set(to.get() - from.get());
    })
    .onUpdate((event) => {
      const next = Math.min(Math.max(snap(origin.get() + (event.translationX / width) * span), low), high - length.get());
      if (next !== from.get()) {
        from.set(next);
        to.set(next + length.get());
        runOnJS(step)(next, next + length.get());
      }
    })
    .onFinalize(() => {
      runOnJS(commit)(from.get(), to.get());
    });

  // Right handle: changes how long it lasts
  const moveEnd = Gesture.Pan()
    .hitSlop(12)
    .onBegin(() => {
      origin.set(to.get());
    })
    .onUpdate((event) => {
      const next = Math.min(Math.max(snap(origin.get() + (event.translationX / width) * span), from.get() + STEP), high);
      if (next !== to.get()) {
        to.set(next);
        runOnJS(step)(from.get(), next);
      }
    })
    .onFinalize(() => {
      runOnJS(commit)(from.get(), to.get());
    });

  const x = (minutes: number) => {
    'worklet';
    return ((minutes - low) / span) * width;
  };
  const startThumb = useAnimatedStyle(() => ({ transform: [{ translateX: x(from.get()) - THUMB / 2 }] }));
  const endThumb = useAnimatedStyle(() => ({ transform: [{ translateX: x(to.get()) - THUMB / 2 }] }));
  const fill = useAnimatedStyle(() => ({ left: x(from.get()), width: x(to.get()) - x(from.get()) }));

  const shown = live ?? { start: startMinutes, end: endMinutes };
  const hours = [];
  for (let hour = Math.ceil(low / 60 / 3) * 3; hour * 60 <= high; hour += 3) hours.push(hour);

  // Screen readers and keyboards move a handle 15 minutes at a time
  const nudge = (which: 'start' | 'end', direction: 1 | -1) => {
    if (which === 'start') {
      const length = endMinutes - startMinutes;
      const next = Math.min(Math.max(startMinutes + direction * STEP, low), high - length);
      onChange(toTime(next), toTime(next + length));
    } else {
      const next = Math.min(Math.max(endMinutes + direction * STEP, startMinutes + STEP), high);
      onChange(start, toTime(next));
    }
  };

  return (
    <View style={styles.field}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Pressable accessibilityRole="button" onPress={() => setExact(!exact)} style={styles.exactButton}>
          <Text style={styles.exactLabel}>{exact ? 'Hide exact times' : 'Exact times'}</Text>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <Text style={styles.times}>
          {toTime(shown.start)} – {toTime(shown.end)}
        </Text>
        <Text style={styles.length}>{formatLength(shown.end - shown.start)}</Text>
      </View>

      <View style={styles.trackArea} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.track} />
        {width > 0 ? (
          <>
            <Animated.View style={[styles.fill, fill]} />
            <GestureDetector gesture={moveStart}>
              <Animated.View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Start time"
                accessibilityValue={{ text: toTime(startMinutes) }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(event) => nudge('start', event.nativeEvent.actionName === 'increment' ? 1 : -1)}
                style={[styles.thumb, startThumb]}
              />
            </GestureDetector>
            <GestureDetector gesture={moveEnd}>
              <Animated.View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="End time"
                accessibilityValue={{ text: toTime(endMinutes) }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(event) => nudge('end', event.nativeEvent.actionName === 'increment' ? 1 : -1)}
                style={[styles.thumb, styles.thumbEnd, endThumb]}
              />
            </GestureDetector>
          </>
        ) : null}
      </View>

      {width > 0 ? (
        <View style={styles.ticks} pointerEvents="none">
          {hours.map((hour) => (
            <Text key={hour} style={[styles.tick, { left: ((hour * 60 - low) / span) * width - 16 }]}>
              {String(hour % 24).padStart(2, '0')}:00
            </Text>
          ))}
        </View>
      ) : null}

      {exact ? (
        <View style={styles.exact}>
          <TimeField
            label="From"
            value={start}
            onChange={(value) => {
              // Keep the same length when the start moves
              const minutes = toMinutes(value);
              const kept = Math.min(minutes + (endMinutes - startMinutes || 60), 24 * 60 - 1);
              onChange(value, toTime(kept));
            }}
          />
          <TimeField label="To" value={end} onChange={(value) => onChange(start, value)} />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  field: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  exactButton: {
    minHeight: 32,
    justifyContent: 'center',
  },
  exactLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    color: colors.accent,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  times: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  length: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
  },
  trackArea: {
    height: 40,
    justifyContent: 'center',
    // Room for the handles at each end
    marginHorizontal: THUMB / 2,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.chip,
  },
  fill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
    boxShadow: `0 2px 6px rgba(${colors.shadow}, 0.2)`,
  },
  thumbEnd: {
    backgroundColor: colors.accent,
  },
  ticks: {
    height: 16,
    marginHorizontal: THUMB / 2,
    marginTop: -6,
  },
  tick: {
    position: 'absolute',
    width: 32,
    textAlign: 'center',
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  exact: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  error: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.dangerText,
  },
}));
