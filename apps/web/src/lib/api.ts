import type { ApiError } from "@emi/shared";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: ApiError | null,
  ) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
  }
  /** Field-path -> message map for form errors. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.body?.issues ?? []) out[i.path.join(".")] ??= i.message;
    return out;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new HttpError(res.status, json as ApiError | null);
  return json as T;
}
