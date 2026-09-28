import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, LayoutAnimation, Platform, ScrollView, Text, View, type KeyboardEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type ScreenProps = {
  children: ReactNode;
  // Forms scroll so the keyboard never covers the focused field
  scroll?: boolean;
};

// How far the keyboard covers the screen, measured on the display when it opens. React Native's
// KeyboardAvoidingView works this out from the screen's position within its parent, which is wrong
// on a sheet (like Ask about this trip) that starts partway down: it left the text box covered.
function useKeyboardOverlap() {
  const screen = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const update = (event: KeyboardEvent, open: boolean) => {
      const apply = (value: number) => {
        // iOS: move in step with the keyboard
        if (Platform.OS === 'ios' && event.duration) {
          LayoutAnimation.configureNext({ duration: event.duration, update: { type: LayoutAnimation.Types.keyboard } });
        }
        setOverlap(value);
      };
      if (!open) return apply(0);
      // Measured now, not when the screen appeared, so a sheet still sliding in doesn't throw it off.
      // The screen itself never changes size (the padding is inside it), so this stays accurate.
      screen.current?.measureInWindow((_x, y, _width, height) =>
        apply(Math.max(0, Math.round(y + height - event.endCoordinates.screenY))),
      );
    };
    // Android draws edge to edge, so its window doesn't shrink for the keyboard either
    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', (event) => update(event, true)),
            Keyboard.addListener('keyboardWillHide', (event) => update(event, false)),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', (event) => update(event, true)),
            Keyboard.addListener('keyboardDidHide', (event) => update(event, false)),
          ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  return { screen, overlap };
}

export function Screen({ children, scroll = true }: ScreenProps) {
  const styles = useStyles();
  const { screen, overlap } = useKeyboardOverlap();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // iOS: leave room for floating bars, like the Liquid Glass tab bar
      contentInsetAdjustmentBehavior="automatic">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.fill]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View ref={screen} collapsable={false} style={styles.fill}>
        <View style={[styles.fill, { paddingBottom: overlap }]}>{content}</View>
      </View>
    </SafeAreaView>
  );
}

export function FormMessage({ message, tone = 'error' }: { message: string | null; tone?: 'error' | 'success' }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!message) return null;
  const isError = tone === 'error';

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.message, isError ? styles.messageError : styles.messageSuccess]}>
      <Text style={[styles.messageText, { color: isError ? colors.dangerText : colors.accentStrong }]}>{message}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    // Keeps forms readable when the web version runs on a wide screen
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  message: {
    borderRadius: radii.input,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  messageError: {
    backgroundColor: colors.dangerSoft,
  },
  messageSuccess: {
    backgroundColor: colors.accentSoft,
  },
  messageText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
}));
