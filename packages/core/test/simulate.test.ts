import { describe, expect, it } from "vitest";
import { compareOffers, simulatePrepayment, type LoanTerms } from "../src";

const base: LoanTerms = {
  currency: "INR",
  principal: 100_000_00,
  annualRate: 12,
  tenureMonths: 12,
  repaymentType: "reducing",
  bookingDate: "2025-01-05",
  firstEmiDate: "2025-02-05",
};

describe("prepayment simulator", () => {
  it("reports interest saved and tenure cut for reduce-tenure", () => {
    const r = simulatePrepayment(base, { date: "2025-04-05", amount: 20_000_00, mode: "reduce_tenure" });
    expect(r.instalmentsBefore).toBe(12);
    expect(r.instalmentsAfter).toBe(10);
    expect(r.interestSaved).toBe(r.before.summary.totalInterest - 4_912_79);
    expect(r.emiAfter).toBe(r.emiBefore);
    expect(r.netSaving).toBe(r.interestSaved);
    expect(r.foreclosed).toBe(false);
  });
  it("reports the lower EMI for reduce-EMI", () => {
    const r = simulatePrepayment(base, { date: "2025-04-05", amount: 20_000_00, mode: "reduce_emi" });
    expect(r.instalmentsAfter).toBe(12);
    expect(r.emiBefore).toBe(8_884_88);
    expect(r.emiAfter).toBe(6_550_07);
  });
  it("includes charges + GST and tax on interest in the net saving", () => {
    const r = simulatePrepayment({ ...base, interestTaxRate: 18 }, { date: "2025-04-05", amount: 20_000_00, mode: "reduce_tenure", chargePercent: 2, chargeTaxRate: 18 });
    expect(r.charges).toBe(400_00 + 72_00);
    expect(r.interestTaxSaved).toBeGreaterThan(0);
    expect(r.netSaving).toBe(r.interestSaved + r.interestTaxSaved - 472_00);
  });
  it("detects foreclosure", () => {
    const r = simulatePrepayment(base, { date: "2025-06-05", amount: 10_000_000_00, mode: "reduce_tenure", chargePercent: 3, chargeTaxRate: 18 });
    expect(r.foreclosed).toBe(true);
    expect(r.instalmentsAfter).toBe(5);
  });
});

describe("offer comparison", () => {
  it("ranks by effective annual rate, not total cost", () => {
    const ranked = compareOffers([
      { label: "A: 11% 5y, no fee", terms: { ...base, annualRate: 11, tenureMonths: 60 } },
      { label: "B: 10% 1y, 3% fee", terms: { ...base, annualRate: 10, processingFee: { kind: "percent", percent: 3 }, processingFeeTaxRate: 18 } },
      { label: "C: 12% flat 1y", terms: { ...base, repaymentType: "flat" } },
    ]);
    const byLabel = Object.fromEntries(ranked.map((r) => [r.label[0], r]));
    // B has the lowest total cost (short tenure) but the 3% fee pushes its true rate above A's.
    expect(byLabel.B!.summary.totalCostOfBorrowing).toBeLessThan(byLabel.A!.summary.totalCostOfBorrowing);
    expect(byLabel.A!.rank).toBe(1);
    expect(byLabel.C!.rank).toBe(3);
  });
  it("keeps invalid offers with an error and no rank", () => {
    const ranked = compareOffers([{ label: "bad", terms: { ...base, tenureMonths: 0 } }, { label: "ok", terms: base }]);
    expect(ranked[0]!.error).toBeTruthy();
    expect(ranked[0]!.rank).toBe(0);
    expect(ranked[1]!.rank).toBe(1);
  });
});
