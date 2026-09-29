import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { api } from '@/api/client';
import { Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Body, Heading } from '@/components/text';
import { makeStyles } from '@/theme/theme';
import { fonts, spacing } from '@/theme/tokens';

export type LegalSection = {
  heading: string;
  // Each string is a paragraph; a list is shown as bullet points
  body: (string | string[])[];
};

// The address for questions, set on the server (CONTACT_EMAIL), so it can change without a new build
export function useContactEmail(): string | null {
  const info = useQuery({
    queryKey: ['site-info'],
    queryFn: () => api<{ contact_email: string | null }>('/site-info', { auth: false }),
    staleTime: Infinity,
    retry: false,
  });
  return info.data?.contact_email ?? null;
}

/** The privacy policy and terms: plain pages anyone can open, signed in or not. */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  const styles = useStyles();

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title={title} />
        <Text style={styles.updated}>Last updated {updated}</Text>
        <Body>{intro}</Body>

        {sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Heading style={styles.heading} accessibilityRole="header">
              {section.heading}
            </Heading>
            {section.body.map((part, index) =>
              typeof part === 'string' ? (
                <Body key={index}>{part}</Body>
              ) : (
                <View key={index} style={styles.list}>
                  {part.map((item) => (
                    <View key={item} style={styles.item}>
                      <Text style={styles.bullet}>•</Text>
                      <Body style={styles.itemText}>{item}</Body>
                    </View>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}

        <View style={styles.links}>
          <Link href="/privacy" style={styles.link}>
            Privacy policy
          </Link>
          <Link href="/terms" style={styles.link}>
            Terms
          </Link>
        </View>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  updated: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  section: {
    gap: spacing.sm,
  },
  heading: {
    fontSize: 20,
    lineHeight: 26,
  },
  list: {
    gap: 6,
  },
  item: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bullet: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
  },
  itemText: {
    flex: 1,
  },
  links: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  link: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
}));
