import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { Body } from '@/components/text';
import { TextField } from '@/components/text-field';
import { makeStyles } from '@/theme/theme';
import { spacing } from '@/theme/tokens';

// Someone without an account starts here with the trip code its owner sent, then enters the PIN on
// the next page. A link the owner sent skips this step: /shared/<code>. Public, signed in or not.
export default function SharedCodeScreen() {
  const styles = useStyles();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const value = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(value)) {
      setError('Enter the trip code, using letters and numbers');
      return;
    }
    setError(undefined);
    router.push({ pathname: '/shared/[code]', params: { code: value } });
  };

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title="View a trip" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Body style={styles.intro}>
          Enter the trip code its owner sent you. You’ll need the PIN too, but you don’t need an account.
        </Body>
        <TextField
          label="Trip code"
          placeholder="e.g. K7Q2M9XA"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          maxLength={16}
          value={code}
          onChangeText={setCode}
          onSubmitEditing={submit}
          error={error}
        />
        <Button label="Continue" onPress={submit} />
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
