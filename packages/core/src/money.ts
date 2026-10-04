/**
 * Money helpers. All amounts are integers in the currency's minor unit
 * (paise, cents, ...). Floating point is only used transiently for rate
 * math and is always rounded back to an integer immediately.
 */

export type Minor = number;

/** Round half away from zero to an integer, tolerant of float noise like 12.4999999999. */
export function roundMinor(x: number): Minor {
  if (!Number.isFinite(x)) throw new RangeError(`Cannot round non-finite value ${x}`);
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const r = Math.round(abs + abs * 1e-12 + 1e-9);
  return r === 0 ? 0 : sign * r;
}

export function assertMinor(x: number, label = "amount"): void {
  if (!Number.isSafeInteger(x)) throw new RangeError(`${label} must be a safe integer in minor units, got ${x}`);
}

const fractionCache = new Map<string, number>();

/** Number of minor-unit digits for an ISO 4217 currency (INR 2, JPY 0, KWD 3). */
export function currencyFractionDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = fractionCache.get(code);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionCache.set(code, digits);
  return digits;
}

/** Convert a major-unit decimal string ("1234.56") to minor units without float math. */
export function parseMajor(input: string, currency: string): Minor {
  const digits = currencyFractionDigits(currency);
  const s = input.trim().replace(/[,\s_]/g, "");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new RangeError(`Invalid amount "${input}"`);
  const neg = m[1] === "-";
  const whole = m[2] || "0";
  let frac = m[3] ?? "";
  // Round half up on the first dropped digit.
  let roundUp = false;
  if (frac.length > digits) {
    roundUp = Number(frac[digits]) >= 5;
    frac = frac.slice(0, digits);
  }
  frac = frac.padEnd(digits, "0");
  let value = Number(whole + frac);
  if (roundUp) value += 1;
  assertMinor(value);
  return neg ? -value : value;
}

/** Minor units -> major-unit decimal string ("123456" INR -> "1234.56"). */
export function toMajorString(amount: Minor, currency: string): string {
  const digits = currencyFractionDigits(currency);
  const neg = amount < 0;
  const abs = Math.abs(amount).toString().padStart(digits + 1, "0");
  const whole = digits ? abs.slice(0, -digits) : abs;
  const frac = digits ? abs.slice(-digits) : "";
  return (neg ? "-" : "") + whole + (digits ? "." + frac : "");
}

/** Minor units -> major-unit number. For display/formatting only. */
export function toMajor(amount: Minor, currency: string): number {
  return amount / 10 ** currencyFractionDigits(currency);
}

/**
 * Format money with Intl. Locale en-IN gives lakh/crore grouping (12,34,567.00)
 * natively; we pass numberingSystem-neutral options so other locales group normally.
 */
export function formatMoney(
  amount: Minor,
  currency: string,
  locale = "en-IN",
  opts: { compact?: boolean; hideMinorIfZero?: boolean } = {},
): string {
  const digits = currencyFractionDigits(currency);
  const major = toMajor(amount, currency);
  const showMinor = !(opts.hideMinorIfZero && amount % 10 ** digits === 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    minimumFractionDigits: opts.compact ? 0 : showMinor ? digits : 0,
    maximumFractionDigits: opts.compact ? 1 : digits,
  }).format(major);
}

/** Percentage of an amount, rounded to minor units. rate is a percent (18 => 18%). */
export function percentOf(amount: Minor, ratePercent: number): Minor {
  return roundMinor((amount * ratePercent) / 100);
}

/** Split `total` into `n` integer parts that sum exactly to total; the last part absorbs the remainder. */
export function splitEvenly(total: Minor, n: number): Minor[] {
  if (n <= 0) return [];
  const base = roundMinor(total / n);
  const parts = Array.from({ length: n }, () => base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

export function sum(values: readonly Minor[]): Minor {
  let s = 0;
  for (const v of values) s += v;
  return s;
}
