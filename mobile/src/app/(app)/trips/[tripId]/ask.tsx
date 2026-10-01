import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { api, type Schemas } from '@/api/client';
import { FormMessage } from '@/components/screen';
import { FormScreen } from '@/components/form-layout';
import { Muted } from '@/components/text';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';

type AskResponse = Schemas['AskResponse'];
type Mention = Schemas['AskMention'];
type Turn = { question: string; answer?: AskResponse; error?: string };

const EXAMPLES = [
  'Which places we saved are near our hotel?',
  'Is anything closed when we planned to go?',
  'What’s the cheapest food we saved?',
  'What could we do on a rainy day?',
];

// Ask about the trip's saves and plans, e.g. "Which cafés are within 10 minutes of our hotel?"
export default function AskScreen() {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const scroll = useRef<ScrollView>(null);

  const ask = useMutation({
    mutationFn: (text: string) => api<AskResponse>(`/trips/${tripId}/ask`, { method: 'POST', body: { question: text } }),
    onMutate: (text) => {
      setTurns((current) => [...current, { question: text }]);
      setQuestion('');
    },
    onSuccess: (answer, text) =>
      setTurns((current) => current.map((turn) => (turn.question === text && !turn.answer ? { ...turn, answer } : turn))),
    onError: (error, text) =>
      setTurns((current) =>
        current.map((turn) => (turn.question === text && !turn.answer ? { ...turn, error: error.message } : turn)),
      ),
  });

  const send = (text = question) => {
    const value = text.trim();
    if (value.length < 2 || ask.isPending) return;
    ask.mutate(value);
  };

  const open = (mention: Mention) => {
    if (mention.kind === 'place') {
      router.push({ pathname: '/trips/[tripId]/places/[placeId]', params: { tripId, placeId: String(mention.id) } });
    } else {
      router.push({ pathname: '/trips/[tripId]/add-activity', params: { tripId, activityId: String(mention.id) } });
    }
  };

  return (
    <FormScreen title="Ask about this trip" scroll={false}>
      <View style={styles.container}>

        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.turns}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          // The keyboard opening shrinks the list: keep the latest answer in view above it
          onLayout={() => scroll.current?.scrollToEnd({ animated: false })}>
          {turns.length === 0 ? (
            <View style={styles.intro}>
              <Muted>
                Ask about the places you’ve saved and the plans you’ve made. Answers only use what’s in this trip, and
                travel times are rough estimates.
              </Muted>
              {EXAMPLES.map((example) => (
                <Pressable
                  key={example}
                  accessibilityRole="button"
                  onPress={() => send(example)}
                  style={({ pressed, hovered }) => [styles.example, (pressed || hovered) && styles.exampleActive]}>
                  <Feather name="message-circle" size={16} color={colors.accent} />
                  <Text style={styles.exampleText}>{example}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            turns.map((turn, index) => (
              <View key={`${index}-${turn.question}`} style={styles.turn}>
                <View style={styles.question}>
                  <Text style={styles.questionText}>{turn.question}</Text>
                </View>
                {turn.answer ? (
                  <View style={styles.answer} accessibilityLiveRegion="polite">
                    <Text selectable style={styles.answerText}>
                      {turn.answer.answer}
                    </Text>
                    {turn.answer.mentions.length > 0 ? (
                      <View style={styles.mentions}>
                        {turn.answer.mentions.map((mention) => (
                          <Pressable
                            key={`${mention.kind}-${mention.id}`}
                            accessibilityRole="link"
                            accessibilityHint={mention.kind === 'place' ? 'Opens the saved place' : 'Opens the plan'}
                            onPress={() => open(mention)}
                            style={({ pressed, hovered }) => [styles.mention, (pressed || hovered) && styles.exampleActive]}>
                            <Feather name={mention.kind === 'place' ? 'map-pin' : 'calendar'} size={13} color={colors.accent} />
                            <Text style={styles.mentionText}>{mention.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : turn.error ? (
                  <FormMessage message={turn.error} />
                ) : (
                  <View style={styles.thinking}>
                    <ActivityIndicator color={colors.accent} />
                    <Muted>Looking through your saves…</Muted>
                  </View>
                )}
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Your question"
            placeholder="Ask about your saved places and plans"
            placeholderTextColor={colors.muted}
            keyboardAppearance={scheme}
            value={question}
            onChangeText={setQuestion}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            maxLength={500}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask"
            accessibilityState={{ disabled: question.trim().length < 2 || ask.isPending }}
            disabled={question.trim().length < 2 || ask.isPending}
            onPress={() => send()}
            style={[styles.send, (question.trim().length < 2 || ask.isPending) && styles.sendDisabled]}>
            <Feather name="arrow-up" size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      </View>
    </FormScreen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  turns: {
    gap: spacing.lg,
    paddingBottom: spacing.md,
  },
  intro: {
    gap: spacing.sm,
  },
  example: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  exampleActive: {
    backgroundColor: colors.accentSoft,
  },
  exampleText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14.5,
    color: colors.ink,
  },
  turn: {
    gap: spacing.sm,
  },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    backgroundColor: colors.accent,
  },
  questionText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.onAccent,
  },
  answer: {
    gap: spacing.md,
    padding: 14,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
  },
  answerText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  mentions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  mention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  mentionText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.ink,
  },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
}));
