import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trophy, X } from "lucide-react";
import { addMonthsClamped, buildSchedule, compareOffers, parseMajor, type LoanTerms, type Schedule } from "@emi/core";
import { COMMON_CURRENCIES } from "@emi/shared";
import { useFormat } from "../lib/format";
import { useMe } from "../lib/queries";
import { PageHeader, Section, SelectField, TextField, Toggle, cx } from "../components/ui";
import { Payoff } from "./Payoff";
import { ExtraCashPlanner } from "./ExtraCash";

interface QuickState {
  label: string;
  currency: string;
  principal: string;
  annualRate: string;
  tenureMonths: string;
  repaymentType: "reducing" | "flat";
  feeKind: "none" | "flat" | "percent";
  fee: string;
  feeTaxRate: string;
  interestTaxRate: string;
  noCostEmi: boolean;
}

function blank(currency: string, taxRate: number, label = ""): QuickState {
  return {
    label,
    currency,
    principal: "",
    annualRate: "",
    tenureMonths: "12",
    repaymentType: "reducing",
    feeKind: "none",
    fee: "",
    feeTaxRate: String(taxRate),
    interestTaxRate: "0",
    noCostEmi: false,
  };
}

/** Form strings -> engine terms; null while incomplete/invalid. Dates are nominal (booking today, first EMI in a month). */
function toTerms(s: QuickState, today: string): LoanTerms | null {
  try {
    const principal = parseMajor(s.principal, s.currency);
    const rate = Number(s.annualRate);
    const n = Number(s.tenureMonths);
    if (!(principal > 0) || !Number.isFinite(rate) || s.annualRate.trim() === "" || !Number.isInteger(n) || n < 1) return null;
    return {
      currency: s.currency,
      principal,
      annualRate: rate,
      tenureMonths: n,
      repaymentType: s.repaymentType,
      bookingDate: today,
      firstEmiDate: addMonthsClamped(today, 1),
      processingFee:
        s.feeKind === "flat" ? { kind: "flat", amount: parseMajor(s.fee || "0", s.currency) } : s.feeKind === "percent" ? { kind: "percent", percent: Number(s.fee) || 0 } : { kind: "none" },
      processingFeeTaxRate: Number(s.feeTaxRate) || 0,
      interestTaxRate: Number(s.interestTaxRate) || 0,
      noCostEmi: s.noCostEmi,
    };
  } catch {
    return null;
  }
}

