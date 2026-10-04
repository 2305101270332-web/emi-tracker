import { describe, expect, it } from "vitest";
import { buildSchedule, ScheduleError, type LoanTerms, type Schedule } from "../src";

const base: LoanTerms = {
  currency: "INR",
  principal: 100_000_00,
  annualRate: 12,
  tenureMonths: 12,
  repaymentType: "reducing",
  bookingDate: "2025-01-05",
  firstEmiDate: "2025-02-05",
};

/** Invariants every schedule must satisfy. */
function checkInvariants(s: Schedule) {
  const rows = s.rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    expect(Number.isSafeInteger(r.interest)).toBe(true);
    expect(Number.isSafeInteger(r.principal)).toBe(true);
    expect(r.emi).toBe(r.principal + r.interest);
    expect(r.closing).toBe(r.opening - r.principal - r.prepayment);
    expect(r.totalPayable).toBe(
      r.emi + r.interestTax + r.processingFee + r.processingFeeTax + r.shiftInterest + r.shiftTax,
    );
    if (i > 0) expect(r.opening).toBe(rows[i - 1]!.closing);
  }
  expect(rows.at(-1)!.closing).toBe(0);
  expect(s.summary.totalPrincipal).toBe(s.summary.financedPrincipal);
  expect(s.summary.instalments).toBe(rows.length);
}

describe("reducing balance", () => {
  it("matches the standard EMI formula (1 lakh, 12%, 12m)", () => {
    const s = buildSchedule(base);
    checkInvariants(s);
    expect(s.rows).toHaveLength(12);
    expect(s.summary.emi).toBe(8_884_88); // ₹8,884.88
    expect(s.rows[0]!.interest).toBe(1_000_00); // 1% of 1,00,000
    expect(s.rows[0]!.principal).toBe(7_884_88);
    // Last instalment absorbs rounding: within a few paise of the EMI
    expect(Math.abs(s.rows[11]!.emi - 8_884_88)).toBeLessThanOrEqual(12);
    expect(s.summary.totalInterest).toBe(s.rows.reduce((a, r) => a + r.emi, 0) - 100_000_00);
  });

  it("matches a long home loan (50 lakh, 8.5%, 240m)", () => {
    const s = buildSchedule({ ...base, principal: 5_000_000_00, annualRate: 8.5, tenureMonths: 240 });
    checkInvariants(s);
    expect(s.summary.emi).toBe(43_391_16);
    expect(s.rows).toHaveLength(240);
  });

  it("supports 1-month tenure", () => {
    const s = buildSchedule({ ...base, tenureMonths: 1 });
    checkInvariants(s);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]!.interest).toBe(1_000_00);
    expect(s.rows[0]!.emi).toBe(101_000_00);
  });

  it("supports 0% interest with rounding absorbed in the final instalment", () => {
    const s = buildSchedule({ ...base, principal: 100_000, annualRate: 0, tenureMonths: 3 });
    checkInvariants(s);
    expect(s.rows.map((r) => r.emi)).toEqual([33_333, 33_333, 33_334]);
    expect(s.summary.totalInterest).toBe(0);
    expect(s.summary.totalCostOfBorrowing).toBe(0);
    expect(s.summary.effectiveAnnualRate).toBe(0);
  });

  it("works for zero-decimal currencies", () => {
    const s = buildSchedule({ ...base, currency: "JPY", principal: 1_000_000 });
    checkInvariants(s);
    expect(s.summary.emi).toBe(88_849); // ¥88,848.79 rounded
  });

  it("rounding: every row is whole minor units and the loan closes at exactly zero", () => {
    for (const rate of [7.25, 10.99, 13.37, 36]) {
      for (const n of [5, 7, 13, 37]) {
        const s = buildSchedule({ ...base, principal: 123_457_89, annualRate: rate, tenureMonths: n });
        checkInvariants(s);
      }
    }
  });
});

