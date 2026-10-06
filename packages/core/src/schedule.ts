import { addMonthsClamped, compareISO, daysBetween, isValidISODate, parseISODate, type ISODate } from "./dates";
import { effectiveToMonthly, solveMonthlyRate, xirr, type CashFlow } from "./irr";
import { assertMinor, percentOf, roundMinor, splitEvenly, sum, type Minor } from "./money";

export type RepaymentType = "reducing" | "flat";
export type ChargeCollection = "upfront" | "first_instalment";
export type DayCountBasis = 365 | 360;

export type FeeSpec =
  | { kind: "none" }
  | { kind: "flat"; amount: Minor }
  | { kind: "percent"; percent: number };

export interface EmiShiftSpec {
  enabled: boolean;
  /**
   * The date the first EMI would have fallen on without the shift. If omitted
   * ("lender aligned EMI to billing date" toggle) it is booking date + 1 month.
   * The shifted date is always the loan's firstEmiDate.
   */
  originalFirstEmiDate?: ISODate;
  dayCount?: DayCountBasis;
  /** When the shift cost is collected. Default: with the first instalment. */
  collection?: ChargeCollection;
}

export type RateChangeMode = "keep_emi" | "keep_tenure";

export interface RateChange {
  effectiveDate: ISODate;
  annualRate: number;
  /**
   * keep_emi (default): EMI unchanged, tenure grows/shrinks.
   * keep_tenure: tenure unchanged, EMI recomputed.
   * keep_emi falls back to keep_tenure if the EMI no longer covers the interest.
   */
  mode?: RateChangeMode;
}

export type PrepaymentMode = "reduce_tenure" | "reduce_emi";

export interface Prepayment {
  /** Applied right after the first instalment billed on/after this date. */
  date: ISODate;
  /** Amount prepaid in minor units; capped at the outstanding principal (foreclosure). */
  amount: Minor;
  mode: PrepaymentMode;
  /** Charge as % of the amount prepaid (part-payment / foreclosure charge). */
  chargePercent?: number;
  /** Flat charge per prepayment in minor units (added to any % charge). */
  chargeFlat?: Minor;
  /** Tax on the charge in percent (e.g. GST 18). */
  chargeTaxRate?: number;
}

export interface LoanTerms {
  currency: string;
  /** Loan amount (for no-cost EMI: the product price) in minor units. */
  principal: Minor;
  /** Annual interest rate in percent (14 => 14% p.a.). */
  annualRate: number;
  tenureMonths: number;
  repaymentType: RepaymentType;
  bookingDate: ISODate;
  firstEmiDate: ISODate;
  /** Day of month for instalments 2..n; defaults to firstEmiDate's day. Clamped to month end. */
  emiDay?: number;
  processingFee?: FeeSpec;
  /** Tax on processing fee in percent (GST 18 => 18). */
  processingFeeTaxRate?: number;
  feeCollection?: ChargeCollection;
  /** Tax on interest in percent; 0 or undefined disables it. Also applied to EMI shift interest. */
  interestTaxRate?: number;
  emiShift?: EmiShiftSpec;
  /**
   * No-cost EMI: an upfront discount equal to the total interest is given, so
   * the financed principal is price - discount and the EMIs sum to the price.
   * Tax on the interest component is still charged.
   */
  noCostEmi?: boolean;
  /** Manual EMI (principal + interest) per instalment number, 1-based. The last instalment cannot be overridden. */
  overrides?: Readonly<Record<number, Minor>>;
  /** Floating-rate changes (reducing balance only), each with its own keep-EMI / keep-tenure mode. */
  rateChanges?: readonly RateChange[];
  /** Part-prepayments / foreclosure (reducing balance only). */
  prepayments?: readonly Prepayment[];
}

