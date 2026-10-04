import { describe, expect, it } from "vitest";
import {
  currencyFractionDigits,
  formatMoney,
  parseMajor,
  percentOf,
  roundMinor,
  splitEvenly,
  toMajorString,
} from "../src";

describe("roundMinor", () => {
  it("rounds half away from zero", () => {
    expect(roundMinor(2.5)).toBe(3);
    expect(roundMinor(-2.5)).toBe(-3);
    expect(roundMinor(2.4999)).toBe(2);
  });
  it("absorbs float noise", () => {
    // 1.005 * 100 = 100.49999999999999 in IEEE 754
    expect(roundMinor(1.005 * 100)).toBe(101);
    expect(roundMinor(0.1 * 3 * 10)).toBe(3);
  });
  it("never returns -0", () => {
    expect(Object.is(roundMinor(-0.2), 0)).toBe(true);
  });
  it("rejects non-finite", () => {
    expect(() => roundMinor(Infinity)).toThrow();
  });
});

describe("currency minor units", () => {
  it("knows ISO 4217 fraction digits", () => {
    expect(currencyFractionDigits("INR")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KWD")).toBe(3);
  });
  it("parses major strings without float math", () => {
    expect(parseMajor("1,00,000.50", "INR")).toBe(10_000_050);
    expect(parseMajor("0.105", "USD")).toBe(11);
    expect(parseMajor("1500", "JPY")).toBe(1500);
    expect(parseMajor("1.2345", "KWD")).toBe(1235);
    expect(() => parseMajor("abc", "INR")).toThrow();
  });
  it("prints minor as major", () => {
    expect(toMajorString(5, "INR")).toBe("0.05");
    expect(toMajorString(-123456, "USD")).toBe("-1234.56");
    expect(toMajorString(1500, "JPY")).toBe("1500");
  });
});

describe("formatMoney", () => {
  it("uses lakh/crore grouping for en-IN", () => {
    const s = formatMoney(1_234_567_89, "INR", "en-IN");
    expect(s).toContain("12,34,567.89");
  });
  it("uses western grouping for en-US", () => {
    expect(formatMoney(1_234_567_89, "USD", "en-US")).toBe("$1,234,567.89");
  });
  it("respects zero-decimal currencies", () => {
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
  });
});

describe("percentOf / splitEvenly", () => {
  it("computes GST 18% rounded", () => {
    expect(percentOf(98_765, 18)).toBe(17_778); // 17777.7
  });
  it("splits so parts sum exactly", () => {
    const parts = splitEvenly(100_000, 3);
    expect(parts).toEqual([33_333, 33_333, 33_334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
  });
});
