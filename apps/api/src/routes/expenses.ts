import { Hono } from "hono";
import { MAX_EXPENSES_PER_USER, expenseInputSchema, type Expense, type ExpenseInput } from "@emi/shared";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { newId } from "../lib/util";

/** Recurring fixed expenses for the monthly budget. Private to the user; never shared. */
export const expenseRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

function expenseFromRow(r: Row): Expense {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category) as Expense["category"],
    amount: Number(r.amount),
    currency: String(r.currency),
    frequency: String(r.frequency) as Expense["frequency"],
    active: Number(r.active) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const values = (e: ExpenseInput) => [e.name, e.category, e.amount, e.currency, e.frequency, e.active ? 1 : 0];

async function getExpense(db: D1Database, userId: string, id: string): Promise<Expense> {
  const row = await db.prepare("SELECT * FROM expenses WHERE id = ? AND user_id = ?").bind(id, userId).first<Row>();
  if (!row) throw notFound("expense_not_found");
  return expenseFromRow(row);
}

expenseRoutes.get("/", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM expenses WHERE user_id = ? ORDER BY category, name").bind(c.get("userId")).all<Row>();
  return c.json(res.results.map(expenseFromRow));
});

expenseRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const input = expenseInputSchema.parse(await c.req.json());
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?").bind(userId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= MAX_EXPENSES_PER_USER) throw new ApiError(422, "too_many_expenses");
  const id = newId();
  await c.env.DB.prepare("INSERT INTO expenses (id, user_id, name, category, amount, currency, frequency, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, ...values(input))
    .run();
  return c.json(await getExpense(c.env.DB, userId, id), 201);
});

expenseRoutes.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const input = expenseInputSchema.parse(await c.req.json());
  const res = await c.env.DB.prepare(
    `UPDATE expenses SET name = ?, category = ?, amount = ?, currency = ?, frequency = ?, active = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?`,
  )
    .bind(...values(input), id, userId)
    .run();
  if (!res.meta.changes) throw notFound("expense_not_found");
  return c.json(await getExpense(c.env.DB, userId, id));
});

expenseRoutes.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("userId")).run();
  if (!res.meta.changes) throw notFound("expense_not_found");
  return c.body(null, 204);
});