export interface ScheduleRow {
  n: number;
  billedDate: ISODate;
  annualRate: number;
  opening: Minor;
  interest: Minor;
  principal: Minor;
  /** principal + interest */
  emi: Minor;
  interestTax: Minor;
  processingFee: Minor;
  processingFeeTax: Minor;
  shiftInterest: Minor;
  shiftTax: Minor;
  /** Everything due for this instalment (excludes any prepayment). */
  totalPayable: Minor;
  /** Principal prepaid right after this instalment. */
  prepayment: Minor;
  prepaymentCharge: Minor;
  prepaymentChargeTax: Minor;
  /** opening - principal - prepayment */
  closing: Minor;
  overridden: boolean;
}

export interface ScheduleSummary {
  currency: string;
  /** Regular EMI (first instalment's principal + interest, before overrides/rate changes). */
  emi: Minor;
  /** Amount actually financed (equals principal unless no-cost EMI). */
  financedPrincipal: Minor;
  totalPrincipal: Minor;
  totalInterest: Minor;
  totalInterestTax: Minor;
  noCostDiscount: Minor;
  processingFee: Minor;
  processingFeeTax: Minor;
  totalFees: Minor;
  shiftDays: number;
  shiftInterest: Minor;
  shiftTax: Minor;
  /** EMI shift cost = shift interest + tax on it. */
  shiftCost: Minor;
  /** Charges paid at booking (fees / shift cost collected upfront). */
  upfrontCharges: Minor;
  totalPrepaid: Minor;
  prepaymentCharges: Minor;
  prepaymentChargeTax: Minor;
  /** Number of instalments actually scheduled (changes with prepayments / keep-EMI rate changes). */
  instalments: number;
  /** Interest - discount + interest tax + fees + fee tax + shift cost + prepayment charges + their tax. */
  totalCostOfBorrowing: Minor;
  /** Everything the borrower pays: instalments, upfront charges, prepayments and their charges. */
  totalPayable: Minor;
  /** Flat loans: the equivalent reducing-balance annual rate (percent). Reducing: the contract rate. */
  equivalentReducingRate: number;
  /** IRR of all cash flows, as an effective annual rate (percent). Null if undefined. */
  effectiveAnnualRate: number | null;
  /** Same IRR expressed as nominal APR = monthly IRR x 12 (percent). */
  nominalApr: number | null;
}

export interface Schedule {
  rows: ScheduleRow[];
  summary: ScheduleSummary;
}

export class ScheduleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScheduleError";
  }
}

const MAX_TENURE = 600;

export function annuityPayment(principal: number, monthlyRate: number, n: number): number {
  if (n <= 0) return 0;
  if (monthlyRate === 0) return principal / n;
  const f = Math.pow(1 + monthlyRate, n);
  return (principal * monthlyRate * f) / (f - 1);
}

function presentValue(payment: number, monthlyRate: number, n: number): number {
  if (monthlyRate === 0) return payment * n;
  return (payment * (1 - Math.pow(1 + monthlyRate, -n))) / monthlyRate;
}

