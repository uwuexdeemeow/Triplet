import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';

import type { BudgetSummary } from '@/api/trips';
import type { ColorScheme } from '@/theme/tokens';

export const EXPENSE_CATEGORIES = ['food', 'accommodation', 'transport', 'activities', 'shopping', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// Fixed colour per category, so food is always the same blue whatever else was spent.
// The first six slots of a colour-blind-checked palette, with its own steps for dark mode.
// The category list always names them in text too, since some are light against white.
export const CATEGORY_META: Record<
  ExpenseCategory,
  { label: string; color: Record<ColorScheme, string>; icon: ComponentProps<typeof Feather>['name'] }
> = {
  food: { label: 'Food & drink', color: { light: '#2a78d6', dark: '#3987e5' }, icon: 'coffee' },
  accommodation: { label: 'Stay', color: { light: '#eb6834', dark: '#d95926' }, icon: 'home' },
  transport: { label: 'Transport', color: { light: '#1baf7a', dark: '#199e70' }, icon: 'navigation' },
  activities: { label: 'Activities', color: { light: '#eda100', dark: '#c98500' }, icon: 'camera' },
  shopping: { label: 'Shopping', color: { light: '#e87ba4', dark: '#d55181' }, icon: 'shopping-bag' },
  other: { label: 'Other', color: { light: '#008300', dark: '#008300' }, icon: 'tag' },
};

export function categoryMeta(category: string) {
  return CATEGORY_META[(EXPENSE_CATEGORIES as readonly string[]).includes(category) ? (category as ExpenseCategory) : 'other'];
}

export type Transfer = { fromId: number; fromName: string; toId: number; toName: string; amount: number };

/**
 * The fewest payments that settle everyone up. Each balance is paid minus fair share:
 * positive means they're owed money, negative means they owe it.
 */
export function settleUp(balances: BudgetSummary['balances']): Transfer[] {
  // Work in cents so rounding can't leave someone owing 0.0000001
  const owed = balances.filter((b) => b.balance > 0.005).map((b) => ({ ...b, cents: Math.round(b.balance * 100) }));
  const owing = balances.filter((b) => b.balance < -0.005).map((b) => ({ ...b, cents: Math.round(-b.balance * 100) }));
  owed.sort((a, b) => b.cents - a.cents);
  owing.sort((a, b) => b.cents - a.cents);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < owing.length && j < owed.length) {
    const cents = Math.min(owing[i].cents, owed[j].cents);
    if (cents > 0) {
      transfers.push({
        fromId: owing[i].user_id,
        fromName: owing[i].name,
        toId: owed[j].user_id,
        toName: owed[j].name,
        amount: cents / 100,
      });
    }
    owing[i].cents -= cents;
    owed[j].cents -= cents;
    if (owing[i].cents === 0) i++;
    if (owed[j].cents === 0) j++;
  }
  return transfers;
}
