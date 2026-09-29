import { Link } from 'expo-router';
import { Text } from 'react-native';

import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

// "Privacy · Terms" at the foot of the signed-out pages, so they're a click away before signing up
export function LegalLinks({ agreeing = false }: { agreeing?: boolean }) {
  const styles = useStyles();

  return (
    <Text style={styles.text}>
      {agreeing ? 'By creating an account you agree to the ' : null}
      <Link href="/terms" style={styles.link}>
        Terms
      </Link>
      {agreeing ? ' and ' : ' · '}
      <Link href="/privacy" style={styles.link}>
        {agreeing ? 'Privacy policy' : 'Privacy'}
      </Link>
      {agreeing ? '.' : null}
    </Text>
  );
}

const useStyles = makeStyles((colors) => ({
  text: {
    marginTop: spacing.lg,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  link: {
    fontFamily: fonts.semibold,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
}));
