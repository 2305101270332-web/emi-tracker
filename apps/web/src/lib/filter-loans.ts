import { addDays, addMonthsClamped, daysInMonth, parseISODate } from "@emi/core";
import type { LoanListItem, LoanType } from "@emi/shared";

/**
 * Loans-tab filters. They live in the URL (?bank=…&card=…) so they survive opening a loan and
 * coming back, and an empty value means "any".
 */
export interface LoanFilters {
  q: string;
  /** Lender name (names, not ids: shared loans carry the owner's lender ids). */
  bank: string;
  /** A card id, or "none" for loans not on a card. */
  card: string;
  /** Name on card, or OWN_CARD for the user's own cards. */
  holder: string;
  type: "" | LoanType;
  due: "" | DueFilter;
  /** Inclusive next-due range for due = "range". */
  from: string;
  to: string;
  status: "" | "active" | "closed";
  split: "" | "yes" | "no";
  currency: string;
}

export const DUE_FILTERS = ["overdue", "week", "month", "nextMonth", "range"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];
export const OWN_CARD = "__own";

export const FILTER_KEYS = ["q", "bank", "card", "holder", "type", "due", "from", "to", "status", "split", "currency"] as const satisfies readonly (keyof LoanFilters)[];

export function readFilters(params: URLSearchParams): LoanFilters {
  const get = (k: keyof LoanFilters) => params.get(k) ?? "";
  const due = get("due");
  const status = get("status");
  const split = get("split");
  return {
    q: get("q"),
    bank: get("bank"),
    card: get("card"),
    holder: get("holder"),
    type: get("type") as LoanFilters["type"],
    due: (DUE_FILTERS as readonly string[]).includes(due) ? (due as DueFilter) : "",
    from: get("from"),
    to: get("to"),
    status: status === "active" || status === "closed" ? status : "",
    split: split === "yes" || split === "no" ? split : "",
    currency: get("currency"),
  };
}

/** Filters that narrow the list (the date range only counts with due = "range"). */
export function activeFilters(f: LoanFilters): (keyof LoanFilters)[] {
  return FILTER_KEYS.filter((k) => (k === "from" || k === "to" ? false : f[k] !== "" && !(k === "q" && !f.q.trim())));
}

function monthBounds(iso: string): [string, string] {
  const start = iso.slice(0, 8) + "01";
  const { y, m } = parseISODate(start);
  return [start, `${start.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, "0")}`];
}

function dueMatches(l: LoanListItem, f: LoanFilters, today: string): boolean {
  if (!f.due) return true;
  const next = l.nextInstalment;
  if (!next) return false; // closed: nothing due
  const d = next.payableDate;
  switch (f.due) {
    case "overdue":
      return next.status === "overdue";
    case "week":
      return d >= today && d <= addDays(today, 7);
    case "month": {
      const [a, b] = monthBounds(today);
      return d >= a && d <= b;
    }
    case "nextMonth": {
      const [a, b] = monthBounds(addMonthsClamped(today.slice(0, 8) + "01", 1, 1));
      return d >= a && d <= b;
    }
    case "range":
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    default:
      return true;
  }
}

export function filterLoans(loans: readonly LoanListItem[], f: LoanFilters, today: string): LoanListItem[] {
  const q = f.q.trim().toLowerCase();
  return loans.filter((l) => {
    const closed = l.progress.principalOutstanding <= 0;
    if (q && !`${l.nickname} ${l.lender?.name ?? ""} ${l.card?.nickname ?? ""} ${l.card?.holderName ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.bank && l.lender?.name !== f.bank) return false;
    if (f.card === "none" ? !!l.card : f.card && l.cardId !== f.card) return false;
    if (f.holder === OWN_CARD ? !l.card || !!l.card.holderName : f.holder && l.card?.holderName !== f.holder) return false;
    if (f.type && l.type !== f.type) return false;
    if (f.status === "active" ? closed : f.status === "closed" && !closed) return false;
    if (f.split === "yes" ? !l.splits.length : f.split === "no" && l.splits.length > 0) return false;
    if (f.currency && l.currency !== f.currency) return false;
    return dueMatches(l, f, today);
  });
}

export interface FilterOptions {
  banks: string[];
  cards: { id: string; label: string }[];
  holders: string[];
  /** Some card EMIs are on the user's own cards (no name on card). */
  ownCards: boolean;
  types: LoanType[];
  currencies: string[];
  anySplit: boolean;
}

/** Choices that actually occur in the user's loans, so no filter can only ever show nothing. */
export function filterOptions(loans: readonly LoanListItem[]): FilterOptions {
  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const cards = new Map<string, string>();
  for (const l of loans) if (l.cardId && l.card) cards.set(l.cardId, `${l.card.nickname}${l.card.last4 ? ` ••${l.card.last4}` : ""}`);
  return {
    banks: sorted(loans.flatMap((l) => (l.lender ? [l.lender.name] : []))),
    cards: [...cards].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    holders: sorted(loans.flatMap((l) => (l.card?.holderName ? [l.card.holderName] : []))),
    ownCards: loans.some((l) => l.card && !l.card.holderName),
    types: [...new Set(loans.map((l) => l.type))],
    currencies: sorted(loans.map((l) => l.currency)),
    anySplit: loans.some((l) => l.splits.length > 0),
  };
}
