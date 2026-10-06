import type { LoanListItem } from "@emi/shared";

export const LOAN_SORTS = ["newest", "nextDue", "name", "outstanding", "emi", "progress", "rate"] as const;
export type LoanSort = (typeof LOAN_SORTS)[number];

const STORAGE_KEY = "emi-loan-sort";

export function readLoanSort(): LoanSort {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LOAN_SORTS as readonly string[]).includes(v)) return v as LoanSort;
  } catch {
    /* storage unavailable */
  }
  return "newest";
}

export function saveLoanSort(sort: LoanSort) {
  try {
    localStorage.setItem(STORAGE_KEY, sort);
  } catch {
    /* storage unavailable */
  }
}

// Amounts are only comparable within one currency, so money sorts group by currency first.
const byMoney = (pick: (l: LoanListItem) => number) => (a: LoanListItem, b: LoanListItem) =>
  a.currency.localeCompare(b.currency) || pick(b) - pick(a);

const compare: Record<LoanSort, (a: LoanListItem, b: LoanListItem) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  // Loans with nothing left to pay go last.
  nextDue: (a, b) => {
    const da = a.nextInstalment?.payableDate;
    const db = b.nextInstalment?.payableDate;
    if (!da || !db) return da ? -1 : db ? 1 : 0;
    return da.localeCompare(db);
  },
  name: (a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base", numeric: true }),
  outstanding: byMoney((l) => l.progress.principalOutstanding),
  emi: byMoney((l) => l.summary.emi),
  progress: (a, b) => b.progress.progress - a.progress.progress,
  rate: (a, b) => b.annualRate - a.annualRate,
};

/** Returns a new sorted array; ties keep the API's order (newest first). */
export function sortLoans(loans: readonly LoanListItem[], sort: LoanSort): LoanListItem[] {
  return [...loans].sort(compare[sort]);
}
