import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { addMonthsClamped, parseMajor, planPayoff, type Debt, type PayoffResult, type PayoffStrategy } from "@emi/core";
import type { LoanListItem } from "@emi/shared";
import { BalanceChart } from "../components/charts";
import { ErrorState, Section, SelectField, Spinner, TextField, cx } from "../components/ui";
import { useFormat } from "../lib/format";
import { useLoans } from "../lib/queries";

/** Own, active, reducing-balance loans as payoff debts. Shared loans are never included. */
export function debtsFor(loans: LoanListItem[], currency: string): Debt[] {
  return loans
    .filter((l) => l.access === "owner" && l.currency === currency && l.repaymentType === "reducing" && l.progress.principalOutstanding > 0)
    .map((l) => ({
      id: l.id,
      label: l.nickname,
      balance: l.progress.principalOutstanding,
      annualRate: l.nextInstalment?.annualRate ?? l.annualRate,
      minPayment: l.nextInstalment?.emi ?? l.summary.emi,
      interestTaxRate: l.interestTaxEnabled ? l.interestTaxRate : 0,
    }));
}

export function Payoff() {
  const { t } = useTranslation();
  const f = useFormat();
  const loans = useLoans();
  const own = (loans.data ?? []).filter((l) => l.access === "owner" && l.progress.principalOutstanding > 0);
  const currencies = [...new Set(own.map((l) => l.currency))].sort();
  const [currency, setCurrency] = useState<string | null>(null);
  const cur = currency && currencies.includes(currency) ? currency : (currencies.includes(f.defaultCurrency) ? f.defaultCurrency : currencies[0]) ?? f.defaultCurrency;
  const [extra, setExtra] = useState("");
  const [strategy, setStrategy] = useState<Exclude<PayoffStrategy, "minimum">>("avalanche");
  const start = addMonthsClamped(f.today(), 1, 1);

  const debts = useMemo(() => debtsFor(own, cur), [own, cur]);
  const flatExcluded = own.filter((l) => l.currency === cur && l.repaymentType === "flat").length;
  const extraMinor = useMemo(() => {
    try {
      return extra ? Math.max(0, parseMajor(extra, cur)) : 0;
    } catch {
      return 0;
    }
  }, [extra, cur]);
  const plans = useMemo(() => {
    if (!debts.length) return null;
    return {
      minimum: planPayoff(debts, 0, "minimum", start),
      avalanche: planPayoff(debts, extraMinor, "avalanche", start),
      snowball: planPayoff(debts, extraMinor, "snowball", start),
    } satisfies Record<PayoffStrategy, PayoffResult>;
  }, [debts, extraMinor, start]);

  if (loans.isLoading) return <Spinner />;
  if (loans.error) return <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />;

  const m = (v: number) => f.money(v, cur);
  const duration = (months: number) => {
    const y = Math.floor(months / 12);
    const mo = months % 12;
    return [y ? t("payoff.years", { count: y }) : "", mo || !y ? t("common.months", { count: mo }) : ""].filter(Boolean).join(" ");
  };
  const chosen = plans?.[strategy];
  const assumptions = t("payoff.assumptions", { returnObjects: true }) as unknown as string[];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Section>
          <p className="mb-4 text-sm text-muted">{t("payoff.intro")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {currencies.length > 1 && (
              <SelectField label={t("payoff.currency")} value={cur} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
            )}
            <TextField label={`${t("payoff.extra")} (${cur})`} inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="0" />
            <fieldset className="sm:col-span-1">
              <legend className="label">{t("payoff.strategy")}</legend>
              <div className="flex gap-2">
                {(["avalanche", "snowball"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={strategy === s}
                    onClick={() => setStrategy(s)}
                    className={strategy === s ? "btn min-h-[44px] flex-1 bg-primary text-primary-on" : "btn-secondary flex-1"}
                  >
                    {t(`payoff.${s}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          {flatExcluded > 0 && (
            <p className="mt-3 flex gap-2 text-xs text-muted">
              <Info size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              {t("payoff.excludedFlat", { count: flatExcluded })} {t("flatRate.payoffExcluded")}
            </p>
          )}
        </Section>

        {!plans ? (
          <Section>
            <p className="text-sm text-muted">{t("payoff.noLoans")}</p>
          </Section>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["avalanche", "snowball", "minimum"] as const).map((k) => {
                const p = plans[k];
                return (
                  <div key={k} className={cx("card p-4", k === strategy && "ring-2 ring-primary")}>
                    <p className="text-sm font-semibold text-primary-strong">{t(`payoff.${k}`)}</p>
                    {k !== "minimum" && <p className="mb-2 text-xs text-muted">{t(`payoff.${k}Desc`)}</p>}
                    <dl className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">{t("payoff.debtFree")}</dt>
                        <dd className="num font-semibold">{p.capped ? "—" : duration(p.months)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">{t("payoff.totalInterest")}</dt>
                        <dd className="num">{m(p.totalInterest)}</dd>
                      </div>
                      {k !== "minimum" && !plans.minimum.capped && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted">{t("payoff.interestSaved")}</dt>
                          <dd className="num font-semibold text-success">{m(plans.minimum.totalInterest - p.totalInterest)}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                );
              })}
            </div>

            {chosen && (
              <Section title={t(`payoff.${strategy}`)}>
                {chosen.capped ? (
                  <p role="alert" className="text-sm text-danger">
                    {t("payoff.capped")}
                  </p>
                ) : (
                  <p className="mb-3 text-sm">
                    <strong>{t("payoff.debtFreeDate", { date: f.monthLabel(addMonthsClamped(start, chosen.months - 1, 1)) })}</strong>
                    {!plans.minimum.capped && plans.minimum.months > chosen.months && (
                      <span className="text-muted"> · {t("payoff.monthsSaved")}: {plans.minimum.months - chosen.months}</span>
                    )}
                  </p>
                )}
                <h3 className="mb-2 text-sm font-semibold">{t("payoff.order")}</h3>
                <ol className="mb-4 space-y-1 text-sm">
                  {chosen.payoffOrder.map((p, i) => (
                    <li key={p.id} className="flex gap-2">
                      <span className="num w-6 text-muted">{i + 1}.</span>
                      <Link to={`/loans/${p.id}`} className="font-medium hover:underline">
                        {p.label}
                      </Link>
                      <span className="text-muted">— {t("payoff.clearsIn", { month: p.month, date: f.monthLabel(p.date) })}</span>
                    </li>
                  ))}
                </ol>
                <BalanceChart
                  currency={cur}
                  label={t("charts.balanceTrend")}
                  points={chosen.balances.map((v, i) => ({ date: addMonthsClamped(start, i - 1, 1), value: v }))}
                />
              </Section>
            )}
          </>
        )}
      </div>

      <Section title={t("payoff.assumptionsTitle")} className="lg:sticky lg:top-6 lg:self-start">
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
