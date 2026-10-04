import { Hono } from "hono";
import { z } from "zod";
import { isValidISODate } from "@emi/core";
import { instalmentStatusPatchSchema, isoDate, loanInputSchema, overrideSchema, paymentInputSchema, type LoanInput } from "@emi/shared";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { newId } from "../lib/util";
import { getDashboard, getLoanDetail, listInstalmentsInRange, listLoans, loadCard, regenerateSchedule } from "../services/loans";
import { loanColumns, loanInputFromRow } from "../services/repo";

export const loanRoutes = new Hono<AppEnv>();
export const instalmentRoutes = new Hono<AppEnv>();
export const dashboardRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

async function assertLender(db: D1Database, userId: string, lenderId: string) {
  const ok = await db.prepare("SELECT 1 FROM lenders WHERE id = ? AND (user_id IS NULL OR user_id = ?)").bind(lenderId, userId).first();
  if (!ok) throw new ApiError(422, "lender_not_found");
}

async function loadLoanRow(db: D1Database, userId: string, id: string): Promise<Row> {
  const row = await db.prepare("SELECT * FROM loans WHERE id = ? AND user_id = ?").bind(id, userId).first<Row>();
  if (!row) throw notFound("loan_not_found");
  return row;
}

// ---- Loans --------------------------------------------------------------------------------

loanRoutes.get("/", async (c) => c.json(await listLoans(c.env.DB, c.get("userId"))));

loanRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const input: LoanInput = loanInputSchema.parse(await c.req.json());
  await assertLender(c.env.DB, userId, input.lenderId);
  const card = input.type === "credit_card_emi" ? await loadCard(c.env.DB, userId, input.cardId) : null;
  const id = newId();
  const cols = loanColumns(input);
  const names = Object.keys(cols);
  await c.env.DB.prepare(
    `INSERT INTO loans (id, user_id, ${names.join(", ")}) VALUES (?, ?, ${names.map(() => "?").join(", ")})`,
  )
    .bind(id, userId, ...Object.values(cols))
    .run();
  try {
    await regenerateSchedule(c.env.DB, userId, id, input, card);
  } catch (err) {
    await c.env.DB.prepare("DELETE FROM loans WHERE id = ? AND user_id = ?").bind(id, userId).run();
    throw err;
  }
  return c.json(await getLoanDetail(c.env.DB, userId, id), 201);
});

loanRoutes.get("/:id", async (c) => c.json(await getLoanDetail(c.env.DB, c.get("userId"), c.req.param("id"))));

loanRoutes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const previous = await loadLoanRow(c.env.DB, userId, id);
  const input: LoanInput = loanInputSchema.parse(await c.req.json());
  await assertLender(c.env.DB, userId, input.lenderId);
  const card = input.type === "credit_card_emi" ? await loadCard(c.env.DB, userId, input.cardId) : null;
  const cols = loanColumns(input);
  const sets = Object.keys(cols).map((k) => `${k} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE loans SET ${sets} WHERE id = ? AND user_id = ?`).bind(...Object.values(cols), id, userId).run();
  try {
    await regenerateSchedule(c.env.DB, userId, id, input, card);
  } catch (err) {
    // Roll the terms back so the stored loan and schedule stay consistent.
    const old = loanColumns(loanInputFromRow(previous));
    await c.env.DB.prepare(`UPDATE loans SET ${Object.keys(old).map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND user_id = ?`)
      .bind(...Object.values(old), id, userId)
      .run();
    throw err;
  }
  return c.json(await getLoanDetail(c.env.DB, userId, id));
});

loanRoutes.patch("/:id/mute", async (c) => {
  const userId = c.get("userId");
  const { muted } = z.object({ muted: z.boolean() }).parse(await c.req.json());
  const res = await c.env.DB.prepare("UPDATE loans SET muted = ? WHERE id = ? AND user_id = ?").bind(muted ? 1 : 0, c.req.param("id"), userId).run();
  if (!res.meta.changes) throw notFound("loan_not_found");
  return c.json({ muted });
});

loanRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await loadLoanRow(c.env.DB, userId, id);
  const docs = await c.env.DB.prepare("SELECT r2_key FROM documents WHERE loan_id = ? AND user_id = ?").bind(id, userId).all<Row>();
  if (docs.results.length) await c.env.DOCS.delete(docs.results.map((d) => String(d.r2_key)));
  await c.env.DB.batch(
    ["payments", "instalments", "rate_changes", "documents", "notifications"].map((t) =>
      c.env.DB.prepare(`DELETE FROM ${t} WHERE loan_id = ? AND user_id = ?`).bind(id, userId),
    ).concat(c.env.DB.prepare("DELETE FROM loans WHERE id = ? AND user_id = ?").bind(id, userId)),
  );
  return c.body(null, 204);
});

