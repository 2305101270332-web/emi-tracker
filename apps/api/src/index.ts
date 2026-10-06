import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiVersion } from "@emi/shared";
import type { AppEnv, Env } from "./env";
import { requireAuth } from "./lib/auth";
import { errorHandler } from "./lib/errors";
import { originGuard, rateLimit, securityHeaders } from "./lib/security";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth";
import { cardRoutes, lenderRoutes } from "./routes/lenders-cards";
import { documentRoutes } from "./routes/documents";
import { expenseRoutes } from "./routes/expenses";
import { dashboardRoutes, instalmentRoutes, loanRoutes } from "./routes/loans";
import { notificationRoutes, publicEmailRoutes, pushRoutes } from "./routes/notify";
import { runReminders } from "./services/reminders";

export function createApp() {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) =>
    cors({
      origin: (origin) => (origin === c.env.APP_ORIGIN ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    })(c, next),
  );
  app.use("*", securityHeaders);
  app.use("*", originGuard);

  app.get("/health", (c) => c.json({ ok: true }));
  /** Public build info for the Settings "About" panel (the repo is public, so nothing secret here). */
  app.get("/version", (c) => {
    const m = c.env.CF_VERSION_METADATA;
    const info: ApiVersion = {
      environment: c.env.ENVIRONMENT,
      commit: m?.tag || null,
      versionId: m?.id || null,
      deployedAt: m?.timestamp || null,
    };
    c.header("Cache-Control", "no-store");
    return c.json(info);
  });
  app.route("/", publicEmailRoutes);
  app.route("/auth", authRoutes);

  const authed = new Hono<AppEnv>();
  authed.use("*", requireAuth, rateLimit("api", 240));
  authed.route("/", accountRoutes);
  authed.route("/lenders", lenderRoutes);
  authed.route("/cards", cardRoutes);
  authed.route("/loans", loanRoutes);
  authed.route("/instalments", instalmentRoutes);
  authed.route("/dashboard", dashboardRoutes);
  authed.route("/expenses", expenseRoutes);
  authed.route("/notifications", notificationRoutes);
  authed.route("/push", pushRoutes);
  authed.route("/", documentRoutes);
  app.route("/", authed);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError(errorHandler);
  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runReminders(env)
        .then((r) => console.log("reminders", JSON.stringify(r)))
        .catch((err) => console.error("reminder run failed", err)),
    );
  },
} satisfies ExportedHandler<Env>;
