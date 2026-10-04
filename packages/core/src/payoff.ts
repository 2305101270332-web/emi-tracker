import { addMonthsClamped, type ISODate } from "./dates";
import { percentOf, roundMinor, type Minor } from "./money";

/**
 * Debt payoff planner (avalanche vs snowball). All debts must share one currency —
 * callers group by currency and never mix them.
 *
 * Model (stated on screen):
 * - Each month every debt accrues interest = balance × annual rate / 12 (rounded to minor units).
 * - Every debt gets its minimum payment (its current EMI, principal + interest).
 * - The monthly budget = sum of all minimum payments + the extra amount. It stays constant:
 *   when a debt is paid off its EMI "rolls over" to the next target.
 * - Money left after minimums goes to the target debt's principal the same month:
 *   avalanche = highest rate first; snowball = smallest balance first (order fixed at the start).
 * - Tax on interest (e.g. GST on card EMIs) is reported as a cost but paid on top of the budget.
 * - No prepayment charges, fees, or rate changes are modelled.
 */

export type PayoffStrategy = "avalanche" | "snowball" | "minimum";

export interface Debt {
  id: string;
  label: string;
  /** Outstanding principal, minor units. */
  balance: Minor;
  annualRate: number;
  /** Current EMI (principal + interest), minor units. */
  minPayment: Minor;
  interestTaxRate?: number;
}

export interface PayoffResult {
  strategy: PayoffStrategy;
  /** Months until every debt is cleared (capped at 600; see `capped`). */
  months: number;
  capped: boolean;
  totalInterest: Minor;
  totalInterestTax: Minor;
  totalPaid: Minor;
  /** Debt ids in the order they are paid off, with the month (1-based) each clears. */
  payoffOrder: { id: string; label: string; month: number; date: ISODate }[];
  /** Total outstanding principal at the end of each month (index 0 = start). */
  balances: Minor[];
}

const MAX_MONTHS = 600;

export function priorityOrder(debts: readonly Debt[], strategy: PayoffStrategy): Debt[] {
  const list = [...debts];
  if (strategy === "avalanche") list.sort((a, b) => b.annualRate - a.annualRate || a.balance - b.balance || a.id.localeCompare(b.id));
  else list.sort((a, b) => a.balance - b.balance || b.annualRate - a.annualRate || a.id.localeCompare(b.id));
  return list;
}

export function planPayoff(debts: readonly Debt[], extraPerMonth: Minor, strategy: PayoffStrategy, start: ISODate): PayoffResult {
  const active = debts.filter((d) => d.balance > 0);
  const order = priorityOrder(active, strategy);
  const bal = new Map(active.map((d) => [d.id, d.balance]));
  const budget = active.reduce((s, d) => s + d.minPayment, 0) + (strategy === "minimum" ? 0 : Math.max(0, extraPerMonth));
  const result: PayoffResult = {
    strategy,
    months: 0,
    capped: false,
    totalInterest: 0,
    totalInterestTax: 0,
    totalPaid: 0,
    payoffOrder: [],
    balances: [sumMap(bal)],
  };

  let month = 0;
  while (sumMap(bal) > 0) {
    if (month >= MAX_MONTHS) {
      result.capped = true;
      break;
    }
    month++;
    let spent = 0;
    // 1. Interest + minimum payment on every open debt.
    for (const d of order) {
      const b = bal.get(d.id)!;
      if (b <= 0) continue;
      const interest = roundMinor((b * d.annualRate) / 1200);
      result.totalInterest += interest;
      result.totalInterestTax += percentOf(interest, d.interestTaxRate ?? 0);
      const pay = Math.min(d.minPayment, b + interest);
      bal.set(d.id, b + interest - pay);
      spent += pay;
    }
    // 2. Remaining budget (extra + rolled-over EMIs) to targets in priority order.
    if (strategy !== "minimum") {
      let left = budget - spent;
      for (const d of order) {
        if (left <= 0) break;
        const b = bal.get(d.id)!;
        if (b <= 0) continue;
        const pay = Math.min(left, b);
        bal.set(d.id, b - pay);
        left -= pay;
        spent += pay;
      }
    }
    result.totalPaid += spent;
    for (const d of order) {
      if (bal.get(d.id)! <= 0 && !result.payoffOrder.some((p) => p.id === d.id)) {
        result.payoffOrder.push({ id: d.id, label: d.label, month, date: addMonthsClamped(start, month - 1) });
      }
    }
    result.balances.push(sumMap(bal));
  }
  result.months = month;
  return result;
}

function sumMap(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += Math.max(0, v);
  return s;
}

// ---- Debt-to-income -----------------------------------------------------------------------------

export type DtiBand = "healthy" | "caution" | "high";

/** Thresholds: < 30% healthy, 30–40% caution, > 40% high (common lender affordability norms). */
export function dtiBand(ratio: number): DtiBand {
  if (ratio < 0.3) return "healthy";
  if (ratio <= 0.4) return "caution";
  return "high";
}
