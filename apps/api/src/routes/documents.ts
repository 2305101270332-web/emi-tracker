import { Hono } from "hono";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, DOCUMENT_USER_QUOTA_BYTES } from "@emi/shared";
import type { AppEnv } from "../env";
import { ApiError, notFound } from "../lib/errors";
import { newId } from "../lib/util";
import { getLoanDetail } from "../services/loans";

/**
 * Loan documents (sanction letters, statements) in R2. Files only ever pass through
 * the Worker: there are no public bucket URLs, and every read checks ownership.
 * Uploads are the raw request body (no multipart parsing) to keep CPU time low.
 */
export const documentRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

/** Detect the real file type from magic bytes; never trust the client's Content-Type alone. */
export function sniffType(bytes: Uint8Array): (typeof DOCUMENT_TYPES)[number] | null {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

const cleanFilename = (name: string) =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "document";

/** POST /loans/:loanId/documents?filename=x.pdf  (body = file bytes) */
documentRoutes.post("/loans/:loanId/documents", async (c) => {
  const userId = c.get("userId");
  const loanId = c.req.param("loanId");
  const loan = await c.env.DB.prepare("SELECT id FROM loans WHERE id = ? AND user_id = ?").bind(loanId, userId).first();
  if (!loan) throw notFound("loan_not_found");

  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > DOCUMENT_MAX_BYTES) throw new ApiError(413, "file_too_large");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) throw new ApiError(400, "empty_file");
  if (bytes.byteLength > DOCUMENT_MAX_BYTES) throw new ApiError(413, "file_too_large");
  const type = sniffType(bytes);
  if (!type) throw new ApiError(415, "unsupported_file_type");

  const used = await c.env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM documents WHERE user_id = ?").bind(userId).first<{ used: number }>();
  if (Number(used?.used ?? 0) + bytes.byteLength > DOCUMENT_USER_QUOTA_BYTES) throw new ApiError(413, "storage_quota_exceeded");

  const id = newId();
  const key = `u/${userId}/${loanId}/${id}`;
  const filename = cleanFilename(c.req.query("filename") ?? "document");
  await c.env.DOCS.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { userId, loanId } });
  try {
    await c.env.DB.prepare("INSERT INTO documents (id, user_id, loan_id, r2_key, filename, content_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, userId, loanId, key, filename, type, bytes.byteLength)
      .run();
  } catch (e) {
    await c.env.DOCS.delete(key);
    throw e;
  }
  return c.json(await getLoanDetail(c.env.DB, userId, loanId), 201);
});

documentRoutes.get("/documents/:id", async (c) => {
  const userId = c.get("userId");
  const doc = await c.env.DB.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).first<Row>();
  if (!doc) throw notFound("document_not_found");
  const obj = await c.env.DOCS.get(String(doc.r2_key));
  if (!obj) throw notFound("document_not_found");
  const filename = String(doc.filename);
  return new Response(obj.body, {
    headers: {
      "Content-Type": String(doc.content_type),
      "Content-Length": String(doc.size),
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

documentRoutes.delete("/documents/:id", async (c) => {
  const userId = c.get("userId");
  const doc = await c.env.DB.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).first<Row>();
  if (!doc) throw notFound("document_not_found");
  await c.env.DOCS.delete(String(doc.r2_key));
  await c.env.DB.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").bind(String(doc.id), userId).run();
  return c.json(await getLoanDetail(c.env.DB, userId, String(doc.loan_id)));
});
