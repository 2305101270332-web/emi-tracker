import { Hono } from "hono";
import { cardInputSchema, lenderInputSchema } from "@emi/shared";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { newId } from "../lib/util";
import { regenerateSchedule } from "../services/loans";
import { cardFromRow, lenderFromRow, loanInputFromRow } from "../services/repo";

export const lenderRoutes = new Hono<AppEnv>();
export const cardRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

// ---- Lenders ------------------------------------------------------------------------------

lenderRoutes.get("/", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM lenders WHERE user_id IS NULL OR user_id = ? ORDER BY country, name")
    .bind(c.get("userId"))
    .all<Row>();
  return c.json(res.results.map(lenderFromRow));
});

lenderRoutes.post("/", async (c) => {
  const input = lenderInputSchema.parse(await c.req.json());
  const id = newId();
  const initial = (input.initial || input.name.trim()[0] || "?").toUpperCase().slice(0, 2);
  await c.env.DB.prepare("INSERT INTO lenders (id, user_id, name, country, color, initial) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, c.get("userId"), input.name, input.country, input.color, initial)
    .run();
  return c.json({ id, ...input, initial, custom: true }, 201);
});

lenderRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const inUse = await c.env.DB.prepare("SELECT 1 FROM loans WHERE lender_id = ? AND user_id = ? LIMIT 1").bind(id, userId).first();
  if (inUse) throw new ApiError(409, "lender_in_use");
  const res = await c.env.DB.prepare("DELETE FROM lenders WHERE id = ? AND user_id = ?").bind(id, userId).run();
  if (!res.meta.changes) throw notFound();
  return c.body(null, 204);
});

// ---- Cards --------------------------------------------------------------------------------

async function assertLender(db: D1Database, userId: string, lenderId: string | null | undefined) {
  if (!lenderId) return;
  const ok = await db.prepare("SELECT 1 FROM lenders WHERE id = ? AND (user_id IS NULL OR user_id = ?)").bind(lenderId, userId).first();
  if (!ok) throw new ApiError(422, "lender_not_found");
}

cardRoutes.get("/", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM cards WHERE user_id = ? ORDER BY nickname").bind(c.get("userId")).all<Row>();
  return c.json(res.results.map(cardFromRow));
});

cardRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const input = cardInputSchema.parse(await c.req.json());
  await assertLender(c.env.DB, userId, input.lenderId);
  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO cards (id, user_id, lender_id, nickname, last4, statement_day, due_day, grace_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, userId, input.lenderId ?? null, input.nickname, input.last4 ?? null, input.statementDay, input.dueDay ?? null, input.graceDays ?? null)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<Row>();
  return c.json(cardFromRow(row!), 201);
});

cardRoutes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const input = cardInputSchema.parse(await c.req.json());
  await assertLender(c.env.DB, userId, input.lenderId);
  const res = await c.env.DB.prepare(
    "UPDATE cards SET lender_id = ?, nickname = ?, last4 = ?, statement_day = ?, due_day = ?, grace_days = ? WHERE id = ? AND user_id = ?",
  )
    .bind(input.lenderId ?? null, input.nickname, input.last4 ?? null, input.statementDay, input.dueDay ?? null, input.graceDays ?? null, id, userId)
    .run();
  if (!res.meta.changes) throw notFound("card_not_found");
  const card = cardFromRow((await c.env.DB.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<Row>())!);
  // Billing cycle changed: payable dates of linked card EMIs must be re-derived.
  const loans = await c.env.DB.prepare("SELECT * FROM loans WHERE card_id = ? AND user_id = ?").bind(id, userId).all<Row>();
  for (const l of loans.results) await regenerateSchedule(c.env.DB, userId, String(l.id), loanInputFromRow(l), card);
  return c.json(card);
});

cardRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const inUse = await c.env.DB.prepare("SELECT 1 FROM loans WHERE card_id = ? AND user_id = ? LIMIT 1").bind(id, userId).first();
  if (inUse) throw new ApiError(409, "card_in_use");
  const res = await c.env.DB.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").bind(id, userId).run();
  if (!res.meta.changes) throw notFound("card_not_found");
  return c.body(null, 204);
});
