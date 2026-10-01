import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { api } from '@/api/client';
import {
  tripKeys,
  useBudget,
  useBudgetEstimate,
  useExpenses,
  useItinerary,
  useMe,
  useMembers,
  type BudgetEstimate,
  type BudgetSummary,
  type Expense,
} from '@/api/trips';
import { Enter } from '@/components/enter';
import { Button } from '@/components/button';
import { Fab } from '@/components/fab';
import { FormMessage } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Body, Title } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { makeStyles, useTheme } from '@/theme/theme';
import { fonts, headingTracking, radii, spacing } from '@/theme/tokens';
import { categoryMeta, EXPENSE_CATEGORIES, CATEGORY_META } from '@/utils/budget';
import { formatShortDate } from '@/utils/dates';
import { useWideLayout } from '@/utils/layout';
import { usePullToRefresh } from '@/utils/pull-to-refresh';
import { formatMoney } from '@/utils/money';

export default function BudgetScreen() {
  const styles = useStyles();
  const wide = useWideLayout();
  const { colors } = useTheme();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = Number(tripId);
  const budget = useBudget(id);
  const estimate = useBudgetEstimate(id);
  const expenses = useExpenses(id);
  const itinerary = useItinerary(id);
  const members = useMembers(id);
  const me = useMe();

  const refresh = () => Promise.all([budget.refetch(), estimate.refetch(), expenses.refetch(), itinerary.refetch()]);
  const pull = usePullToRefresh(refresh);

  const myRole = members.data?.find((member) => member.user_id === me.data?.id)?.role;
  const canEdit = myRole === 'owner' || myRole === 'member';

  if (budget.isPending || expenses.isPending) return <ActivityIndicator color={colors.accent} style={styles.loading} />;

  if (budget.isError || expenses.isError) {
    return (
      <View style={styles.list}>
        <FormMessage message={(budget.error ?? expenses.error)?.message ?? null} />
        <Button label="Try again" variant="secondary" onPress={refresh} />
      </View>
    );
  }

  const summary = budget.data;
  const currency = summary.currency;
  const money = (amount: number) => formatMoney(amount, currency);

  // Plans with a cost that nobody has logged an expense for yet, so the forecast doesn't count them twice
  const paidPlans = new Set(expenses.data.map((expense) => expense.activity_id).filter((value) => value != null));
  const plans = itinerary.data?.days.flatMap((day) => day.activities) ?? [];
  const planTitles = new Map(plans.map((plan) => [plan.id, plan.title]));
  const stillToPay = plans
    .filter((plan) => !paidPlans.has(plan.id))
    .reduce((total, plan) => total + (plan.estimated_cost ?? 0), 0);
  const names = new Map(members.data?.map((member) => [member.user_id, member.user_id === me.data?.id ? 'you' : member.name]));

  return (
    <View style={[styles.screen, wide && styles.screenWide]}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors.accent} />}>
        <SummaryCard tripId={tripId} summary={summary} stillToPay={stillToPay} canEdit={canEdit} money={money} />

        {estimate.data ? <EstimateCard estimate={estimate.data} money={money} /> : null}

        {summary.total_spent > 0 ? <CategoryCard summary={summary} money={money} /> : null}

        {summary.balances.length > 1 && summary.total_spent > 0 ? (
          <SettleUpCard tripId={id} summary={summary} myId={me.data?.id} canEdit={canEdit} money={money} />
        ) : null}

        <Text style={styles.sectionTitle}>Expenses</Text>
        {expenses.data.length === 0 ? (
          <View style={styles.empty}>
            <Title style={styles.center}>Nothing spent yet</Title>
            <Body style={styles.muted}>
              Log what you spend as you go. With friends on the trip, split each cost between everyone or just some of
              you, then settle up at the end.
            </Body>
          </View>
        ) : (
          groupByDay(expenses.data).map(([day, items]) => (
            <View key={day ?? 'none'} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{day ? formatShortDate(day) : 'No date'}</Text>
                <Text style={styles.groupTotal}>{money(items.reduce((total, item) => total + item.amount, 0))}</Text>
              </View>
              {items.map((expense, index) => (
                <Enter key={expense.id} index={index}>
                  <ExpenseRow
                    tripId={id}
                    expense={expense}
                    payer={expense.paid_by_id != null ? names.get(expense.paid_by_id) : undefined}
                    showPayer={summary.balances.length > 1}
                    plan={expense.activity_id != null ? planTitles.get(expense.activity_id) : undefined}
                    canEdit={canEdit}
                    money={money}
                  />
                </Enter>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {canEdit ? (
        <Fab label="Add expense" onPress={() => router.push({ pathname: '/trips/[tripId]/expense', params: { tripId } })} />
      ) : null}
    </View>
  );
}

// Newest day first, expenses without a date at the end
function groupByDay(expenses: Expense[]): [string | null, Expense[]][] {
  const groups = new Map<string | null, Expense[]>();
  for (const expense of expenses) {
    const key = expense.spent_on ?? null;
    groups.set(key, [...(groups.get(key) ?? []), expense]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)));
}

function SummaryCard({
  tripId,
  summary,
  stillToPay,
  canEdit,
  money,
}: {
  tripId: string;
  summary: BudgetSummary;
  stillToPay: number;
  canEdit: boolean;
  money: (amount: number) => string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { budget, total_spent: spent } = summary;
  const over = budget != null && spent > budget;
  const forecast = spent + stillToPay;
  const forecastOver = budget != null && !over && forecast > budget;

  // Shares of the bar: spent, then what the plans will still cost
  const scale = budget != null ? Math.max(budget, forecast) : 0;
  const spentWidth = scale > 0 ? Math.min(100, (spent / scale) * 100) : 0;
  const plannedWidth = scale > 0 ? Math.min(100 - spentWidth, (stillToPay / scale) * 100) : 0;
  const budgetMark = budget != null && scale > budget ? (budget / scale) * 100 : null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Spent so far</Text>
      <View style={styles.hero}>
        <Text style={styles.heroValue}>{money(spent)}</Text>
        {budget != null ? <Text style={styles.heroOf}>of {money(budget)}</Text> : null}
      </View>

      {budget != null ? (
        <>
          <View
            style={styles.meter}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`Spent ${money(spent)} of ${money(budget)}`}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(100, (spent / (budget || 1)) * 100)) }}>
            {spentWidth > 0 ? (
              <View style={[styles.meterFill, { width: `${spentWidth}%`, backgroundColor: over ? colors.danger : colors.accent }]} />
            ) : null}
            {plannedWidth > 0 ? <View style={[styles.meterPlanned, { width: `${plannedWidth}%` }]} /> : null}
            {budgetMark != null ? <View style={[styles.budgetMark, { left: `${budgetMark}%` }]} /> : null}
          </View>

          {over ? (
            <View style={styles.status}>
              <Feather name="alert-triangle" size={15} color={colors.dangerText} />
              <Text style={[styles.statusText, styles.statusOver]}>{money(spent - budget)} over budget</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>{money(budget - spent)} left</Text>
          )}
        </>
      ) : (
        <View style={styles.noBudget}>
          <Text style={styles.statusText}>No budget set for this trip.</Text>
          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/trips/[tripId]/settings', params: { tripId } })}
              style={styles.textButton}>
              <Text style={styles.textButtonLabel}>Set a budget</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {stillToPay > 0 ? (
        <View style={styles.forecast}>
          {budget != null ? <View style={styles.plannedKey} /> : null}
          <Text style={[styles.forecastText, forecastOver && styles.statusOver]}>
            Plans still to pay: about {money(stillToPay)}
            {forecastOver ? ` · ${money(forecast - budget!)} over budget` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// What the whole trip will roughly cost: the plans, meals they don't cover, getting around, and the hotels
function EstimateCard({ estimate, money }: { estimate: BudgetEstimate; money: (amount: number) => string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [showDays, setShowDays] = useState(false);
  const over = estimate.over_budget_by != null && estimate.over_budget_by > 0;
  const rows = [
    { label: 'Plans', icon: 'map-pin' as const, amount: estimate.plans_total },
    { label: 'Meals not in the plan', icon: 'coffee' as const, amount: estimate.meals_total },
    { label: 'Getting around', icon: 'navigation' as const, amount: estimate.transport_total },
    { label: 'Where you stay', icon: 'home' as const, amount: estimate.stays_total ?? 0 },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Estimated trip cost</Text>
      <View style={styles.hero}>
        <Text style={styles.heroValue}>≈ {money(estimate.total)}</Text>
        <Text style={styles.heroOf}>
          for {estimate.people} {estimate.people === 1 ? 'person' : 'people'}
        </Text>
      </View>
      {estimate.over_budget_by != null ? (
        <View style={styles.status}>
          {over ? <Feather name="alert-triangle" size={15} color={colors.dangerText} /> : null}
          <Text style={[styles.statusText, over && styles.statusOver]}>
            {over
              ? `About ${money(estimate.over_budget_by)} over budget`
              : `About ${money(-estimate.over_budget_by)} under budget`}
          </Text>
        </View>
      ) : null}

      <View style={styles.legend}>
        {rows.map((row) => (
          <View key={row.label} style={styles.legendRow}>
            <Feather name={row.icon} size={14} color={colors.muted} />
            <Text style={styles.legendLabel}>{row.label}</Text>
            <Text style={styles.legendAmount}>{money(row.amount)}</Text>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showDays }}
        onPress={() => setShowDays((value) => !value)}
        style={styles.textButton}>
        <Text style={styles.textButtonLabel}>{showDays ? 'Hide days' : 'See each day'}</Text>
      </Pressable>
      {showDays ? (
        <View style={styles.legend}>
          {estimate.days.map((day) => {
            // What makes up the day's total, on its own line so it has room
            const parts = [
              day.plans > 0 ? `Plans ${money(day.plans)}` : null,
              day.meals > 0 ? `Meals ${money(day.meals)}` : null,
              day.transport > 0 ? `Getting around ${money(day.transport)}` : null,
              (day.stays ?? 0) > 0 ? `Stay ${money(day.stays!)}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View
                key={day.date}
                style={styles.estimateDay}
                accessible
                accessibilityLabel={`${formatShortDate(day.date)}: about ${money(day.total)}${parts ? `. ${parts}` : ''}`}>
                <View style={styles.legendRow}>
                  <Text style={styles.legendLabel}>{formatShortDate(day.date)}</Text>
                  <Text style={styles.legendAmount}>{money(day.total)}</Text>
                </View>
                {parts ? <Text style={styles.estimateDayParts}>{parts}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {estimate.notes.map((note) => (
        <Text key={note} style={styles.estimateNote}>
          {note}
        </Text>
      ))}
      {/* ExchangeRate-API's free rates ask for a link back */}
      {estimate.rates_source === 'ExchangeRate-API' ? (
        <Text
          accessibilityRole="link"
          onPress={() => Linking.openURL('https://www.exchangerate-api.com')}
          style={[styles.estimateNote, styles.estimateCredit]}>
          Rates by Exchange Rate API
        </Text>
      ) : null}
    </View>
  );
}

function CategoryCard({ summary, money }: { summary: BudgetSummary; money: (amount: number) => string }) {
  const { scheme } = useTheme();
  const styles = useStyles();
  const total = summary.total_spent;
  // Fixed category order, so colours and positions stay put as spending changes
  const rows = EXPENSE_CATEGORIES.map((category) => ({ category, amount: summary.by_category[category] ?? 0 })).filter(
    (row) => row.amount > 0,
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Where it went</Text>
      <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {rows.map((row) => (
          <View
            key={row.category}
            style={[styles.stackSegment, { flexGrow: row.amount, backgroundColor: CATEGORY_META[row.category].color[scheme] }]}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {rows.map((row) => {
          const meta = CATEGORY_META[row.category];
          const percent = Math.round((row.amount / total) * 100);
          return (
            <View
              key={row.category}
              style={styles.legendRow}
              accessible
              accessibilityLabel={`${meta.label}: ${money(row.amount)}, ${percent} percent`}>
              <View style={[styles.legendDot, { backgroundColor: meta.color[scheme] }]} />
              <Text style={styles.legendLabel}>{meta.label}</Text>
              <Text style={styles.legendPercent}>{percent}%</Text>
              <Text style={styles.legendAmount}>{money(row.amount)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Who pays whom to even things out, worked out by the server from everyone's shares and the
// paybacks already recorded. "Mark as paid" records one, and a mistake can be undone.
function SettleUpCard({
  tripId,
  summary,
  myId,
  canEdit,
  money,
}: {
  tripId: number;
  summary: BudgetSummary;
  myId: number | undefined;
  canEdit: boolean;
  money: (amount: number) => string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const transfers = summary.settle_up ?? [];
  const settlements = summary.settlements ?? [];
  const names = new Map(summary.balances.map((balance) => [balance.user_id, balance.name]));
  const who = (id: number | null | undefined, start = false) =>
    id == null ? 'Someone who left' : id === myId ? (start ? 'You' : 'you') : (names.get(id) ?? 'Someone who left');
  const mine = summary.balances.find((balance) => balance.user_id === myId);

  const refresh = () => queryClient.invalidateQueries({ queryKey: tripKeys.budget(tripId) });
  const markPaid = useMutation({
    mutationFn: (transfer: { from_user_id: number; to_user_id: number; amount: number }) =>
      api(`/trips/${tripId}/settlements`, {
        method: 'POST',
        body: { from_user_id: transfer.from_user_id, to_user_id: transfer.to_user_id, amount: transfer.amount },
      }),
    onSuccess: refresh,
  });
  const undo = useMutation({
    mutationFn: (settlementId: number) => api(`/trips/${tripId}/settlements/${settlementId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Settle up</Text>
      {mine ? <Text style={styles.cardNote}>Your share of the costs: {money(mine.share)}.</Text> : null}
      <FormMessage message={(markPaid.error ?? undo.error)?.message ?? null} />
      {transfers.length === 0 ? (
        <View style={styles.status}>
          <Feather name="check-circle" size={15} color={colors.accent} />
          <Text style={styles.statusText}>Everyone’s even.</Text>
        </View>
      ) : (
        transfers.map((transfer) => (
          <View key={`${transfer.from_user_id}-${transfer.to_user_id}`} style={styles.transfer}>
            <View style={styles.transferMain}>
              <Text style={styles.transferText}>
                <Text style={styles.bold}>{who(transfer.from_user_id, true)}</Text>
                {transfer.from_user_id === myId ? ' pay ' : ' pays '}
                <Text style={styles.bold}>{who(transfer.to_user_id)}</Text>
              </Text>
              <Text style={styles.transferAmount}>{money(transfer.amount)}</Text>
            </View>
            {canEdit ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark ${money(transfer.amount)} from ${who(transfer.from_user_id)} to ${who(transfer.to_user_id)} as paid`}
                disabled={markPaid.isPending}
                onPress={() => markPaid.mutate(transfer)}
                style={({ pressed }) => [styles.paidButton, pressed && styles.pressed]}>
                <Text style={styles.paidLabel}>Mark as paid</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
      {settlements.length ? (
        <View style={styles.paidList}>
          <Text style={styles.paidTitle}>Paid back</Text>
          {settlements.map((settlement) => (
            <View key={settlement.id} style={styles.paidRow}>
              <Text style={styles.paidText} numberOfLines={2}>
                {who(settlement.from_user_id, true)} paid {who(settlement.to_user_id)} {money(settlement.amount)}
              </Text>
              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Undo this payment"
                  disabled={undo.isPending}
                  onPress={() => undo.mutate(settlement.id)}
                  hitSlop={8}>
                  <Text style={styles.undoLabel}>Undo</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ExpenseRow({
  tripId,
  expense,
  payer,
  showPayer,
  plan,
  canEdit,
  money,
}: {
  tripId: number;
  expense: Expense;
  payer: string | undefined;
  showPayer: boolean;
  plan: string | undefined;
  canEdit: boolean;
  money: (amount: number) => string;
}) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const queryClient = useQueryClient();
  const meta = categoryMeta(expense.category);
  const remove = useMutation({
    mutationFn: () => api(`/trips/${tripId}/expenses/${expense.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripKeys.expenses(tripId) });
      queryClient.invalidateQueries({ queryKey: tripKeys.budget(tripId) });
    },
  });

  const splitNote =
    expense.split === 'people'
      ? `Split between ${expense.shares.length}`
      : expense.split === 'amounts'
        ? 'Custom split'
        : null;
  const details = [
    showPayer && payer ? `Paid by ${payer}` : null,
    splitNote,
    plan ? `For ${plan}` : null,
    showPayer || plan || splitNote ? null : meta.label,
  ]
    .filter(Boolean)
    .join(' · ');

  const row = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${expense.title}, ${money(expense.amount)}`}
      accessibilityHint={canEdit ? 'Opens the expense to edit it' : undefined}
      disabled={!canEdit}
      onPress={() =>
        router.push({ pathname: '/trips/[tripId]/expense', params: { tripId: String(tripId), expenseId: String(expense.id) } })
      }
      scaleTo={0.98}
      style={styles.expense}>
      <View style={[styles.expenseIcon, { backgroundColor: meta.color[scheme] }]}>
        <Feather name={meta.icon} size={16} color={colors.onAccent} />
      </View>
      <View style={styles.expenseText}>
        <Text style={styles.expenseTitle} numberOfLines={1}>
          {expense.title}
        </Text>
        {details ? (
          <Text style={styles.expenseDetails} numberOfLines={1}>
            {details}
          </Text>
        ) : null}
        {remove.error ? <Text style={styles.expenseError}>{remove.error.message}</Text> : null}
      </View>
      {/* On the web the delete button sits in the corner, so keep the amount clear of it */}
      <Text style={[styles.expenseAmount, canEdit && Platform.OS === 'web' && styles.expenseAmountWeb]}>
        {money(expense.amount)}
      </Text>
    </PressableScale>
  );

  return canEdit ? (
    <SwipeToDelete label={`Delete ${expense.title}`} radius={16} onDelete={() => remove.mutateAsync()}>
      {row}
    </SwipeToDelete>
  ) : (
    row
  );
}

const useStyles = makeStyles((colors) => ({
  estimateNote: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  estimateCredit: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  screenWide: {
    maxWidth: 760,
    paddingTop: spacing.lg,
  },
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  loading: {
    marginTop: spacing.xxl,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: spacing.xs,
    // Room for the add button
    paddingBottom: 110,
    gap: spacing.md,
  },
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: radii.card,
  },
  cardLabel: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
  },
  cardNote: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
  },
  heroValue: {
    fontFamily: fonts.display,
    letterSpacing: headingTracking,
    fontSize: 34,
    color: colors.ink,
  },
  heroOf: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.muted,
  },
  meter: {
    flexDirection: 'row',
    height: 6,
    marginVertical: spacing.xs,
    borderRadius: 3,
    backgroundColor: colors.chip,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  meterPlanned: {
    height: '100%',
    // Lighter than spending: money the plans will still cost
    marginLeft: 2,
    borderRadius: 3,
    backgroundColor: colors.accentMuted,
  },
  budgetMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.ink,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontFamily: fonts.semibold,
    fontSize: 14.5,
    color: colors.ink,
  },
  statusOver: {
    color: colors.dangerText,
  },
  noBudget: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
  },
  textButton: {
    minHeight: 36,
    justifyContent: 'center',
  },
  textButtonLabel: {
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.accent,
  },
  forecast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  plannedKey: {
    width: 12,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accentMuted,
  },
  forecastText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  stack: {
    flexDirection: 'row',
    height: 8,
    gap: 2,
    marginVertical: spacing.xs,
  },
  stackSegment: {
    flexBasis: 0,
    minWidth: 4,
    height: '100%',
    borderRadius: 4,
  },
  legend: {
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 26,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  legendPercent: {
    width: 42,
    textAlign: 'right',
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  estimateDay: {
    paddingVertical: 4,
  },
  estimateDayParts: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  legendAmount: {
    minWidth: 80,
    textAlign: 'right',
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
  transfer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.input,
    backgroundColor: colors.bg,
  },
  transferMain: {
    flex: 1,
    minWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  paidButton: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paidLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.accentStrong,
  },
  paidList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  paidTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.muted,
  },
  paidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  paidText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  pressed: {
    opacity: 0.75,
  },
  undoLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.accent,
  },
  transferText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
  },
  bold: {
    fontFamily: fonts.bold,
  },
  transferAmount: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  sectionTitle: {
    marginTop: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  empty: {
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  center: {
    textAlign: 'center',
  },
  muted: {
    color: colors.muted,
    textAlign: 'center',
  },
  group: {
    gap: spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  groupTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
  groupTotal: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.muted,
  },
  expense: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    boxShadow: colors.cardShadow,
    borderRadius: 12,
  },
  expenseIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  expenseTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.ink,
  },
  expenseDetails: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  expenseError: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.dangerText,
  },
  expenseAmount: {
    fontFamily: fonts.bold,
    fontSize: 15.5,
    color: colors.ink,
  },
  expenseAmountWeb: {
    marginRight: 36,
  },
}));
