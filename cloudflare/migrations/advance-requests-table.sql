-- Advance salary requests table (Phase 1, advance/Zoom commission).
--
-- ROOT CAUSE (why this file exists): Batch B added this table to the
-- schema statements in functions/api/db.js WITHOUT bumping
-- SCHEMA_VERSION, so live D1 — whose schema_version marker already read
-- '2026-10-28-v2' — skipped schema creation entirely (ensureSchema
-- returns early when the marker matches). Live D1 therefore has NO
-- advance_requests table, and every teacher advance request fails with
-- 503. The code fix (same batch) bumps SCHEMA_VERSION to
-- '2026-10-29-v3', so the NEXT Worker deploy re-runs the idempotent
-- statements and creates the table.
--
-- FASTER ACTIVATION (no deploy, needs the owner's explicit approval):
-- reset the live marker row (system_settings key 'schema_version') and
-- the CURRENT live Worker creates this table on its next authenticated
-- /api/db call, because its bundled statements already include it:
--   DELETE FROM system_settings WHERE key = 'schema_version';
-- (The next call re-runs all idempotent statements and re-records the
-- marker. This touches one settings row only — no academy data.)
--
-- DIRECT ALTERNATIVE (if the marker reset is not wanted): run this
-- statement once against the live D1. It is idempotent.
CREATE TABLE IF NOT EXISTS advance_requests (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  teacher_name TEXT,
  period TEXT NOT NULL,
  advance_type TEXT NOT NULL,
  requested_amount REAL NOT NULL,
  approved_amount REAL,
  status TEXT DEFAULT 'Pending',
  reason TEXT,
  reviewer_comment TEXT,
  reviewed_by TEXT,
  adjustment_id TEXT,
  requested_at TEXT,
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
