/**
 * Transactional email via Resend's REST API (plain fetch, no SDK).
 * Templates are inline-styled responsive HTML with a plain-text fallback.
 */
import { createTranslator, formatDate, formatMoney, type DateFormat } from "@emi/shared";
import type { Env } from "../env";
import { b64Decode, b64urlEncode, hmacSha256, timingSafeEqual } from "../lib/util";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Our dedupe key, echoed back as a Resend tag for webhook correlation. */
  tag?: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

const RESEND_URL = "https://api.resend.com";

export function emailConfigured(env: Env): boolean {
  return !!(env.RESEND_API_KEY && env.RESEND_FROM);
}

function toResend(env: Env, e: OutgoingEmail) {
  return {
    from: env.RESEND_FROM,
    to: [e.to],
    subject: e.subject,
    html: e.html,
    text: e.text,
    headers: e.headers,
  };
}

export async function sendEmail(env: Env, e: OutgoingEmail): Promise<SendResult> {
  if (!emailConfigured(env)) return { ok: false, error: "email_not_configured" };
  const res = await fetch(`${RESEND_URL}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(toResend(env, e)),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `resend_${res.status}: ${(await res.text()).slice(0, 300)}` };
}

/** Send up to 100 emails in one request (one subrequest), per Resend's batch endpoint. */
export async function sendEmailBatch(env: Env, emails: OutgoingEmail[]): Promise<SendResult[]> {
  if (emails.length === 0) return [];
  if (!emailConfigured(env)) return emails.map(() => ({ ok: false, error: "email_not_configured" }));
  const res = await fetch(`${RESEND_URL}/emails/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(emails.slice(0, 100).map((e) => toResend(env, e))),
  });
  if (res.ok) return emails.map(() => ({ ok: true }));
  const err = `resend_${res.status}: ${(await res.text()).slice(0, 300)}`;
  return emails.map(() => ({ ok: false, error: err }));
}

// ---- Unsubscribe tokens -----------------------------------------------------------------

export type UnsubKind = "reminders" | "weekly";

export async function unsubscribeToken(secret: string, userId: string, kind: UnsubKind): Promise<string> {
  return b64urlEncode(await hmacSha256(secret, `unsub:${userId}:${kind}`));
}

export async function verifyUnsubscribeToken(secret: string, userId: string, kind: UnsubKind, token: string): Promise<boolean> {
  return timingSafeEqual(await unsubscribeToken(secret, userId, kind), token);
}

export async function unsubscribeUrl(env: Env, userId: string, kind: UnsubKind): Promise<string> {
  const s = await unsubscribeToken(env.SESSION_SECRET, userId, kind);
  return `${env.API_ORIGIN}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&k=${kind}&s=${s}`;
}

// ---- Resend webhook (Svix) signature ----------------------------------------------------

/** Verify a Resend webhook using the Svix scheme: HMAC-SHA256 over "id.timestamp.body". */
export async function verifyResendWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  const key = b64Decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const expected = btoa(String.fromCharCode(...(await hmacSha256(key, `${headers.id}.${headers.timestamp}.${body}`))));
  return headers.signature
    .split(" ")
    .map((s) => s.split(",")[1] ?? "")
    .some((sig) => timingSafeEqual(sig, expected));
}

// ---- Templates ----------------------------------------------------------------------------

const C = {
  primary: "#0077B6",
  primaryDark: "#023E8A",
  light: "#CAF0F8",
  accent: "#FF7A00",
  accentText: "#B35500",
  text: "#0B1B2B",
  muted: "#4A5B6C",
  bg: "#F3F9FC",
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export interface EmailUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  dateFormat: DateFormat;
}

function layout(opts: { heading: string; bodyHtml: string; ctaUrl: string; ctaLabel: string; footer: string; unsubUrl?: string; unsubLabel?: string }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(2,62,138,.08)">
<tr><td style="background:${C.primaryDark};padding:20px 24px;color:#ffffff;font-size:18px;font-weight:700">
<span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:${C.accent};color:#fff;margin-right:8px">E</span>EMI Tracker</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${C.primaryDark}">${esc(opts.heading)}</h1>
${opts.bodyHtml}
<p style="margin:24px 0 0"><a href="${esc(opts.ctaUrl)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(opts.ctaLabel)}</a></p>
</td></tr>
<tr><td style="padding:16px 24px;background:${C.light};font-size:12px;color:${C.muted}">
${esc(opts.footer)}${opts.unsubUrl ? `<br><a href="${esc(opts.unsubUrl)}" style="color:${C.primaryDark}">${esc(opts.unsubLabel ?? "Unsubscribe")}</a>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

export function welcomeEmail(user: EmailUser, appUrl: string): OutgoingEmail {
  const t = createTranslator(user.locale);
  const heading = t("email.welcomeHeading", { name: user.name || user.email });
  const body = t("email.welcomeBody");
  return {
    to: user.email,
    subject: t("email.welcomeSubject"),
    html: layout({
      heading,
      bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.6;color:${C.muted}">${esc(body)}</p>`,
      ctaUrl: appUrl,
      ctaLabel: t("email.welcomeCta"),
      footer: t("common.appName"),
    }),
    text: `${heading}\n\n${body}\n\n${t("email.welcomeCta")}: ${appUrl}\n`,
  };
}

