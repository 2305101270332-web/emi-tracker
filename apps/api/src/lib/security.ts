import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "./errors";

/**
 * CSRF defence in depth on top of SameSite=Lax cookies: state-changing
 * requests must come from the app (or API) origin when an Origin header is sent.
 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin && origin !== c.env.APP_ORIGIN && origin !== c.env.API_ORIGIN) {
      throw new ApiError(403, "bad_origin");
    }
  }
  await next();
};

// Fallback limiter when the Workers rate-limit binding is absent (tests, older wrangler).
const buckets = new Map<string, { count: number; reset: number }>();

/** Tests only: clear the in-memory fallback limiter between cases. */
export const resetRateLimits = () => buckets.clear();

async function allow(env: AppEnv["Bindings"], key: string, limit: number): Promise<boolean> {
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return success;
  }
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + 60_000 });
    if (buckets.size > 10_000) buckets.clear();
    return true;
  }
  b.count++;
  return b.count <= limit;
}

/** Rate limit by user (when signed in) or client IP. */
export function rateLimit(scope: string, limitPerMinute = 120): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const who = c.get("userId") ?? c.req.header("CF-Connecting-IP") ?? "anon";
    if (!(await allow(c.env, `${scope}:${who}`, limitPerMinute))) throw new ApiError(429, "rate_limited");
    await next();
  };
}

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
};
