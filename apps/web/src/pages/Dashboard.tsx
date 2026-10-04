import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, Plus, Wallet } from "lucide-react";
import type { Dashboard as DashboardData, Lender, PayByGroup } from "@emi/shared";
import { currencyEntries, useFormat } from "../lib/format";
import { useCards, useDashboard, useLenders, useMe } from "../lib/queries";
import { ErrorState, LenderAvatar, MoneyLines, PageHeader, Section, Spinner, StatusBadge, cx } from "../components/ui";

function Tile({ label, totals, tone = "default", icon }: { label: string; totals: Record<string, number>; tone?: "default" | "accent" | "warn"; icon?: React.ReactNode }) {
  const f = useFormat();
  return (
    <div
      className={cx(
        "card p-4",
        tone === "accent" && "border-transparent bg-primary-strong text-white",
        tone === "warn" && currencyEntries(totals).length > 0 && "border-accent/50 bg-accent-soft",
      )}
    >
      <div className={cx("flex items-center gap-2 text-sm font-medium", tone === "accent" ? "text-primary-soft" : "text-muted")}>
        {icon}
        {label}
      </div>
      <MoneyLines
        entries={currencyEntries(totals)}
        money={f.money}
        className={cx("mt-2 text-xl font-bold", tone === "warn" && currencyEntries(totals).length > 0 && "text-accent-text")}
      />
    </div>
  );
}

function Breakdown({ title, data, label }: { title: string; data: Record<string, Record<string, number>>; label: (k: string) => React.ReactNode }) {
  const f = useFormat();
  // One bar list per currency so magnitudes are only compared within a currency.
  const byCurrency = new Map<string, [string, number][]>();
  for (const [k, totals] of Object.entries(data)) {
    for (const [c, v] of Object.entries(totals)) {
      if (!byCurrency.has(c)) byCurrency.set(c, []);
      byCurrency.get(c)!.push([k, v]);
    }
  }
  if (!byCurrency.size) return null;
  return (
    <Section title={title}>
      <div className="space-y-5">
        {[...byCurrency].map(([c, rows]) => {
          rows.sort((a, b) => b[1] - a[1]);
          const max = rows[0]?.[1] ?? 1;
          return (
            <div key={c}>
              {byCurrency.size > 1 && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{c}</p>}
              <ul className="space-y-3">
                {rows.map(([k, v]) => (
                  <li key={k}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 truncate">{label(k)}</span>
                      <span className="num shrink-0 font-semibold">{f.money(v, c)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2" aria-hidden>
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function PayByRow({ g, cardName }: { g: PayByGroup; cardName: (id: string) => string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const first = g.items[0]!;
  const overdue = g.items.some((i) => i.status === "overdue");
  return (
    <li className={cx("flex items-center gap-3 rounded-xl border p-3", overdue ? "border-accent/60 bg-accent-soft" : "border-line")}>
      <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-primary-soft py-1 text-primary-strong">
        <span className="text-lg font-bold leading-tight">{g.payableDate.slice(8)}</span>
        <span className="text-[11px] uppercase">{f.monthShort(g.payableDate)}</span>
      </div>
      <div className="min-w-0 flex-1">
        {g.cardId && g.items.length > 1 ? (
          <p className="truncate font-medium">{t("dashboard.cardGroup", { count: g.items.length, card: cardName(g.cardId) })}</p>
        ) : (
          <Link to={`/loans/${first.loanId}`} className="truncate font-medium hover:underline">
            {first.loanNickname} <span className="text-muted">#{first.n}</span>
          </Link>
        )}
        <p className="text-xs text-muted">
          {t("dashboard.payBy", { date: f.date(g.payableDate) })}
          {first.billedDate !== g.payableDate && <> · {t("dashboard.billedOn", { date: f.date(first.billedDate) })}</>}
        </p>
        {g.cardId && g.items.length > 1 && (
          <ul className="mt-1 text-xs text-muted">
            {g.items.map((i) => (
              <li key={i.instalmentId}>
                <Link to={`/loans/${i.loanId}`} className="hover:underline">
                  {i.loanNickname}
                </Link>{" "}
                · {f.money(i.amount, i.currency)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="num font-bold">{f.money(g.total, g.currency)}</span>
        <StatusBadge status={overdue ? "overdue" : first.status} />
      </div>
    </li>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const me = useMe();
  const dash = useDashboard();
  const lenders = useLenders();
  const cards = useCards();

  if (dash.isLoading) return <Spinner />;
  if (dash.error) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data as DashboardData;
  const lenderById = new Map((lenders.data ?? []).map((l) => [l.id, l] as [string, Lender]));
  const cardName = (id: string) => cards.data?.find((c) => c.id === id)?.nickname ?? "";

  const firstName = me.data?.user.name.split(" ")[0] ?? "";
  const addBtn = (
    <Link to="/loans/new" className="btn-primary">
      <Plus size={18} aria-hidden /> {t("dashboard.addLoan")}
    </Link>
  );

  if (d.activeLoans === 0 && d.upcoming.length === 0) {
    return (
      <>
        <PageHeader title={t("dashboard.greeting", { name: firstName })} />
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Wallet size={40} className="text-primary" aria-hidden />
          <h2 className="text-lg font-semibold">{t("dashboard.emptyTitle")}</h2>
          <p className="max-w-sm text-muted">{t("dashboard.emptyBody")}</p>
          {addBtn}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("dashboard.greeting", { name: firstName })} actions={addBtn} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={t("dashboard.payableThisMonth")} totals={d.payableThisMonth} tone="accent" icon={<CalendarClock size={16} aria-hidden />} />
        <Tile label={t("dashboard.next7")} totals={d.next7Days} />
        <Tile label={t("dashboard.next30")} totals={d.next30Days} />
        <Tile label={t("dashboard.overdue")} totals={d.overdue} tone="warn" icon={<AlertTriangle size={16} aria-hidden />} />
        <Tile label={t("dashboard.outstanding")} totals={d.outstanding} />
      </div>
      <p className="mt-2 text-xs text-muted">{t("dashboard.perCurrencyNote")}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Section title={t("dashboard.upcoming")} className="lg:col-span-2">
          {d.upcoming.length === 0 ? (
            <p className="text-muted">{t("dashboard.nothingDue")}</p>
          ) : (
            <ul className="space-y-2">
              {d.upcoming.map((g) => (
                <PayByRow key={g.key} g={g} cardName={cardName} />
              ))}
            </ul>
          )}
          <Link to="/calendar" className="btn-ghost mt-3">
            {t("common.viewAll")}
          </Link>
        </Section>
        <div className="space-y-6">
          <Breakdown
            title={t("dashboard.byLender")}
            data={d.byLender}
            label={(id) => {
              const l = lenderById.get(id);
              return (
                <>
                  <LenderAvatar lender={l} size={22} /> <span className="truncate">{l?.name ?? id}</span>
                </>
              );
            }}
          />
          <Breakdown title={t("dashboard.byType")} data={d.byType} label={(k) => t(`loans.types.${k}`)} />
        </div>
      </div>
    </>
  );
}
