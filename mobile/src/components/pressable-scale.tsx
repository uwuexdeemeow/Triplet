import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Quick in, soft settle back: feels like pressing something physical
const PRESS = { damping: 20, stiffness: 400, mass: 0.6 };

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  // How far it shrinks while held, e.g. 0.97 for buttons, 0.98 for big cards
  scaleTo?: number;
  // Runs on press, e.g. a haptic from utils/haptics
  feedback?: () => void;
};

/** A Pressable that shrinks slightly while held and springs back when let go. */
export function PressableScale({
  style,
  scaleTo = 0.97,
  feedback,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...props
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        scale.set(withSpring(scaleTo, PRESS));
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        scale.set(withSpring(1, PRESS));
        onPressOut?.(event);
      }}
      onPress={(event: GestureResponderEvent) => {
        feedback?.();
        onPress?.(event);
      }}
      style={[style, animated]}
      {...props}
    />
  );
}
