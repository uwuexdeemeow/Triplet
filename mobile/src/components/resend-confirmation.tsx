import { useEffect, useState } from 'react';

import { ApiError } from '@/api/client';
import { resendConfirmation } from '@/auth/verification';
import { Button } from '@/components/button';
import { FormMessage } from '@/components/screen';

// Long enough that a code which is just slow to arrive isn't replaced by a second one
const WAIT_SECONDS = 30;

// A button that emails a fresh code for the waiting sign-up, then waits a little before it can again
export function ResendConfirmation({ email, label = 'Send a new code' }: { email: string; label?: string }) {
  const [sending, setSending] = useState(false);
  const [wait, setWait] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const resend = async () => {
    setSending(true);
    setMessage(null);
    try {
      await resendConfirmation();
      setMessage({ text: `A new code is on its way to ${email}. Older codes no longer work.`, tone: 'success' });
      setWait(WAIT_SECONDS);
    } catch (error) {
      setMessage({
        text:
          error instanceof ApiError && error.status === 429
            ? 'That’s a lot of codes. Wait a while, then try again.'
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
      <Button
        label={wait > 0 ? `${label} (${wait}s)` : label}
        variant="secondary"
        loading={sending}
        disabled={wait > 0}
        onPress={resend}
      />
    </>
  );
}
