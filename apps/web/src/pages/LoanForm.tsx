import { useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { buildSchedule, currencyFractionDigits, parseISODate, parseMajor, toMajorString } from "@emi/core";
import {
  COMMON_CURRENCIES,
  COUNTRIES,
  LOAN_TYPES,
  TAX_LABELS,
  loanInputSchema,
  toLoanTerms,
  type Loan,
  type LoanDetail,
  type LoanInputRaw,
  type LoanType,
  type Settings,
} from "@emi/shared";
import { HttpError, errorMessage } from "../lib/api";
import { useFormat } from "../lib/format";
import { useAddLender, useCards, useLenders, useLoan, useMe, useSaveLoan } from "../lib/queries";
import { Dialog, ErrorState, PageHeader, Section, SelectField, Spinner, TextField, Toggle } from "../components/ui";

interface FormState {
  lenderId: string;
  type: LoanType;
  customTypeLabel: string;
  nickname: string;
  cardId: string;
  currency: string;
  principal: string;
  annualRate: string;
  tenureMonths: string;
  repaymentType: "reducing" | "flat";
  bookingDate: string;
  firstEmiDate: string;
  emiDay: string;
  holidayRule: "none" | "previous_working_day" | "next_working_day";
  feeKind: "none" | "flat" | "percent";
  feeAmount: string;
  feePercent: string;
  feeTaxRate: string;
  feeCollection: "upfront" | "first_instalment";
  taxLabel: (typeof TAX_LABELS)[number];
  interestTaxEnabled: boolean;
  interestTaxRate: string;
  noCostEmi: boolean;
  shiftEnabled: boolean;
  shiftOriginal: string;
  shiftDayCount: "365" | "360";
  shiftCollection: "upfront" | "first_instalment";
  notes: string;
  muted: boolean;
}

function initialState(settings: Settings | undefined, loan: Loan | undefined, today: string): FormState {
  if (loan) {
    return {
      lenderId: loan.lenderId,
      type: loan.type,
      customTypeLabel: loan.customTypeLabel ?? "",
      nickname: loan.nickname,
      cardId: loan.cardId ?? "",
      currency: loan.currency,
      principal: toMajorString(loan.principal, loan.currency),
      annualRate: String(loan.annualRate),
      tenureMonths: String(loan.tenureMonths),
      repaymentType: loan.repaymentType,
      bookingDate: loan.bookingDate,
      firstEmiDate: loan.firstEmiDate,
      emiDay: String(loan.emiDay),
      holidayRule: loan.holidayRule,
      feeKind: loan.processingFee.kind,
      feeAmount: loan.processingFee.kind === "flat" ? toMajorString(loan.processingFee.amount, loan.currency) : "",
      feePercent: loan.processingFee.kind === "percent" ? String(loan.processingFee.percent) : "",
      feeTaxRate: String(loan.processingFeeTaxRate),
      feeCollection: loan.feeCollection,
      taxLabel: loan.taxLabel,
      interestTaxEnabled: loan.interestTaxEnabled,
      interestTaxRate: String(loan.interestTaxRate),
      noCostEmi: loan.noCostEmi,
      shiftEnabled: loan.emiShift.enabled,
      shiftOriginal: loan.emiShift.originalFirstEmiDate ?? "",
      shiftDayCount: String(loan.emiShift.dayCount) as "365" | "360",
      shiftCollection: loan.emiShift.collection,
      notes: loan.notes ?? "",
      muted: loan.muted,
    };
  }
  const first = (() => {
    const { y, m, d } = parseISODate(today);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
  })();
  const taxRate = settings?.taxRate ?? 0;
  return {
    lenderId: "",
    type: "personal",
    customTypeLabel: "",
    nickname: "",
    cardId: "",
    currency: settings?.currency ?? "INR",
    principal: "",
    annualRate: "",
    tenureMonths: "12",
    repaymentType: "reducing",
    bookingDate: today,
    firstEmiDate: first,
    emiDay: first.slice(8).replace(/^0/, ""),
    holidayRule: "none",
    feeKind: "none",
    feeAmount: "",
    feePercent: "",
    feeTaxRate: String(taxRate),
    feeCollection: "upfront",
    taxLabel: settings?.taxLabel ?? "None",
    interestTaxEnabled: false,
    interestTaxRate: String(taxRate),
    noCostEmi: false,
    shiftEnabled: false,
    shiftOriginal: "",
    shiftDayCount: "365",
    shiftCollection: "first_instalment",
    notes: "",
    muted: false,
  };
}

/** Form strings -> API input. Money is converted to integer minor units here (no float math). */
const OWNER_CARD_PLACEHOLDER = "owner-card";

function toRaw(s: FormState): LoanInputRaw {
  const money = (v: string) => {
    try {
      return parseMajor(v, s.currency);
    } catch {
      return Number.NaN;
    }
  };
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));
  return {
    lenderId: s.lenderId,
    cardId: s.type === "credit_card_emi" ? s.cardId || null : null,
    type: s.type,
    customTypeLabel: s.type === "other" ? s.customTypeLabel : undefined,
    nickname: s.nickname,
    currency: s.currency,
    principal: money(s.principal),
    annualRate: num(s.annualRate),
    tenureMonths: num(s.tenureMonths),
    repaymentType: s.repaymentType,
    bookingDate: s.bookingDate,
    firstEmiDate: s.firstEmiDate,
    emiDay: num(s.emiDay),
    holidayRule: s.holidayRule,
    processingFee:
      s.feeKind === "flat"
        ? { kind: "flat", amount: money(s.feeAmount) }
        : s.feeKind === "percent"
          ? { kind: "percent", percent: num(s.feePercent) }
          : { kind: "none" },
    processingFeeTaxRate: s.feeKind === "none" ? 0 : num(s.feeTaxRate || "0"),
    feeCollection: s.feeCollection,
    taxLabel: s.taxLabel,
    interestTaxEnabled: s.interestTaxEnabled,
    interestTaxRate: s.interestTaxEnabled ? num(s.interestTaxRate || "0") : 0,
    noCostEmi: s.noCostEmi,
    emiShift: {
      enabled: s.shiftEnabled,
      originalFirstEmiDate: s.shiftEnabled && s.shiftOriginal ? s.shiftOriginal : null,
      dayCount: s.shiftDayCount === "360" ? 360 : 365,
      collection: s.shiftCollection,
    },
    notes: s.notes || undefined,
    muted: s.muted,
  };
}

