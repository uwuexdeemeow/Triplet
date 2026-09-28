import { z } from 'zod';

import type { PickedDestination } from '@/components/destination-field';
import { CURRENCIES } from '@/utils/currencies';

// Empty means "no budget"; otherwise a positive amount like "150000" or "1,200.50"
const optionalAmount = z
  .string()
  .trim()
  .refine((value) => value === '' || (Number.isFinite(Number(value.replace(/,/g, ''))) && Number(value.replace(/,/g, '')) >= 0), {
    message: 'Enter an amount, like 1500',
  });

export function parseAmount(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, '');
  return cleaned === '' ? null : Number(cleaned);
}

export const tripSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the trip a name').max(255),
    destinations: z.array(z.custom<PickedDestination>()).min(1, 'Where are you going?').max(10),
    startDate: z.string(),
    endDate: z.string(),
    budget: optionalAmount,
    currency: z.string().refine((code) => Object.hasOwn(CURRENCIES, code), { message: 'Pick a currency' }),
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: 'The trip can’t end before it starts',
    path: ['endDate'],
  });

export const activitySchema = z
  .object({
    title: z.string().trim().min(1, 'What are you doing?').max(255),
    location: z.string().trim().min(1, 'Where is it?').max(255),
    day: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    estimatedCost: optionalAmount,
  })
  .refine((values) => values.endTime >= values.startTime, {
    message: 'It can’t end before it starts',
    path: ['endTime'],
  });

export type TripValues = z.infer<typeof tripSchema>;
export type ActivityValues = z.infer<typeof activitySchema>;
