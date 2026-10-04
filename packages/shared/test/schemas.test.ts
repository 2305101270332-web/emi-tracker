import { describe, expect, it } from "vitest";
import { buildSchedule } from "@emi/core";
import { cardInputSchema, createTranslator, loanInputSchema, settingsSchema, toLoanTerms } from "../src";

const loan = {
  lenderId: "l1",
  type: "personal",
  nickname: "Test",
  currency: "INR",
  principal: 100_000_00,
  annualRate: 12,
  tenureMonths: 12,
  repaymentType: "reducing",
  bookingDate: "2025-01-05",
  firstEmiDate: "2025-02-05",
  emiDay: 5,
};

describe("loanInputSchema", () => {
  it("accepts a minimal loan and fills defaults", () => {
    const parsed = loanInputSchema.parse(loan);
    expect(parsed.processingFee).toEqual({ kind: "none" });
    expect(parsed.emiShift.enabled).toBe(false);
  });
  it("rejects floating-point money", () => {
    expect(loanInputSchema.safeParse({ ...loan, principal: 100.5 }).success).toBe(false);
  });
  it("rejects invalid currency and dates", () => {
    expect(loanInputSchema.safeParse({ ...loan, currency: "XYZ1" }).success).toBe(false);
    expect(loanInputSchema.safeParse({ ...loan, bookingDate: "2025-02-30" }).success).toBe(false);
  });
  it("requires a card for credit card EMIs", () => {
    const r = loanInputSchema.safeParse({ ...loan, type: "credit_card_emi" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("card_required");
  });
  it("maps to engine terms and builds a schedule", () => {
    const parsed = loanInputSchema.parse({ ...loan, interestTaxEnabled: true, interestTaxRate: 18 });
    const s = buildSchedule(toLoanTerms(parsed));
    expect(s.summary.emi).toBe(8_884_88);
    expect(s.rows[0]!.interestTax).toBe(180_00);
  });
  it("does not apply interest tax when disabled even if a rate is set", () => {
    const parsed = loanInputSchema.parse({ ...loan, interestTaxEnabled: false, interestTaxRate: 18 });
    expect(toLoanTerms(parsed).interestTaxRate).toBe(0);
  });
});

describe("cardInputSchema", () => {
  it("requires exactly one of due day / grace days", () => {
    expect(cardInputSchema.safeParse({ nickname: "C", statementDay: 5, dueDay: 25 }).success).toBe(true);
    expect(cardInputSchema.safeParse({ nickname: "C", statementDay: 5, graceDays: 20 }).success).toBe(true);
    expect(cardInputSchema.safeParse({ nickname: "C", statementDay: 5 }).success).toBe(false);
    expect(cardInputSchema.safeParse({ nickname: "C", statementDay: 5, dueDay: 2, graceDays: 3 }).success).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("validates time zones", () => {
    const base = {
      country: "IN", currency: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY",
      taxLabel: "GST", taxRate: 18, theme: "system", reminderHour: 9, reminderDaysBefore: [3, 1],
      remindOnDay: true, remindOverdue: true, pushEnabled: true, emailReminders: true, weeklySummary: false,
    };
    expect(settingsSchema.safeParse(base).success).toBe(true);
    expect(settingsSchema.safeParse({ ...base, timeZone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("server translator", () => {
  it("interpolates and pluralises", () => {
    const t = createTranslator("en-IN");
    expect(t("loans.instalmentsLeft", { count: 3 })).toBe("3 left");
    expect(t("common.months", { count: 1 })).toBe("1 month");
    expect(t("common.months", { count: 2 })).toBe("2 months");
    expect(t("missing.key")).toBe("missing.key");
  });
});
