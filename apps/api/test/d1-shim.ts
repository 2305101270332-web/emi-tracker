/**
 * Minimal D1Database implementation on Node's built-in node:sqlite so the API
 * can be integration-tested against the real migrations without Miniflare.
 */
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Loaded via require: Vite 5 does not know node:sqlite is a builtin.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncT;

type Param = string | number | null;

const isReader = (sql: string) => /^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql);

class Stmt {
  constructor(
    private db: DatabaseSync,
    public sql: string,
    private params: Param[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Stmt(
      this.db,
      this.sql,
      params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : (p as Param))),
    );
  }
  private exec() {
    const s = this.db.prepare(this.sql);
    if (isReader(this.sql)) return { rows: s.all(...this.params) as Record<string, unknown>[], changes: 0 };
    const r = s.run(...this.params);
    return { rows: [] as Record<string, unknown>[], changes: Number(r.changes) };
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.exec().rows[0];
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>() {
    const { rows, changes } = this.exec();
    return { results: rows.map((r) => ({ ...r })) as T[], success: true, meta: { changes } };
  }
  async run() {
    const { changes } = this.exec();
    return { results: [], success: true, meta: { changes } };
  }
  async raw() {
    return this.exec().rows.map((r) => Object.values(r));
  }
}

export class D1Shim {
  readonly db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.all());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
  migrate(dir: string) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      this.db.exec(readFileSync(join(dir, f), "utf8"));
    }
    return this;
  }
}
