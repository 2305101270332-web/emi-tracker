/**
 * Hourly reminder job (Workers Cron Trigger). Sends push + email + in-app
 * notifications for upcoming, due-today and overdue instalments, using each
 * user's time zone and preferred hour.
 *
 * Free-tier budget per invocation: 50 D1 queries, 50 subrequests, 10 ms CPU.
 * This job uses a fixed ~7 queries regardless of user count (json_each for
 * set operations) and caps push subrequests; anything not sent is retried on
 * the next hourly run because only delivered/failed messages are recorded.
 */
import { addDays, daysBetween, dayOfWeek, formatMoney, hourInZone, todayInZone } from "@emi/core";
import { createTranslator, formatDate, type DateFormat } from "@emi/shared";
import type { Env } from "../env";
import { newId } from "../lib/util";
import {
  emailConfigured,
  reminderEmail,
  sendEmailBatch,
  unsubscribeUrl,
  weeklySummaryEmail,
  type DueSection,
  type EmailUser,
  type OutgoingEmail,
} from "./email";
import { sendPush, type VapidKeys } from "./push";

type Row = Record<string, unknown>;

export const PUSH_BUDGET_PER_RUN = 20;
export const MAX_ATTEMPTS = 3;
const OVERDUE_LOOKBACK_DAYS = 30;

interface UserCtx {
  id: string;
  email: string;
  name: string;
  bounced: boolean;
  locale: string;
  timeZone: string;
  dateFormat: DateFormat;
  today: string;
  daysBefore: number[];
  remindOnDay: boolean;
  remindOverdue: boolean;
  pushEnabled: boolean;
  emailReminders: boolean;
  weeklySummary: boolean;
}

interface Due {
  instalmentId: string;
  userId: string;
  loanId: string;
  loanNickname: string;
  n: number;
  billedDate: string;
  payableDate: string;
  amount: number;
  currency: string;
}

type EventKind = "before" | "due_today" | "overdue";

interface ReminderEvent {
  kind: EventKind;
  /** Days until payable date (negative = overdue). */
  days: number;
  due: Due;
  /** Stable per-instalment suffix: e.g. 'before3', 'due_today', 'overdue'. */
  tag: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  channel: "inapp" | "push" | "email";
  kind: string;
  dedupe_key: string;
  loan_id: string | null;
  instalment_id: string | null;
  title: string;
  body: string;
  status: "sent" | "failed";
  error: string | null;
  send_id: string | null;
}

export interface RunReport {
  usersChecked: number;
  usersEligible: number;
  inapp: number;
  pushSent: number;
  pushFailed: number;
  emailsSent: number;
  emailsFailed: number;
  emailsDeferred: number;
}

export function dedupeKey(channel: string, e: Pick<ReminderEvent, "tag" | "due">): string {
  return `${channel}:${e.tag}:${e.due.instalmentId}`;
}

/** Which reminder (if any) applies to an unpaid instalment today. Exported for tests. */
export function eventFor(u: Pick<UserCtx, "today" | "daysBefore" | "remindOnDay" | "remindOverdue">, d: Due): ReminderEvent | null {
  const days = daysBetween(u.today, d.payableDate);
  if (days > 0 && u.daysBefore.includes(days)) return { kind: "before", days, due: d, tag: `before${days}` };
  if (days === 0 && u.remindOnDay) return { kind: "due_today", days, due: d, tag: "due_today" };
  if (days < 0 && days >= -OVERDUE_LOOKBACK_DAYS && u.remindOverdue) return { kind: "overdue", days, due: d, tag: "overdue" };
  return null;
}

function whenText(t: ReturnType<typeof createTranslator>, days: number): string {
  if (days === 0) return t("notifications.whenToday");
  if (days === 1) return t("notifications.whenTomorrow");
  return t("notifications.whenInDays", { count: days });
}

function userFromRow(r: Row, now: Date): UserCtx {
  const timeZone = String(r.time_zone);
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    bounced: Number(r.email_bounced) === 1,
    locale: String(r.locale),
    timeZone,
    dateFormat: String(r.date_format) as DateFormat,
    today: todayInZone(timeZone, now),
    daysBefore: JSON.parse(String(r.reminder_days_before)) as number[],
    remindOnDay: Number(r.remind_on_day) === 1,
    remindOverdue: Number(r.remind_overdue) === 1,
    pushEnabled: Number(r.push_enabled) === 1,
    emailReminders: Number(r.email_reminders) === 1,
    weeklySummary: Number(r.weekly_summary) === 1,
  };
}