describe("instalment dates", () => {
  it("uses EMI day 31 and clamps in short months", () => {
    const s = buildSchedule({ ...base, firstEmiDate: "2025-01-31", bookingDate: "2025-01-01", emiDay: 31, tenureMonths: 4 });
    expect(s.rows.map((r) => r.billedDate)).toEqual(["2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30"]);
  });
  it("uses EMI day 29/30 across a leap February", () => {
    const s29 = buildSchedule({ ...base, bookingDate: "2023-12-01", firstEmiDate: "2024-01-29", tenureMonths: 3 });
    expect(s29.rows.map((r) => r.billedDate)).toEqual(["2024-01-29", "2024-02-29", "2024-03-29"]);
    const s30 = buildSchedule({ ...base, bookingDate: "2024-12-01", firstEmiDate: "2025-01-30", tenureMonths: 3 });
    expect(s30.rows.map((r) => r.billedDate)).toEqual(["2025-01-30", "2025-02-28", "2025-03-30"]);
  });
  it("lets EMI day differ from the first EMI date", () => {
    const s = buildSchedule({ ...base, firstEmiDate: "2025-02-20", emiDay: 5, tenureMonths: 3 });
    expect(s.rows.map((r) => r.billedDate)).toEqual(["2025-02-20", "2025-03-05", "2025-04-05"]);
  });
});

describe("flat rate", () => {
  it("spreads flat interest evenly and shows the true reducing rate", () => {
    const s = buildSchedule({ ...base, repaymentType: "flat", annualRate: 10 });
    checkInvariants(s);
    expect(s.summary.totalInterest).toBe(10_000_00);
    expect(s.rows[0]!.interest).toBe(833_33);
    expect(s.rows[11]!.interest).toBe(833_37);
    expect(s.rows[0]!.principal).toBe(8_333_33);
    expect(s.summary.equivalentReducingRate).toBeGreaterThan(17.9);
    expect(s.summary.equivalentReducingRate).toBeLessThan(18.1);
  });
  it("handles multi-year flat loans", () => {
    const s = buildSchedule({ ...base, repaymentType: "flat", annualRate: 8, tenureMonths: 36, principal: 300_000_00 });
    checkInvariants(s);
    expect(s.summary.totalInterest).toBe(72_000_00);
  });
});

describe("tax on interest", () => {
  it("charges tax per instalment on the interest portion only", () => {
    const s = buildSchedule({ ...base, interestTaxRate: 18 });
    checkInvariants(s);
    expect(s.rows[0]!.interestTax).toBe(180_00);
    expect(s.rows[0]!.totalPayable).toBe(8_884_88 + 180_00);
    expect(s.summary.totalInterestTax).toBe(s.rows.reduce((a, r) => a + r.interestTax, 0));
    expect(s.summary.totalCostOfBorrowing).toBe(s.summary.totalInterest + s.summary.totalInterestTax);
  });
});

describe("processing fee", () => {
  it("percent fee + GST, paid upfront", () => {
    const s = buildSchedule({ ...base, processingFee: { kind: "percent", percent: 1.5 }, processingFeeTaxRate: 18 });
    expect(s.summary.processingFee).toBe(1_500_00);
    expect(s.summary.processingFeeTax).toBe(270_00);
    expect(s.summary.upfrontCharges).toBe(1_770_00);
    expect(s.rows[0]!.processingFee).toBe(0);
    expect(s.summary.totalPayable).toBe(s.rows.reduce((a, r) => a + r.totalPayable, 0) + 1_770_00);
  });
  it("flat fee added to the first instalment", () => {
    const s = buildSchedule({
      ...base,
      processingFee: { kind: "flat", amount: 199_00 },
      processingFeeTaxRate: 18,
      feeCollection: "first_instalment",
    });
    checkInvariants(s);
    expect(s.rows[0]!.processingFee).toBe(199_00);
    expect(s.rows[0]!.processingFeeTax).toBe(35_82);
    expect(s.rows[1]!.processingFee).toBe(0);
    expect(s.summary.upfrontCharges).toBe(0);
  });
  it("fees raise the effective rate above the contract rate", () => {
    const plain = buildSchedule(base);
    const withFee = buildSchedule({ ...base, processingFee: { kind: "percent", percent: 2 }, processingFeeTaxRate: 18 });
    expect(plain.summary.effectiveAnnualRate!).toBeGreaterThan(12);
    expect(plain.summary.nominalApr!).toBeCloseTo(12, 0);
    expect(withFee.summary.nominalApr!).toBeGreaterThan(plain.summary.nominalApr! + 3);
  });
});

