import { Hono } from "hono";
import { settingsPatchSchema, type Me, type Settings } from "@emi/shared";
import type { AppEnv } from "../env";
import { notFound } from "../lib/errors";
import { SETTINGS_COLUMNS, settingsFromRow, settingsValue } from "../services/repo";

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get("/me", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(
    "SELECT u.id, u.email, u.name, u.picture, s.* FROM users u JOIN settings s ON s.user_id = u.id WHERE u.id = ?",
  )
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) throw notFound("user_not_found");
  const me: Me = {
    user: { id: String(row.id), email: String(row.email), name: String(row.name), picture: row.picture ? String(row.picture) : null },
    settings: settingsFromRow(row),
  };
  return c.json(me);
});

accountRoutes.patch("/settings", async (c) => {
  const userId = c.get("userId");
  const patch = settingsPatchSchema.parse(await c.req.json());
  const keys = Object.keys(patch) as (keyof Settings)[];
  if (keys.length) {
    const sets = keys.map((k) => `${SETTINGS_COLUMNS[k]} = ?`).join(", ");
    await c.env.DB.prepare(`UPDATE settings SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?`)
      .bind(...keys.map((k) => settingsValue(k, patch[k])), userId)
      .run();
  }
  const row = await c.env.DB.prepare("SELECT * FROM settings WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();
  return c.json(settingsFromRow(row!));
});
