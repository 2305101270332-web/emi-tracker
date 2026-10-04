// ILLUSTRATIVE — not a real bank statement. Figures were produced independently of
// this engine (Python Decimal, round-half-up, standard EMI formula, last instalment
// absorbs rounding) to cross-check the engine. Replace or add real statements when
// available; see _template.statement.ts.
import { defineStatement } from "./statement";

export default defineStatement({
  name: "Illustrative personal loan ₹3,00,000 @ 10.5% × 24",
  source: "Independent reference calculation (not a bank document)",
  terms: {
    currency: "INR",
    principal: 3_00_000_00,
    annualRate: 10.5,
    tenureMonths: 24,
    repaymentType: "reducing",
    bookingDate: "2025-03-10",
    firstEmiDate: "2025-04-10",
    emiDay: 10,
    processingFee: { kind: "percent", percent: 1.5 },
    processingFeeTaxRate: 18,
    feeCollection: "upfront",
  },
  expect: {
    summary: { emi: 13_912_81, totalInterest: 33_907_51, processingFee: 4_500_00, processingFeeTax: 810_00 },
    rows: [
      { n: 1, billedDate: "2025-04-10", opening: 3_00_000_00, interest: 2_625_00, principal: 11_287_81, closing: 2_88_712_19 },
      { n: 2, interest: 2_526_23, principal: 11_386_58, closing: 2_77_325_61 },
      { n: 3, interest: 2_426_60, principal: 11_486_21, closing: 2_65_839_40 },
      { n: 24, billedDate: "2027-03-10", opening: 13_792_20, interest: 120_68, principal: 13_792_20, emi: 13_912_88, closing: 0 },
    ],
  },
});