function QuickForm({ s, onChange, compact }: { s: QuickState; onChange: (s: QuickState) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const set = <K extends keyof QuickState>(k: K, v: QuickState[K]) => onChange({ ...s, [k]: v });
  return (
    <div className={cx("grid gap-3", !compact && "sm:grid-cols-2")}>
      <SelectField label={t("form.currency")} value={s.currency} onChange={(e) => set("currency", e.target.value)}>
        {[...new Set([s.currency, ...COMMON_CURRENCIES])].map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </SelectField>
      <TextField label={t("form.principal")} inputMode="decimal" value={s.principal} onChange={(e) => set("principal", e.target.value)} />
      <TextField label={t("form.annualRate")} inputMode="decimal" value={s.annualRate} onChange={(e) => set("annualRate", e.target.value)} />
      <TextField label={t("form.tenure")} inputMode="numeric" value={s.tenureMonths} onChange={(e) => set("tenureMonths", e.target.value)} />
      <SelectField label={t("form.repaymentType")} value={s.repaymentType} onChange={(e) => set("repaymentType", e.target.value as QuickState["repaymentType"])}>
        <option value="reducing">{t("form.reducing")}</option>
        <option value="flat">{t("form.flat")}</option>
      </SelectField>
      <SelectField label={t("form.processingFee")} value={s.feeKind} onChange={(e) => set("feeKind", e.target.value as QuickState["feeKind"])}>
        <option value="none">{t("form.feeNone")}</option>
        <option value="flat">{t("form.feeFlat")}</option>
        <option value="percent">{t("form.feePercent")}</option>
      </SelectField>
      {s.feeKind !== "none" && (
        <>
          <TextField label={s.feeKind === "flat" ? t("form.feeAmount") : t("form.feePercentValue")} inputMode="decimal" value={s.fee} onChange={(e) => set("fee", e.target.value)} />
          <TextField label={t("form.feeTaxRate")} inputMode="decimal" value={s.feeTaxRate} onChange={(e) => set("feeTaxRate", e.target.value)} />
        </>
      )}
      <TextField label={t("form.interestTaxRate")} inputMode="decimal" value={s.interestTaxRate} onChange={(e) => set("interestTaxRate", e.target.value)} />
      <div className={cx(!compact && "sm:col-span-2")}>
        <Toggle label={t("form.noCost")} checked={s.noCostEmi} onChange={(v) => set("noCostEmi", v)} />
      </div>
    </div>
  );
}

function SummaryList({ schedule, flat }: { schedule: Schedule; flat: boolean }) {
  const { t } = useTranslation();
  const f = useFormat();
  const s = schedule.summary;
  const m = (v: number) => f.money(v, s.currency);
  const row = (label: string, value: string, strong?: boolean) => (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("num text-right", strong && "font-bold text-primary-strong")}>{value}</dd>
    </div>
  );
  return (
    <dl className="text-sm">
      {row(t("schedule.emi"), m(s.emi), true)}
      {row(t("schedule.totalInterest"), m(s.totalInterest))}
      {s.noCostDiscount > 0 && row(t("schedule.noCostDiscount"), `−${m(s.noCostDiscount)}`)}
      {s.totalInterestTax > 0 && row(t("schedule.totalTax"), m(s.totalInterestTax))}
      {s.totalFees > 0 && row(t("schedule.totalFees"), m(s.totalFees))}
      {row(t("schedule.totalCost"), m(s.totalCostOfBorrowing), true)}
      {row(t("schedule.totalPayable"), m(s.totalPayable))}
      {flat && row(t("schedule.equivalentRate"), f.percent(s.equivalentReducingRate))}
      {s.effectiveAnnualRate !== null && row(t("schedule.effectiveRate"), f.percent(s.effectiveAnnualRate))}
      {s.nominalApr !== null && row(t("schedule.nominalApr"), f.percent(s.nominalApr))}
    </dl>
  );
}

function Calculator() {
  const { t } = useTranslation();
  const f = useFormat();
  const me = useMe();
  const [s, setS] = useState(() => blank(me.data?.settings.currency ?? f.defaultCurrency, me.data?.settings.taxRate ?? 0));
  const [showRows, setShowRows] = useState(false);
  const schedule = useMemo(() => {
    const terms = toTerms(s, f.today());
    if (!terms) return null;
    try {
      return buildSchedule(terms);
    } catch {
      return null;
    }
  }, [s, f]);
  const m = (v: number) => f.money(v, s.currency);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section className="lg:col-span-2">
        <p className="mb-4 text-sm text-muted">{t("tools.calculatorIntro")}</p>
        <QuickForm s={s} onChange={setS} />
      </Section>
      <Section title={t("schedule.summary")} className="lg:sticky lg:top-6 lg:self-start">
        {schedule ? <SummaryList schedule={schedule} flat={s.repaymentType === "flat"} /> : <p className="text-sm text-muted">—</p>}
        {schedule && (
          <button className="btn-ghost mt-3" onClick={() => setShowRows((v) => !v)} aria-expanded={showRows}>
            {showRows ? t("tools.hideSchedule") : t("tools.showSchedule")}
          </button>
        )}
      </Section>
      {schedule && showRows && (
        <Section title={t("schedule.title")} className="overflow-x-auto lg:col-span-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th scope="col" className="py-2">{t("schedule.n")}</th>
                <th scope="col" className="text-right">{t("schedule.interest")}</th>
                <th scope="col" className="text-right">{t("schedule.principal")}</th>
                <th scope="col" className="text-right">{t("schedule.tax")}</th>
                <th scope="col" className="text-right">{t("schedule.total")}</th>
                <th scope="col" className="text-right">{t("schedule.closing")}</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.map((r) => (
                <tr key={r.n} className="border-t border-line">
                  <td className="py-1.5">{r.n}</td>
                  <td className="num text-right">{m(r.interest)}</td>
                  <td className="num text-right">{m(r.principal)}</td>
                  <td className="num text-right">{m(r.interestTax)}</td>
                  <td className="num text-right font-semibold">{m(r.totalPayable)}</td>
                  <td className="num text-right">{m(r.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

function Compare() {
  const { t } = useTranslation();
  const f = useFormat();
  const me = useMe();
  const cur = me.data?.settings.currency ?? f.defaultCurrency;
  const tax = me.data?.settings.taxRate ?? 0;
  const [offers, setOffers] = useState<QuickState[]>(() => [blank(cur, tax, `${t("tools.offer", { n: 1 })}`), blank(cur, tax, `${t("tools.offer", { n: 2 })}`)]);
  const today = f.today();
  const ranked = useMemo(() => {
    const valid = offers.map((o, i) => ({ i, terms: toTerms(o, today) }));
    const results = compareOffers(valid.filter((v) => v.terms).map((v) => ({ label: String(v.i), terms: v.terms! })));
    return new Map(results.map((r) => [Number(r.label), r]));
  }, [offers, today]);

  return (
    <>
      <p className="mb-4 text-sm text-muted">{t("tools.compareIntro")}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {offers.map((o, i) => {
          const r = ranked.get(i);
          const best = r && !r.error && r.rank === 1 && ranked.size > 1;
          return (
            <section key={i} className={cx("card p-4", best && "ring-2 ring-accent")} aria-label={o.label || t("tools.offer", { n: i + 1 })}>
              <div className="mb-3 flex items-center gap-2">
                <input
                  className="input font-semibold"
                  aria-label={t("tools.offerLabel")}
                  value={o.label}
                  onChange={(e) => setOffers((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                {offers.length > 2 && (
                  <button className="btn-ghost px-2" onClick={() => setOffers((p) => p.filter((_, j) => j !== i))} aria-label={t("tools.removeOffer")}>
                    <X size={18} aria-hidden />
                  </button>
                )}
              </div>
              <QuickForm s={o} compact onChange={(next) => setOffers((p) => p.map((x, j) => (j === i ? next : x)))} />
              <div className="mt-4 border-t border-line pt-3">
                {r && !r.error ? (
                  <>
                    <p className={cx("mb-2 flex items-center gap-2 text-sm font-semibold", best ? "text-accent-text" : "text-muted")}>
                      {best && <Trophy size={16} aria-hidden />}
                      {t("tools.rank")} #{r.rank}
                      {best && ` · ${t("tools.best")}`}
                    </p>
                    <SummaryList schedule={{ rows: [], summary: r.summary }} flat={o.repaymentType === "flat"} />
                  </>
                ) : (
                  <p className="text-sm text-muted">{r?.error ? t("tools.invalid") : "—"}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {offers.length < 3 && (
        <button className="btn-secondary mt-4" onClick={() => setOffers((p) => [...p, blank(cur, tax, t("tools.offer", { n: p.length + 1 }))])}>
          <Plus size={16} aria-hidden /> {t("tools.addOffer")}
        </button>
      )}
    </>
  );
}

const TABS = ["calculator", "compare", "payoff", "extraCash"] as const;

export function Tools() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number]>("calculator");
  return (
    <>
      <PageHeader title={t("tools.title")} />
      <div role="tablist" aria-label={t("tools.title")} className="mb-5 inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {TABS.map((v) => (
          <button
            key={v}
            role="tab"
            id={`tab-${v}`}
            aria-selected={tab === v}
            aria-controls={`panel-${v}`}
            tabIndex={tab === v ? 0 : -1}
            onKeyDown={(e) => {
              const i = TABS.indexOf(v);
              const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
              if (!next) return;
              e.preventDefault();
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
            className={cx("min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium sm:px-4", tab === v ? "bg-primary text-primary-on" : "text-muted")}
            onClick={() => setTab(v)}
          >
            {t(`tools.${v}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "calculator" ? <Calculator /> : tab === "compare" ? <Compare /> : tab === "payoff" ? <Payoff /> : <ExtraCashPlanner />}
      </div>
    </>
  );
}
