import { api } from '@/api/client';

// The sign-up waiting for its emailed code. The code only works with the token the sign-up
// answered with, so someone else signing up with the same email can't finish this one (or
// this one theirs). Kept in memory: after a restart, signing up again sends a new code.
let pending: { email: string; token: string } | null = null;

export function rememberSignup(email: string, token: string) {
  pending = { email, token };
}

export function pendingSignup() {
  return pending;
}

export function forgetSignup() {
  pending = null;
}

// The backend answers the same whether or not a sign-up is still waiting on the token
export async function resendConfirmation(): Promise<void> {
  if (!pending) throw new Error('Sign up again to get a new code.');
  await api('/auth/verify-email/resend', { method: 'POST', body: { signup_token: pending.token }, auth: false });
}