function validate(t: LoanTerms): void {
  const fail = (code: string, msg: string) => {
    throw new ScheduleError(code, msg);
  };
  assertMinor(t.principal, "principal");
  if (t.principal <= 0) fail("principal", "Principal must be positive");
  if (!Number.isInteger(t.tenureMonths) || t.tenureMonths < 1 || t.tenureMonths > MAX_TENURE)
    fail("tenure", `Tenure must be 1-${MAX_TENURE} months`);
  if (!(t.annualRate >= 0 && t.annualRate <= 100)) fail("rate", "Annual rate must be between 0 and 100");
  if (!isValidISODate(t.bookingDate)) fail("bookingDate", "Invalid booking date");
  if (!isValidISODate(t.firstEmiDate)) fail("firstEmiDate", "Invalid first EMI date");
  if (compareISO(t.firstEmiDate, t.bookingDate) < 0) fail("firstEmiDate", "First EMI date cannot be before booking date");
  if (t.emiDay !== undefined && (!Number.isInteger(t.emiDay) || t.emiDay < 1 || t.emiDay > 31))
    fail("emiDay", "EMI day must be 1-31");
  for (const r of [t.processingFeeTaxRate, t.interestTaxRate]) {
    if (r !== undefined && !(r >= 0 && r <= 100)) fail("taxRate", "Tax rate must be between 0 and 100");
  }
  const fee = t.processingFee;
  if (fee?.kind === "flat") {
    assertMinor(fee.amount, "processing fee");
    if (fee.amount < 0) fail("fee", "Processing fee cannot be negative");
  }
  if (fee?.kind === "percent" && !(fee.percent >= 0 && fee.percent <= 100)) fail("fee", "Processing fee % must be 0-100");
  for (const [k, v] of Object.entries(t.overrides ?? {})) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > t.tenureMonths) fail("override", `Override instalment ${k} is out of range`);
    if (n === t.tenureMonths) fail("override", "The last instalment is computed to close the loan and cannot be overridden");
    assertMinor(v, "override");
    if (v < 0) fail("override", "Override amount cannot be negative");
  }
  if (t.emiShift?.enabled && t.emiShift.originalFirstEmiDate && !isValidISODate(t.emiShift.originalFirstEmiDate))
    fail("emiShift", "Invalid original first EMI date");
  for (const rc of t.rateChanges ?? []) {
    if (!isValidISODate(rc.effectiveDate)) fail("rateChange", "Invalid rate change date");
    if (!(rc.annualRate >= 0 && rc.annualRate <= 100)) fail("rateChange", "Rate change must be 0-100%");
  }
  if (t.rateChanges?.length && t.repaymentType === "flat") fail("rateChange", "Rate changes apply to reducing-balance loans only");
  for (const p of t.prepayments ?? []) {
    if (!isValidISODate(p.date)) fail("prepayment", "Invalid prepayment date");
    assertMinor(p.amount, "prepayment");
    if (p.amount <= 0) fail("prepayment", "Prepayment amount must be positive");
    for (const r of [p.chargePercent, p.chargeTaxRate]) {
      if (r !== undefined && !(r >= 0 && r <= 100)) fail("prepayment", "Prepayment charge and tax must be 0-100%");
    }
    if (p.chargeFlat !== undefined) {
      assertMinor(p.chargeFlat, "prepayment charge");
      if (p.chargeFlat < 0) fail("prepayment", "Prepayment charge can't be negative");
    }
  }
  if (t.prepayments?.length && t.repaymentType === "flat") fail("prepayment", "Prepayments are supported for reducing-balance loans only");
}

/** Months needed to repay `balance` with payment `emi` at monthly rate r; Infinity if the EMI doesn't cover interest. */
export function monthsToRepay(balance: number, r: number, emi: number): number {
  if (balance <= 0) return 0;
  if (emi <= 0) return Infinity;
  if (r === 0) return Math.ceil(balance / emi - 1e-9);
  const x = 1 - (balance * r) / emi;
  if (x <= 0) return Infinity;
  return Math.max(1, Math.ceil(-Math.log(x) / Math.log(1 + r) - 1e-9));
}

/** Billed date of instalment n (1-based). */
export function instalmentDate(t: Pick<LoanTerms, "firstEmiDate" | "emiDay">, n: number): ISODate {
  if (n === 1) return t.firstEmiDate;
  const day = t.emiDay ?? parseISODate(t.firstEmiDate).d;
  return addMonthsClamped(t.firstEmiDate, n - 1, day);
}

interface CoreRow {
  opening: Minor;
  interest: Minor;
  principal: Minor;
  closing: Minor;
  overridden: boolean;
  annualRate: number;
  prepayment: Minor;
  prepaymentCharge: Minor;
  prepaymentChargeTax: Minor;
}

const noPrepay = { prepayment: 0, prepaymentCharge: 0, prepaymentChargeTax: 0 };

