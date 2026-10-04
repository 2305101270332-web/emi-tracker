import { addDays, addMonthsClamped, compareISO, isWeekend, parseISODate, withDayClamped, type ISODate } from "./dates";
import type { Minor } from "./money";

export type HolidayRule = "none" | "previous_working_day" | "next_working_day";

export interface CardCycle {
  /** Day of month the statement is generated (1-31, clamped to month end). */
  statementDay: number;
  /** Either a fixed due day of month... */
  dueDay?: number | null;
  /** ...or a number of grace days after the statement date. */
  graceDays?: number | null;
}

export interface PayableRule {
  card?: CardCycle | null;
  holidayRule?: HolidayRule;
  /** Extra non-working dates (ISO) for the holiday rule. */
  holidays?: readonly ISODate[];
  /** Weekend days, 0 = Sunday. Default Saturday + Sunday. */
  weekendDays?: readonly number[];
}

/** The statement date on which an EMI billed on `billedDate` appears: the first statement on/after it. */
export function statementDateFor(billedDate: ISODate, statementDay: number): ISODate {
  const thisMonth = withDayClamped(billedDate, statementDay);
  if (compareISO(billedDate, thisMonth) <= 0) return thisMonth;
  return addMonthsClamped(billedDate, 1, statementDay);
}

/** Card payment due date for a statement date. */
export function cardDueDate(statementDate: ISODate, card: CardCycle): ISODate {
  if (card.dueDay) {
    // First occurrence of dueDay strictly after the statement date.
    const sameMonth = withDayClamped(statementDate, card.dueDay);
    if (compareISO(sameMonth, statementDate) > 0) return sameMonth;
    return addMonthsClamped(statementDate, 1, card.dueDay);
  }
  return addDays(statementDate, card.graceDays ?? 20);
}

export function adjustForHolidays(date: ISODate, rule: PayableRule): ISODate {
  const mode = rule.holidayRule ?? "none";
  if (mode === "none") return date;
  const holidays = new Set(rule.holidays ?? []);
  const step = mode === "previous_working_day" ? -1 : 1;
  let d = date;
  for (let guard = 0; guard < 30 && (isWeekend(d, rule.weekendDays) || holidays.has(d)); guard++) d = addDays(d, step);
  return d;
}

/** Derive payable_date from billed_date. Normal loans: same date; card EMIs: the card's due date. */
export function derivePayableDate(billedDate: ISODate, rule: PayableRule = {}): ISODate {
  parseISODate(billedDate);
  const raw = rule.card ? cardDueDate(statementDateFor(billedDate, rule.card.statementDay), rule.card) : billedDate;
  return adjustForHolidays(raw, rule);
}

export interface PayableItem {
  id: string;
  loanId: string;
  cardId?: string | null;
  currency: string;
  payableDate: ISODate;
  billedDate: ISODate;
  amount: Minor;
}

export interface PayableGroup {
  key: string;
  cardId: string | null;
  payableDate: ISODate;
  currency: string;
  total: Minor;
  items: PayableItem[];
}

/**
 * Group dues into "pay by" buckets: all EMIs on one card with the same due date
 * and currency collapse into one group; non-card EMIs stay individual.
 */
export function groupPayables(items: readonly PayableItem[]): PayableGroup[] {
  const groups = new Map<string, PayableGroup>();
  for (const it of items) {
    const key = it.cardId ? `card:${it.cardId}:${it.payableDate}:${it.currency}` : `item:${it.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, cardId: it.cardId ?? null, payableDate: it.payableDate, currency: it.currency, total: 0, items: [] };
      groups.set(key, g);
    }
    g.items.push(it);
    g.total += it.amount;
  }
  return [...groups.values()].sort((a, b) => compareISO(a.payableDate, b.payableDate) || a.key.localeCompare(b.key));
}
