import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Info, TrendingDown } from "lucide-react";
import { parseMajor, planLumpSum, toMajorString, type LumpSumDebt, type LumpSumPlan, type LumpSumStrategy } from "@emi/core";
import type { LoanListItem } from "@emi/shared";
import { ErrorState, Section, SelectField, Spinner, TextField, cx } from "../components/ui";
import { useFormat } from "../lib/format";
import { useLoans, useMe } from "../lib/queries";
import { debtsFor } from "./Payoff";

const STRATEGIES: LumpSumStrategy[] = ["interest", "cashflow"];

interface ChargeDraft {
  kind: "none" | "flat" | "percent";
  /** Major units for "flat", percent for "percent". */
  value: string;
  tax: string;
}

/** A loan's saved pre-closure charge as editable strings. */
function savedCharge(l: LoanListItem, defaultTax: number): ChargeDraft {
  const c = l.prepaymentCharge;
  return {
    kind: c.kind,
    value: c.kind === "flat" ? toMajorString(c.amount, l.currency) : c.kind === "percent" ? String(c.percent) : "",
    tax: String(c.kind === "none" ? defaultTax : l.prepaymentChargeTaxRate),
  };
}

function chargeParams(d: ChargeDraft | undefined, currency: string): Pick<LumpSumDebt, "chargePercent" | "chargeFlat" | "chargeTaxRate"> {
  if (!d || d.kind === "none") return {};
  let flat = 0;
  try {
    flat = d.kind === "flat" && d.value ? Math.max(0, parseMajor(d.value, currency)) : 0;
  } catch {
    /* half-typed amount: treat as no charge */
  }
  return { chargePercent: d.kind === "percent" ? Number(d.value) || 0 : 0, chargeFlat: flat, chargeTaxRate: Number(d.tax) || 0 };
}