describe("EMI shift / broken-period interest", () => {
  const shifted: LoanTerms = {
    ...base,
    principal: 50_000_00,
    annualRate: 16,
    interestTaxRate: 18,
    bookingDate: "2025-01-05",
    firstEmiDate: "2025-02-15",
    emiShift: { enabled: true },
  };
  it("charges interest only for the shifted days (aligned toggle)", () => {
    const s = buildSchedule(shifted);
    checkInvariants(s);
    expect(s.summary.shiftDays).toBe(10); // Feb 5 -> Feb 15
    expect(s.summary.shiftInterest).toBe(219_18); // 50,000 * 16% * 10/365 = 219.178
    expect(s.summary.shiftTax).toBe(39_45);
    expect(s.summary.shiftCost).toBe(258_63);
    expect(s.rows[0]!.shiftInterest).toBe(219_18);
    expect(s.summary.totalCostOfBorrowing).toBe(
      s.summary.totalInterest + s.summary.totalInterestTax + s.summary.shiftCost,
    );
  });
  it("uses explicit original date and 360-day basis", () => {
    const s = buildSchedule({
      ...shifted,
      emiShift: { enabled: true, originalFirstEmiDate: "2025-02-01", dayCount: 360 },
    });
    expect(s.summary.shiftDays).toBe(14);
    expect(s.summary.shiftInterest).toBe(311_11); // 50,000 * 16% * 14/360 = 311.11
  });
  it("can be collected upfront", () => {
    const s = buildSchedule({ ...shifted, emiShift: { enabled: true, collection: "upfront" } });
    expect(s.rows[0]!.shiftInterest).toBe(0);
    expect(s.summary.upfrontCharges).toBe(258_63);
  });
  it("handles a shift across a leap-year February", () => {
    const s = buildSchedule({
      ...shifted,
      bookingDate: "2024-01-31",
      firstEmiDate: "2024-03-05",
      emiShift: { enabled: true },
    });
    // natural first EMI = 2024-02-29 (clamped), shifted to Mar 5 => 5 days
    expect(s.summary.shiftDays).toBe(5);
  });
  it("rejects a shift to an earlier date", () => {
    expect(() =>
      buildSchedule({ ...shifted, emiShift: { enabled: true, originalFirstEmiDate: "2025-02-20" } }),
    ).toThrow(ScheduleError);
  });
});

describe("no-cost EMI", () => {
  const phone: LoanTerms = {
    ...base,
    principal: 60_000_00,
    annualRate: 15,
    tenureMonths: 6,
    interestTaxRate: 18,
    noCostEmi: true,
  };
  it("EMIs sum to the price and discount equals total interest", () => {
    const s = buildSchedule(phone);
    checkInvariants(s);
    expect(s.rows.reduce((a, r) => a + r.emi, 0)).toBe(60_000_00);
    expect(s.summary.noCostDiscount).toBe(s.summary.totalInterest);
    expect(s.summary.noCostDiscount).toBeGreaterThan(0);
    expect(s.rows[0]!.emi).toBe(10_000_00);
  });
  it("still charges GST on the interest component", () => {
    const s = buildSchedule(phone);
    expect(s.summary.totalInterestTax).toBeGreaterThan(0);
    expect(s.summary.totalCostOfBorrowing).toBe(s.summary.totalInterestTax);
    expect(s.summary.effectiveAnnualRate!).toBeGreaterThan(0);
  });
  it("with 0% rate it is a plain interest-free split", () => {
    const s = buildSchedule({ ...phone, annualRate: 0 });
    expect(s.summary.noCostDiscount).toBe(0);
    expect(s.summary.totalInterestTax).toBe(0);
    expect(s.summary.totalCostOfBorrowing).toBe(0);
  });
  it("works with flat rate", () => {
    const s = buildSchedule({ ...phone, repaymentType: "flat" });
    checkInvariants(s);
    expect(s.rows.reduce((a, r) => a + r.emi, 0)).toBe(60_000_00);
    expect(s.summary.noCostDiscount).toBe(s.summary.totalInterest);
  });
});

