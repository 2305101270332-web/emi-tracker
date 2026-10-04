/**
 * Calendar-date helpers on ISO "YYYY-MM-DD" strings. Dates carry no time or
 * zone; arithmetic is done in UTC so DST never shifts a day.
 */

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseISODate(s: ISODate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(s);
  if (!m || !isValidISODate(s)) throw new RangeError(`Invalid ISO date "${s}"`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function toISODate(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** m is 1-12. */
export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

function toEpochDay(s: ISODate): number {
  const { y, m, d } = parseISODate(s);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromEpochDay(n: number): ISODate {
  const dt = new Date(n * DAY_MS);
  return toISODate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: ISODate, days: number): ISODate {
  return fromEpochDay(toEpochDay(s) + days);
}

/** b - a in whole days. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** Date in the month `months` after s, on `day` (defaults to s's day), clamped to month end. */
export function addMonthsClamped(s: ISODate, months: number, day?: number): ISODate {
  const { y, m, d } = parseISODate(s);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return toISODate(ny, nm, Math.min(day ?? d, daysInMonth(ny, nm)));
}

/** Date in the same month as s on `day`, clamped to the month end. */
export function withDayClamped(s: ISODate, day: number): ISODate {
  const { y, m } = parseISODate(s);
  return toISODate(y, m, Math.min(day, daysInMonth(y, m)));
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(s: ISODate): number {
  return new Date(toEpochDay(s) * DAY_MS).getUTCDay();
}

export function isWeekend(s: ISODate, weekendDays: readonly number[] = [0, 6]): boolean {
  return weekendDays.includes(dayOfWeek(s));
}

/** Today's calendar date in an IANA time zone. */
export function todayInZone(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Current hour (0-23) in an IANA time zone. */
export function hourInZone(timeZone: string, now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h);
}

/** Year fraction between two dates on a 365/360 day basis. */
export function yearFraction(a: ISODate, b: ISODate, basis: 365 | 360 = 365): number {
  return daysBetween(a, b) / basis;
}
