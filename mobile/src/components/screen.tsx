import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, ScrollView, Text, View, type KeyboardEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type ScreenProps = {
  children: ReactNode;
  // Forms scroll so the keyboard never covers the focused field
  scroll?: boolean;
};

// How far the keyboard covers the screen. React Native's KeyboardAvoidingView (and measureInWindow)
// place the screen using React Native's own layout, which doesn't know iOS moved a sheet (like Ask
// about this trip) partway down the display. So they came up short and the keyboard covered the box.
function useKeyboardOverlap() {
  const screen = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const apply = (event: KeyboardEvent, value: number) => {
      // iOS: move in step with the keyboard
      if (Platform.OS === 'ios' && event.duration) {
        LayoutAnimation.configureNext({ duration: event.duration, update: { type: LayoutAnimation.Types.keyboard } });
      }
      setOverlap(Math.max(0, Math.round(value)));
    };

    if (Platform.OS === 'ios') {
      // Every screen and sheet reaches the bottom of the display (the safe area only pads the top),
      // so the keyboard covers everything from its top edge down. No positions needed.
      const subscriptions = [
        Keyboard.addListener('keyboardWillChangeFrame', (event) =>
          apply(event, Dimensions.get('screen').height - event.endCoordinates.screenY),
        ),
        Keyboard.addListener('keyboardWillHide', (event) => apply(event, 0)),
      ];
      return () => subscriptions.forEach((subscription) => subscription.remove());
    }

    // Android: modals fill the display, so measuring works. It draws edge to edge, so the window
    // usually doesn't shrink for the keyboard; if it does, the measured overlap is simply 0.
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', (event) =>
        screen.current?.measureInWindow((_x, y, _width, height) =>
          apply(event, y + height - event.endCoordinates.screenY),
        ),
      ),
      Keyboard.addListener('keyboardDidHide', (event) => apply(event, 0)),
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
