-- User-configurable "due" window (days before payable_date an unpaid instalment shows as due).
ALTER TABLE settings ADD COLUMN due_window_days INTEGER NOT NULL DEFAULT 7 CHECK (due_window_days BETWEEN 0 AND 30);

-- Bumped by "Sign out of all devices"; session cookies carry the version they were issued with.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