export async function runReminders(env: Env, now: Date = new Date()): Promise<RunReport> {
  const db = env.DB;
  const report: RunReport = {
    usersChecked: 0,
    usersEligible: 0,
    inapp: 0,
    pushSent: 0,
    pushFailed: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsDeferred: 0,
  };

  // Q1: users + settings
  const usersRes = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.email_bounced, s.* FROM users u JOIN settings s ON s.user_id = u.id LIMIT 5000`,
    )
    .all<Row>();
  report.usersChecked = usersRes.results.length;
  const users = new Map<string, UserCtx>();
  for (const r of usersRes.results) {
    let hour: number;
    try {
      hour = hourInZone(String(r.time_zone), now);
    } catch {
      continue;
    }
    // ">=" rather than "==" so a run that hit a budget cap catches up next hour (dedupe prevents repeats).
    if (hour >= Number(r.reminder_hour)) users.set(String(r.id), userFromRow(r, now));
  }
  report.usersEligible = users.size;
  if (users.size === 0) return report;

  const todays = [...users.values()].map((u) => u.today).sort();
  const from = addDays(todays[0]!, -OVERDUE_LOOKBACK_DAYS);
  const to = addDays(todays.at(-1)!, 31);
  const userIds = JSON.stringify([...users.keys()]);

  // Q2: unpaid, unskipped, unmuted instalments in the window
  const dueRes = await db
    .prepare(
      `SELECT i.id, i.user_id, i.loan_id, i.n, i.billed_date, i.payable_date, i.total_payable, l.nickname, l.currency
       FROM instalments i
       JOIN loans l ON l.id = i.loan_id AND l.user_id = i.user_id
       LEFT JOIN payments p ON p.instalment_id = i.id
       WHERE i.user_id IN (SELECT value FROM json_each(?1))
         AND i.payable_date BETWEEN ?2 AND ?3
         AND p.id IS NULL AND i.skipped = 0 AND l.muted = 0
       ORDER BY i.payable_date, l.nickname`,
    )
    .bind(userIds, from, to)
    .all<Row>();

  const dues = dueRes.results.map(
    (r): Due => ({
      instalmentId: String(r.id),
      userId: String(r.user_id),
      loanId: String(r.loan_id),
      loanNickname: String(r.nickname),
      n: Number(r.n),
      billedDate: String(r.billed_date),
      payableDate: String(r.payable_date),
      amount: Number(r.total_payable),
      currency: String(r.currency),
    }),
  );

  const eventsByUser = new Map<string, ReminderEvent[]>();
  const weeklyByUser = new Map<string, Due[]>();
  for (const d of dues) {
    const u = users.get(d.userId)!;
    const e = eventFor(u, d);
    if (e) {
      let list = eventsByUser.get(u.id);
      if (!list) eventsByUser.set(u.id, (list = []));
      list.push(e);
    }
    const days = daysBetween(u.today, d.payableDate);
    if (u.weeklySummary && days >= 0 && days <= 7) {
      let w = weeklyByUser.get(u.id);
      if (!w) weeklyByUser.set(u.id, (w = []));
      w.push(d);
    }
  }
  const weeklyUsers = [...users.values()].filter((u) => u.weeklySummary && dayOfWeek(u.today) === 1);

  // Q3: which dedupe keys are already done
  const candidateKeys: string[] = [];
  for (const [, events] of eventsByUser) {
    for (const e of events) for (const ch of ["inapp", "push", "email"]) candidateKeys.push(dedupeKey(ch, e));
  }
  for (const u of weeklyUsers) candidateKeys.push(`email:weekly:${u.id}:${u.today}`);
  const done = new Set<string>();
  const failedAttempts = new Map<string, number>();
  if (candidateKeys.length) {
    const existing = await db
      .prepare(`SELECT dedupe_key, status, attempts FROM notifications WHERE dedupe_key IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(candidateKeys))
      .all<Row>();
    for (const r of existing.results) {
      const k = String(r.dedupe_key);
      if (r.status === "sent" || Number(r.attempts) >= MAX_ATTEMPTS) done.add(k);
      else failedAttempts.set(k, Number(r.attempts));
    }
  }

  // Q4: push subscriptions; Q5: emails sent today (UTC day, matches Resend's daily quota)
  const vapid: VapidKeys | null =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
      : null;
  const [subsRes, sentTodayRes] = await db.batch([
    db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (SELECT value FROM json_each(?))`).bind(userIds),
    db
      .prepare(`SELECT COUNT(DISTINCT send_id) AS c FROM notifications WHERE channel = 'email' AND status = 'sent' AND created_at >= ?`)
      .bind(now.toISOString().slice(0, 10) + "T00:00:00.000Z"),
  ]);
  const subsByUser = new Map<string, Row[]>();
  for (const s of subsRes!.results as Row[]) {
    const id = String(s.user_id);
    let list = subsByUser.get(id);
    if (!list) subsByUser.set(id, (list = []));
    list.push(s);
  }
  let emailBudget = Math.max(0, Number(env.EMAIL_DAILY_CAP ?? 95) - Number((sentTodayRes!.results as Row[])[0]?.c ?? 0));
  let pushBudget = PUSH_BUDGET_PER_RUN;

  const rows: NotificationRow[] = [];
  const expiredSubs: string[] = [];
  const emails: { email: OutgoingEmail; sendId: string; rows: NotificationRow[] }[] = [];

  for (const u of users.values()) {
    const t = createTranslator(u.locale);
    const events = eventsByUser.get(u.id) ?? [];

    // Group by payable date + kind so several EMIs due together become one message.
    const groups = new Map<string, ReminderEvent[]>();
    for (const e of events) {
      const k = `${e.due.payableDate}|${e.kind}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(e);
    }

    const emailSections: DueSection[] = [];
    const emailEvents: ReminderEvent[] = [];
    let allOverdue = true;

    for (const group of groups.values()) {
      const first = group[0]!;
      const amount = groupAmount(group, u.locale);
      const date = formatDateSafe(first.due.payableDate, u);
      const single = group.length === 1;
      const title =
        first.kind === "overdue"
          ? t("notifications.overdueTitle", { loan: single ? first.due.loanNickname : `${group.length} EMIs`, amount })
          : single
            ? t("notifications.reminderTitle", { loan: first.due.loanNickname, amount, when: whenText(t, first.days) })
            : t("notifications.groupTitle", { amount, when: whenText(t, first.days) });
      const body =
        first.kind === "overdue"
          ? t("notifications.overdueBody", { n: first.due.n, date })
          : single
            ? t("notifications.reminderBody", { n: first.due.n, date })
            : t("notifications.groupBody", { count: group.length, date });

      // In-app: always recorded (fallback when push is denied).
      for (const e of group) {
        const key = dedupeKey("inapp", e);
        if (done.has(key)) continue;
        rows.push(notif(u.id, "inapp", e, key, title, body, "sent", null, null));
        report.inapp++;
      }

      // Push
      const pushPending = group.filter((e) => !done.has(dedupeKey("push", e)));
      const subs = subsByUser.get(u.id) ?? [];
      if (vapid && u.pushEnabled && pushPending.length && subs.length && pushBudget >= subs.length) {
        const sendId = newId();
        let anyOk = false;
        let lastErr: string | null = null;
        for (const s of subs) {
          pushBudget--;
          try {
            const res = await sendPush(
              { endpoint: String(s.endpoint), p256dh: String(s.p256dh), auth: String(s.auth) },
              { title, body, url: single ? `/loans/${first.due.loanId}` : "/", tag: `${first.due.payableDate}-${first.kind}` },
              vapid,
            );
            if (res.ok) anyOk = true;
            else lastErr = `push_${res.status}`;
            if (res.expired) expiredSubs.push(String(s.id));
          } catch (err) {
            lastErr = String(err).slice(0, 200);
          }
        }
        for (const e of pushPending) {
          rows.push(notif(u.id, "push", e, dedupeKey("push", e), title, body, anyOk ? "sent" : "failed", anyOk ? null : lastErr, sendId));
        }
        if (anyOk) report.pushSent++;
        else report.pushFailed++;
      }

      // Email: collect into one message per user
      const emailPending = group.filter((e) => !done.has(dedupeKey("email", e)));
      if (emailPending.length) {
        if (first.kind !== "overdue") allOverdue = false;
        const heading = first.kind === "overdue" ? t("email.overdueHeading") : capitalise(whenText(t, first.days));
        emailSections.push({
          heading,
          payableDate: first.due.payableDate,
          lines: emailPending.map((e) => ({ ...e.due })),
        });
        emailEvents.push(...emailPending);
      }
    }

    const canEmail = emailConfigured(env) && u.emailReminders && !u.bounced;
    if (canEmail && emailEvents.length) {
      if (emailBudget > 0) {
        emailBudget--;
        const sendId = newId();
        const unsub = await unsubscribeUrl(env, u.id, "reminders");
        const email = reminderEmail(asEmailUser(u), emailSections, { appUrl: env.APP_ORIGIN, unsubUrl: unsub, overdueOnly: allOverdue });
        emails.push({
          email,
          sendId,
          rows: emailEvents.map((e) => notif(u.id, "email", e, dedupeKey("email", e), email.subject, "", "sent", null, sendId)),
        });
      } else {
        report.emailsDeferred++;
      }
    }

    // Weekly summary (Mondays, user's local date)
    if (u.weeklySummary && !u.bounced && emailConfigured(env) && dayOfWeek(u.today) === 1) {
      const key = `email:weekly:${u.id}:${u.today}`;
      if (!done.has(key)) {
        if (emailBudget > 0) {
          emailBudget--;
          const sendId = newId();
          const week = weeklyByUser.get(u.id) ?? [];
          const byDate = new Map<string, Due[]>();
          for (const d of week) {
            let l = byDate.get(d.payableDate);
            if (!l) byDate.set(d.payableDate, (l = []));
            l.push(d);
          }
          const sections: DueSection[] = [...byDate].map(([date, lines]) => ({
            heading: formatDateSafe(date, u),
            payableDate: date,
            lines,
          }));
          const unsub = await unsubscribeUrl(env, u.id, "weekly");
          const email = weeklySummaryEmail(asEmailUser(u), sections, { appUrl: env.APP_ORIGIN, unsubUrl: unsub });
          emails.push({
            email,
            sendId,
            rows: [
              {
                id: newId(), user_id: u.id, channel: "email", kind: "weekly", dedupe_key: key, loan_id: null, instalment_id: null,
                title: email.subject, body: "", status: "sent", error: null, send_id: sendId,
              },
            ],
          });
        } else {
          report.emailsDeferred++;
        }
      }
    }
  }

  // Emails: Resend batch endpoint, 100 per request => 1 subrequest per 100 emails.
  for (let i = 0; i < emails.length; i += 100) {
    const part = emails.slice(i, i + 100);
    const results = await sendEmailBatch(env, part.map((p) => p.email));
    part.forEach((p, idx) => {
      const r = results[idx]!;
      for (const row of p.rows) {
        row.status = r.ok ? "sent" : "failed";
        row.error = r.ok ? null : (r.error ?? "unknown");
        rows.push(row);
      }
      if (r.ok) report.emailsSent++;
      else {
        report.emailsFailed++;
        console.error("email send failed", p.email.to.replace(/(.).*@/, "$1***@"), r.error);
      }
    });
  }

  // Q6: record everything in one statement; failed rows bump attempts so retries stop at MAX_ATTEMPTS.
  if (rows.length) {
    await db
      .prepare(
        `INSERT INTO notifications (id, user_id, channel, kind, dedupe_key, loan_id, instalment_id, title, body, status, attempts, error, send_id)
         SELECT json_extract(value,'$.id'), json_extract(value,'$.user_id'), json_extract(value,'$.channel'), json_extract(value,'$.kind'),
                json_extract(value,'$.dedupe_key'), json_extract(value,'$.loan_id'), json_extract(value,'$.instalment_id'),
                json_extract(value,'$.title'), json_extract(value,'$.body'), json_extract(value,'$.status'), 1,
                json_extract(value,'$.error'), json_extract(value,'$.send_id')
         FROM json_each(?) WHERE true
         ON CONFLICT(dedupe_key) DO UPDATE SET status = excluded.status, attempts = notifications.attempts + 1,
           error = excluded.error, send_id = excluded.send_id, title = excluded.title, body = excluded.body`,
      )
      .bind(JSON.stringify(rows))
      .run();
  }
  // Q7: drop subscriptions the push service says are gone
  if (expiredSubs.length) {
    await db.prepare(`DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(expiredSubs)).run();
  }
  return report;
}

function notif(
  userId: string,
  channel: NotificationRow["channel"],
  e: ReminderEvent,
  key: string,
  title: string,
  body: string,
  status: NotificationRow["status"],
  error: string | null,
  sendId: string | null,
): NotificationRow {
  return {
    id: newId(),
    user_id: userId,
    channel,
    kind: e.kind,
    dedupe_key: key,
    loan_id: e.due.loanId,
    instalment_id: e.due.instalmentId,
    title,
    body,
    status,
    error,
    send_id: sendId,
  };
}

function groupAmount(group: ReminderEvent[], locale: string): string {
  const totals = new Map<string, number>();
  for (const e of group) totals.set(e.due.currency, (totals.get(e.due.currency) ?? 0) + e.due.amount);
  return [...totals].map(([c, v]) => formatMoney(v, c, locale)).join(" + ");
}

function formatDateSafe(iso: string, u: Pick<UserCtx, "dateFormat" | "locale">): string {
  try {
    return formatDate(iso, u.dateFormat, u.locale);
  } catch {
    return iso;
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function asEmailUser(u: UserCtx): EmailUser {
  return { id: u.id, email: u.email, name: u.name, locale: u.locale, dateFormat: u.dateFormat };
}