function AddLenderDialog({ open, onClose, onAdded, country }: { open: boolean; onClose: () => void; onAdded: (id: string) => void; country: string }) {
  const { t } = useTranslation();
  const add = useAddLender();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#8E1B1B");
  const [initial, setInitial] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const l = await add.mutateAsync({ name, country, color, initial: initial || undefined });
    onAdded(l.id);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("form.addLender")}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <TextField label={t("form.lenderName")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t("form.lenderColor")} type="color" value={color} onChange={(e) => setColor(e.target.value)} className="[&_input]:h-11 [&_input]:p-1" />
          <TextField label={t("form.lenderInitial")} value={initial} onChange={(e) => setInitial(e.target.value.slice(0, 2))} maxLength={2} />
        </div>
        <button className="btn-primary w-full" disabled={add.isPending || !name.trim()}>
          {add.isPending ? t("common.saving") : t("common.add")}
        </button>
      </form>
    </Dialog>
  );
}

export function LoanForm() {
  const { id } = useParams();
  const me = useMe();
  const existing = useLoan(id);
  if (me.isLoading || (id && existing.isLoading)) return <Spinner />;
  if (id && existing.error) return <ErrorState error={existing.error} />;
  if (existing.data && existing.data.access === "view") return <Navigate to={`/loans/${existing.data.id}`} replace />;
  return <LoanFormInner key={id ?? "new"} loan={existing.data} settings={me.data?.settings} />;
}

