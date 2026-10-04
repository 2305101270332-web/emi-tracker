import { Hono, type Context } from "hono";
import { countryDefaults, googleLoginSchema } from "@emi/shared";
import type { AppEnv } from "../env";
import { clearSession, issueSession, requireAuth, verifyGoogleIdToken, type GoogleIdentity } from "../lib/auth";
import { seedDemo } from "../services/demo";
import { ApiError } from "../lib/errors";
import { rateLimit } from "../lib/security";
import { newId, nowIso } from "../lib/util";
import { sendEmail, welcomeEmail } from "../services/email";

export const authRoutes = new Hono<AppEnv>();

/** Create the user (and default settings by request country) on first login; returns user id. */
export async function upsertUser(c: Context<AppEnv>, g: GoogleIdentity): Promise<{ id: string; created: boolean }> {
  const db = c.env.DB;
  const existing = await db.prepare("SELECT id FROM users WHERE google_sub = ?").bind(g.sub).first<{ id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE users SET email = ?, name = ?, picture = ?, last_login_at = ? WHERE id = ?")
      .bind(g.email, g.name, g.picture, nowIso(), existing.id)
      .run();
    return { id: existing.id, created: false };
  }
  const id = newId();
  const country = (c.req.raw as Request & { cf?: { country?: string } }).cf?.country ?? c.req.header("CF-IPCountry") ?? "IN";
  const d = countryDefaults(country);
  await db.batch([
    db
      .prepare("INSERT INTO users (id, google_sub, email, name, picture, last_login_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, g.sub, g.email, g.name, g.picture, nowIso()),
    db
      .prepare(
        "INSERT INTO settings (user_id, country, currency, locale, time_zone, date_format, tax_label, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, d.code, d.currency, d.locale, d.timeZone, d.dateFormat, d.taxLabel, d.taxRate),
  ]);
  return { id, created: true };
}

async function sendWelcome(c: Context<AppEnv>, userId: string, g: GoogleIdentity) {
  const s = await c.env.DB.prepare("SELECT locale, date_format FROM settings WHERE user_id = ?").bind(userId).first<{ locale: string; date_format: string }>();
  const email = welcomeEmail(
    { id: userId, email: g.email, name: g.name, locale: s?.locale ?? "en", dateFormat: (s?.date_format ?? "DD/MM/YYYY") as never },
    c.env.APP_ORIGIN,
  );
  const result = await sendEmail(c.env, email);
  await c.env.DB.prepare(
    `INSERT INTO notifications (id, user_id, channel, kind, dedupe_key, title, body, status, error, send_id)
     VALUES (?, ?, 'email', 'welcome', ?, ?, '', ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
  )
    .bind(newId(), userId, `email:welcome:${userId}`, email.subject, result.ok ? "sent" : "failed", result.error ?? null, newId())
    .run();
  if (!result.ok && result.error !== "email_not_configured") console.error("welcome email failed", result.error);
}

authRoutes.post("/google", rateLimit("auth", 20), async (c) => {
  const { credential } = googleLoginSchema.parse(await c.req.json());
  const g = await verifyGoogleIdToken(credential, c.env.GOOGLE_CLIENT_ID);
  const { id, created } = await upsertUser(c, g);
  await issueSession(c, id);
  if (created) c.executionCtx.waitUntil(sendWelcome(c, id, g));
  return c.json({ ok: true, created });
});

/** Local development only: sign in as a demo user without Google. */
authRoutes.post("/dev", async (c) => {
  if (c.env.ENVIRONMENT !== "development" && c.env.ENVIRONMENT !== "test") throw new ApiError(404, "not_found");
  const { id } = await upsertUser(c, { sub: "dev-demo-user", email: "demo@example.com", name: "Demo User", picture: null });
  await issueSession(c, id);
  return c.json({ ok: true });
});

/** Local development only: fill the signed-in account with sample loans. */
authRoutes.post("/dev/seed", requireAuth, async (c) => {
  if (c.env.ENVIRONMENT !== "development" && c.env.ENVIRONMENT !== "test") throw new ApiError(404, "not_found");
  return c.json({ created: await seedDemo(c.env.DB, c.get("userId")) });
});

authRoutes.post("/logout", async (c) => {
  clearSession(c);
  return c.json({ ok: true });
});
