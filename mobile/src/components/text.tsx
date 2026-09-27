import { Text, type TextProps } from 'react-native';

import { makeStyles } from '@/theme/theme';
import { fonts, headingTracking } from '@/theme/tokens';

export function Heading({ style, ...props }: TextProps) {
  const styles = useStyles();
  return <Text accessibilityRole="header" style={[styles.heading, style]} {...props} />;
}

export function Title({ style, ...props }: TextProps) {
  const styles = useStyles();
  return <Text accessibilityRole="header" style={[styles.title, style]} {...props} />;
}

export function Body({ style, ...props }: TextProps) {
  const styles = useStyles();
  return <Text style={[styles.body, style]} {...props} />;
}

export function Muted({ style, ...props }: TextProps) {
  const styles = useStyles();
  return <Text style={[styles.muted, style]} {...props} />;
}

const useStyles = makeStyles((colors) => ({
  heading: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 30,
    lineHeight: 36,
    color: colors.ink,
  },
  title: {
    fontFamily: fonts.displaySemi,
    letterSpacing: headingTracking,
    fontSize: 20,
    lineHeight: 26,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.ink,
  },
  muted: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
}));
