import { Text, View } from 'react-native';

import { checkPassword } from '@/auth/password-strength';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts } from '@/theme/tokens';

type PasswordMeterProps = {
  password: string;
  // Passwords built from these are easy to guess, so they count against the score
  name?: string;
  email?: string;
};

/** Four bars that fill as the password gets harder to guess, with a tip while it's too weak. */
export function PasswordMeter({ password, name, email }: PasswordMeterProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!password) return null;

  const tooShort = password.length < 8;
  const strength = checkPassword(password, name, email);
  // Bars filled: at least one once typing starts, all four at "Very strong"
  const filled = tooShort ? 1 : Math.max(1, strength.score);
  const color = !tooShort && strength.strongEnough ? colors.accent : colors.danger;

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={`Password strength: ${tooShort ? 'too short' : strength.label}`}
      accessibilityLiveRegion="polite">
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((bar) => (
          <View key={bar} style={[styles.bar, bar <= filled && { backgroundColor: color }]} />
        ))}
      </View>
      <Text style={[styles.label, { color: !tooShort && strength.strongEnough ? colors.accentStrong : colors.dangerText }]}>
        {tooShort ? `Too short · ${8 - password.length} more ${8 - password.length === 1 ? 'character' : 'characters'}` : strength.label}
      </Text>
      {!tooShort && strength.tip ? <Text style={styles.tip}>{strength.tip}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 6,
  },
  bars: {
    flexDirection: 'row',
    gap: 4,
  },
  bar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  tip: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
}));
