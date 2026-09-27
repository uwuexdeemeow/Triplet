import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Body } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

// Someone without an account opens a trip with the code and PIN its owner shared
export default function GuestScreen() {
  const styles = useStyles();
  const { enterAsGuest } = useSession();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ code?: string; pin?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const pinRef = useRef<TextInput>(null);

  const submit = async () => {
    const next: typeof errors = {};
    if (!code.trim()) next.code = 'Enter the trip code';
    if (!/^\d{4,12}$/.test(pin)) next.pin = 'The PIN is 4 to 12 digits';
    setErrors(next);
    if (next.code || next.pin) return;

    setSubmitting(true);
    try {
      await enterAsGuest(code.trim().toUpperCase(), pin);
      // The root layout switches to the guest view once in
    } catch (error) {
      setErrors({
        form:
          error instanceof ApiError && error.status === 401
            ? error.message === 'Guest access has expired'
              ? 'This trip code has expired. Ask the trip owner for a new one.'
              : 'That code and PIN don’t match.'
            : error instanceof Error
              ? error.message
              : 'Something went wrong.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title="View a trip" />
        <Body style={styles.intro}>
          Enter the code and PIN the trip’s owner sent you to see their plan. You don’t need an account.
        </Body>
        <FormMessage message={errors.form ?? null} />
        <TextField
          label="Trip code"
          placeholder="e.g. K7Q2M9XA"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
          maxLength={16}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={() => pinRef.current?.focus()}
          error={errors.code}
        />
        <TextField
          ref={pinRef}
          label="PIN"
          secureTextEntry
          keyboardType="number-pad"
          returnKeyType="go"
          maxLength={12}
          value={pin}
          onChangeText={setPin}
          onSubmitEditing={submit}
          error={errors.pin}
        />
        <Button label="View trip" loading={submitting} onPress={submit} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 18,
  },
  intro: {
    color: colors.muted,
    marginBottom: spacing.sm,
  },
}));