describe("manual overrides", () => {
  it("keeps tenure and recomputes the remaining EMI", () => {
    const s = buildSchedule({ ...base, overrides: { 3: 10_000_00 } });
    checkInvariants(s);
    expect(s.rows).toHaveLength(12);
    expect(s.rows[2]!.emi).toBe(10_000_00);
    expect(s.rows[2]!.overridden).toBe(true);
    expect(s.rows[3]!.emi).toBeLessThan(8_884_88);
    // Rows 4..11 share the recomputed EMI
    const later = s.rows.slice(3, 11).map((r) => r.emi);
    expect(new Set(later).size).toBe(1);
  });
  it("supports overrides lower than interest (negative amortisation)", () => {
    const s = buildSchedule({ ...base, overrides: { 1: 500_00 } });
    checkInvariants(s);
    expect(s.rows[0]!.principal).toBe(-500_00);
    expect(s.rows[0]!.closing).toBe(100_500_00);
  });
  it("supports multiple overrides on a flat loan", () => {
    const s = buildSchedule({ ...base, repaymentType: "flat", annualRate: 10, overrides: { 2: 12_000_00, 5: 5_000_00 } });
    checkInvariants(s);
    expect(s.rows[1]!.emi).toBe(12_000_00);
    expect(s.rows[4]!.emi).toBe(5_000_00);
  });
  it("rejects overriding the last instalment or overpaying", () => {
    expect(() => buildSchedule({ ...base, overrides: { 12: 1 } })).toThrow(ScheduleError);
    expect(() => buildSchedule({ ...base, overrides: { 2: 200_000_00 } })).toThrow(ScheduleError);
  });
});

describe("rate changes", () => {
  it("keep tenure: recomputes EMI from the effective date", () => {
    const s = buildSchedule({ ...base, rateChanges: [{ effectiveDate: "2025-07-01", annualRate: 14, mode: "keep_tenure" }] });
    checkInvariants(s);
    expect(s.rows).toHaveLength(12);
    expect(s.rows[4]!.annualRate).toBe(12); // 2025-06-05
    expect(s.rows[5]!.annualRate).toBe(14); // 2025-07-05
    expect(s.rows[5]!.emi).toBeGreaterThan(s.rows[4]!.emi);
  });
  it("keep EMI (default): a rate rise extends the tenure, EMI unchanged", () => {
    const s = buildSchedule({ ...base, principal: 2_000_000_00, annualRate: 8.5, tenureMonths: 120, rateChanges: [{ effectiveDate: "2026-01-01", annualRate: 9.5 }] });
    checkInvariants(s);
    expect(s.rows.length).toBeGreaterThan(120);
    const emis = new Set(s.rows.slice(0, -1).map((r) => r.emi));
    expect(emis.size).toBe(1);
  });
  it("keep EMI: a rate cut shortens the tenure", () => {
    const s = buildSchedule({ ...base, principal: 2_000_000_00, annualRate: 9.5, tenureMonths: 120, rateChanges: [{ effectiveDate: "2026-01-01", annualRate: 8, mode: "keep_emi" }] });
    checkInvariants(s);
    expect(s.rows.length).toBeLessThan(120);
  });
  it("keep EMI falls back to keep tenure when the EMI no longer covers interest", () => {
    // 50 lakh @ 8.5% x 240: EMI 43,391.16 covers interest only while the rate stays below ~10.4%.
    const s = buildSchedule({ ...base, principal: 5_000_000_00, annualRate: 8.5, tenureMonths: 240, rateChanges: [{ effectiveDate: "2025-03-01", annualRate: 11 }] });
    checkInvariants(s);
    expect(s.rows).toHaveLength(240);
    expect(s.rows[1]!.emi).toBeGreaterThan(s.rows[0]!.emi);
  });
  it("applies several changes in date order", () => {
    const s = buildSchedule({
      ...base,
      rateChanges: [
        { effectiveDate: "2025-09-01", annualRate: 11, mode: "keep_tenure" },
        { effectiveDate: "2025-05-01", annualRate: 13, mode: "keep_tenure" },
      ],
    });
    checkInvariants(s);
    expect(s.rows.map((r) => r.annualRate)).toEqual([12, 12, 12, 13, 13, 13, 13, 11, 11, 11, 11, 11]);
  });
});

