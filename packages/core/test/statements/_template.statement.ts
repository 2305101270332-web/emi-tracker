// TEMPLATE — not a real loan. Files starting with "_" are skipped by the test.
// Copy to e.g. `personal-loan.statement.ts` and replace every value with the
// figures from your sanction letter / statement. Amounts are in paise (₹1 = 100).
import { defineStatement } from "./statement";

export default defineStatement({
  name: "Template",
  source: "Bank, document name and date",
  terms: {
    currency: "INR",
    principal: 100_000_00,
    annualRate: 12,
    tenureMonths: 12,
    repaymentType: "reducing",
    bookingDate: "2025-01-05",
    firstEmiDate: "2025-02-05",
    emiDay: 5,
    // Credit card EMI extras, when applicable:
    // interestTaxRate: 18,
    // processingFee: { kind: "flat", amount: 199_00 }, processingFeeTaxRate: 18, feeCollection: "first_instalment",
    // emiShift: { enabled: true, originalFirstEmiDate: "2025-02-05" },
    // noCostEmi: true,
  },
  expect: {
    summary: { emi: 8_884_88 },
    rows: [
      { n: 1, interest: 1_000_00, principal: 7_884_88, closing: 92_115_12 },
      // { n: 2, interest: ..., principal: ..., interestTax: ..., totalPayable: ..., closing: ... },
    ],
  },
});
