import {
  addDays,
  addMonthsClamped,
  buildSchedule,
  compareISO,
  derivePayableDate,
  groupPayables,
  instalmentStatus,
  loanProgress,
  todayInZone,
  totalsByCurrency,
  totalsByKeyAndCurrency,
  type LoanProgress,
  type PayableRule,
  type ScheduleSummary,
} from "@emi/core";
import { toLoanTerms, type Card, type Dashboard, type Instalment, type LoanDetail, type LoanInput, type LoanListItem, type UpcomingItem } from "@emi/shared";
import { ApiError, notFound } from "../lib/errors";
import { chunk } from "../lib/util";
import { cardFromRow, loanFromRow, sqlLiteral } from "./repo";

type Row = Record<string, unknown>;

export async function userToday(db: D1Database, userId: string): Promise<string> {
  const s = await db.prepare("SELECT time_zone FROM settings WHERE user_id = ?").bind(userId).first<{ time_zone: string }>();
  return todayInZone(s?.time_zone ?? "UTC");
}

export async function loadCard(db: D1Database, userId: string, cardId: string | null | undefined): Promise<Card | null> {
  if (!cardId) return null;
  const r = await db.prepare("SELECT * FROM cards WHERE id = ? AND user_id = ?").bind(cardId, userId).first<Row>();
  if (!r) throw new ApiError(422, "card_not_found");
  return cardFromRow(r);
}

/**
 * Rebuild a loan's instalments from its terms, preserving manual overrides,
 * skip flags and payments (instalment ids are stable: '<loanId>:<n>').
 * Returns the summary which is cached on the loan row.
 */
export async function regenerateSchedule(
  db: D1Database,
  userId: string,
  loanId: string,
  input: LoanInput,
  card: Card | null,
): Promise<ScheduleSummary> {
  const [ov, rc] = await db.batch([
    db.prepare("SELECT n, override_amount FROM instalments WHERE loan_id = ? AND user_id = ? AND override_amount IS NOT NULL").bind(loanId, userId),
    db.prepare("SELECT effective_date, annual_rate FROM rate_changes WHERE loan_id = ? AND user_id = ?").bind(loanId, userId),
  ]);
  const overrides: Record<number, number> = {};
  for (const r of (ov!.results as Row[]) ?? []) {
    const n = Number(r.n);
    if (n < input.tenureMonths) overrides[n] = Number(r.override_amount);
  }
  const rateChanges = ((rc!.results as Row[]) ?? []).map((r) => ({
    effectiveDate: String(r.effective_date),
    annualRate: Number(r.annual_rate),
  }));

  const schedule = buildSchedule(toLoanTerms(input, { overrides, rateChanges }));
  const rule: PayableRule = {
    card: card ? { statementDay: card.statementDay, dueDay: card.dueDay, graceDays: card.graceDays } : null,
    holidayRule: input.holidayRule,
  };

  // Multi-row upserts with literal values (all generated numbers/ids/dates) keep us well
  // under D1's 100 bound-parameter and 50 queries-per-invocation limits.
  const statements: D1PreparedStatement[] = [];
  for (const part of chunk(schedule.rows, 150)) {
    const values = part
      .map((r) =>
        `(${[
          sqlLiteral(`${loanId}:${r.n}`),
          sqlLiteral(userId),
          sqlLiteral(loanId),
          r.n,
          sqlLiteral(r.billedDate),
          sqlLiteral(derivePayableDate(r.billedDate, rule)),
          r.annualRate,
          r.opening,
          r.interest,
          r.principal,
          r.emi,
          r.interestTax,
          r.processingFee + r.processingFeeTax,
          r.shiftInterest + r.shiftTax,
          r.totalPayable,
          r.closing,
        ].join(",")})`,
      )
      .join(",\n");
    statements.push(
      db.prepare(
        `INSERT INTO instalments (id, user_id, loan_id, n, billed_date, payable_date, annual_rate, opening, interest, principal, emi, interest_tax, fees, shift_cost, total_payable, closing)
         VALUES ${values}
         ON CONFLICT(id) DO UPDATE SET billed_date=excluded.billed_date, payable_date=excluded.payable_date,
           annual_rate=excluded.annual_rate, opening=excluded.opening, interest=excluded.interest,
           principal=excluded.principal, emi=excluded.emi, interest_tax=excluded.interest_tax, fees=excluded.fees,
           shift_cost=excluded.shift_cost, total_payable=excluded.total_payable, closing=excluded.closing`,
      ),
    );
  }
  statements.push(
    db.prepare("DELETE FROM payments WHERE loan_id = ? AND user_id = ? AND instalment_id IN (SELECT id FROM instalments WHERE loan_id = ? AND n > ?)").bind(loanId, userId, loanId, input.tenureMonths),
    db.prepare("DELETE FROM instalments WHERE loan_id = ? AND user_id = ? AND n > ?").bind(loanId, userId, input.tenureMonths),
    db.prepare("UPDATE loans SET summary = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?").bind(JSON.stringify(schedule.summary), loanId, userId),
  );
  await db.batch(statements);
  return schedule.summary;
}

