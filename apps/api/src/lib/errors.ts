import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { ScheduleError } from "@emi/core";

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503,
    public readonly code: string,
    message?: string,
  ) {
    super(status, { message: message ?? code });
  }
}

export const notFound = (what = "not_found") => new ApiError(404, what);

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  }
  if (err instanceof ScheduleError) {
    return c.json({ error: "schedule_error", message: err.message, issues: [{ path: [err.code], message: err.message }] }, 422);
  }
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: "http_error", message: err.message }, err.status);
  }
  console.error("Unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
}
