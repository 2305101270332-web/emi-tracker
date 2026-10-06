import { roundMinor, type Minor } from "@emi/core";
import type { LoanSplit } from "./schemas";

export interface SplitResult {
  /** Each other person's part, in the order they were added. */
  others: { name: string; amount: Minor }[];
  othersTotal: Minor;
  /** What is left for the user. */
  mine: Minor;
}

/**
 * Split one instalment between the user and the people on the loan. Percent shares are
 * rounded to minor units; fixed amounts are capped so the parts never exceed the instalment
 * (e.g. a smaller final instalment). The user pays whatever is left.
 */
export function splitAmount(amount: Minor, splits: readonly LoanSplit[] | undefined): SplitResult {
  let left = Math.max(0, amount);
  const others = (splits ?? []).map((s) => {
    const want = s.kind === "percent" ? roundMinor((amount * s.percent) / 100) : s.amount;
    const part = Math.min(left, want);
    left -= part;
    return { name: s.name, amount: part };
  });
  return { others, othersTotal: amount - left, mine: left };
}
