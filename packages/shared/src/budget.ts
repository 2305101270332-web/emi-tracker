import { roundMinor, type Minor } from "@emi/core";
import type { ExpenseFrequency } from "./constants";
import type { Expense, UpcomingItem } from "./api-types";

/** What a recurring expense costs per month (quarterly ÷ 3, yearly ÷ 12, rounded to minor units). */
export function monthlyEquivalent(amount: Minor, frequency: ExpenseFrequency): Minor {
  return frequency === "monthly" ? amount : roundMinor(amount / (frequency === "quarterly" ? 3 : 12));
}

export interface BudgetRow {
  currency: string;
  /** Monthly income, when it is set in this currency. */
  income: Minor | null;
  /** EMIs payable this month (skipped instalments excluded). */
  emis: Minor;
  /** Part of `emis` already paid. */
  emisPaid: Minor;
  /** Active fixed expenses, monthly equivalent. */
  expenses: Minor;
  outgo: Minor;
  /** income − outgo; null without income in this currency. */
  left: Minor | null;
}

/**
 * Month budget per currency — amounts in different currencies are never added together.
 * The income currency comes first, then the rest alphabetically.
 */
export function summarizeBudget(opts: {
  expenses: readonly Expense[];
  dues: readonly UpcomingItem[];
  income: { amount: Minor; currency: string } | null;
}): BudgetRow[] {
  const rows = new Map<string, BudgetRow>();
  const row = (currency: string) => {
    let r = rows.get(currency);
    if (!r) rows.set(currency, (r = { currency, income: null, emis: 0, emisPaid: 0, expenses: 0, outgo: 0, left: null }));
    return r;
  };
  if (opts.income) row(opts.income.currency).income = opts.income.amount;
  for (const d of opts.dues) {
    if (d.status === "skipped") continue;
    const r = row(d.currency);
    r.emis += d.amount;
    if (d.status === "paid") r.emisPaid += d.amount;
  }
  for (const e of opts.expenses) if (e.active) row(e.currency).expenses += monthlyEquivalent(e.amount, e.frequency);
  for (const r of rows.values()) {
    r.outgo = r.emis + r.expenses;
    r.left = r.income === null ? null : r.income - r.outgo;
  }
  const first = opts.income?.currency;
  return [...rows.values()].sort((a, b) => Number(b.currency === first) - Number(a.currency === first) || a.currency.localeCompare(b.currency));
}
