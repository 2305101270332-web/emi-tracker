-- Private monthly income for the debt-to-income indicator (never exposed to shared users).
ALTER TABLE settings ADD COLUMN monthly_income INTEGER CHECK (monthly_income IS NULL OR monthly_income >= 0);
ALTER TABLE settings ADD COLUMN income_currency TEXT;

-- Loan sharing. An invite is addressed to an email; it is linked to a user (user_id)
-- when someone signs in with Google using that verified email.
CREATE TABLE loan_shares (
  id TEXT PRIMARY KEY,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('view', 'edit')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  accepted_at TEXT,
  UNIQUE (loan_id, email)
);
CREATE INDEX idx_loan_shares_user ON loan_shares(user_id);
CREATE INDEX idx_loan_shares_email ON loan_shares(email);
CREATE INDEX idx_loan_shares_owner ON loan_shares(owner_id);
