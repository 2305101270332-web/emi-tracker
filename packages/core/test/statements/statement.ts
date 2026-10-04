import type { LoanTerms, ScheduleRow, ScheduleSummary } from "../../src";

/**
 * A bank-statement fixture: the loan's terms plus the figures the bank actually
 * printed. Every figure listed under `expect` must match the engine exactly, in
 * minor units (paise/cents). Leave out anything the statement doesn't show.
 *
 * To add one: copy `_template.statement.ts` to `<name>.statement.ts`, fill it in
 * from the sanction letter / statement, and run `npm test -w @emi/core`.
 */
export interface StatementFixture {
  name: string;
  /** Where the numbers came from, e.g. "HDFC loan statement dated 2025-04-30". */
  source: string;
  terms: LoanTerms;
  expect: {
    summary?: Partial<Pick<ScheduleSummary, "emi" | "totalInterest" | "totalInterestTax" | "processingFee" | "processingFeeTax" | "shiftInterest" | "shiftTax" | "totalPayable">>;
    /** Rows by instalment number; include only the columns printed on the statement. */
    rows?: (Partial<Pick<ScheduleRow, "billedDate" | "opening" | "interest" | "principal" | "emi" | "interestTax" | "totalPayable" | "closing">> & { n: number })[];
  };
}

export const defineStatement = (f: StatementFixture) => f;
