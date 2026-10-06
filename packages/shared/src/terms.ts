import type { LoanTerms, RateChange } from "@emi/core";
import type { LoanInput } from "./schemas";

/** Map a validated loan input onto calculation-engine terms. Used by both API and web preview. */
export function toLoanTerms(
  l: LoanInput,
  extras: { overrides?: Record<number, number>; rateChanges?: RateChange[] } = {},
): LoanTerms {
  return {
    currency: l.currency,
    principal: l.principal,
    annualRate: l.annualRate,
    tenureMonths: l.tenureMonths,
    repaymentType: l.repaymentType,
    bookingDate: l.bookingDate,
    firstEmiDate: l.firstEmiDate,
    emiDay: l.emiDay,
    processingFee: l.processingFee,
    processingFeeTaxRate: l.processingFeeTaxRate,
    feeCollection: l.feeCollection,
    interestTaxRate: l.interestTaxEnabled ? l.interestTaxRate : 0,
    emiShift: l.emiShift.enabled
      ? {
          enabled: true,
          originalFirstEmiDate: l.emiShift.originalFirstEmiDate ?? undefined,
          dayCount: l.emiShift.dayCount,
          collection: l.emiShift.collection,
        }
      : undefined,
    noCostEmi: l.noCostEmi,
    overrides: extras.overrides,
    rateChanges: extras.rateChanges,
  };
}

/** A loan's saved pre-closure charge as prepayment-engine inputs. */
export function prepaymentChargeOf(l: Pick<LoanInput, "prepaymentCharge" | "prepaymentChargeTaxRate">): {
  chargePercent: number;
  chargeFlat: number;
  chargeTaxRate: number;
} {
  const c = l.prepaymentCharge;
  return {
    chargePercent: c.kind === "percent" ? c.percent : 0,
    chargeFlat: c.kind === "flat" ? c.amount : 0,
    chargeTaxRate: c.kind === "none" ? 0 : l.prepaymentChargeTaxRate,
  };
}
