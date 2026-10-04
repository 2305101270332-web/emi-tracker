import type { LoanAccess } from "@emi/shared";
import { ApiError, notFound } from "./errors";

type Row = Record<string, unknown>;

export interface LoanAccessCtx {
  role: LoanAccess;
  ownerId: string;
  ownerName: string | null;
  /** The loan row (owner's data). */
  loan: Row;
}

const RANK: Record<LoanAccess, number> = { view: 1, edit: 2, owner: 3 };

/**
 * Resolve the caller's role on a loan. Loans the caller neither owns nor has an
 * active share for are reported as 404 (their existence is not revealed).
 */
export async function loanAccess(db: D1Database, userId: string, loanId: string): Promise<LoanAccessCtx> {
  const row = await db
    .prepare(
      `SELECT l.*, CASE WHEN l.user_id = ?1 THEN 'owner' ELSE s.access END AS caller_role, u.name AS owner_display_name
       FROM loans l
       LEFT JOIN loan_shares s ON s.loan_id = l.id AND s.owner_id = l.user_id AND s.user_id = ?1
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.id = ?2 AND (l.user_id = ?1 OR s.user_id = ?1)`,
    )
    .bind(userId, loanId)
    .first<Row>();
  if (!row || !row.caller_role) throw notFound("loan_not_found");
  return {
    role: String(row.caller_role) as LoanAccess,
    ownerId: String(row.user_id),
    ownerName: row.owner_display_name ? String(row.owner_display_name) : null,
    loan: row,
  };
}

/** 403 when the caller's role is below `min` (they can see the loan, so 404 would be misleading). */
export function requireRole(ctx: LoanAccessCtx, min: LoanAccess): void {
  if (RANK[ctx.role] < RANK[min]) throw new ApiError(403, min === "owner" ? "owner_only" : "read_only");
}

export async function accessFor(db: D1Database, userId: string, loanId: string, min: LoanAccess): Promise<LoanAccessCtx> {
  const ctx = await loanAccess(db, userId, loanId);
  requireRole(ctx, min);
  return ctx;
}

export const viewerOf = (userId: string, ctx: LoanAccessCtx) => ({ userId, role: ctx.role, ownerName: ctx.ownerName });
