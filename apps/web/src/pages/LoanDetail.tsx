import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Check, Pencil, PencilLine, SkipForward, Trash2, Undo2 } from "lucide-react";
import { parseMajor, toMajorString } from "@emi/core";
import type { Instalment, LoanDetail as LoanDetailT } from "@emi/shared";
import { HttpError } from "../lib/api";
import { useFormat } from "../lib/format";
import { useDeleteLoan, useLenders, useLoan, useMuteLoan, useOverride, usePay, useSkip, useUnpay } from "../lib/queries";
import { Documents, ExportMenu, PrepaySimulator, RateChanges } from "../components/LoanExtras";
import { Dialog, ErrorState, LenderAvatar, PageHeader, ProgressBar, Section, Spinner, StatusBadge, TextField, cx } from "../components/ui";

function Stat({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className={cx("num text-right", strong && "text-lg font-bold text-primary-strong")}>{value}</dd>
    </div>
  );
}

function PayDialog({ inst, loan, onClose }: { inst: Instalment; loan: LoanDetailT; onClose: () => void }) {
  const { t } = useTranslation();
  const f = useFormat();
  const pay = usePay();
  const [paidDate, setPaidDate] = useState(f.today() < inst.payableDate ? f.today() : inst.payableDate);
  const [amount, setAmount] = useState(toMajorString(inst.totalPayable, loan.currency));
  const [lateFee, setLateFee] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await pay.mutateAsync({
        instalmentId: inst.id,
        input: {
          paidDate,
          amountPaid: parseMajor(amount, loan.currency),
          lateFee: lateFee ? parseMajor(lateFee, loan.currency) : 0,
          note: note || undefined,
        },
      });
      onClose();
    } catch (ex) {
      setError(ex instanceof RangeError ? t("form.errors.invalid_amount") : ex instanceof Error ? ex.message : t("common.errorGeneric"));
    }
  };
  return (
    <Dialog open onClose={onClose} title={`${t("schedule.markPaid")} · #${inst.n}`}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <TextField label={t("schedule.paidDate")} type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required />
        <TextField label={`${t("schedule.amountPaid")} (${loan.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <TextField label={`${t("schedule.lateFee")} (${t("common.optional")})`} inputMode="decimal" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
        <TextField label={`${t("schedule.note")} (${t("common.optional")})`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={pay.isPending}>
          {pay.isPending ? t("common.saving") : t("schedule.markPaid")}
        </button>
      </form>
    </Dialog>
  );
}

function OverrideDialog({ inst, loan, onClose }: { inst: Instalment; loan: LoanDetailT; onClose: () => void }) {
  const { t } = useTranslation();
  const override = useOverride();
  const [amount, setAmount] = useState(toMajorString(inst.emi, loan.currency));
  const [error, setError] = useState<string | null>(null);
  const run = async (value: number | null) => {
    try {
      await override.mutateAsync({ loanId: loan.id, n: inst.n, amount: value });
      onClose();
    } catch (ex) {
      setError(ex instanceof HttpError ? ex.message : ex instanceof RangeError ? t("form.errors.invalid_amount") : t("common.errorGeneric"));
    }
  };
  return (
    <Dialog open onClose={onClose} title={`${t("schedule.overrideAmount")} · #${inst.n}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            void run(parseMajor(amount, loan.currency));
          } catch {
            setError(t("form.errors.invalid_amount"));
          }
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted">{t("schedule.overrideHint")}</p>
        <TextField label={`${t("schedule.emi")} (${loan.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={override.isPending}>
            {t("common.save")}
          </button>
          {inst.overridden && (
            <button type="button" className="btn-secondary" onClick={() => void run(null)}>
              {t("schedule.clearOverride")}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function RowActions({ inst, loan, onPay, onOverride }: { inst: Instalment; loan: LoanDetailT; onPay: () => void; onOverride: () => void }) {
  const { t } = useTranslation();
  const unpay = useUnpay();
  const skip = useSkip();
  const isLast = inst.n === loan.tenureMonths;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {inst.payment ? (
        <button className="btn-ghost min-h-[36px] px-2 text-xs" onClick={() => unpay.mutate(inst.id)} disabled={unpay.isPending}>
          <Undo2 size={14} aria-hidden /> {t("schedule.markUnpaid")}
        </button>
      ) : (
        <>
          <button className="btn-primary min-h-[36px] px-3 text-xs" onClick={onPay}>
            <Check size={14} aria-hidden /> {t("schedule.markPaid")}
          </button>
          <button
            className="btn-ghost min-h-[36px] px-2 text-xs"
            onClick={() => skip.mutate({ instalmentId: inst.id, skipped: !inst.skipped })}
            aria-label={`${inst.skipped ? t("schedule.unskip") : t("schedule.skip")} #${inst.n}`}
          >
            <SkipForward size={14} aria-hidden />
            <span className="hidden xl:inline">{inst.skipped ? t("schedule.unskip") : t("schedule.skip")}</span>
          </button>
        </>
      )}
      {!isLast && (
        <button className="btn-ghost min-h-[36px] px-2 text-xs" onClick={onOverride} aria-label={`${t("schedule.overrideAmount")} #${inst.n}`}>
          <PencilLine size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function LoanDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const f = useFormat();
  const navigate = useNavigate();
  const loanQ = useLoan(id);
  const lenders = useLenders();
  const del = useDeleteLoan();
  const mute = useMuteLoan();
  const [paying, setPaying] = useState<Instalment | null>(null);
  const [overriding, setOverriding] = useState<Instalment | null>(null);

  if (loanQ.isLoading) return <Spinner />;
  if (loanQ.error || !loanQ.data) return <ErrorState error={loanQ.error} onRetry={() => void loanQ.refetch()} />;
  const loan = loanQ.data;
  const s = loan.summary;
  const m = (v: number) => f.money(v, loan.currency);
  const lender = lenders.data?.find((l) => l.id === loan.lenderId);
  const taxName = loan.taxLabel === "None" ? t("schedule.tax") : loan.taxLabel;
  const showTax = s.totalInterestTax > 0;
  const showFees = loan.instalments.some((i) => i.fees > 0 || i.shiftCost > 0);
  const showPayable = loan.instalments.some((i) => i.payableDate !== i.billedDate);

  const onDelete = async () => {
    if (!confirm(t("loans.deleteConfirm"))) return;
    await del.mutateAsync(loan.id);
    navigate("/loans");
  };

  return (
    <>
      <PageHeader
        title={loan.nickname}
        actions={
          <>
            <button className="btn-secondary" onClick={() => mute.mutate({ id: loan.id, muted: !loan.muted })} aria-pressed={loan.muted}>
              {loan.muted ? <BellOff size={16} aria-hidden /> : <Bell size={16} aria-hidden />}
              {loan.muted ? t("loans.unmute") : t("loans.mute")}
            </button>
            <Link to={`/loans/${loan.id}/edit`} className="btn-secondary">
              <Pencil size={16} aria-hidden /> {t("common.edit")}
            </Link>
            <button className="btn-danger" onClick={() => void onDelete()}>
              <Trash2 size={16} aria-hidden /> {t("common.delete")}
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Section className="lg:col-span-1">
          <div className="mb-4 flex items-center gap-3">
            <LenderAvatar lender={lender} />
            <div>
              <p className="font-semibold">{lender?.name}</p>
              <p className="text-sm text-muted">
                {loan.type === "other" ? loan.customTypeLabel : t(`loans.types.${loan.type}`)} · {t("common.perAnnum", { rate: loan.annualRate })} ·{" "}
                {t("common.months", { count: loan.tenureMonths })}
              </p>
            </div>
          </div>
          <ProgressBar value={loan.progress.progress} label={t("loans.progress", { percent: Math.round(loan.progress.progress * 100) })} />
          <p className="mt-2 text-xs text-muted">
            {t("loans.progress", { percent: Math.round(loan.progress.progress * 100) })} · {t("loans.instalmentsLeft", { count: loan.progress.instalmentsLeft })}
          </p>
          <dl className="mt-4 divide-y divide-line">
            <Stat label={t("schedule.emi")} value={m(s.emi)} strong />
            <Stat label={t("schedule.principalOutstanding")} value={m(loan.progress.principalOutstanding)} />
            <Stat label={t("schedule.interestPaid")} value={m(loan.progress.interestPaid)} />
          </dl>
        </Section>

        <Section title={t("schedule.summary")} className="lg:col-span-2">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <Stat label={t("form.principal")} value={m(loan.principal)} />
            <Stat label={t("schedule.totalInterest")} value={m(s.totalInterest)} />
            {s.noCostDiscount > 0 && <Stat label={t("schedule.noCostDiscount")} value={`−${m(s.noCostDiscount)}`} />}
            {showTax && <Stat label={t("schedule.taxOnInterest", { label: taxName })} value={m(s.totalInterestTax)} />}
            {s.totalFees > 0 && <Stat label={t("schedule.totalFees")} value={m(s.totalFees)} />}
            {s.shiftCost > 0 && <Stat label={t("schedule.shiftCost")} hint={t("schedule.shiftDetail", { days: s.shiftDays })} value={m(s.shiftCost)} />}
            <Stat label={t("schedule.totalCost")} value={m(s.totalCostOfBorrowing)} strong />
            <Stat label={t("schedule.totalPayable")} value={m(s.totalPayable)} />
            {loan.repaymentType === "flat" && <Stat label={t("schedule.equivalentRate")} value={f.percent(s.equivalentReducingRate)} />}
            {s.effectiveAnnualRate !== null && <Stat label={t("schedule.effectiveRate")} value={f.percent(s.effectiveAnnualRate)} />}
            {s.nominalApr !== null && <Stat label={t("schedule.nominalApr")} value={f.percent(s.nominalApr)} />}
          </dl>
        </Section>
      </div>

      <Section title={t("schedule.title")} className="mt-6 p-0 sm:p-0">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("schedule.title")}</caption>
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">{t("schedule.n")}</th>
                <th scope="col" className="px-3 py-2">{t("schedule.billed")}</th>
                {showPayable && <th scope="col" className="px-3 py-2">{t("schedule.payable")}</th>}
                <th scope="col" className="px-3 py-2 text-right">{t("schedule.opening")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("schedule.interest")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("schedule.principal")}</th>
                {showTax && <th scope="col" className="px-3 py-2 text-right">{taxName}</th>}
                {showFees && <th scope="col" className="px-3 py-2 text-right">{t("schedule.fees")}</th>}
                <th scope="col" className="px-3 py-2 text-right">{t("schedule.total")}</th>
                <th scope="col" className="px-3 py-2 text-right">{t("schedule.closing")}</th>
                <th scope="col" className="px-3 py-2">{t("schedule.status")}</th>
                <th scope="col" className="px-3 py-2 text-right">
                  <span className="sr-only">{t("schedule.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loan.instalments.map((i) => (
                <tr key={i.id} className={cx("border-t border-line", i.status === "overdue" && "bg-accent-soft/60", i.status === "paid" && "text-muted")}>
                  <td className="px-3 py-2 font-medium">{i.n}</td>
                  <td className="whitespace-nowrap px-3 py-2">{f.date(i.billedDate)}</td>
                  {showPayable && <td className="whitespace-nowrap px-3 py-2 font-medium">{f.date(i.payableDate)}</td>}
                  <td className="num px-3 py-2 text-right">{m(i.opening)}</td>
                  <td className="num px-3 py-2 text-right">{m(i.interest)}</td>
                  <td className="num px-3 py-2 text-right">
                    {m(i.principal)}
                    {i.overridden && (
                      <span className="ml-1 text-accent-text" title={t("schedule.overridden")} aria-label={t("schedule.overridden")}>
                        ✎
                      </span>
                    )}
                  </td>
                  {showTax && <td className="num px-3 py-2 text-right">{m(i.interestTax)}</td>}
                  {showFees && (
                    <td className="num px-3 py-2 text-right" title={i.shiftCost ? t("schedule.shiftCost") : undefined}>
                      {i.fees + i.shiftCost ? m(i.fees + i.shiftCost) : "—"}
                    </td>
                  )}
                  <td className="num px-3 py-2 text-right font-semibold">{m(i.totalPayable)}</td>
                  <td className="num px-3 py-2 text-right">{m(i.closing)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="px-3 py-2">
                    <RowActions inst={i} loan={loan} onPay={() => setPaying(i)} onOverride={() => setOverriding(i)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <ul className="divide-y divide-line md:hidden">
          {loan.instalments.map((i) => (
            <li key={i.id} className={cx("p-4", i.status === "overdue" && "bg-accent-soft/60")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    #{i.n} · {f.date(i.payableDate)}
                  </p>
                  {i.payableDate !== i.billedDate && <p className="text-xs text-muted">{t("dashboard.billedOn", { date: f.date(i.billedDate) })}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {t("schedule.principal")} {m(i.principal)} · {t("schedule.interest")} {m(i.interest)}
                    {i.interestTax > 0 && ` · ${taxName} ${m(i.interestTax)}`}
                    {i.fees + i.shiftCost > 0 && ` · ${t("schedule.fees")} ${m(i.fees + i.shiftCost)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num font-bold">{m(i.totalPayable)}</p>
                  <StatusBadge status={i.status} />
                </div>
              </div>
              <div className="mt-2">
                <RowActions inst={i} loan={loan} onPay={() => setPaying(i)} onOverride={() => setOverriding(i)} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PrepaySimulator loan={loan} />
        <div className="space-y-6">
          <ExportMenu loan={loan} lenderName={lender?.name ?? ""} />
          <Documents loan={loan} />
        </div>
        <div className="lg:col-span-2">
          <RateChanges loan={loan} />
        </div>
      </div>

      {loan.notes && (
        <Section title={t("form.notes")} className="mt-6">
          <p className="whitespace-pre-wrap text-sm">{loan.notes}</p>
        </Section>
      )}

      {paying && <PayDialog inst={paying} loan={loan} onClose={() => setPaying(null)} />}
      {overriding && <OverrideDialog inst={overriding} loan={loan} onClose={() => setOverriding(null)} />}
    </>
  );
}
