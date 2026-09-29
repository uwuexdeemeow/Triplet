import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';

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

