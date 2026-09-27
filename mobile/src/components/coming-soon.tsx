import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { Body, Title } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

type ComingSoonProps = {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  description: string;
};

// Placeholder for trip sections that come in later build steps
export function ComingSoon({ icon, title, description }: ComingSoonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Feather name={icon} size={32} color={colors.muted} />
      <Title>{title}</Title>
      <Body style={styles.description}>{description}</Body>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    paddingHorizontal: 20,
    paddingTop: spacing.xxl,
    gap: spacing.sm,
    alignItems: 'center',
  },
  description: {
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 320,
  },
}));