/** Manually set (or clear with null) an instalment's EMI so the schedule matches the bank statement. */
loanRoutes.put("/:id/instalments/:n/override", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const n = Number(c.req.param("n"));
  const { amount } = overrideSchema.parse(await c.req.json());
  const row = await loadLoanRow(c.env.DB, userId, id);
  const input = loanInputFromRow(row);
  if (!Number.isInteger(n) || n < 1 || n >= input.tenureMonths) throw new ApiError(422, "override_out_of_range");
  const prev = await c.env.DB.prepare("SELECT override_amount FROM instalments WHERE loan_id = ? AND n = ? AND user_id = ?")
    .bind(id, n, userId)
    .first<{ override_amount: number | null }>();
  await c.env.DB.prepare("UPDATE instalments SET override_amount = ? WHERE loan_id = ? AND n = ? AND user_id = ?").bind(amount, id, n, userId).run();
  try {
    await regenerateSchedule(c.env.DB, userId, id, input, await loadCard(c.env.DB, userId, input.cardId));
  } catch (err) {
    await c.env.DB.prepare("UPDATE instalments SET override_amount = ? WHERE loan_id = ? AND n = ? AND user_id = ?")
      .bind(prev?.override_amount ?? null, id, n, userId)
      .run();
    throw err;
  }
  return c.json(await getLoanDetail(c.env.DB, userId, id));
});

// ---- Instalments --------------------------------------------------------------------------

instalmentRoutes.get("/", async (c) => {
  const q = z.object({ from: isoDate, to: isoDate }).parse({ from: c.req.query("from"), to: c.req.query("to") });
  if (q.from > q.to) throw new ApiError(400, "bad_range");
  return c.json(await listInstalmentsInRange(c.env.DB, c.get("userId"), q.from, q.to));
});

async function loadInstalment(db: D1Database, userId: string, id: string): Promise<Row> {
  const row = await db.prepare("SELECT * FROM instalments WHERE id = ? AND user_id = ?").bind(id, userId).first<Row>();
  if (!row) throw notFound("instalment_not_found");
  return row;
}

instalmentRoutes.post("/:id/payment", async (c) => {
  const userId = c.get("userId");
  const inst = await loadInstalment(c.env.DB, userId, c.req.param("id"));
  const p = paymentInputSchema.parse(await c.req.json());
  if (!isValidISODate(p.paidDate)) throw new ApiError(400, "invalid_date");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO payments (id, user_id, loan_id, instalment_id, paid_date, amount_paid, late_fee, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instalment_id) DO UPDATE SET paid_date = excluded.paid_date, amount_paid = excluded.amount_paid,
         late_fee = excluded.late_fee, note = excluded.note`,
    ).bind(newId(), userId, String(inst.loan_id), String(inst.id), p.paidDate, p.amountPaid, p.lateFee, p.note ?? null),
    c.env.DB.prepare("UPDATE instalments SET skipped = 0 WHERE id = ? AND user_id = ?").bind(String(inst.id), userId),
  ]);
  return c.json(await getLoanDetail(c.env.DB, userId, String(inst.loan_id)));
});

instalmentRoutes.delete("/:id/payment", async (c) => {
  const userId = c.get("userId");
  const inst = await loadInstalment(c.env.DB, userId, c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM payments WHERE instalment_id = ? AND user_id = ?").bind(String(inst.id), userId).run();
  return c.json(await getLoanDetail(c.env.DB, userId, String(inst.loan_id)));
});

instalmentRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const inst = await loadInstalment(c.env.DB, userId, c.req.param("id"));
  const { skipped } = instalmentStatusPatchSchema.parse(await c.req.json());
  await c.env.DB.prepare("UPDATE instalments SET skipped = ? WHERE id = ? AND user_id = ?").bind(skipped ? 1 : 0, String(inst.id), userId).run();
  return c.json(await getLoanDetail(c.env.DB, userId, String(inst.loan_id)));
});

// ---- Dashboard ----------------------------------------------------------------------------

dashboardRoutes.get("/", async (c) => c.json(await getDashboard(c.env.DB, c.get("userId"))));
