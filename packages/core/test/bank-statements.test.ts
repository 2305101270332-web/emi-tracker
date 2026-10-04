import { describe, expect, it } from "vitest";
import { buildSchedule } from "../src";
import type { StatementFixture } from "./statements/statement";

/**
 * "Compare with bank statement": every *.statement.ts fixture must reproduce the
 * bank's printed figures exactly (to the paisa). Files starting with "_" are
 * templates and run only as a harness self-check.
 */
const modules = import.meta.glob<{ default: StatementFixture }>("./statements/*.statement.ts", { eager: true });

const entries = Object.entries(modules).map(([path, m]) => ({ path, file: path.split("/").pop()!, fixture: m.default }));
const real = entries.filter((e) => !e.file.startsWith("_"));
const templates = entries.filter((e) => e.file.startsWith("_"));

function check(f: StatementFixture) {
  const s = buildSchedule(f.terms);
  const mismatches: string[] = [];
  for (const [k, v] of Object.entries(f.expect.summary ?? {})) {
    const got = s.summary[k as keyof typeof s.summary];
    if (got !== v) mismatches.push(`summary.${k}: bank ${v}, engine ${got}`);
  }
  for (const want of f.expect.rows ?? []) {
    const row = s.rows[want.n - 1];
    if (!row) {
      mismatches.push(`row ${want.n}: missing (schedule has ${s.rows.length} rows)`);
      continue;
    }
    for (const [k, v] of Object.entries(want)) {
      if (k === "n") continue;
      const got = row[k as keyof typeof row];
      if (got !== v) mismatches.push(`row ${want.n}.${k}: bank ${v}, engine ${got}`);
    }
  }
  return mismatches;
}

describe("bank statement comparison", () => {
  it.each(templates.map((e) => [e.file, e.fixture] as const))("harness self-check: %s", (_f, fixture) => {
    expect(check(fixture)).toEqual([]);
  });

  if (real.length === 0) {
    it.todo("add real loan statements in packages/core/test/statements/");
  }

  it.each(real.map((e) => [`${e.fixture.name} (${e.fixture.source})`, e.fixture] as const))("matches %s to the paisa", (_n, fixture) => {
    expect(check(fixture)).toEqual([]);
  });
});
