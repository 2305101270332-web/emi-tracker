import { addDays, compareISO, type ISODate } from "./dates";
import type { Minor } from "./money";

export type InstalmentStatus = "upcoming" | "due" | "paid" | "overdue" | "skipped";

/** Default days before payable_date at which an unpaid instalment becomes "due" (user-configurable). */
export const DUE_WINDOW_DAYS = 7;

export interface StatusInput {
  payableDate: ISODate;
  paidAt?: ISODate | null;
  skipped?: boolean;
}

export function instalmentStatus(i: StatusInput, today: ISODate, dueWindowDays: number = DUE_WINDOW_DAYS): InstalmentStatus {
  if (i.paidAt) return "paid";
  if (i.skipped) return "skipped";
  if (compareISO(i.payableDate, today) < 0) return "overdue";
  if (compareISO(i.payableDate, addDays(today, dueWindowDays)) <= 0) return "due";
  return "upcoming";
}

export interface ProgressRow {
  principal: Minor;
  interest: Minor;
  closing: Minor;
  opening: Minor;
  paid: boolean;
}

export interface LoanProgress {
  instalmentsTotal: number;
  instalmentsPaid: number;
  instalmentsLeft: number;
  principalPaid: Minor;
  interestPaid: Minor;
  principalOutstanding: Minor;
  /** 0..1 by principal repaid. */
  progress: number;
}

export function loanProgress(rows: readonly ProgressRow[]): LoanProgress {
  const financed = rows[0]?.opening ?? 0;
  let principalPaid = 0;
  let interestPaid = 0;
  let paid = 0;
  for (const r of rows) {
    if (!r.paid) continue;
    paid++;
    principalPaid += r.principal;
    interestPaid += r.interest;
  }
  const outstanding = financed - principalPaid;
  return {
    instalmentsTotal: rows.length,
    instalmentsPaid: paid,
    instalmentsLeft: rows.length - paid,
    principalPaid,
    interestPaid,
    principalOutstanding: outstanding,
    progress: financed > 0 ? principalPaid / financed : 0,
  };
}

/** Sum amounts per currency. Never adds across currencies. */
export function totalsByCurrency<T>(
  items: readonly T[],
  currency: (t: T) => string,
  amount: (t: T) => Minor,
): Record<string, Minor> {
  const out: Record<string, Minor> = {};
  for (const it of items) {
    const c = currency(it);
    out[c] = (out[c] ?? 0) + amount(it);
  }
  return out;
}

/** Group then sum per currency: result[groupKey][currency] = total. */
export function totalsByKeyAndCurrency<T>(
  items: readonly T[],
  key: (t: T) => string,
  currency: (t: T) => string,
  amount: (t: T) => Minor,
): Record<string, Record<string, Minor>> {
  const out: Record<string, Record<string, Minor>> = {};
  for (const it of items) {
    const k = key(it);
    const c = currency(it);
    const bucket = (out[k] ??= {});
    bucket[c] = (bucket[c] ?? 0) + amount(it);
  }
  return out;
}
