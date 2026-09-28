// Types for what the website (react-native-web) adds on top of React Native

import 'react-native';

declare module 'react-native' {
  // A mouse over a Pressable on the web; always false on phones
  interface PressableStateCallbackType {
    readonly hovered?: boolean;
    readonly focused?: boolean;
  }
}