export interface DueLine {
  loanNickname: string;
  n: number;
  payableDate: string;
  billedDate: string;
  amount: number;
  currency: string;
}

export interface DueSection {
  /** e.g. "tomorrow", "in 3 days", "today", or overdue */
  heading: string;
  payableDate: string;
  lines: DueLine[];
}

function totalsText(lines: DueLine[], locale: string): string {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amount);
  return [...totals].map(([c, v]) => formatMoney(v, c, locale)).join(" + ");
}

function sectionsHtml(sections: DueSection[], user: EmailUser): string {
  const t = createTranslator(user.locale);
  return sections
    .map((s) => {
      const rows = s.lines
        .map(
          (l) => `<tr>
<td style="padding:8px 0;border-bottom:1px solid #E3EEF5;font-size:14px">${esc(l.loanNickname)} <span style="color:${C.muted}">#${l.n}</span></td>
<td style="padding:8px 0;border-bottom:1px solid #E3EEF5;font-size:14px;white-space:nowrap">${esc(formatDate(l.payableDate, user.dateFormat, user.locale))}</td>
<td align="right" style="padding:8px 0;border-bottom:1px solid #E3EEF5;font-size:14px;font-weight:600;white-space:nowrap">${esc(formatMoney(l.amount, l.currency, user.locale))}</td></tr>`,
        )
        .join("");
      return `<h2 style="margin:20px 0 8px;font-size:16px;color:${C.accentText}">${esc(s.heading)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><th align="left" style="font-size:12px;color:${C.muted};font-weight:600;padding-bottom:4px">${esc(t("email.colLoan"))}</th>
<th align="left" style="font-size:12px;color:${C.muted};font-weight:600;padding-bottom:4px">${esc(t("email.colPayBy"))}</th>
<th align="right" style="font-size:12px;color:${C.muted};font-weight:600;padding-bottom:4px">${esc(t("email.colAmount"))}</th></tr>
${rows}
<tr><td colspan="2" style="padding-top:8px;font-weight:700">${esc(t("email.total"))}</td>
<td align="right" style="padding-top:8px;font-weight:700;color:${C.primaryDark}">${esc(totalsText(s.lines, user.locale))}</td></tr></table>`;
    })
    .join("");
}

function sectionsText(sections: DueSection[], user: EmailUser): string {
  return sections
    .map(
      (s) =>
        `${s.heading}\n` +
        s.lines
          .map((l) => `- ${l.loanNickname} #${l.n}: ${formatMoney(l.amount, l.currency, user.locale)} (${formatDate(l.payableDate, user.dateFormat, user.locale)})`)
          .join("\n"),
    )
    .join("\n\n");
}

export function reminderEmail(
  user: EmailUser,
  sections: DueSection[],
  opts: { appUrl: string; unsubUrl: string; overdueOnly: boolean },
): OutgoingEmail {
  const t = createTranslator(user.locale);
  const all = sections.flatMap((s) => s.lines);
  const amount = totalsText(all, user.locale);
  const first = sections[0]!;
  const subject = opts.overdueOnly
    ? t("email.overdueSubject", { amount })
    : t("email.reminderSubject", { amount, when: first.heading.toLowerCase() });
  const heading = opts.overdueOnly ? t("email.overdueHeading") : t("email.reminderHeading", { when: first.heading.toLowerCase() });
  return {
    to: user.email,
    subject,
    html: layout({
      heading,
      bodyHtml: sectionsHtml(sections, user),
      ctaUrl: opts.appUrl,
      ctaLabel: t("email.cta"),
      footer: t("email.footer"),
      unsubUrl: opts.unsubUrl,
      unsubLabel: t("email.unsubscribe"),
    }),
    text: `${heading}\n\n${sectionsText(sections, user)}\n\n${t("email.cta")}: ${opts.appUrl}\n\n${t("email.footer")}\n${t("email.unsubscribe")}: ${opts.unsubUrl}\n`,
    headers: { "List-Unsubscribe": `<${opts.unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export function weeklySummaryEmail(user: EmailUser, sections: DueSection[], opts: { appUrl: string; unsubUrl: string }): OutgoingEmail {
  const t = createTranslator(user.locale);
  const heading = t("email.weeklyHeading");
  const bodyHtml = sections.length
    ? sectionsHtml(sections, user)
    : `<p style="margin:0;color:${C.muted}">${esc(t("email.weeklyEmpty"))}</p>`;
  return {
    to: user.email,
    subject: t("email.weeklySubject"),
    html: layout({
      heading,
      bodyHtml,
      ctaUrl: opts.appUrl,
      ctaLabel: t("email.cta"),
      footer: t("email.footer"),
      unsubUrl: opts.unsubUrl,
      unsubLabel: t("email.unsubscribe"),
    }),
    text: `${heading}\n\n${sections.length ? sectionsText(sections, user) : t("email.weeklyEmpty")}\n\n${t("email.unsubscribe")}: ${opts.unsubUrl}\n`,
    headers: { "List-Unsubscribe": `<${opts.unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