describe("prepayments", () => {
  // Expected figures from an independent Python Decimal reference (see docs/DECISIONS.md).
  it("reduce tenure: EMI unchanged, loan ends sooner", () => {
    const s = buildSchedule({ ...base, prepayments: [{ date: "2025-04-05", amount: 20_000_00, mode: "reduce_tenure" }] });
    checkInvariants(s);
    expect(s.rows).toHaveLength(10);
    expect(s.rows[2]!.prepayment).toBe(20_000_00);
    expect(s.rows[3]).toMatchObject({ interest: 561_08, principal: 8_323_80, closing: 47_784_22, emi: 8_884_88 });
    expect(s.rows[9]).toMatchObject({ interest: 49_00, principal: 4_899_87, closing: 0 });
    expect(s.summary.totalInterest).toBe(4_912_79);
    expect(s.summary.totalPrepaid).toBe(20_000_00);
  });
  it("reduce EMI: tenure unchanged, EMI recomputed", () => {
    const s = buildSchedule({ ...base, prepayments: [{ date: "2025-04-05", amount: 20_000_00, mode: "reduce_emi" }] });
    checkInvariants(s);
    expect(s.rows).toHaveLength(12);
    expect(s.rows[3]).toMatchObject({ interest: 561_08, principal: 5_988_99, emi: 6_550_07, closing: 50_119_03 });
    expect(s.rows[11]).toMatchObject({ interest: 64_85, principal: 6_485_22, closing: 0 });
    expect(s.summary.totalInterest).toBe(5_605_27);
  });
  it("a payment between EMI dates is applied after the next EMI", () => {
    const s = buildSchedule({ ...base, prepayments: [{ date: "2025-03-20", amount: 20_000_00, mode: "reduce_tenure" }] });
    expect(s.rows[1]!.prepayment).toBe(0); // EMI 2 on 2025-03-05
    expect(s.rows[2]!.prepayment).toBe(20_000_00); // applied after EMI 3 on 2025-04-05
  });
  it("foreclosure: closes the loan, charge on amount prepaid plus GST", () => {
    const s = buildSchedule({ ...base, prepayments: [{ date: "2025-06-05", amount: 1_000_000_00, mode: "reduce_tenure", chargePercent: 4, chargeTaxRate: 18 }] });
    checkInvariants(s);
    expect(s.rows).toHaveLength(5);
    const last = s.rows[4]!;
    const outstanding = last.opening - last.principal;
    expect(last.prepayment).toBe(outstanding);
    expect(last.prepaymentCharge).toBe(Math.round(outstanding * 0.04));
    expect(last.prepaymentChargeTax).toBe(Math.round(last.prepaymentCharge * 0.18));
    expect(s.summary.totalCostOfBorrowing).toBe(s.summary.totalInterest + last.prepaymentCharge + last.prepaymentChargeTax);
  });
  it("rejects prepayments on flat-rate loans", () => {
    expect(() => buildSchedule({ ...base, repaymentType: "flat", prepayments: [{ date: "2025-04-05", amount: 1, mode: "reduce_emi" }] })).toThrow(ScheduleError);
  });
});

describe("validation", () => {
  it.each([
    [{ principal: 0 }],
    [{ principal: 1.5 }],
    [{ tenureMonths: 0 }],
    [{ annualRate: -1 }],
    [{ firstEmiDate: "2024-12-01" }],
    [{ bookingDate: "2025-02-30" }],
    [{ emiDay: 32 }],
  ])("rejects %o", (patch) => {
    expect(() => buildSchedule({ ...base, ...(patch as Partial<LoanTerms>) })).toThrow();
  });
});
