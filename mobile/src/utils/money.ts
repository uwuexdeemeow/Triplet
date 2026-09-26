// "¥7,500", "$12.50" or "JPY 7,500" if the device doesn't know the currency
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      // "¥1,500" rather than "JP¥1,500"; the trip already says which currency it uses
      currencyDisplay: 'narrowSymbol',
      // Currencies like JPY have no minor units, others show cents only when there are some
      minimumFractionDigits: Number.isInteger(amount) ? 0 : undefined,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