/** "I have spare money — which loans should I close first?" Uses the same loans as the payoff planner. */
export function ExtraCashPlanner() {
  const { t } = useTranslation();
  const f = useFormat();
  const me = useMe();
  const loans = useLoans();
  const own = useMemo(() => (loans.data ?? []).filter((l) => l.access === "owner" && l.progress.principalOutstanding > 0), [loans.data]);
  const currencies = [...new Set(own.map((l) => l.currency))].sort();
  const [currency, setCurrency] = useState<string | null>(null);
  const cur = currency && currencies.includes(currency) ? currency : (currencies.includes(f.defaultCurrency) ? f.defaultCurrency : currencies[0]) ?? f.defaultCurrency;
  const [amount, setAmount] = useState("");
  const [strategy, setStrategy] = useState<LumpSumStrategy>("interest");
  // What-if edits to each loan's saved pre-closure charge (not saved to the loan).
  const [edits, setEdits] = useState<Record<string, Partial<ChargeDraft>>>({});
  const drafts = useMemo(() => {
    const out: Record<string, ChargeDraft> = {};
    for (const l of own) out[l.id] = { ...savedCharge(l, me.data?.settings.taxRate ?? 0), ...edits[l.id] };
    return out;
  }, [own, edits, me.data?.settings.taxRate]);
  const editCharge = (id: string, patch: Partial<ChargeDraft>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  const amountMinor = useMemo(() => {
    try {
      return amount ? Math.max(0, parseMajor(amount, cur)) : 0;
    } catch {
      return 0;
    }
  }, [amount, cur]);
  const debts: LumpSumDebt[] = useMemo(() => debtsFor(own, cur).map((d) => ({ ...d, ...chargeParams(drafts[d.id], cur) })), [own, cur, drafts]);
  const plans = useMemo(
    () => (amountMinor > 0 && debts.length ? (Object.fromEntries(STRATEGIES.map((s) => [s, planLumpSum(debts, amountMinor, s)])) as Record<LumpSumStrategy, LumpSumPlan>) : null),
    [debts, amountMinor],
  );

  if (loans.isLoading) return <Spinner />;
  if (loans.error) return <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />;

  const m = (v: number) => f.money(v, cur);
  const chosen = plans?.[strategy];
  const assumptions = t("extraCash.assumptions", { returnObjects: true }) as unknown as string[];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Section>
          <p className="mb-4 text-sm text-muted">{t("extraCash.intro")}</p>
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
            <TextField label={`${t("extraCash.amount")} (${cur})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" />
            <fieldset className={currencies.length > 1 ? "" : "sm:col-span-2"}>
              <legend className="label">{t("extraCash.goal")}</legend>
              <div className="flex gap-2">
                {STRATEGIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={strategy === s}
                    onClick={() => setStrategy(s)}
                    className={strategy === s ? "btn min-h-[44px] flex-1 bg-primary px-2 text-primary-on" : "btn-secondary flex-1 px-2"}
                  >
                    {t(`extraCash.${s}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          {debts.length > 0 && (
            <details className="mt-4 rounded-xl border border-line p-3" open={debts.some((d) => (d.chargePercent ?? 0) > 0 || (d.chargeFlat ?? 0) > 0) || undefined}>
              <summary className="cursor-pointer text-sm font-semibold text-primary-strong">{t("extraCash.charges")}</summary>
              <p className="mb-3 mt-2 text-xs text-muted">{t("extraCash.chargesIntro")}</p>
              <ul className="divide-y divide-line">
                {debts.map((d) => {
                  const c = drafts[d.id]!;
                  return (
                    <li key={d.id} className="py-2">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                        <span className="font-medium">{d.label}</span>
                        <span className="num text-xs text-muted">
                          {d.annualRate}% · {m(d.balance)}
                        </span>
                      </p>
                      <div className="mt-1 grid grid-cols-[7.5rem_1fr_5.5rem] gap-2">
                        <SelectField hideLabel label={`${t("extraCash.chargeKind")} — ${d.label}`} value={c.kind} onChange={(e) => editCharge(d.id, { kind: e.target.value as ChargeDraft["kind"], value: "" })}>
                          <option value="none">{t("extraCash.none")}</option>
                          <option value="flat">{t("extraCash.flat")}</option>
                          <option value="percent">{t("extraCash.percent")}</option>
                        </SelectField>
                        {c.kind !== "none" && (
                          <>
                            <input
                              className="input"
                              inputMode="decimal"
                              aria-label={`${c.kind === "flat" ? `${t("extraCash.chargeValue")} (${cur})` : `${t("extraCash.chargeValue")} (%)`} — ${d.label}`}
                              placeholder={c.kind === "flat" ? cur : "%"}
                              value={c.value}
                              onChange={(e) => editCharge(d.id, { value: e.target.value })}
                            />
                            <input
                              className="input"
                              inputMode="decimal"
                              aria-label={`${t("extraCash.chargeTax")} — ${d.label}`}
                              title={t("extraCash.chargeTax")}
                              value={c.tax}
                              onChange={(e) => editCharge(d.id, { tax: e.target.value })}
                            />
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </Section>

        {!debts.length ? (
          <Section>
            <p className="text-sm text-muted">{t("extraCash.noLoans")}</p>
          </Section>
        ) : !plans || !chosen ? (
          <Section>
            <p className="text-sm text-muted">{t("extraCash.enterAmount")}</p>
          </Section>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {STRATEGIES.map((k) => {
                const p = plans[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStrategy(k)}
                    aria-pressed={strategy === k}
                    className={cx("card p-4 text-left", k === strategy && "ring-2 ring-primary")}
                  >
                    <p className="text-sm font-semibold text-primary-strong">{t(`extraCash.${k}`)}</p>
                    <p className="mb-2 text-xs text-muted">{t(`extraCash.${k}Desc`)}</p>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">{t("extraCash.interestSaved")}</dt>
                        <dd className="num font-semibold text-success">{m(p.interestSaved)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">{t("extraCash.emiFreed")}</dt>
                        <dd className="num font-semibold">{m(p.emiFreed)}</dd>
                      </div>
                      {p.charges > 0 && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted">{t("extraCash.netSaving")}</dt>
                          <dd className="num">{m(p.netSaving)}</dd>
                        </div>
                      )}
                    </dl>
                  </button>
                );
              })}
            </div>

            <Section title={t("extraCash.plan")}>
              {chosen.allocations.length === 0 ? (
                <p className="text-sm text-muted">{t("extraCash.nothing")}</p>
              ) : (
                <ol className="space-y-3">
                  {chosen.allocations.map((a, i) => (
                    <li key={a.id} className="flex gap-3">
                      <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-strong">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                          {a.closes ? <CheckCircle2 size={16} className="text-success" aria-hidden /> : <TrendingDown size={16} className="text-primary" aria-hidden />}
                          <Link to={`/loans/${a.id}`} className="hover:underline">
                            {a.closes ? t("extraCash.close", { loan: a.label }) : t("extraCash.prepay", { loan: a.label })}
                          </Link>
                          <span className="num font-normal text-muted">— {t("extraCash.pay", { amount: m(a.cost) })}</span>
                        </p>
                        <p className="text-sm text-muted">
                          {[
                            a.charges > 0 && t("extraCash.inclCharges", { amount: m(a.charges) }),
                            a.interestSaved > 0 && t("extraCash.savesInterest", { amount: m(a.interestSaved) }),
                            a.closes ? t("extraCash.freesEmi", { amount: m(a.emiFreed) }) : a.monthsSaved > 0 && t("extraCash.sooner", { count: a.monthsSaved }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {chosen.leftover > 0 && chosen.allocations.length > 0 && (
                <p className="mt-4 flex gap-2 rounded-xl bg-primary-soft/50 p-3 text-sm">
                  <Info size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                  <span>
                    <strong className="num">
                      {t("extraCash.leftover")}: {m(chosen.leftover)}
                    </strong>{" "}
                    — {t("extraCash.leftoverNote")}
                  </span>
                </p>
              )}
            </Section>
          </>
        )}
      </div>

      <Section title={t("extraCash.assumptionsTitle")} className="lg:sticky lg:top-6 lg:self-start">
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
