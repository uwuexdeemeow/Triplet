import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Small, consistent taps for touch feedback. They do nothing on the web, and never throw:
// a missing haptic engine shouldn't break a button.

function run(effect: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  effect().catch(() => {});
}

// A light tap for buttons
export function tap() {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

// A tick when picking an option, like a chip or a day
export function select() {
  run(() => Haptics.selectionAsync());
}

// A firmer tap before something destructive, like revealing Delete
export function warn() {
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

// Something finished: saved, added, deleted
export function success() {
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
