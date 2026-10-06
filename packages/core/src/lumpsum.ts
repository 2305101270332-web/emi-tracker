import { percentOf, roundMinor, type Minor } from "./money";
import type { Debt } from "./payoff";

/**
 * Lump-sum planner: where should a one-off amount of spare money (bonus, savings, refund, ...) go across loans?
 * All debts must share the lump sum's currency — callers group by currency.
 *
 * Model (same as the payoff planner, stated on screen):
 * - Each month a debt accrues interest = balance × annual rate / 12 (rounded), plus tax on
 *   interest; the EMI stays the same, so prepaying shortens the loan (reduce tenure).
 * - A prepayment may carry a charge (% of the principal prepaid) plus tax on that charge,
 *   both paid out of the lump sum.
 * - Strategies:
 *   interest: highest effective rate first — rate incl. tax on interest, minus the charge
 *             spread over the months the loan has left. Loans that cost nothing (0%) get nothing.
 *   cashflow: close whole loans that free the most EMI per rupee spent; whatever cannot
 *             close a loan goes to the highest effective rate.
 * - Savings are undiscounted totals; tax benefits on interest (e.g. home loans) are not modelled.
 */

export type LumpSumStrategy = "interest" | "cashflow";

export interface LumpSumDebt extends Debt {
  /** Prepayment / foreclosure charge as % of the principal prepaid. */
  chargePercent?: number;
  /** Tax on the charge in percent (e.g. GST 18). */
  chargeTaxRate?: number;
}

export interface LumpSumAllocation {
  id: string;
  label: string;
  /** Principal prepaid. */
  principal: Minor;
  /** Prepayment charge plus tax on it. */
  charges: Minor;
  /** principal + charges: what this allocation takes out of the lump sum. */
  cost: Minor;
  /** True when the allocation pays the loan off. */
  closes: boolean;
  /** Monthly EMI no longer payable (closed loans only). */
  emiFreed: Minor;
  /** Interest plus tax on interest no longer payable. */
  interestSaved: Minor;
  /** interestSaved - charges. */
  netSaving: Minor;
  monthsSaved: number;
  /** Ranking rate used by the "interest" strategy, % p.a. */
  effectiveRate: number;
}

export interface LumpSumPlan {
  strategy: LumpSumStrategy;
  allocations: LumpSumAllocation[];
  used: Minor;
  /** Money not used: every loan worth prepaying is closed (or only rounding is left). */
  leftover: Minor;
  interestSaved: Minor;
  charges: Minor;
  netSaving: Minor;
  emiFreed: Minor;
}

const MAX_MONTHS = 600;

/** Interest (incl. tax) still to pay and months left if only the EMI is paid. */
export function runOff(balance: Minor, d: Debt): { interest: Minor; months: number } {
  let b = balance;
  let interest = 0;
  let months = 0;
  while (b > 0 && months < MAX_MONTHS) {
    months++;
    const i = roundMinor((b * d.annualRate) / 1200);
    interest += i + percentOf(i, d.interestTaxRate ?? 0);
    b = b + i - Math.min(d.minPayment, b + i);
  }
  return { interest, months };
}

function chargeOn(principal: Minor, d: LumpSumDebt): Minor {
  const charge = roundMinor((principal * (d.chargePercent ?? 0)) / 100);
  return charge + percentOf(charge, d.chargeTaxRate ?? 0);
}

/** Largest principal whose principal + charges fits in `cash`. */
function affordablePrincipal(cash: Minor, d: LumpSumDebt): Minor {
  const k = ((d.chargePercent ?? 0) / 100) * (1 + (d.chargeTaxRate ?? 0) / 100);
  let p = Math.min(d.balance, Math.floor(cash / (1 + k)));
  // The division above can land a unit off either way (float + rounded charges).
  while (p > 0 && p + chargeOn(p, d) > cash) p--;
  while (p < d.balance && p + 1 + chargeOn(p + 1, d) <= cash) p++;
  return Math.max(0, p);
}

export function effectiveRate(d: LumpSumDebt): number {
  const months = Math.max(1, runOff(d.balance, d).months);
  const chargePct = (d.chargePercent ?? 0) * (1 + (d.chargeTaxRate ?? 0) / 100);
  return d.annualRate * (1 + (d.interestTaxRate ?? 0) / 100) - (chargePct * 12) / months;
}

function allocate(d: LumpSumDebt, principal: Minor): LumpSumAllocation {
  const before = runOff(d.balance, d);
  const after = runOff(d.balance - principal, d);
  const charges = chargeOn(principal, d);
  const closes = principal >= d.balance;
  const interestSaved = before.interest - after.interest;
  return {
    id: d.id,
    label: d.label,
    principal,
    charges,
    cost: principal + charges,
    closes,
    emiFreed: closes ? d.minPayment : 0,
    interestSaved,
    netSaving: interestSaved - charges,
    monthsSaved: before.months - after.months,
    effectiveRate: effectiveRate(d),
  };
}

const byRate = (a: LumpSumDebt, b: LumpSumDebt) => effectiveRate(b) - effectiveRate(a) || a.balance - b.balance || a.id.localeCompare(b.id);
const closeCost = (d: LumpSumDebt) => d.balance + chargeOn(d.balance, d);

export function planLumpSum(debts: readonly LumpSumDebt[], amount: Minor, strategy: LumpSumStrategy): LumpSumPlan {
  let left = Math.max(0, Math.floor(amount));
  let open = debts.filter((d) => d.balance > 0);
  const allocations: LumpSumAllocation[] = [];
  const take = (d: LumpSumDebt, principal: Minor) => {
    const a = allocate(d, principal);
    allocations.push(a);
    left -= a.cost;
    open = open.filter((o) => o.id !== d.id);
    return a;
  };

  if (strategy === "cashflow") {
    for (;;) {
      const closable = open.filter((d) => closeCost(d) <= left);
      if (!closable.length) break;
      closable.sort((a, b) => b.minPayment / closeCost(b) - a.minPayment / closeCost(a) || byRate(a, b));
      take(closable[0]!, closable[0]!.balance);
    }
  }
  // "interest" strategy, and the remainder of "cashflow": highest effective rate first.
  for (const d of [...open].sort(byRate)) {
    if (left <= 0 || effectiveRate(d) <= 0) break;
    const p = affordablePrincipal(left, d);
    if (p <= 0) continue;
    if (!take(d, p).closes) break; // the money ran out on a part-payment
  }

  const total = (k: "cost" | "interestSaved" | "charges" | "netSaving" | "emiFreed") => allocations.reduce((s, a) => s + a[k], 0);
  const used = total("cost");
  return {
    strategy,
    allocations,
    used,
    leftover: left,
    interestSaved: total("interestSaved"),
    charges: total("charges"),
    netSaving: total("netSaving"),
    emiFreed: total("emiFreed"),
  };
}