const INSTALMENT_SELECT = `
  SELECT i.*, p.id AS payment_id, p.paid_date, p.amount_paid, p.late_fee, p.note AS payment_note
  FROM instalments i LEFT JOIN payments p ON p.instalment_id = i.id AND p.user_id = i.user_id`;

export function instalmentFromRow(r: Row, today: string): Instalment {
  const payment = r.payment_id
    ? {
        id: String(r.payment_id),
        paidDate: String(r.paid_date),
        amountPaid: Number(r.amount_paid),
        lateFee: Number(r.late_fee),
        note: r.payment_note === null ? null : String(r.payment_note),
      }
    : null;
  const payableDate = String(r.payable_date);
  return {
    id: String(r.id),
    loanId: String(r.loan_id),
    n: Number(r.n),
    billedDate: String(r.billed_date),
    payableDate,
    opening: Number(r.opening),
    interest: Number(r.interest),
    principal: Number(r.principal),
    emi: Number(r.emi),
    interestTax: Number(r.interest_tax),
    fees: Number(r.fees),
    shiftCost: Number(r.shift_cost),
    totalPayable: Number(r.total_payable),
    closing: Number(r.closing),
    overridden: r.override_amount !== null && r.override_amount !== undefined,
    skipped: Number(r.skipped) === 1,
    status: instalmentStatus({ payableDate, paidAt: payment?.paidDate ?? null, skipped: Number(r.skipped) === 1 }, today),
    payment,
  };
}

function progressFrom(instalments: Instalment[], summary: ScheduleSummary): LoanProgress {
  const p = loanProgress(instalments.map((i) => ({ ...i, paid: !!i.payment })));
  return { ...p, principalOutstanding: summary.financedPrincipal - p.principalPaid };
}

export async function getLoanDetail(db: D1Database, userId: string, loanId: string): Promise<LoanDetail> {
  const [loanRes, instRes, tzRes] = await db.batch([
    db.prepare("SELECT * FROM loans WHERE id = ? AND user_id = ?").bind(loanId, userId),
    db.prepare(`${INSTALMENT_SELECT} WHERE i.loan_id = ? AND i.user_id = ? ORDER BY i.n`).bind(loanId, userId),
    db.prepare("SELECT time_zone FROM settings WHERE user_id = ?").bind(userId),
  ]);
  const row = (loanRes!.results as Row[])[0];
  if (!row) throw notFound("loan_not_found");
  const today = todayInZone(String((tzRes!.results as Row[])[0]?.time_zone ?? "UTC"));
  const loan = loanFromRow(row);
  const instalments = (instRes!.results as Row[]).map((r) => instalmentFromRow(r, today));
  return {
    ...loan,
    instalments,
    progress: progressFrom(instalments, loan.summary),
    nextInstalment: instalments.find((i) => !i.payment && !i.skipped) ?? null,
  };
}

export async function listLoans(db: D1Database, userId: string): Promise<LoanListItem[]> {
  const [loanRes, instRes, tzRes] = await db.batch([
    db.prepare("SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC").bind(userId),
    db.prepare(`${INSTALMENT_SELECT} WHERE i.user_id = ? ORDER BY i.loan_id, i.n`).bind(userId),
    db.prepare("SELECT time_zone FROM settings WHERE user_id = ?").bind(userId),
  ]);
  const today = todayInZone(String((tzRes!.results as Row[])[0]?.time_zone ?? "UTC"));
  const byLoan = new Map<string, Instalment[]>();
  for (const r of instRes!.results as Row[]) {
    const i = instalmentFromRow(r, today);
    let list = byLoan.get(i.loanId);
    if (!list) byLoan.set(i.loanId, (list = []));
    list.push(i);
  }
  return (loanRes!.results as Row[]).map((r) => {
    const loan = loanFromRow(r);
    const inst = byLoan.get(loan.id) ?? [];
    return {
      ...loan,
      progress: progressFrom(inst, loan.summary),
      nextInstalment: inst.find((i) => !i.payment && !i.skipped) ?? null,
    };
  });
}

