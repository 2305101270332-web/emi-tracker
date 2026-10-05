import { Hono } from "hono";
import { z } from "zod";
import { createTranslator, pushSubscriptionSchema, type AppNotification } from "@emi/shared";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { rateLimit } from "../lib/security";
import { newId } from "../lib/util";
import { verifyResendWebhook, verifyUnsubscribeToken, type UnsubKind } from "../services/email";
import { sendPush } from "../services/push";

export const notificationRoutes = new Hono<AppEnv>();
export const pushRoutes = new Hono<AppEnv>();
/** Public (no session) routes: unsubscribe links and the Resend webhook. */
export const publicEmailRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

// ---- In-app notification centre ------------------------------------------------------------

notificationRoutes.get("/", async (c) => {
  const res = await c.env.DB.prepare(
    "SELECT * FROM notifications WHERE user_id = ? AND channel = 'inapp' ORDER BY created_at DESC LIMIT 100",
  )
    .bind(c.get("userId"))
    .all<Row>();
  const list: AppNotification[] = res.results.map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    body: String(r.body),
    loanId: r.loan_id ? String(r.loan_id) : null,
    instalmentId: r.instalment_id ? String(r.instalment_id) : null,
    createdAt: String(r.created_at),
    readAt: r.read_at ? String(r.read_at) : null,
  }));
  return c.json(list);
});

notificationRoutes.post("/read-all", async (c) => {
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND channel = 'inapp' AND read_at IS NULL",
  )
    .bind(c.get("userId"))
    .run();
  return c.json({ ok: true });
});

notificationRoutes.post("/:id/read", async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ? AND channel = 'inapp'",
  )
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  if (!res.meta.changes) throw notFound();
  return c.json({ ok: true });
});

// ---- Web Push subscriptions ------------------------------------------------------------------

pushRoutes.get("/vapid-public-key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY || null }));

pushRoutes.post("/subscribe", async (c) => {
  const userId = c.get("userId");
  const sub = pushSubscriptionSchema.parse(await c.req.json());
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(newId(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, (c.req.header("User-Agent") ?? "").slice(0, 200))
    .run();
  return c.json({ ok: true }, 201);
});

pushRoutes.post("/unsubscribe", async (c) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await c.req.json());
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, c.get("userId")).run();
  return c.json({ ok: true });
});

pushRoutes.post("/test", rateLimit("push-test", 5), async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_KEY) throw new ApiError(503, "push_not_configured");
  const subs = await c.env.DB.prepare("SELECT * FROM push_subscriptions WHERE user_id = ? LIMIT 5").bind(c.get("userId")).all<Row>();
  const t = createTranslator("en");
  let sent = 0;
  for (const s of subs.results) {
    const r = await sendPush(
      { endpoint: String(s.endpoint), p256dh: String(s.p256dh), auth: String(s.auth) },
      { title: t("notifications.testTitle"), body: t("notifications.testBody"), url: "/" },
      { publicKey: c.env.VAPID_PUBLIC_KEY, privateKey: c.env.VAPID_PRIVATE_KEY, subject: c.env.VAPID_SUBJECT },
    );
    if (r.ok) sent++;
    if (r.expired) await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(String(s.id)).run();
  }
  return c.json({ sent });
});

// ---- Email: unsubscribe + Resend webhook -----------------------------------------------------

const unsubQuery = z.object({ u: z.string().min(1).max(64), k: z.enum(["reminders", "weekly"]), s: z.string().min(10).max(100) });

async function applyUnsubscribe(env: AppEnv["Bindings"], q: z.infer<typeof unsubQuery>) {
  if (!(await verifyUnsubscribeToken(env.SESSION_SECRET, q.u, q.k as UnsubKind, q.s))) throw new ApiError(403, "bad_token");
  const col = q.k === "reminders" ? "email_reminders" : "weekly_summary";
  await env.DB.prepare(`UPDATE settings SET ${col} = 0 WHERE user_id = ?`).bind(q.u).run();
}

publicEmailRoutes.get("/email/unsubscribe", rateLimit("unsub", 30), async (c) => {
  const q = unsubQuery.parse(c.req.query());
  await applyUnsubscribe(c.env, q);
  const t = createTranslator("en");
  const kind = q.k === "reminders" ? t("email.kindReminders") : t("email.kindWeekly");
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t("email.unsubscribedTitle")}</title></head>
<body style="font-family:system-ui,sans-serif;background:#F6EEDC;color:#2B1510;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<main style="max-width:420px;background:#fff;border-radius:16px;padding:24px;border:1px solid #C9A227;box-shadow:0 2px 8px rgba(62,7,9,.12)">
<h1 style="color:#5E1014;font-family:Georgia,serif;font-size:22px;margin:0 0 8px">${t("email.unsubscribedTitle")}</h1>
<p style="color:#6B4A36;line-height:1.5">${t("email.unsubscribedBody", { kind })}</p>
<p><a href="${c.env.APP_ORIGIN}/settings" style="color:#8E1B1B">${t("nav.settings")}</a></p></main></body></html>`);
});

// RFC 8058 one-click unsubscribe (mail clients POST to the List-Unsubscribe URL).
publicEmailRoutes.post("/email/unsubscribe", rateLimit("unsub", 30), async (c) => {
  await applyUnsubscribe(c.env, unsubQuery.parse(c.req.query()));
  return c.json({ ok: true });
});

publicEmailRoutes.post("/webhooks/resend", async (c) => {
  if (!c.env.RESEND_WEBHOOK_SECRET) throw new ApiError(503, "webhook_not_configured");
  const body = await c.req.text();
  const ok = await verifyResendWebhook(
    c.env.RESEND_WEBHOOK_SECRET,
    { id: c.req.header("svix-id") ?? null, timestamp: c.req.header("svix-timestamp") ?? null, signature: c.req.header("svix-signature") ?? null },
    body,
  );
  if (!ok) throw new ApiError(401, "bad_signature");
  const event = JSON.parse(body) as { type?: string; data?: { to?: string[] | string } };
  if (event.type === "email.bounced" || event.type === "email.complained") {
    const to = Array.isArray(event.data?.to) ? event.data!.to : event.data?.to ? [event.data.to] : [];
    if (to.length) {
      await c.env.DB.prepare(`UPDATE users SET email_bounced = 1 WHERE lower(email) IN (SELECT lower(value) FROM json_each(?))`)
        .bind(JSON.stringify(to))
        .run();
      console.warn(`resend ${event.type}: suppressed ${to.length} address(es)`);
    }
  }
  return c.json({ ok: true });
});
