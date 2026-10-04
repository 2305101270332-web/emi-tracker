// ILLUSTRATIVE — not a real bank statement. Figures were produced independently of
// this engine (Python Decimal, round-half-up) to cross-check a typical Indian credit
// card EMI: GST 18% on each interest portion, ₹199 processing fee + GST billed with the
// first instalment, and the first EMI moved from 3 Jun to the 15 Jun statement date
// (12 days of extra interest + GST). Replace or add real statements when available.
import { defineStatement } from "./statement";

export default defineStatement({
  name: "Illustrative credit card EMI ₹45,000 @ 15% × 9",
  source: "Independent reference calculation (not a bank document)",
  terms: {
    currency: "INR",
    principal: 45_000_00,
    annualRate: 15,
    tenureMonths: 9,
    repaymentType: "reducing",
    bookingDate: "2025-05-03",
    firstEmiDate: "2025-06-15",
    emiDay: 15,
    interestTaxRate: 18,
    processingFee: { kind: "flat", amount: 199_00 },
    processingFeeTaxRate: 18,
    feeCollection: "first_instalment",
    emiShift: { enabled: true, dayCount: 365 },
  },
  expect: {
    summary: {
      emi: 5_317_67,
      totalInterest: 2_859_08,
      totalInterestTax: 514_65,
      processingFee: 199_00,
      processingFeeTax: 35_82,
      shiftInterest: 221_92,
      shiftTax: 39_95,
    },
    rows: [
      { n: 1, billedDate: "2025-06-15", interest: 562_50, principal: 4_755_17, interestTax: 101_25, totalPayable: 5_915_61, closing: 40_244_83 },
      { n: 2, interest: 503_06, principal: 4_814_61, interestTax: 90_55, totalPayable: 5_408_22, closing: 35_430_22 },
      { n: 9, billedDate: "2026-02-15", interest: 65_65, principal: 5_252_07, emi: 5_317_72, interestTax: 11_82, totalPayable: 5_329_54, closing: 0 },
    ],
  },
});