function reducingRows(t: LoanTerms, financed: Minor, noCostTotal: Minor | null): CoreRow[] {
  const overrides = t.overrides ?? {};
  const simple = !Object.keys(overrides).length && !t.rateChanges?.length && !t.prepayments?.length;
  const changes = [...(t.rateChanges ?? [])].sort((a, b) => compareISO(a.effectiveDate, b.effectiveDate));
  const prepays = [...(t.prepayments ?? [])].sort((a, b) => compareISO(a.date, b.date));
  let changeIdx = 0;
  let prepayIdx = 0;

  // Rate changes effective on/before the first instalment simply set the starting rate.
  let rate = t.annualRate;
  const firstDate = instalmentDate(t, 1);
  while (changeIdx < changes.length && compareISO(changes[changeIdx]!.effectiveDate, firstDate) <= 0) rate = changes[changeIdx++]!.annualRate;
  let r = rate / 1200;

  // Total instalments; changes with keep-EMI rate changes and reduce-tenure prepayments.
  let planned = t.tenureMonths;
  let emi = noCostTotal !== null ? roundMinor(noCostTotal / planned) : roundMinor(annuityPayment(financed, r, planned));
  let balance = financed;
  let paidSoFar = 0;
  const rows: CoreRow[] = [];

  for (let i = 1; i <= MAX_TENURE; i++) {
    const opening = balance;
    const billed = instalmentDate(t, i);

    // Floating-rate changes effective on/before this instalment.
    while (changeIdx < changes.length && compareISO(changes[changeIdx]!.effectiveDate, billed) <= 0) {
      const c = changes[changeIdx++]!;
      rate = c.annualRate;
      r = rate / 1200;
      const k = (c.mode ?? "keep_emi") === "keep_emi" ? monthsToRepay(opening, r, emi) : Infinity;
      if (Number.isFinite(k) && i - 1 + k <= MAX_TENURE) planned = i - 1 + k;
      else emi = roundMinor(annuityPayment(opening, r, planned - i + 1));
    }

    let interest = roundMinor(opening * r);
    const isLast = i >= planned;
    let principal: Minor;
    let overridden = false;

    if (isLast) {
      principal = opening;
      // No-cost EMI: force instalments to total the product price exactly, so discount == total interest.
      if (noCostTotal !== null && simple) interest = noCostTotal - paidSoFar - opening;
    } else if (overrides[i] !== undefined) {
      principal = overrides[i]! - interest;
      overridden = true;
      if (principal > opening) {
        throw new ScheduleError(
          "override",
          `Override for instalment ${i} exceeds the outstanding balance plus interest; use a prepayment instead`,
        );
      }
    } else {
      principal = Math.min(emi - interest, opening);
    }

    let closing = opening - principal;
    paidSoFar += principal + interest;

    // Prepayments dated on/before this instalment are applied right after it.
    let prepayment = 0;
    let prepaymentCharge = 0;
    let prepaymentChargeTax = 0;
    let prepayMode: PrepaymentMode | null = null;
    while (prepayIdx < prepays.length && compareISO(prepays[prepayIdx]!.date, billed) <= 0) {
      const p = prepays[prepayIdx++]!;
      const amt = Math.min(p.amount, closing - prepayment);
      if (amt <= 0) continue;
      const charge = percentOf(amt, p.chargePercent ?? 0) + (p.chargeFlat ?? 0);
      prepayment += amt;
      prepaymentCharge += charge;
      prepaymentChargeTax += percentOf(charge, p.chargeTaxRate ?? 0);
      prepayMode = p.mode;
    }
    closing -= prepayment;

    rows.push({ opening, interest, principal, closing, overridden, annualRate: rate, prepayment, prepaymentCharge, prepaymentChargeTax });
    balance = closing;
    if (closing <= 0 || isLast) break;

    if (prepayMode === "reduce_emi") {
      emi = roundMinor(annuityPayment(closing, r, planned - i));
    } else if (prepayMode === "reduce_tenure") {
      const k = monthsToRepay(closing, r, emi);
      if (Number.isFinite(k)) planned = Math.min(planned, i + k);
    }
    // Keep tenure: after an override the remaining instalments get a fresh EMI.
    if (overridden) emi = roundMinor(annuityPayment(closing, r, planned - i));
  }
  return rows;
}

