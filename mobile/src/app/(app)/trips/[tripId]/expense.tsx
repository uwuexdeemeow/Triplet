import { Feather } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useState } from 'react';
import { z } from 'zod';

import { api, ApiError } from '@/api/client';
import {
  tripKeys,
  useExpenses,
  useItinerary,
  useMe,
  useMembers,
  useTrip,
  type Expense,
  type Trip,
} from '@/api/trips';
import { FieldRow, FormActions, FormScreen, FormSection } from '@/components/form-layout';
import { FormMessage } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, radii, spacing } from '@/theme/tokens';
import { CATEGORY_META, EXPENSE_CATEGORIES } from '@/utils/budget';
import { activityClock, dayOfMonth, eachDay, todayString, weekdayShort } from '@/utils/dates';
import { formatMoney } from '@/utils/money';

const schema = z.object({
  title: z.string().trim().min(1, 'What was it for?').max(255),
  amount: z
    .string()
    .trim()
    .min(1, 'Enter how much it cost')
    .refine((value) => {
      const number = Number(value.replace(/,/g, ''));
      return Number.isFinite(number) && number > 0;
    }, 'Enter an amount above 0, like 1500'),
  category: z.enum(EXPENSE_CATEGORIES),
  day: z.string().nullable(),
  paidBy: z.number().nullable(),
  activityId: z.number().nullable(),
});

type Values = z.infer<typeof schema>;

// "people" covers custom amounts too: anyone given an amount pays that, and the others split
// what's left evenly
type Split = 'all' | 'people';

const SPLITS: { value: Split; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'people', label: 'Some people' },
];

function parseMoney(value: string): number {
  const number = Number(value.trim().replace(/,/g, ''));
  return Number.isFinite(number) ? number : NaN;
}

// Whole cents, so adding up amounts like 0.1 + 0.2 comes out exact
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

// Adds an expense, or edits one when opened with an expenseId
export default function ExpenseScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { tripId, expenseId } = useLocalSearchParams<{ tripId: string; expenseId?: string }>();
  const id = Number(tripId);
  const trip = useTrip(id);
  const expenses = useExpenses(id);
  const expense = expenseId ? expenses.data?.find((item) => item.id === Number(expenseId)) : undefined;

  const loading = !trip.data || (expenseId && expenses.isPending);
  const missing = expenseId && !expenses.isPending && !expense;

  const title = expenseId ? 'Edit expense' : 'Add expense';
  if (missing) return <FormScreen title={title} message="This expense couldn’t be found. It may have been deleted." />;
  if (loading || !trip.data) {
    return (
      <FormScreen title={title}>
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      </FormScreen>
    );
  }
  // Mounted once the data is here, so the fields start with the right values
  return <ExpenseForm trip={trip.data} expense={expense} title={title} />;
}

