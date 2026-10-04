-- EMI Tracker initial schema.
-- Money columns are INTEGER minor units; dates are ISO 'YYYY-MM-DD' TEXT;
-- timestamps are ISO-8601 UTC TEXT. Every user-owned row carries user_id.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT,
  email_bounced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  country TEXT NOT NULL DEFAULT 'IN',
  currency TEXT NOT NULL DEFAULT 'INR',
  locale TEXT NOT NULL DEFAULT 'en-IN',
  time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  tax_label TEXT NOT NULL DEFAULT 'GST',
  tax_rate REAL NOT NULL DEFAULT 18,
  theme TEXT NOT NULL DEFAULT 'system',
  reminder_hour INTEGER NOT NULL DEFAULT 9,
  reminder_days_before TEXT NOT NULL DEFAULT '[3,1]',
  remind_on_day INTEGER NOT NULL DEFAULT 1,
  remind_overdue INTEGER NOT NULL DEFAULT 1,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  email_reminders INTEGER NOT NULL DEFAULT 1,
  weekly_summary INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Seeded lenders have user_id NULL; custom lenders belong to a user.
CREATE TABLE lenders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  color TEXT NOT NULL,
  initial TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_lenders_user ON lenders(user_id);
CREATE INDEX idx_lenders_country ON lenders(country);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lender_id TEXT REFERENCES lenders(id),
  nickname TEXT NOT NULL,
  last4 TEXT,
  statement_day INTEGER NOT NULL CHECK (statement_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  grace_days INTEGER CHECK (grace_days BETWEEN 1 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_cards_user ON cards(user_id);

CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lender_id TEXT NOT NULL REFERENCES lenders(id),
  card_id TEXT REFERENCES cards(id),
  type TEXT NOT NULL,
  custom_type_label TEXT,
  nickname TEXT NOT NULL,
  currency TEXT NOT NULL,
  principal INTEGER NOT NULL,
  annual_rate REAL NOT NULL,
  tenure_months INTEGER NOT NULL,
  repayment_type TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  first_emi_date TEXT NOT NULL,
  emi_day INTEGER NOT NULL,
  processing_fee TEXT NOT NULL DEFAULT '{"kind":"none"}',
  processing_fee_tax_rate REAL NOT NULL DEFAULT 0,
  fee_collection TEXT NOT NULL DEFAULT 'upfront',
  tax_label TEXT NOT NULL DEFAULT 'None',
  interest_tax_enabled INTEGER NOT NULL DEFAULT 0,
  interest_tax_rate REAL NOT NULL DEFAULT 0,
  emi_shift TEXT NOT NULL DEFAULT '{"enabled":false,"dayCount":365,"collection":"first_instalment"}',
  no_cost_emi INTEGER NOT NULL DEFAULT 0,
  holiday_rule TEXT NOT NULL DEFAULT 'none',
  notes TEXT,
  muted INTEGER NOT NULL DEFAULT 0,
  -- Cached ScheduleSummary JSON, refreshed whenever the schedule is regenerated.
  summary TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_loans_user ON loans(user_id);
CREATE INDEX idx_loans_card ON loans(card_id);

-- Generated schedule. id = '<loan_id>:<n>' so payments survive regeneration.
CREATE TABLE instalments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  billed_date TEXT NOT NULL,
  payable_date TEXT NOT NULL,
  annual_rate REAL NOT NULL,
  opening INTEGER NOT NULL,
  interest INTEGER NOT NULL,
  principal INTEGER NOT NULL,
  emi INTEGER NOT NULL,
  interest_tax INTEGER NOT NULL,
  fees INTEGER NOT NULL,
  shift_cost INTEGER NOT NULL,
  total_payable INTEGER NOT NULL,
  closing INTEGER NOT NULL,
  override_amount INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  UNIQUE (loan_id, n)
);
CREATE INDEX idx_instalments_user_payable ON instalments(user_id, payable_date);
CREATE INDEX idx_instalments_payable ON instalments(payable_date);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  instalment_id TEXT NOT NULL UNIQUE,
  paid_date TEXT NOT NULL,
  amount_paid INTEGER NOT NULL,
  late_fee INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_loan ON payments(loan_id);

CREATE TABLE rate_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,
  annual_rate REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_rate_changes_user ON rate_changes(user_id);
CREATE INDEX idx_rate_changes_loan ON rate_changes(loan_id);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_documents_user ON documents(user_id);

-- In-app notification centre + delivery log for push/email.
-- dedupe_key is unique so a reminder is never sent twice.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('inapp', 'push', 'email')),
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  loan_id TEXT,
  instalment_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  -- One id per delivered message (an email may cover several instalments); used for daily caps.
  send_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at TEXT
);
CREATE INDEX idx_notifications_user ON notifications(user_id, channel, created_at);
CREATE INDEX idx_notifications_created ON notifications(channel, created_at);
