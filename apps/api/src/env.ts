export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  RATE_LIMITER?: RateLimit;
  /** Cloudflare version metadata: id, tag (we set the git commit) and deploy timestamp. */
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };

  ENVIRONMENT: "production" | "development" | "test";
  APP_ORIGIN: string;
  API_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  EMAIL_DAILY_CAP?: string;

  // Secrets (wrangler secret put)
  SESSION_SECRET: string;
  VAPID_PRIVATE_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_WEBHOOK_SECRET?: string;
}

export interface Variables {
  userId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
