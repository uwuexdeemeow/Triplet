import { z } from 'zod';

// Mirrors the backend's rules so users see problems before submitting

const email = z.string().trim().min(1, 'Enter your email').email('Enter a valid email');

// The backend's strength check (zxcvbn) can still reject a long but guessable password
const newPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(64, 'Use at most 64 characters');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});

export const signupSchema = z.object({
  // Python's str.isalnum(): letters and numbers in any language, no spaces
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name')
    .regex(/^[\p{L}\p{N}]+$/u, 'Use letters and numbers only, no spaces'),
  email,
  password: newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: "Passwords don't match",
    path: ['confirm'],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
