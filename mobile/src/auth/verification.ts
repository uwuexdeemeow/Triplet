import { api } from '@/api/client';

// The backend answers the same whether or not the email has an account waiting to be confirmed
export async function resendConfirmation(email: string): Promise<void> {
  await api('/auth/verify-email/resend', { method: 'POST', body: { email }, auth: false });
}