/** Instalments in a payable-date range (calendar / list view), across all loans. */
export async function listInstalmentsInRange(
  db: D1Database,
  userId: string,
  from: string,
  to: string,
): Promise<UpcomingItem[]> {
  const today = await userToday(db, userId);
  const res = await db
    .prepare(
      `${INSTALMENT_SELECT.replace("SELECT i.*", "SELECT i.*, l.nickname AS loan_nickname, l.lender_id, l.card_id, l.currency")}
       JOIN loans l ON l.id = i.loan_id AND l.user_id = i.user_id
       WHERE i.user_id = ? AND i.payable_date BETWEEN ? AND ? ORDER BY i.payable_date, l.nickname`,
    )
    .bind(userId, from, to)
    .all<Row>();
  return res.results.map((r) => toUpcoming(r, today));
}

function toUpcoming(r: Row, today: string): UpcomingItem {
  const i = instalmentFromRow(r, today);
  return {
    instalmentId: i.id,
    loanId: i.loanId,
    loanNickname: String(r.loan_nickname),
    lenderId: String(r.lender_id),
    cardId: r.card_id === null ? null : String(r.card_id),
    currency: String(r.currency),
    n: i.n,
    billedDate: i.billedDate,
    payableDate: i.payableDate,
    amount: i.totalPayable,
    status: i.status,
  };
}

export async function getDashboard(db: D1Database, userId: string): Promise<Dashboard> {
  const today = await userToday(db, userId);
  const monthStart = today.slice(0, 8) + "01";
  const monthEnd = addDays(addMonthsClamped(monthStart, 1), -1);
  const horizon = addDays(today, 30);
  const windowEnd = compareISO(horizon, monthEnd) > 0 ? horizon : monthEnd;

  const [dueRes, loanRes, paidRes] = await db.batch([
    db
      .prepare(
        `${INSTALMENT_SELECT.replace("SELECT i.*", "SELECT i.*, l.nickname AS loan_nickname, l.lender_id, l.card_id, l.currency")}
         JOIN loans l ON l.id = i.loan_id AND l.user_id = i.user_id
         WHERE i.user_id = ? AND i.payable_date <= ? AND (i.payable_date >= ? OR (p.id IS NULL AND i.skipped = 0))
         ORDER BY i.payable_date`,
      )
      .bind(userId, windowEnd, monthStart),
    db.prepare("SELECT id, lender_id, type, currency, summary FROM loans WHERE user_id = ?").bind(userId),
    db
      .prepare(
        `SELECT i.loan_id, SUM(i.principal) AS principal_paid FROM instalments i
         JOIN payments p ON p.instalment_id = i.id AND p.user_id = i.user_id
         WHERE i.user_id = ? GROUP BY i.loan_id`,
      )
      .bind(userId),
  ]);

  const items = (dueRes!.results as Row[]).map((r) => toUpcoming(r, today));
  const unpaid = items.filter((i) => i.status !== "paid" && i.status !== "skipped");
  const inMonth = items.filter((i) => i.payableDate >= monthStart && i.payableDate <= monthEnd);
  const amount = (i: UpcomingItem) => i.amount;
  const cur = (i: UpcomingItem) => i.currency;

  const principalPaid = new Map<string, number>();
  for (const r of paidRes!.results as Row[]) principalPaid.set(String(r.loan_id), Number(r.principal_paid));
  const loans = (loanRes!.results as Row[]).map((r) => {
    const summary = JSON.parse(String(r.summary)) as ScheduleSummary;
    return {
      lenderId: String(r.lender_id),
      type: String(r.type),
      currency: String(r.currency),
      outstanding: summary.financedPrincipal - (principalPaid.get(String(r.id)) ?? 0),
    };
  });
  const active = loans.filter((l) => l.outstanding > 0);

  return {
    today,
    payableThisMonth: totalsByCurrency(inMonth.filter((i) => i.status !== "skipped"), cur, amount),
    next7Days: totalsByCurrency(unpaid.filter((i) => i.payableDate >= today && i.payableDate <= addDays(today, 7)), cur, amount),
    next30Days: totalsByCurrency(unpaid.filter((i) => i.payableDate >= today && i.payableDate <= horizon), cur, amount),
    overdue: totalsByCurrency(unpaid.filter((i) => i.status === "overdue"), cur, amount),
    outstanding: totalsByCurrency(active, (l) => l.currency, (l) => l.outstanding),
    byLender: totalsByKeyAndCurrency(active, (l) => l.lenderId, (l) => l.currency, (l) => l.outstanding),
    byType: totalsByKeyAndCurrency(active, (l) => l.type, (l) => l.currency, (l) => l.outstanding),
    upcoming: groupPayables(
      unpaid
        .filter((i) => i.payableDate <= horizon)
        .map((i) => ({ ...i, id: i.instalmentId })),
    ).map((g) => ({ ...g, items: g.items as unknown as UpcomingItem[] })),
    activeLoans: active.length,
  };
}
