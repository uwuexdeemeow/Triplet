import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, StyleSheet, View, type ColorValue, type ViewProps } from 'react-native';

import { useTheme } from '@/theme/theme';

export type GlassProps = ViewProps & {
  // Glass that reacts to touch, for buttons
  interactive?: boolean;
  // A coloured glass, e.g. the accent for a + button
  tintColor?: ColorValue;
};

/**
 * A see-through surface for things that float over content: map controls, bottom sheets,
 * the + buttons. Put the corner radius on `style` and don't give it a background colour.
 *
 * - iOS 26+: Apple's Liquid Glass
 * - Older iOS: the system's frosted blur
 * - Android: a lightly see-through surface (a real blur there costs too much performance)
 * The website uses glass.web.tsx.
 */
export function Glass({ interactive = false, tintColor, style, children, ...props }: GlassProps) {
  const { colors, scheme } = useTheme();

  // Checked each render: turning on Reduce Transparency switches Liquid Glass off
  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        colorScheme={scheme}
        tintColor={tintColor}
        style={style}
        {...props}>
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <BlurView
        tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        intensity={90}
        style={[styles.clip, tintColor ? { backgroundColor: tintColor } : null, style]}
        {...props}>
        {children}
      </BlurView>
    );
  }

  return (
    <View
      style={[
        styles.clip,
        {
          backgroundColor: tintColor ?? colors.glassFill,
          borderColor: colors.glassEdge,
          boxShadow: `0 6px 20px rgba(${colors.shadow}, 0.14)`,
        },
        styles.edge,
        style,
      ]}
      {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  edge: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
