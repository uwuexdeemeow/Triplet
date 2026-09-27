import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type ScreenProps = {
  children: ReactNode;
  // Forms scroll so the keyboard never covers the focused field
  scroll?: boolean;
};

export function Screen({ children, scroll = true }: ScreenProps) {
  const styles = useStyles();
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.fill]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {content}
      </KeyboardAvoidingView>
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