function flatRows(t: LoanTerms, financed: Minor, totalInterest: Minor): CoreRow[] {
  const n = t.tenureMonths;
  const overrides = t.overrides ?? {};
  const interestParts = splitEvenly(totalInterest, n);
  let principalPlan = splitEvenly(financed, n);
  const rows: CoreRow[] = [];
  let balance = financed;
  for (let i = 1; i <= n; i++) {
    const opening = balance;
    const interest = interestParts[i - 1]!;
    let principal: Minor;
    let overridden = false;
    if (i === n) {
      principal = opening;
    } else if (overrides[i] !== undefined) {
      principal = overrides[i]! - interest;
      overridden = true;
      if (principal > opening)
        throw new ScheduleError("override", `Override for instalment ${i} exceeds the outstanding balance plus interest`);
    } else {
      principal = principalPlan[i - 1]!;
    }
    const closing = opening - principal;
    rows.push({ opening, interest, principal, closing, overridden, annualRate: t.annualRate, ...noPrepay });
    balance = closing;
    if (overridden) {
      // Spread the remaining principal evenly across the remaining instalments.
      principalPlan = [...principalPlan.slice(0, i), ...splitEvenly(closing, n - i)];
    }
  }
  return rows;
}

export function buildSchedule(terms: LoanTerms): Schedule {
  validate(terms);
  const t = terms;
  const n = t.tenureMonths;
  const r0 = t.annualRate / 1200;
  const taxRate = t.interestTaxRate ?? 0;

  // --- Financed principal & interest model ------------------------------------------------
  let financed = t.principal;
  let noCostTotal: Minor | null = null;
  let flatInterest = 0;

  if (t.repaymentType === "flat") {
    if (t.noCostEmi && t.annualRate > 0) {
      // P' + P' * rate * years = price
      financed = roundMinor(t.principal / (1 + (t.annualRate / 100) * (n / 12)));
      flatInterest = t.principal - financed;
    } else {
      flatInterest = roundMinor(t.principal * (t.annualRate / 100) * (n / 12));
    }
  } else if (t.noCostEmi && t.annualRate > 0) {
    noCostTotal = t.principal;
    financed = roundMinor(presentValue(t.principal / n, r0, n));
  }

  const core =
    t.repaymentType === "flat" ? flatRows(t, financed, flatInterest) : reducingRows(t, financed, noCostTotal);

  // --- Charges --------------------------------------------------------------------------------
  const fee = t.processingFee ?? { kind: "none" };
  const processingFee =
    fee.kind === "flat" ? fee.amount : fee.kind === "percent" ? percentOf(t.principal, fee.percent) : 0;
  const processingFeeTax = percentOf(processingFee, t.processingFeeTaxRate ?? 0);
  const feeUpfront = (t.feeCollection ?? "upfront") === "upfront";

  let shiftDays = 0;
  let shiftInterest = 0;
  let shiftTax = 0;
  const shift = t.emiShift;
  if (shift?.enabled) {
    const original = shift.originalFirstEmiDate ?? addMonthsClamped(t.bookingDate, 1);
    shiftDays = daysBetween(original, t.firstEmiDate);
    if (shiftDays < 0) {
      throw new ScheduleError("emiShift", "The shifted first EMI date must be on or after the original first EMI date");
    }
    shiftInterest = roundMinor((financed * (t.annualRate / 100) * shiftDays) / (shift.dayCount ?? 365));
    shiftTax = percentOf(shiftInterest, taxRate);
  }
  const shiftUpfront = shift?.collection === "upfront";

  // --- Rows -----------------------------------------------------------------------------------
  const rows: ScheduleRow[] = core.map((c, idx) => {
    const first = idx === 0;
    const interestTax = percentOf(c.interest, taxRate);
    const rowFee = first && !feeUpfront ? processingFee : 0;
    const rowFeeTax = first && !feeUpfront ? processingFeeTax : 0;
    const rowShift = first && !shiftUpfront ? shiftInterest : 0;
    const rowShiftTax = first && !shiftUpfront ? shiftTax : 0;
    const emi = c.principal + c.interest;
    return {
      n: idx + 1,
      billedDate: instalmentDate(t, idx + 1),
      annualRate: c.annualRate,
      opening: c.opening,
      interest: c.interest,
      principal: c.principal,
      emi,
      interestTax,
      processingFee: rowFee,
      processingFeeTax: rowFeeTax,
      shiftInterest: rowShift,
      shiftTax: rowShiftTax,
      totalPayable: emi + interestTax + rowFee + rowFeeTax + rowShift + rowShiftTax,
      prepayment: c.prepayment,
      prepaymentCharge: c.prepaymentCharge,
      prepaymentChargeTax: c.prepaymentChargeTax,
      closing: c.closing,
      overridden: c.overridden,
    };
  });

  // --- Summary --------------------------------------------------------------------------------
  const totalInterest = sum(rows.map((x) => x.interest));
  const totalInterestTax = sum(rows.map((x) => x.interestTax));
  const noCostDiscount = t.principal - financed;
  const totalFees = processingFee + processingFeeTax;
  const shiftCost = shiftInterest + shiftTax;
  const upfrontCharges = (feeUpfront ? totalFees : 0) + (shiftUpfront ? shiftCost : 0);
  const totalPrepaid = sum(rows.map((x) => x.prepayment));
  const prepaymentCharges = sum(rows.map((x) => x.prepaymentCharge));
  const prepaymentChargeTax = sum(rows.map((x) => x.prepaymentChargeTax));
  const totalPayable =
    sum(rows.map((x) => x.totalPayable)) + upfrontCharges + totalPrepaid + prepaymentCharges + prepaymentChargeTax;
  const totalCostOfBorrowing =
    totalInterest - noCostDiscount + totalInterestTax + totalFees + shiftCost + prepaymentCharges + prepaymentChargeTax;

  let equivalentReducingRate = t.annualRate;
  if (t.repaymentType === "flat" && flatInterest > 0) {
    equivalentReducingRate = solveMonthlyRate(financed, (financed + flatInterest) / n, n) * 1200;
  }

  // Borrower receives the principal (the product, for no-cost EMI) at booking, pays upfront
  // charges at booking, then every instalment on its billed date.
  const flows: CashFlow[] = [{ date: t.bookingDate, amount: t.principal - upfrontCharges }];
  for (const row of rows) {
    flows.push({ date: row.billedDate, amount: -(row.totalPayable + row.prepayment + row.prepaymentCharge + row.prepaymentChargeTax) });
  }
  const eff = totalCostOfBorrowing === 0 ? 0 : xirr(flows);

  return {
    rows,
    summary: {
      currency: t.currency,
      emi: rows[0]!.emi,
      financedPrincipal: financed,
      totalPrincipal: sum(rows.map((x) => x.principal + x.prepayment)),
      totalInterest,
      totalInterestTax,
      noCostDiscount,
      processingFee,
      processingFeeTax,
      totalFees,
      shiftDays,
      shiftInterest,
      shiftTax,
      shiftCost,
      upfrontCharges,
      totalPrepaid,
      prepaymentCharges,
      prepaymentChargeTax,
      instalments: rows.length,
      totalCostOfBorrowing,
      totalPayable,
      equivalentReducingRate,
      effectiveAnnualRate: eff === null ? null : eff * 100,
      nominalApr: eff === null ? null : effectiveToMonthly(eff) * 1200,
    },
  };
}
