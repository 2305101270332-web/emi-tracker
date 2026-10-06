-- Name printed on a card, for cards that belong to someone else (e.g. a family member's
-- card used for an EMI purchase). NULL = the user's own card.
ALTER TABLE cards ADD COLUMN holder_name TEXT;

-- Recurring fixed expenses (gym, subscriptions, food...) for the monthly budget view.
-- amount is in minor units of currency, per `frequency`; the budget uses its monthly equivalent.
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_expenses_user ON expenses(user_id);
