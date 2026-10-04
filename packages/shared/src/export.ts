import { addDays, formatMoney, toMajorString } from "@emi/core";
import type { Instalment, LoanDetail, UpcomingItem } from "./api-types";
import { createTranslator } from "./i18n";

// ---- CSV ------------------------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = String(v);
  // Quote when needed; prefix formula-like text so spreadsheets don't execute it (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Amortisation schedule as CSV. Amounts are plain decimals in major units ("1234.56"),
 * not locale-formatted, so spreadsheets read them as numbers.
 */
export function scheduleToCsv(loan: Pick<LoanDetail, "currency" | "nickname" | "taxLabel">, instalments: readonly Instalment[], language = "en"): string {
  const t = createTranslator(language);
  const m = (v: number) => toMajorString(v, loan.currency);
  const header = [
    t("schedule.n"),
    t("schedule.billed"),
    t("schedule.payable"),
    `${t("schedule.opening")} (${loan.currency})`,
    `${t("schedule.interest")} (${loan.currency})`,
    `${t("schedule.principal")} (${loan.currency})`,
    `${loan.taxLabel === "None" ? t("schedule.tax") : loan.taxLabel} (${loan.currency})`,
    `${t("schedule.fees")} (${loan.currency})`,
    `${t("schedule.shiftCost")} (${loan.currency})`,
    `${t("schedule.total")} (${loan.currency})`,
    `${t("schedule.closing")} (${loan.currency})`,
    t("schedule.status"),
    t("schedule.paidDate"),
    `${t("schedule.amountPaid")} (${loan.currency})`,
  ];
  const lines = instalments.map((i) =>
    [
      i.n,
      i.billedDate,
      i.payableDate,
      m(i.opening),
      m(i.interest),
      m(i.principal),
      m(i.interestTax),
      m(i.fees),
      m(i.shiftCost),
      m(i.totalPayable),
      m(i.closing),
      t(`schedule.statuses.${i.status}`),
      i.payment?.paidDate ?? "",
      i.payment ? m(i.payment.amountPaid) : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

// ---- iCalendar (.ics) ---------------------------------------------------------------------------

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines to 75 octets as RFC 5545 requires (UTF-8 aware). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export interface IcsOptions {
  locale: string;
  language?: string;
  /** Minutes before 09:00 local on the due date... we use an all-day event with a day-before alarm. */
  alarmDaysBefore?: number;
  now?: Date;
}

/** Due dates as an all-day .ics calendar (one event per instalment, on its payable date). */
export function duesToIcs(items: readonly UpcomingItem[], opts: IcsOptions): string {
  const t = createTranslator(opts.language ?? "en");
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const d = (iso: string) => iso.replace(/-/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EMI Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(t("common.appName"))}`,
  ];
  for (const i of items) {
    if (i.status === "paid" || i.status === "skipped") continue;
    const amount = formatMoney(i.amount, i.currency, opts.locale);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${i.instalmentId.replace(/[^A-Za-z0-9:\-_.]/g, "")}@emi-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d(i.payableDate)}`,
      `DTEND;VALUE=DATE:${d(addDays(i.payableDate, 1))}`,
      `SUMMARY:${icsEscape(`${i.loanNickname} #${i.n}: ${amount}`)}`,
      `DESCRIPTION:${icsEscape(`${t("dashboard.payBy", { date: i.payableDate })}. ${t("dashboard.billedOn", { date: i.billedDate })}.`)}`,
      "TRANSP:TRANSPARENT",
    );
    if (opts.alarmDaysBefore !== undefined) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(`${i.loanNickname}: ${amount}`)}`, `TRIGGER:-P${opts.alarmDaysBefore}D`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
