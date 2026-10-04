import type { Minor } from "./money";
import { buildSchedule, type LoanTerms, type Prepayment, type Schedule, type ScheduleSummary } from "./schedule";

export interface PrepaymentResult {
  before: Schedule;
  after: Schedule;
  /** Interest no longer payable. */
  interestSaved: Minor;
  /** Tax on interest no longer payable. */
  interestTaxSaved: Minor;
  /** Prepayment / foreclosure charge plus tax on it. */
  charges: Minor;
  /** interestSaved + interestTaxSaved - charges (can be negative). */
  netSaving: Minor;
  instalmentsBefore: number;
  instalmentsAfter: number;
  /** EMI on the instalment right after the prepayment, before vs after. */
  emiBefore: Minor;
  emiAfter: Minor;
  /** True when the prepayment pays the loan off. */
  foreclosed: boolean;
}

/** Compare a loan with and without an extra prepayment (on top of any already in `terms`). */
export function simulatePrepayment(terms: LoanTerms, prepayment: Prepayment): PrepaymentResult {
  const before = buildSchedule(terms);
  const after = buildSchedule({ ...terms, prepayments: [...(terms.prepayments ?? []), prepayment] });
  const idx = after.rows.findIndex((r) => r.billedDate >= prepayment.date);
  const nextIdx = idx >= 0 ? idx + 1 : after.rows.length;
  const charges =
    after.summary.prepaymentCharges + after.summary.prepaymentChargeTax - (before.summary.prepaymentCharges + before.summary.prepaymentChargeTax);
  const interestSaved = before.summary.totalInterest - after.summary.totalInterest;
  const interestTaxSaved = before.summary.totalInterestTax - after.summary.totalInterestTax;
  return {
    before,
    after,
    interestSaved,
    interestTaxSaved,
    charges,
    netSaving: interestSaved + interestTaxSaved - charges,
    instalmentsBefore: before.rows.length,
    instalmentsAfter: after.rows.length,
    emiBefore: before.rows[nextIdx]?.emi ?? 0,
    emiAfter: after.rows[nextIdx]?.emi ?? 0,
    foreclosed: (after.rows[idx]?.closing ?? 1) === 0 && after.rows.length === idx + 1,
  };
}

export interface Offer {
  label: string;
  terms: LoanTerms;
}

export interface RankedOffer {
  label: string;
  summary: ScheduleSummary;
  /** 1 = cheapest by effective annual rate (ties broken by total cost of borrowing). */
  rank: number;
  error?: string;
}

/** Rank loan offers by true cost: effective annual rate (XIRR incl. all charges). */
export function compareOffers(offers: readonly Offer[]): RankedOffer[] {
  const results = offers.map((o) => {
    try {
      return { label: o.label, summary: buildSchedule(o.terms).summary, rank: 0 } as RankedOffer;
    } catch (e) {
      return { label: o.label, summary: null as unknown as ScheduleSummary, rank: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const valid = results.filter((r) => !r.error);
  const key = (r: RankedOffer) => r.summary.effectiveAnnualRate ?? Number.POSITIVE_INFINITY;
  valid
    .slice()
    .sort((a, b) => key(a) - key(b) || a.summary.totalCostOfBorrowing - b.summary.totalCostOfBorrowing)
    .forEach((r, i) => (r.rank = i + 1));
  return results;
}
