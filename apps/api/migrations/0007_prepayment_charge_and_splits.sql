-- Pre-closure / part-payment charge, same shape as processing_fee: {"kind":"none"|"flat"|"percent",...}.
-- Only used by the prepayment tools; it never changes the stored schedule.
ALTER TABLE loans ADD COLUMN prepayment_charge TEXT NOT NULL DEFAULT '{"kind":"none"}';
ALTER TABLE loans ADD COLUMN prepayment_charge_tax_rate REAL NOT NULL DEFAULT 0;

-- People who pay part of each instalment: JSON array of {name, kind: "percent"|"flat", percent|amount}.
ALTER TABLE loans ADD COLUMN splits TEXT NOT NULL DEFAULT '[]';
