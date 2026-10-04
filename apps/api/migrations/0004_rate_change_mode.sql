-- Per-change behaviour for floating-rate changes: keep EMI (tenure changes) or keep tenure (EMI changes).
ALTER TABLE rate_changes ADD COLUMN mode TEXT NOT NULL DEFAULT 'keep_emi' CHECK (mode IN ('keep_emi', 'keep_tenure'));
CREATE INDEX idx_documents_loan ON documents(loan_id);
