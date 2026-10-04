import { useMemo } from "react";
import { formatMoney, todayInZone } from "@emi/core";
import { formatDate, type Settings } from "@emi/shared";
import { useMe } from "./queries";

const DEFAULTS: Pick<Settings, "locale" | "dateFormat" | "timeZone" | "currency"> = {
  locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
  dateFormat: "DD MMM YYYY",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  currency: "USD",
};

/** Formatting bound to the signed-in user's locale, date format and time zone. */
export function useFormat() {
  const { data } = useMe();
  const s = data?.settings ?? DEFAULTS;
  return useMemo(
    () => ({
      locale: s.locale,
      timeZone: s.timeZone,
      defaultCurrency: s.currency,
      money: (amount: number, currency: string, opts?: { compact?: boolean }) => formatMoney(amount, currency, s.locale, opts),
      date: (iso: string) => formatDate(iso, s.dateFormat, s.locale),
      shortDate: (iso: string) =>
        new Intl.DateTimeFormat(s.locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")),
      monthShort: (iso: string) =>
        new Intl.DateTimeFormat(s.locale, { month: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")),
      monthLabel: (iso: string) =>
        new Intl.DateTimeFormat(s.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z")),
      percent: (v: number, digits = 2) =>
        new Intl.NumberFormat(s.locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v) + "%",
      today: () => todayInZone(s.timeZone),
    }),
    [s.locale, s.dateFormat, s.timeZone, s.currency],
  );
}

/** Per-currency totals as [currency, amount] pairs, sorted, zeroes removed. */
export function currencyEntries(totals: Record<string, number> | undefined): [string, number][] {
  return Object.entries(totals ?? {})
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
}
