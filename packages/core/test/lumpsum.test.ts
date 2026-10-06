import { describe, expect, it } from "vitest";
import { effectiveRate, planLumpSum, runOff, type LumpSumDebt } from "../src";

const card: LumpSumDebt = { id: "card", label: "Card EMI", balance: 30_000_00, annualRate: 16, minPayment: 5_000_00, interestTaxRate: 18 };
const personal: LumpSumDebt = { id: "personal", label: "Personal", balance: 2_00_000_00, annualRate: 12, minPayment: 10_000_00 };
const home: LumpSumDebt = { id: "home", label: "Home", balance: 20_00_000_00, annualRate: 8.5, minPayment: 20_000_00 };
const noCost: LumpSumDebt = { id: "nocost", label: "Phone", balance: 12_000_00, annualRate: 0, minPayment: 4_000_00 };
const debts = [home, personal, noCost, card];
const ids = (p: ReturnType<typeof planLumpSum>) => p.allocations.map((a) => a.id);

describe("runOff", () => {
  it("matches a standard 12-month amortisation", () => {
    const r = runOff(1_00_000_00, { id: "x", label: "x", balance: 1_00_000_00, annualRate: 12, minPayment: 8_884_88 });
    expect(r.months).toBe(12);
    expect(Math.abs(r.interest - 6_618_56)).toBeLessThan(10); // 12 × EMI − principal, ± rounding
  });
});

describe("planLumpSum", () => {
  it("interest: closes the costliest loan, then part-pays the next", () => {
    const p = planLumpSum(debts, 50_000_00, "interest");
    expect(ids(p)).toEqual(["card", "personal"]);
    expect(p.allocations[0]).toMatchObject({ closes: true, principal: 30_000_00, emiFreed: 5_000_00, charges: 0 });
    expect(p.allocations[1]).toMatchObject({ closes: false, principal: 20_000_00, emiFreed: 0 });
    expect(p.allocations[1]!.monthsSaved).toBeGreaterThan(0);
    expect(p.used).toBe(50_000_00);
    expect(p.leftover).toBe(0);
    expect(p.interestSaved).toBeGreaterThan(0);
  });

  it("cashflow: closes loans that free the most EMI per rupee", () => {
    const p = planLumpSum(debts, 50_000_00, "cashflow");
    expect(ids(p)).toEqual(["nocost", "card", "personal"]);
    expect(p.emiFreed).toBe(9_000_00);
    expect(p.allocations[0]!.interestSaved).toBe(0); // 0% loan: frees cash, saves no interest
    expect(p.used).toBe(50_000_00);
  });

  it("never gives the interest strategy's money to a 0% loan", () => {
    const p = planLumpSum(debts, 1_00_00_000_00, "interest");
    expect(ids(p)).not.toContain("nocost");
    expect(p.allocations.every((a) => a.closes)).toBe(true);
    expect(p.leftover).toBe(1_00_00_000_00 - p.used);
  });

  it("pays charges out of the lump sum and never overspends", () => {
    const charged = { ...card, chargePercent: 3, chargeTaxRate: 18 };
    const p = planLumpSum([charged, personal], 31_062_00, "interest");
    expect(p.allocations[0]).toMatchObject({ id: "card", closes: true, charges: 1_062_00, cost: 31_062_00 });
    for (const amount of [1_00, 999_99, 31_061_99, 77_777_77]) {
      expect(planLumpSum([charged, personal, home], amount, "interest").used).toBeLessThanOrEqual(amount);
      expect(planLumpSum([charged, personal, home], amount, "cashflow").used).toBeLessThanOrEqual(amount);
    }
  });

  it("a big foreclosure charge on a nearly-finished loan pushes it down the order", () => {
    const pricey = { ...card, chargePercent: 5, chargeTaxRate: 18 };
    expect(effectiveRate(pricey)).toBeLessThan(effectiveRate(personal));
    expect(ids(planLumpSum([pricey, personal], 50_000_00, "interest"))).toEqual(["personal"]);
  });

  it("supports flat charges, and skips a prepayment whose charges outweigh the saving", () => {
    const flat = { ...card, chargeFlat: 500_00, chargeTaxRate: 18 }; // ₹590 with GST
    const p = planLumpSum([flat, personal], 50_000_00, "interest");
    expect(p.allocations[0]).toMatchObject({ id: "card", closes: true, charges: 590_00, cost: 30_590_00 });
    expect(p.used).toBe(50_000_00);
    // ₹1,000 can't close anything; a ₹2,000 flat fee on a part-payment saves nothing.
    const steep = { ...personal, chargeFlat: 2_000_00 };
    expect(planLumpSum([steep], 1_000_00, "interest").allocations).toEqual([]);
    expect(planLumpSum([steep], 5_000_00, "interest").allocations).toEqual([]);
  });

  it("handles nothing to allocate", () => {
    expect(planLumpSum(debts, 0, "interest")).toMatchObject({ allocations: [], used: 0, leftover: 0 });
    expect(planLumpSum([], 10_000_00, "cashflow")).toMatchObject({ allocations: [], leftover: 10_000_00 });
  });
});
