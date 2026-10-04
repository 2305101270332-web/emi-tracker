import { formatMoney, parseISODate } from "@emi/core";
import type { DateFormat } from "./constants";

/** Format an ISO date per the user's chosen date format and locale (month names). */
export function formatDate(iso: string, format: DateFormat, locale = "en"): string {
  const { y, m, d } = parseISODate(iso);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  switch (format) {
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${y}`;
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${y}`;
    case "YYYY-MM-DD":
      return iso;
    case "DD MMM YYYY": {
      const mon = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
      return `${dd} ${mon} ${y}`;
    }
  }
}

/** Format per-currency totals, e.g. { INR: 100, USD: 5 } => "₹1.00 · $0.05". Never sums across currencies. */
export function formatTotals(totals: Record<string, number>, locale: string): string[] {
  return Object.entries(totals)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => formatMoney(v, c, locale));
}

export { formatMoney };
