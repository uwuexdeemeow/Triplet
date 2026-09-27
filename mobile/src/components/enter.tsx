import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

type EnterProps = {
  // Position in the list, so items arrive one after another
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * Slides a list item gently into place when it first appears. Only the first few are
 * staggered, so long lists don't keep you waiting, and it's skipped when the phone's
 * Reduce Motion setting is on.
 */
export function Enter({ index = 0, style, children }: EnterProps) {
  return (
    <Animated.View entering={FadeInDown.duration(260).delay(Math.min(index, 6) * 45)} style={style}>
      {children}
    </Animated.View>
  );
}