function ExpenseForm({ trip, expense, title }: { trip: Trip; expense: Expense | undefined; title: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const me = useMe();
  const members = useMembers(trip.id);
  const itinerary = useItinerary(trip.id);

  const days = trip.start_date && trip.end_date ? eachDay(trip.start_date, trip.end_date) : [];
  const today = todayString();

  const { control, handleSubmit, setValue, getValues } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: expense
      ? {
          title: expense.title,
          amount: String(expense.amount),
          category: (EXPENSE_CATEGORIES as readonly string[]).includes(expense.category)
            ? (expense.category as Values['category'])
            : 'other',
          day: expense.spent_on ?? null,
          paidBy: expense.paid_by_id ?? null,
          activityId: expense.activity_id ?? null,
        }
      : {
          title: '',
          amount: '',
          category: 'food',
          // Today during the trip, otherwise no date
          day: days.includes(today) ? today : null,
          // Whoever logs it paid, unless they pick someone else
          paidBy: null,
          activityId: null,
        },
  });
  const day = useWatch({ control, name: 'day' });
  const amountText = useWatch({ control, name: 'amount' });

  // Who shares the cost. Kept beside the form: "Some people" needs a choice per person, and
  // maybe an amount, which depends on who's on the trip. Expenses saved with exact amounts by
  // older versions open as "Some people" with every amount filled in.
  const [split, setSplit] = useState<Split>(expense && expense.split !== 'all' ? 'people' : 'all');
  const [chosen, setChosen] = useState<Set<number> | null>(() =>
    expense && expense.split !== 'all' ? new Set(expense.shares.map((share) => share.user_id)) : null,
  );
  // Amounts typed for some people; the others share what's left evenly
  const [amounts, setAmounts] = useState<Record<number, string>>(() =>
    expense && expense.split !== 'all'
      ? Object.fromEntries(
          expense.shares
            .filter((share) => share.fixed || expense.split === 'amounts')
            .map((share) => [share.user_id, String(share.amount)]),
        )
      : {},
  );
  const [splitError, setSplitError] = useState<string | null>(null);

  // Several people paying for it together, e.g. two cards at dinner: what each paid
  const [several, setSeveral] = useState(() => (expense?.payments?.length ?? 0) > 1);
  const [paid, setPaid] = useState<Record<number, string>>(() =>
    Object.fromEntries((expense?.payments ?? []).map((payment) => [payment.user_id, String(payment.amount)])),
  );
  const [payError, setPayError] = useState<string | null>(null);
  const everyone = members.data?.map((member) => member.user_id) ?? [];
  // Until someone is left out, "Some people" starts with everyone ticked
  const picked = chosen ?? new Set(everyone);

  const plansThatDay = itinerary.data?.days.find((item) => item.date === day)?.activities ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: tripKeys.expenses(trip.id) });
    queryClient.invalidateQueries({ queryKey: tripKeys.budget(trip.id) });
  };

  const save = useMutation({
    mutationFn: (values: Values) => {
      const body = {
        title: values.title.trim(),
        amount: Number(values.amount.trim().replace(/,/g, '')),
        category: values.category,
        spent_on: values.day,
        activity_id: values.activityId,
        // Leaving it empty on a new expense means "me"; the server fills that in
        ...(!several && (values.paidBy != null || !expense) ? { paid_by_id: values.paidBy } : {}),
        // Several payers, or none to mean the one payer above paid it all
        payments: several
          ? everyone
              .filter((userId) => parseMoney(paid[userId] ?? '') > 0)
              .map((userId) => ({ user_id: userId, amount: parseMoney(paid[userId]) }))
          : [],
        split,
        shares:
          split === 'people'
            ? everyone
                .filter((userId) => picked.has(userId))
                .map((userId) => (typed(userId) ? { user_id: userId, amount: parseMoney(amounts[userId]) } : { user_id: userId }))
            : [],
      };
      return expense
        ? api(`/trips/${trip.id}/expenses/${expense.id}`, { method: 'PATCH', body })
        : api(`/trips/${trip.id}/expenses`, { method: 'POST', body });
    },
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/trips/${trip.id}/expenses/${expense!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      router.back();
    },
  });

  // Whether someone ticked has an amount typed; they pay that, and the rest share what's left
  const typed = (userId: number) => picked.has(userId) && (amounts[userId] ?? '').trim() !== '';
  const totalCents = toCents(parseMoney(amountText ?? ''));
  const typedCents = everyone.reduce((sum, userId) => sum + (typed(userId) ? toCents(parseMoney(amounts[userId])) || 0 : 0), 0);
  const evenPeople = everyone.filter((userId) => picked.has(userId) && !typed(userId));
  // Each of the others' part, as the server works it out (spare cents aside)
  const evenCents = evenPeople.length && totalCents >= typedCents ? Math.floor((totalCents - typedCents) / evenPeople.length) : 0;
  // And how much of it the people who paid account for
  const paidCents = everyone.reduce((sum, userId) => sum + (toCents(parseMoney(paid[userId] ?? '')) || 0), 0);

  const onSubmit = handleSubmit((values) => {
    setSplitError(null);
    setPayError(null);
    if (several) {
      if (everyone.some((userId) => paid[userId]?.trim() && !(parseMoney(paid[userId]) >= 0))) {
        return setPayError('Enter amounts as numbers, like 1500.');
      }
      if (paidCents !== totalCents) {
        return setPayError(`What everyone paid needs to add up to ${formatMoney(totalCents / 100, trip.currency)}.`);
      }
    }
    if (split === 'people') {
      if (picked.size === 0) return setSplitError('Choose who shares it.');
      if (everyone.some((userId) => typed(userId) && !(parseMoney(amounts[userId]) >= 0))) {
        return setSplitError('Enter amounts as numbers, like 1500.');
      }
      if (typedCents > totalCents) {
        return setSplitError(`The amounts add up to more than ${formatMoney(totalCents / 100, trip.currency)}.`);
      }
      if (evenPeople.length === 0 && typedCents !== totalCents) {
        return setSplitError(
          `The amounts need to add up to ${formatMoney(totalCents / 100, trip.currency)}, or leave someone’s empty to share what’s left.`,
        );
      }
    }
    save.mutate(values);
  });

  const error = save.error ?? remove.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'Viewers can’t change the budget. Ask the trip owner to make you a member.'
      : (error?.message ?? null);

  return (
    <FormScreen
      title={title}
      message={errorMessage}
      actions={
        <FormActions
          label={expense ? 'Save' : 'Add expense'}
          onSave={onSubmit}
          saving={save.isPending}
          remove={
            expense
              ? {
                  label: 'Delete expense',
                  question: `Delete ${expense.title} (${formatMoney(expense.amount, trip.currency)})?`,
                  onConfirm: () => remove.mutate(),
                  pending: remove.isPending,
                }
              : undefined
          }
        />
      }>
      <FormSection title="Expense">
      <FieldRow>
      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <TextField
            label="What for"
            placeholder="e.g. Ramen at Menya Itto"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={`Amount (${trip.currency})`}
            placeholder="e.g. 1500"
            keyboardType="decimal-pad"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      </FieldRow>

      <Controller
        control={control}
        name="category"
        render={({ field }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chips}>
              {EXPENSE_CATEGORIES.map((category) => {
                const meta = CATEGORY_META[category];
                const selected = field.value === category;
                return (
                  <Pressable
                    key={category}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => field.onChange(category)}
                    style={[styles.chip, selected && styles.chipSelected]}>
                    <Feather name={meta.icon} size={15} color={selected ? colors.onAccent : colors.muted} />
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{meta.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      />

      </FormSection>

      <FormSection title="When" description="Link it to a plan and it counts as that plan’s cost.">
      <Controller
        control={control}
        name="day"
        render={({ field }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: field.value === null }}
                onPress={() => {
                  field.onChange(null);
                  setValue('activityId', null);
                }}
                style={[styles.dayChip, styles.noDay, field.value === null && styles.dayChipSelected]}>
                <Text style={[styles.dayName, field.value === null && styles.dayNameSelected]}>No</Text>
                <Text style={[styles.dayNoDate, field.value === null && styles.dayNumberSelected]}>date</Text>
              </Pressable>
              {days.map((date) => {
                const selected = date === field.value;
                return (
                  <Pressable
                    key={date}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      field.onChange(date);
                      // A plan from another day no longer fits
                      setValue('activityId', null);
                    }}
                    style={[styles.dayChip, selected && styles.dayChipSelected]}>
                    <Text style={[styles.dayName, selected && styles.dayNameSelected]}>{weekdayShort(date)}</Text>
                    <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{dayOfMonth(date)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      />

      {plansThatDay.length > 0 ? (
        <Controller
          control={control}
          name="activityId"
          render={({ field }) => (
            <View style={styles.field}>
              <Text style={styles.label}>For a plan (optional)</Text>
              <View style={styles.chips}>
                {plansThatDay.map((activity) => {
                  const selected = field.value === activity.id;
                  return (
                    <Pressable
                      key={activity.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => {
                        field.onChange(selected ? null : activity.id);
                        // Fill in what's still empty from the plan
                        if (!selected && !getValues('title').trim()) setValue('title', activity.title);
                        if (!selected && !getValues('amount').trim() && activity.estimated_cost) {
                          setValue('amount', String(activity.estimated_cost));
                        }
                      }}
                      style={[styles.chip, selected && styles.chipSelected]}>
                      <Text style={[styles.chipTime, selected && styles.chipTextSelected]}>
                        {activityClock(activity.start_time)}
                      </Text>
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                        {activity.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        />
      ) : null}

      </FormSection>

      {(members.data?.length ?? 0) > 1 || everyone.length > 1 ? (
      <FormSection title="Who paid" description="Who paid, and how it’s shared, settles up in the Budget tab.">
      {(members.data?.length ?? 0) > 1 ? (
        <Controller
          control={control}
          name="paidBy"
          render={({ field }) => {
            const payer = field.value ?? me.data?.id ?? null;
            return (
              <View style={styles.field}>
                <Text style={styles.label}>Paid by</Text>
                <View style={styles.chips}>
                  {members.data!.map((member) => {
                    const selected = !several && payer === member.user_id;
                    return (
                      <Pressable
                        key={member.user_id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        onPress={() => {
                          setSeveral(false);
                          setPayError(null);
                          field.onChange(member.user_id);
                        }}
                        style={[styles.chip, selected && styles.chipSelected]}>
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {member.user_id === me.data?.id ? 'Me' : member.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: several }}
                    accessibilityHint="Enter how much each person paid"
                    onPress={() => {
                      setSeveral(true);
                      setPayError(null);
                    }}
                    style={[styles.chip, several && styles.chipSelected]}>
                    <Feather name="users" size={14} color={several ? colors.onAccent : colors.muted} />
                    <Text style={[styles.chipText, several && styles.chipTextSelected]}>Several people</Text>
                  </Pressable>
                </View>

                {several ? (
                  <>
                    {members.data!.map((member) => (
                      <View key={member.user_id} style={styles.shareRow}>
                        <Text style={styles.shareName} numberOfLines={1}>
                          {member.user_id === me.data?.id ? 'Me' : member.name}
                        </Text>
                        <View style={styles.shareAmount}>
                          <TextField
                            label={member.user_id === me.data?.id ? 'I paid' : `${member.name} paid`}
                            placeholder="0"
                            keyboardType="decimal-pad"
                            value={paid[member.user_id] ?? ''}
                            onChangeText={(value) => {
                              setPaid((current) => ({ ...current, [member.user_id]: value }));
                              setPayError(null);
                            }}
                          />
                        </View>
                      </View>
                    ))}
                    <Text style={[styles.hint, totalCents > 0 && paidCents !== totalCents && styles.hintAttention]}>
                      {totalCents > 0
                        ? paidCents === totalCents
                          ? 'All of it is accounted for.'
                          : paidCents < totalCents
                            ? `${formatMoney((totalCents - paidCents) / 100, trip.currency)} still to account for.`
                            : `${formatMoney((paidCents - totalCents) / 100, trip.currency)} too much.`
                        : 'Enter the amount above first.'}
                    </Text>
                    <FormMessage message={payError} />
                  </>
                ) : null}
              </View>
            );
          }}
        />
      ) : null}

      {everyone.length > 1 ? (
        <View style={styles.field}>
          <Text style={styles.label}>Split</Text>
          <View style={styles.chips}>
            {SPLITS.map((option) => {
              const selected = split === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    setSplit(option.value);
                    setSplitError(null);
                  }}
                  style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {split === 'all' ? <Text style={styles.hint}>Split evenly between everyone on the trip.</Text> : null}

          {split === 'people' ? (
            <>
              {members.data!.map((member) => {
                const selected = picked.has(member.user_id);
                const name = member.user_id === me.data?.id ? 'Me' : member.name;
                return (
                  <View key={member.user_id} style={styles.shareRow}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`${name} shares it`}
                      onPress={() => {
                        const next = new Set(picked);
                        if (selected) next.delete(member.user_id);
                        else next.add(member.user_id);
                        setChosen(next);
                        setSplitError(null);
                      }}
                      style={[styles.chip, styles.shareChip, selected && styles.chipSelected]}>
                      {selected ? <Feather name="check" size={14} color={colors.onAccent} /> : null}
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                        {name}
                      </Text>
                    </Pressable>
                    {selected ? (
                      <View style={styles.shareAmount}>
                        <TextField
                          label={`${member.user_id === me.data?.id ? 'My' : `${member.name}’s`} share`}
                          // Empty means an even part of what's left, which the placeholder shows
                          placeholder={
                            typed(member.user_id) || !evenCents ? 'Even' : formatMoney(evenCents / 100, trip.currency)
                          }
                          keyboardType="decimal-pad"
                          value={amounts[member.user_id] ?? ''}
                          onChangeText={(value) => {
                            setAmounts((current) => ({ ...current, [member.user_id]: value }));
                            setSplitError(null);
                          }}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
              <Text
                style={[
                  styles.hint,
                  totalCents > 0 && (typedCents > totalCents || (!evenPeople.length && typedCents !== totalCents)) && styles.hintAttention,
                ]}>
                {totalCents <= 0
                  ? 'Enter the amount above first.'
                  : typedCents > totalCents
                    ? `The amounts are ${formatMoney((typedCents - totalCents) / 100, trip.currency)} over the total.`
                    : evenPeople.length === 0
                      ? typedCents === totalCents
                        ? 'All of it is assigned.'
                        : `${formatMoney((totalCents - typedCents) / 100, trip.currency)} left. Leave someone’s amount empty to share it.`
                      : typedCents === 0
                        ? `Split evenly: about ${formatMoney(evenCents / 100, trip.currency)} each. Type an amount for anyone who should pay a different share.`
                        : `The others split what’s left: about ${formatMoney(evenCents / 100, trip.currency)} each.`}
              </Text>
            </>
          ) : null}
          <FormMessage message={splitError} />
        </View>
      ) : null}

      </FormSection>
      ) : null}
    </FormScreen>
  );
}

const useStyles = makeStyles((colors) => ({
  loading: {
    marginTop: spacing.xl,
  },
  field: {
    gap: 8,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  hintAttention: {
    fontFamily: fonts.semibold,
    color: colors.secondText,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  // A tick-box chip that takes the row's spare width, beside its amount
  shareChip: {
    flex: 1,
    marginBottom: 6,
  },
  shareName: {
    flex: 1,
    paddingBottom: 16,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.ink,
  },
  shareAmount: {
    width: 140,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  chipTime: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.muted,
  },
  chipTextSelected: {
    color: colors.onAccent,
  },
  days: {
    gap: spacing.sm,
  },
  dayChip: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDay: {
    width: 64,
  },
  dayChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dayName: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.muted,
  },
  dayNameSelected: {
    color: colors.accentSoft,
  },
  dayNumber: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  dayNoDate: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
  dayNumberSelected: {
    color: colors.onAccent,
  },
}));