function LoanFormInner({ loan, settings }: { loan?: LoanDetail; settings?: Settings }) {
  const { t } = useTranslation();
  const f = useFormat();
  const navigate = useNavigate();
  const lenders = useLenders();
  const cards = useCards();
  const save = useSaveLoan();
  const isEditor = loan?.access === "edit";
  const [s, setS] = useState<FormState>(() => {
    const st = initialState(settings, loan, f.today());
    return isEditor && st.type === "credit_card_emi" ? { ...st, cardId: OWNER_CARD_PLACEHOLDER } : st;
  });
  const [emiDayTouched, setEmiDayTouched] = useState(!!loan);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lenderDialog, setLenderDialog] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));
  const err = (path: string) => (errors[path] ? t(`form.errors.${errors[path]}`, { defaultValue: errors[path] }) : undefined);

  const preview = useMemo(() => {
    const parsed = loanInputSchema.safeParse(toRaw(s));
    if (!parsed.success) return null;
    try {
      return buildSchedule(toLoanTerms(parsed.data)).summary;
    } catch {
      return null;
    }
  }, [s]);

  const lendersSorted = useMemo(() => {
    const list = [...(lenders.data ?? [])];
    const home = settings?.country;
    return list.sort((a, b) => Number(b.custom) - Number(a.custom) || Number(b.country === home) - Number(a.country === home) || a.name.localeCompare(b.name));
  }, [lenders.data, settings?.country]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = loanInputSchema.safeParse(toRaw(s));
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const key = i.path.join(".").replace(/^processingFee\.(amount|percent)$/, "processingFee");
        map[key] ??= i.code === "invalid_type" || i.message.startsWith("Number must") || i.message.startsWith("Expected") ? "required" : i.message;
      }
      setErrors(map);
      document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return;
    }
    setErrors({});
    try {
      const saved = await save.mutateAsync({ id: loan?.id, input: parsed.data });
      navigate(`/loans/${saved.id}`);
    } catch (ex) {
      // Validation issues map onto fields; engine (schedule) errors are shown translated at the form level.
      if (ex instanceof HttpError && ex.body?.error === "validation_error") setErrors({ ...ex.fieldErrors(), _form: errorMessage(t, ex) });
      else setErrors({ _form: errorMessage(t, ex) });
    }
  };

  const digits = currencyFractionDigits(s.currency);
  const moneyStep = digits ? (1 / 10 ** digits).toFixed(digits) : "1";

  return (
    <>
      <PageHeader title={loan ? t("loans.editTitle") : t("loans.newTitle")} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title={t("form.sectionBasics")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {isEditor && loan ? (
                <dl className="grid gap-3 rounded-xl bg-surface-2 p-3 text-sm sm:col-span-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">{t("form.lender")}</dt>
                    <dd className="font-medium">{loan.lender?.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("form.loanType")}</dt>
                    <dd className="font-medium">{loan.type === "other" ? loan.customTypeLabel : t(`loans.types.${loan.type}`)}</dd>
                  </div>
                </dl>
              ) : (
              <>
              <div>
                <SelectField label={t("form.lender")} value={s.lenderId} onChange={(e) => set("lenderId", e.target.value)} error={err("lenderId")} required>
                  <option value="">—</option>
                  {lendersSorted.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.country !== settings?.country && !l.custom ? ` (${l.country})` : ""}
                    </option>
                  ))}
                </SelectField>
                <button type="button" className="btn-ghost mt-1 min-h-[36px] px-2 text-xs" onClick={() => setLenderDialog(true)}>
                  <Plus size={14} aria-hidden /> {t("form.addLender")}
                </button>
              </div>
              <SelectField
                label={t("form.loanType")}
                value={s.type}
                onChange={(e) => {
                  const type = e.target.value as LoanType;
                  setS((p) => ({ ...p, type, interestTaxEnabled: type === "credit_card_emi" && Number(p.interestTaxRate) > 0 ? true : p.interestTaxEnabled }));
                }}
              >
                {LOAN_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`loans.types.${ty}`)}
                  </option>
                ))}
              </SelectField>
              {s.type === "other" && (
                <TextField label={t("form.customTypeLabel")} value={s.customTypeLabel} onChange={(e) => set("customTypeLabel", e.target.value)} error={err("customTypeLabel")} maxLength={40} />
              )}
              {s.type === "credit_card_emi" && (
                <SelectField label={t("form.card")} value={s.cardId} onChange={(e) => set("cardId", e.target.value)} error={err("cardId")} hint={cards.data?.length ? undefined : t("form.noCards")}>
                  <option value="">{t("form.selectCard")}</option>
                  {cards.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nickname}
                      {c.last4 ? ` ••${c.last4}` : ""}
                    </option>
                  ))}
                </SelectField>
              )}
              </>
              )}
              <TextField
                label={t("form.nickname")}
                placeholder={t("form.nicknamePlaceholder")}
                value={s.nickname}
                onChange={(e) => set("nickname", e.target.value)}
                error={err("nickname")}
                maxLength={80}
                className="sm:col-span-2"
              />
            </div>
          </Section>

          <Section title={t("form.sectionAmounts")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label={t("form.currency")} value={s.currency} onChange={(e) => set("currency", e.target.value)}>
                {[...new Set([s.currency, ...COMMON_CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
              <TextField
                label={s.noCostEmi ? t("form.principalNoCost") : t("form.principal")}
                inputMode="decimal"
                value={s.principal}
                onChange={(e) => set("principal", e.target.value)}
                error={err("principal")}
                step={moneyStep}
              />
              <TextField label={t("form.annualRate")} inputMode="decimal" value={s.annualRate} onChange={(e) => set("annualRate", e.target.value)} error={err("annualRate")} />
              <TextField label={t("form.tenure")} inputMode="numeric" value={s.tenureMonths} onChange={(e) => set("tenureMonths", e.target.value)} error={err("tenureMonths")} />
              <SelectField label={t("form.repaymentType")} value={s.repaymentType} onChange={(e) => set("repaymentType", e.target.value as FormState["repaymentType"])}>
                <option value="reducing">{t("form.reducing")}</option>
                <option value="flat">{t("form.flat")}</option>
              </SelectField>
              <div className="sm:col-span-2">
                <Toggle label={t("form.noCost")} hint={t("form.noCostHint")} checked={s.noCostEmi} onChange={(v) => set("noCostEmi", v)} />
              </div>
            </div>
          </Section>

          <Section title={t("form.sectionDates")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t("form.bookingDate")} type="date" value={s.bookingDate} onChange={(e) => set("bookingDate", e.target.value)} error={err("bookingDate")} />
              <TextField
                label={t("form.firstEmiDate")}
                type="date"
                value={s.firstEmiDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setS((p) => ({ ...p, firstEmiDate: v, emiDay: !emiDayTouched && v ? String(Number(v.slice(8))) : p.emiDay }));
                }}
                error={err("firstEmiDate")}
              />
              <TextField
                label={t("form.emiDay")}
                hint={t("form.emiDayHint")}
                inputMode="numeric"
                value={s.emiDay}
                onChange={(e) => {
                  setEmiDayTouched(true);
                  set("emiDay", e.target.value);
                }}
                error={err("emiDay")}
              />
              <SelectField label={t("form.holidayRule")} value={s.holidayRule} onChange={(e) => set("holidayRule", e.target.value as FormState["holidayRule"])}>
                <option value="none">{t("form.holidayNone")}</option>
                <option value="previous_working_day">{t("form.holidayPrev")}</option>
                <option value="next_working_day">{t("form.holidayNext")}</option>
              </SelectField>
            </div>
          </Section>

          <Section title={t("form.sectionCharges")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label={t("form.processingFee")} value={s.feeKind} onChange={(e) => set("feeKind", e.target.value as FormState["feeKind"])}>
                <option value="none">{t("form.feeNone")}</option>
                <option value="flat">{t("form.feeFlat")}</option>
                <option value="percent">{t("form.feePercent")}</option>
              </SelectField>
              {s.feeKind === "flat" && (
                <TextField label={t("form.feeAmount")} inputMode="decimal" value={s.feeAmount} onChange={(e) => set("feeAmount", e.target.value)} error={err("processingFee")} />
              )}
              {s.feeKind === "percent" && (
                <TextField label={t("form.feePercentValue")} inputMode="decimal" value={s.feePercent} onChange={(e) => set("feePercent", e.target.value)} error={err("processingFee")} />
              )}
              {s.feeKind !== "none" && (
                <>
                  <TextField label={t("form.feeTaxRate")} inputMode="decimal" value={s.feeTaxRate} onChange={(e) => set("feeTaxRate", e.target.value)} error={err("processingFeeTaxRate")} />
                  <SelectField label={t("form.feeCollection")} value={s.feeCollection} onChange={(e) => set("feeCollection", e.target.value as FormState["feeCollection"])}>
                    <option value="upfront">{t("form.feeUpfront")}</option>
                    <option value="first_instalment">{t("form.feeFirst")}</option>
                  </SelectField>
                </>
              )}
              <SelectField label={t("form.taxLabel")} value={s.taxLabel} onChange={(e) => set("taxLabel", e.target.value as FormState["taxLabel"])}>
                {TAX_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {l === "None" ? t("common.none") : l}
                  </option>
                ))}
              </SelectField>
              <div className="sm:col-span-2">
                <Toggle label={t("form.interestTax")} hint={t("form.interestTaxHint")} checked={s.interestTaxEnabled} onChange={(v) => set("interestTaxEnabled", v)} />
              </div>
              {s.interestTaxEnabled && (
                <TextField label={t("form.interestTaxRate")} inputMode="decimal" value={s.interestTaxRate} onChange={(e) => set("interestTaxRate", e.target.value)} error={err("interestTaxRate")} />
              )}
            </div>
          </Section>

          <Section title={t("form.sectionShift")}>
            <Toggle label={t("form.shiftEnabled")} hint={t("form.shiftHint")} checked={s.shiftEnabled} onChange={(v) => set("shiftEnabled", v)} />
            {s.shiftEnabled && (
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <TextField
                  label={t("form.shiftOriginal")}
                  hint={t("form.shiftOriginalHint")}
                  type="date"
                  value={s.shiftOriginal}
                  onChange={(e) => set("shiftOriginal", e.target.value)}
                  error={err("emiShift.originalFirstEmiDate") ?? err("emiShift")}
                />
                <SelectField label={t("form.shiftDayCount")} value={s.shiftDayCount} onChange={(e) => set("shiftDayCount", e.target.value as "365" | "360")}>
                  <option value="365">365</option>
                  <option value="360">360</option>
                </SelectField>
                <SelectField label={t("form.shiftCollection")} value={s.shiftCollection} onChange={(e) => set("shiftCollection", e.target.value as FormState["shiftCollection"])}>
                  <option value="first_instalment">{t("form.feeFirst")}</option>
                  <option value="upfront">{t("form.feeUpfront")}</option>
                </SelectField>
              </div>
            )}
          </Section>

          <Section title={t("form.sectionOther")}>
            <label htmlFor="notes" className="label">
              {t("form.notes")} <span className="font-normal text-muted">({t("common.optional")})</span>
            </label>
            <textarea id="notes" className="input min-h-[96px] py-2" value={s.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
          </Section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Section title={t("form.preview")}>
            {preview ? (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">{t("form.previewEmi")}</dt>
                  <dd className="num text-xl font-bold text-primary-strong">{f.money(preview.emi, s.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{t("schedule.totalInterest")}</dt>
                  <dd className="num">{f.money(preview.totalInterest, s.currency)}</dd>
                </div>
                {preview.noCostDiscount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("schedule.noCostDiscount")}</dt>
                    <dd className="num">−{f.money(preview.noCostDiscount, s.currency)}</dd>
                  </div>
                )}
                {preview.totalInterestTax > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("schedule.totalTax")}</dt>
                    <dd className="num">{f.money(preview.totalInterestTax, s.currency)}</dd>
                  </div>
                )}
                {preview.totalFees > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("schedule.totalFees")}</dt>
                    <dd className="num">{f.money(preview.totalFees, s.currency)}</dd>
                  </div>
                )}
                {preview.shiftCost > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("schedule.shiftCost")}</dt>
                    <dd className="num">{f.money(preview.shiftCost, s.currency)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-3 font-semibold">
                  <dt>{t("form.previewTotalCost")}</dt>
                  <dd className="num text-accent-text">{f.money(preview.totalCostOfBorrowing, s.currency)}</dd>
                </div>
                {s.repaymentType === "flat" && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("schedule.equivalentRate")}</dt>
                    <dd className="num">{f.percent(preview.equivalentReducingRate)}</dd>
                  </div>
                )}
                {preview.effectiveAnnualRate !== null && (
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("schedule.effectiveRate")}</dt>
                    <dd className="num">{f.percent(preview.effectiveAnnualRate)}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
            {errors._form && (
              <p role="alert" className="mt-4 text-sm font-medium text-danger">
                {errors._form}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button type="submit" className="btn-primary flex-1" disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("common.save")}
              </button>
              <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
                {t("common.cancel")}
              </button>
            </div>
          </Section>
        </aside>
      </form>
      <AddLenderDialog
        open={lenderDialog}
        onClose={() => setLenderDialog(false)}
        onAdded={(lid) => set("lenderId", lid)}
        country={settings?.country ?? COUNTRIES[0]!.code}
      />
    </>
  );
}
