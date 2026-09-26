import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing, touchTarget } from '@/theme/tokens';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  // "back" for pushed screens, "close" for forms opened on top
  icon?: 'back' | 'close';
  onBack?: () => void;
  right?: ReactNode;
};

export function ScreenHeader({ title, subtitle, icon = 'back', onBack, right }: ScreenHeaderProps) {
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={icon === 'close' ? 'Close' : 'Back'}
        onPress={goBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Feather name={icon === 'close' ? 'x' : 'chevron-left'} size={22} color={colors.ink} />
      </Pressable>
      <View style={styles.titles}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: 999,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  titles: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
});
