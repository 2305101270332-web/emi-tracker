import { daysBetween, type ISODate } from "./dates";

export interface CashFlow {
  date: ISODate;
  /** Positive = money received by the borrower, negative = paid by the borrower. */
  amount: number;
}

/**
 * XIRR: the annual effective rate `x` such that
 *   sum(cf_i / (1 + x)^(days_i / 365)) = 0.
 * Uses Newton-Raphson with a bisection fallback. Returns null if no sign change.
 */
export function xirr(flows: readonly CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = flows[0]!.date;
  const ts = flows.map((f) => daysBetween(t0, f.date) / 365);
  const npv = (rate: number) => flows.reduce((acc, f, i) => acc + f.amount / Math.pow(1 + rate, ts[i]!), 0);
  const dnpv = (rate: number) =>
    flows.reduce((acc, f, i) => acc - (ts[i]! * f.amount) / Math.pow(1 + rate, ts[i]! + 1), 0);

  // Exact zero-cost loans: total in == total out.
  if (Math.abs(npv(0)) < 1e-9) return 0;

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate);
    const d = dnpv(rate);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = rate - v / d;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-12) return next;
    rate = next;
  }

  // Bisection fallback on (-0.9999, 100].
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-14) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** Effective annual rate -> equivalent monthly periodic rate. */
export function effectiveToMonthly(effectiveAnnual: number): number {
  return Math.pow(1 + effectiveAnnual, 1 / 12) - 1;
}

/** Monthly rate r for which an n-month annuity on `principal` has payment `payment`. */
export function solveMonthlyRate(principal: number, payment: number, n: number): number {
  if (n <= 0 || principal <= 0) return 0;
  if (payment * n <= principal + 1e-9) return 0;
  const f = (r: number) => (r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n))) - payment;
  let lo = 0;
  let hi = 1;
  while (f(hi) < 0 && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}
