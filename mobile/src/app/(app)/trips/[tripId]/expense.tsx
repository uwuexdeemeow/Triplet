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
import { Button } from '@/components/button';
import { FormMessage, Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
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

  return (
    <Screen>
      <View style={styles.container}>
        <ScreenHeader title={expenseId ? 'Edit expense' : 'Add expense'} icon="close" />
        {missing ? (
          <FormMessage message="This expense couldn’t be found. It may have been deleted." />
        ) : loading || !trip.data ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : (
          // Mounted once the data is here, so the fields start with the right values
          <ExpenseForm trip={trip.data} expense={expense} />
        )}
      </View>
    </Screen>
  );
}

function ExpenseForm({ trip, expense }: { trip: Trip; expense: Expense | undefined }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const me = useMe();
  const members = useMembers(trip.id);
  const itinerary = useItinerary(trip.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
        ...(values.paidBy != null || !expense ? { paid_by_id: values.paidBy } : {}),
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

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const error = save.error ?? remove.error;
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? 'Viewers can’t change the budget. Ask the trip owner to make you a member.'
      : (error?.message ?? null);

  return (
    <>
      <FormMessage message={errorMessage} />

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
                    const selected = payer === member.user_id;
                    return (
                      <Pressable
                        key={member.user_id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        onPress={() => field.onChange(member.user_id)}
                        style={[styles.chip, selected && styles.chipSelected]}>
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {member.user_id === me.data?.id ? 'Me' : member.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hint}>Split evenly between everyone on the trip.</Text>
              </View>
            );
          }}
        />
      ) : null}

      <Button label={expense ? 'Save' : 'Add expense'} loading={save.isPending} onPress={onSubmit} />

      {expense ? (
        confirmDelete ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>
              Delete {expense.title} ({formatMoney(expense.amount, trip.currency)})?
            </Text>
            <View style={styles.confirmButtons}>
              <Button label="Keep" variant="secondary" onPress={() => setConfirmDelete(false)} style={styles.flex} />
              <Pressable
                accessibilityRole="button"
                disabled={remove.isPending}
                onPress={() => remove.mutate()}
                style={[styles.deleteButton, styles.flex]}>
                <Text style={styles.deleteLabel}>{remove.isPending ? 'Deleting…' : 'Delete'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={styles.deleteLink}>
            <Text style={styles.deleteLinkLabel}>Delete expense</Text>
          </Pressable>
        )
      ) : null}
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: 20,
  },
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
  confirm: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  confirmText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.dangerText,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  deleteButton: {
    minHeight: 52,
    borderRadius: radii.button,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.onDanger,
  },
  deleteLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLinkLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.dangerText,
  },
}));
