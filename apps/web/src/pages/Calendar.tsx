import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonthsClamped, dayOfWeek, daysInMonth, parseISODate } from "@emi/core";
import { duesToIcs, type UpcomingItem } from "@emi/shared";
import { api } from "../lib/api";
import { downloadBlob } from "../lib/download";
import { currencyEntries, useFormat } from "../lib/format";
import { useInstalments } from "../lib/queries";
import { ErrorState, PageHeader, Section, Spinner, StatusBadge, cx } from "../components/ui";

export function Calendar() {
  const { t, i18n } = useTranslation();
  const f = useFormat();
  const [exporting, setExporting] = useState(false);
  const exportIcs = async () => {
    setExporting(true);
    try {
      const from = f.today();
      const items = await api<UpcomingItem[]>(`/instalments?from=${from}&to=${addMonthsClamped(from, 24)}`);
      downloadBlob("emi-due-dates.ics", duesToIcs(items, { locale: f.locale, language: i18n.language, alarmDaysBefore: 1 }), "text/calendar;charset=utf-8");
    } finally {
      setExporting(false);
    }
  };
  const [month, setMonth] = useState(() => f.today().slice(0, 8) + "01");
  const [view, setView] = useState<"month" | "list">(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "list" : "month"));
  const { y, m } = parseISODate(month);
  const end = `${month.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const q = useInstalments(month, end);
  const today = f.today();

  const byDay = useMemo(() => {
    const map = new Map<string, UpcomingItem[]>();
    for (const i of q.data ?? []) {
      if (!map.has(i.payableDate)) map.set(i.payableDate, []);
      map.get(i.payableDate)!.push(i);
    }
    return map;
  }, [q.data]);

  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of q.data ?? []) if (i.status !== "skipped") out[i.currency] = (out[i.currency] ?? 0) + i.amount;
    return out;
  }, [q.data]);

  // Monday-first grid
  const lead = (dayOfWeek(month) + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth(y, m) }, (_, i) => addDays(month, i))];
  while (cells.length % 7) cells.push(null);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(f.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))),
  );

  return (
    <>
      <PageHeader
        title={t("calendar.title")}
        actions={
          <>
          <button className="btn-secondary" onClick={() => void exportIcs()} disabled={exporting}>
            <CalendarPlus size={16} aria-hidden /> {t("exporting.icsAll")}
          </button>
          <div role="group" aria-label={t("calendar.title")} className="inline-flex rounded-xl border border-line bg-surface p-1">
            {(["month", "list"] as const).map((v) => (
              <button
                key={v}
                className={cx("min-h-[36px] rounded-lg px-3 text-sm font-medium", view === v ? "bg-primary text-primary-on" : "text-muted")}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {t(`calendar.${v}`)}
              </button>
            ))}
          </div>
          </>
        }
      />
      <Section>
        <div className="mb-4 flex items-center justify-between gap-2">
          <button className="btn-ghost px-2" onClick={() => setMonth(addMonthsClamped(month, -1, 1))} aria-label={t("calendar.prev")}>
            <ChevronLeft aria-hidden />
          </button>
          <div className="text-center">
            <h2 className="text-lg font-semibold" aria-live="polite">
              {f.monthLabel(month)}
            </h2>
            <p className="num text-sm text-muted">{currencyEntries(totals).map(([c, v]) => f.money(v, c)).join(" · ")}</p>
          </div>
          <button className="btn-ghost px-2" onClick={() => setMonth(addMonthsClamped(month, 1, 1))} aria-label={t("calendar.next")}>
            <ChevronRight aria-hidden />
          </button>
        </div>

        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : view === "month" ? (
          // A real table: weekday column headers give each day cell context for screen readers.
          <table className="w-full table-fixed border-separate border-spacing-0.5 sm:border-spacing-1">
            <caption className="sr-only">{f.monthLabel(month)}</caption>
            <thead>
              <tr>
                {weekdays.map((w) => (
                  <th key={w} scope="col" className="py-1 text-center text-[11px] font-semibold uppercase text-muted sm:text-xs">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, week) => (
                <tr key={week}>
                  {cells.slice(week * 7, week * 7 + 7).map((d, idx) => {
                    const items = d ? (byDay.get(d) ?? []) : [];
                    const overdue = items.some((i) => i.status === "overdue");
                    return (
                      <td
                        key={idx}
                        className={cx(
                          "h-[84px] rounded-lg border p-0.5 align-top sm:p-1",
                          d ? "border-line" : "border-transparent",
                          d === today && "ring-2 ring-primary",
                          overdue && "bg-accent-soft",
                        )}
                      >
                        {d && (
                          <div className="text-xs font-semibold text-muted">
                            <span aria-hidden>{Number(d.slice(8))}</span>
                            <span className="sr-only">{f.date(d)}</span>
                          </div>
                        )}
                        <ul className="mt-1 space-y-1">
                          {items.slice(0, 3).map((i) => (
                            <li key={i.instalmentId}>
                              <Link
                                to={`/loans/${i.loanId}`}
                                className={cx(
                                  "block truncate rounded px-0.5 text-[10px] font-medium sm:px-1 sm:text-[11px]",
                                  i.status === "paid" ? "bg-success/15 text-success" : i.status === "overdue" ? "bg-accent text-accent-on" : "bg-primary-soft text-primary-strong",
                                )}
                                aria-label={`${i.loanNickname} #${i.n}: ${f.money(i.amount, i.currency)}, ${t(`schedule.statuses.${i.status}`)}`}
                                title={`${i.loanNickname} · ${f.money(i.amount, i.currency)}`}
                              >
                                {f.moneyShort(i.amount, i.currency)}
                              </Link>
                            </li>
                          ))}
                          {items.length > 3 && <li className="px-1 text-[11px] text-muted">+{items.length - 3}</li>}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-muted">{t("calendar.noDues")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {[...byDay].map(([day, items]) => (
              <li key={day} className="py-3">
                <h3 className={cx("mb-2 text-sm font-semibold", day === today ? "text-primary" : "text-muted")}>{f.date(day)}</h3>
                <ul className="space-y-2">
                  {items.map((i) => (
                    <li key={i.instalmentId} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/loans/${i.loanId}`} className="block truncate font-medium hover:underline">
                          {i.loanNickname} <span className="text-muted">#{i.n}</span>
                        </Link>
                        {i.billedDate !== i.payableDate && <p className="text-xs text-muted">{t("dashboard.billedOn", { date: f.date(i.billedDate) })}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="num font-semibold">{f.money(i.amount, i.currency)}</span>
                        <StatusBadge status={i.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
