import { StyleSheet, View, type ViewStyle } from 'react-native';

import type { GlassProps } from '@/components/glass';
import { useTheme } from '@/theme/theme';

// Browsers get frosted glass from CSS: blur what's behind, then a translucent fill and a fine edge
export function Glass({ interactive: _interactive, tintColor, style, children, ...props }: GlassProps) {
  const { colors } = useTheme();

  const glass = {
    backgroundColor: tintColor ?? colors.glassFill,
    borderColor: colors.glassEdge,
    boxShadow: `0 8px 24px rgba(${colors.shadow}, 0.14), inset 0 1px 0 ${colors.glassEdge}`,
    backdropFilter: 'blur(18px) saturate(170%)',
  } as ViewStyle;

  return (
    <View style={[styles.base, glass, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
