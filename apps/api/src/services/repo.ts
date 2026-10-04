import type { Card, Lender, Loan, LoanInput, Settings } from "@emi/shared";
import type { ScheduleSummary } from "@emi/core";

/* Row <-> DTO mapping. D1 returns snake_case columns; the API speaks camelCase. */

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v);
const bool = (v: unknown) => Number(v) === 1;

export function settingsFromRow(r: Row): Settings {
  return {
    country: String(r.country),
    currency: String(r.currency),
    locale: String(r.locale),
    timeZone: String(r.time_zone),
    dateFormat: String(r.date_format) as Settings["dateFormat"],
    taxLabel: String(r.tax_label) as Settings["taxLabel"],
    taxRate: num(r.tax_rate),
    theme: String(r.theme) as Settings["theme"],
    reminderHour: num(r.reminder_hour),
    dueWindowDays: num(r.due_window_days),
    reminderDaysBefore: JSON.parse(String(r.reminder_days_before)) as number[],
    remindOnDay: bool(r.remind_on_day),
    remindOverdue: bool(r.remind_overdue),
    pushEnabled: bool(r.push_enabled),
    emailReminders: bool(r.email_reminders),
    weeklySummary: bool(r.weekly_summary),
    monthlyIncome: r.monthly_income === null || r.monthly_income === undefined ? null : num(r.monthly_income),
    incomeCurrency: str(r.income_currency),
  };
}

export const SETTINGS_COLUMNS: Record<keyof Settings, string> = {
  country: "country",
  currency: "currency",
  locale: "locale",
  timeZone: "time_zone",
  dateFormat: "date_format",
  taxLabel: "tax_label",
  taxRate: "tax_rate",
  theme: "theme",
  reminderHour: "reminder_hour",
  dueWindowDays: "due_window_days",
  reminderDaysBefore: "reminder_days_before",
  remindOnDay: "remind_on_day",
  remindOverdue: "remind_overdue",
  pushEnabled: "push_enabled",
  emailReminders: "email_reminders",
  weeklySummary: "weekly_summary",
  monthlyIncome: "monthly_income",
  incomeCurrency: "income_currency",
};

export function settingsValue(key: keyof Settings, v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (key === "reminderDaysBefore") return JSON.stringify([...new Set(v as number[])].sort((a, b) => b - a));
  return v;
}

export function lenderFromRow(r: Row): Lender {
  return {
    id: String(r.id),
    name: String(r.name),
    country: String(r.country),
    color: String(r.color),
    initial: String(r.initial),
    custom: r.user_id !== null && r.user_id !== undefined,
  };
}

export function cardFromRow(r: Row): Card {
  return {
    id: String(r.id),
    nickname: String(r.nickname),
    lenderId: str(r.lender_id),
    last4: str(r.last4),
    statementDay: num(r.statement_day),
    dueDay: r.due_day === null ? null : num(r.due_day),
    graceDays: r.grace_days === null ? null : num(r.grace_days),
  };
}

export function loanInputFromRow(r: Row): LoanInput {
  return {
    lenderId: String(r.lender_id),
    cardId: str(r.card_id),
    type: String(r.type) as LoanInput["type"],
    customTypeLabel: str(r.custom_type_label) ?? undefined,
    nickname: String(r.nickname),
    currency: String(r.currency),
    principal: num(r.principal),
    annualRate: num(r.annual_rate),
    tenureMonths: num(r.tenure_months),
    repaymentType: String(r.repayment_type) as LoanInput["repaymentType"],
    bookingDate: String(r.booking_date),
    firstEmiDate: String(r.first_emi_date),
    emiDay: num(r.emi_day),
    processingFee: JSON.parse(String(r.processing_fee)),
    processingFeeTaxRate: num(r.processing_fee_tax_rate),
    feeCollection: String(r.fee_collection) as LoanInput["feeCollection"],
    taxLabel: String(r.tax_label) as LoanInput["taxLabel"],
    interestTaxEnabled: bool(r.interest_tax_enabled),
    interestTaxRate: num(r.interest_tax_rate),
    emiShift: JSON.parse(String(r.emi_shift)),
    noCostEmi: bool(r.no_cost_emi),
    holidayRule: String(r.holiday_rule) as LoanInput["holidayRule"],
    notes: str(r.notes) ?? undefined,
    muted: bool(r.muted),
  };
}

export function loanFromRow(r: Row): Loan & { summary: ScheduleSummary } {
  return {
    ...loanInputFromRow(r),
    id: String(r.id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    summary: JSON.parse(String(r.summary)) as ScheduleSummary,
  };
}

/** Column list + bound values for INSERT/UPDATE of a loan input. */
export function loanColumns(l: LoanInput): Record<string, unknown> {
  return {
    lender_id: l.lenderId,
    card_id: l.type === "credit_card_emi" ? (l.cardId ?? null) : null,
    type: l.type,
    custom_type_label: l.type === "other" ? (l.customTypeLabel ?? null) : null,
    nickname: l.nickname,
    currency: l.currency,
    principal: l.principal,
    annual_rate: l.annualRate,
    tenure_months: l.tenureMonths,
    repayment_type: l.repaymentType,
    booking_date: l.bookingDate,
    first_emi_date: l.firstEmiDate,
    emi_day: l.emiDay,
    processing_fee: JSON.stringify(l.processingFee),
    processing_fee_tax_rate: l.processingFeeTaxRate,
    fee_collection: l.feeCollection,
    tax_label: l.taxLabel,
    interest_tax_enabled: l.interestTaxEnabled ? 1 : 0,
    interest_tax_rate: l.interestTaxRate,
    emi_shift: JSON.stringify(l.emiShift),
    no_cost_emi: l.noCostEmi ? 1 : 0,
    holiday_rule: l.holidayRule,
    notes: l.notes ?? null,
    muted: l.muted ? 1 : 0,
  };
}

/** SQL literal for generated (non-user) values only: finite numbers, null, or vetted strings. */
export function sqlLiteral(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number in SQL literal");
    return String(v);
  }
  if (!/^[A-Za-z0-9:\-_.]*$/.test(v)) throw new Error(`unsafe SQL literal ${v}`);
  return `'${v}'`;
}
