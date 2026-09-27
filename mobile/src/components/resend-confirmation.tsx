import { useState } from 'react';

import { ApiError } from '@/api/client';
import { resendConfirmation } from '@/auth/verification';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';

// A button that sends a fresh confirmation link, and says so once it has
export function ResendConfirmation({ email, label = 'Send a new link' }: { email: string; label?: string }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);

  const resend = async () => {
    setSending(true);
    setMessage(null);
    try {
      await resendConfirmation(email);
      setMessage({ text: `A new link is on its way to ${email}. Older links no longer work.`, tone: 'success' });
    } catch (error) {
      setMessage({
        text:
          error instanceof ApiError && error.status === 429
            ? 'That’s a lot of links. Wait a while, then try again.'
            : error instanceof Error
              ? error.message
              : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <FormMessage message={message?.text ?? null} tone={message?.tone} />
      <Button label={label} variant="secondary" loading={sending} onPress={resend} />
    </>
  );
}
