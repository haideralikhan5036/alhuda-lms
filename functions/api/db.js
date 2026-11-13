/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — CLOUDFLARE D1 DATABASE API ENGINE
 * File: functions/api/db.js
 * Purpose: Zero-configuration Cloudflare Pages Function that automatically
 *          initializes D1 tables and executes Supabase-compatible queries.
 *
 * Security hardening (2026-10-14):
 *  - CORS restricted to an allowlist via env.ALLOWED_ORIGINS (comma-separated).
 *    No origins configured = no cross-origin access.
 *  - update/delete with empty filters are rejected (400).
 *  - Internal error details never leave the server (generic 500 responses).
 *  - Batch 7 Part B: onRequest refuses any call without the Worker's
 *    in-process __lmsInternal marker (403 before any DDL or data path),
 *    so a standalone Cloudflare Pages deploy cannot expose this engine.
 *    OPTIONS preflights (headers only, no data) are carved out explicitly.
 * ============================================================================
 */

const ALLOWED_TABLES = new Set([
  'families',
  'students',
  'teachers',
  'class_schedules',
  'attendance_logs',
  'payments',
  'leave_requests',
  // Teacher Cover / Substitute (2026-11-13): per-day cover assignments +
  // per-leave banner rows. Scoped per role in worker.js (teacher: own
  // covers/absences; parent: own children's covers + their teachers'
  // banners; manager: full operational access except delete).
  'cover_assignments',
  'trial_students',
  'system_settings',
  // Batch 2.1: readable by the OWNER through this engine; the Worker
  // denies it to every other role before delegation (see worker.js).
  'audit_log',
  // Batch 6B: financial record tables (fee payments + payroll). See
  // FINANCIAL_TABLES below for the stricter write semantics they get.
  'salary_slips',
  'salary_adjustments',
  // Salary-advance workflow (Batch B): teacher requests are read through
  // this engine (scoped per role in worker.js); writes go through the
  // dedicated /api/advances/* endpoints, except the owner's repair path.
  'advance_requests',
  // Salary Restructuring Phase 3 (2026-11-07): one row per ACTUAL
  // advance-recovery deduction event, written ONLY by the Worker's
  // /api/advances/apply-recovery endpoint when a salary slip is
  // finalized. Read through this engine scoped per role in worker.js
  // (teachers: own rows only). UNIQUE (slip_id, adjustment_id) is the
  // hard double-deduction guard.
  'advance_recoveries',
  // Salary Restructuring Phase 4 (2026-11-07): per-cycle MANUAL
  // repayment submissions. A teacher with a manual-plan advance
  // submits an amount for one salary period; Administration confirms,
  // adjusts (with a reason) or rejects it at slip time through the
  // Worker's /api/advances/manual-* endpoints — the ONLY writers.
  // Read through this engine scoped per role in worker.js (teachers:
  // own rows only), like advance_recoveries. Rows are never
  // hard-deleted (Worker-enforced, like the other financial tables).
  'advance_manual_requests',
  // Assignment-based salary (Phase 2, 2026-11-03): dated student→teacher→
  // course assignment history. Rows are CLOSED (end_date set), never
  // hard-deleted — the Worker denies deletes for every role.
  'student_assignments'
]);

// Batch 6B: financial record tables. Inserts here are plain INSERTs — a
// UNIQUE conflict must surface as an error, never silently replace an
// existing record the way INSERT OR REPLACE would — and hard deletes are
// rejected for every role: financial rows are cancelled, not deleted.
const FINANCIAL_TABLES = new Set(['payments', 'salary_slips', 'salary_adjustments']);

// Batch 3.4 (audit P2-3): SELECT result ceilings. An unfiltered SELECT
// used to return every row of the table; at 321 families the
// system_settings table alone is 751 rows and growing, so an unguarded
// read is a slow denial-of-service on the Worker and on the portal
// that renders it. Explicit caller limits are kept (clamped to the
// ceiling); absent limits get the default. Join chunks below stay
// safely under D1's 100-parameter binding limit.
const SELECT_DEFAULT_LIMIT = 5000;
const SELECT_MAX_LIMIT = 10000;
const JOIN_CHUNK_SIZE = 90;

/**
 * Build CORS headers from an explicit allowlist.
 * env.ALLOWED_ORIGINS: comma-separated list of exact origins, e.g.
 *   "https://lms.example.com,https://admin.example.com"
 * If unset or empty, cross-origin requests receive no ACAO header (denied).
 * Authorization is kept in allowed headers for bearer-token auth handled
 * upstream (cloudflare/worker.js).
 */
function buildCorsHeaders(request, env) {
  const raw = String((env && env.ALLOWED_ORIGINS) || '').trim();
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

// Batch 7A: authentication-hardening tables. Additive only, created by
// ensureSchema below AND lazily by cloudflare/worker.js auth helpers
// (which import this list), so login/logout/revocation paths work even on
// a cold isolate that has not served /api/db yet. Keys are HMAC-SHA-256
// hex under WORKER_AUTH_SECRET — never plaintext usernames or IPs.
//   auth_throttle: one row per (kind, key_hash). kind is 'account' (a
//     login identifier), 'ip' (a client IP), or 'setpw' (set-password
//     attempts from one IP). window_start / locked_until are unix
//     milliseconds; fail_count counts failures inside the window.
//   auth_revoked_tokens: one row per logged-out token (token_hash is
//     SHA-256 of the full token string — the token itself is never
//     stored). Rows past expires_at are purged opportunistically.
//   auth_subject_valid_after: one row per subject; tokens with iat
//     earlier than valid_after (unix seconds) are rejected.
export const AUTH_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS auth_throttle (
    kind TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    fail_count INTEGER DEFAULT 0,
    window_start INTEGER,
    locked_until INTEGER,
    updated_at TEXT,
    PRIMARY KEY (kind, key_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS auth_revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER,
    created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_revoked_tokens_expires ON auth_revoked_tokens (expires_at)`,
  `CREATE TABLE IF NOT EXISTS auth_subject_valid_after (
    subject_hash TEXT PRIMARY KEY,
    valid_after INTEGER,
    reason TEXT,
    updated_at TEXT
  )`,
];

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    parent_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    whatsapp TEXT,
    country TEXT DEFAULT 'United Kingdom',
    timezone TEXT DEFAULT 'Europe/London',
    currency TEXT DEFAULT 'GBP',
    monthly_fee REAL DEFAULT 0,
    billing_day INTEGER DEFAULT 1,
    status TEXT DEFAULT 'Active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    father_name TEXT,
    phone TEXT,
    cnic TEXT,
    email TEXT,
    address TEXT,
    witness_name TEXT,
    witness_phone TEXT,
    working_shift TEXT DEFAULT '10 Hours Shift (02:00 PM - 12:00 AM PKT)',
    rate_per_slot REAL DEFAULT 2200,
    joining_date TEXT,
    zoom_link TEXT,
    status TEXT DEFAULT 'Active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    family_id TEXT,
    name TEXT NOT NULL,
    age INTEGER DEFAULT 8,
    gender TEXT DEFAULT 'Male',
    course_id TEXT DEFAULT 'Nazra Quran',
    assigned_teacher_id TEXT,
    joining_date TEXT,
    days_per_week TEXT DEFAULT '5 Days (Mon-Fri)',
    status TEXT DEFAULT 'Active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS class_schedules (
    id TEXT PRIMARY KEY,
    student_id TEXT,
    teacher_id TEXT,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_mins INTEGER DEFAULT 30,
    course_name TEXT,
    meeting_link TEXT,
    status TEXT DEFAULT 'Active',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS attendance_logs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT,
    student_id TEXT,
    teacher_id TEXT,
    class_date TEXT NOT NULL,
    status TEXT NOT NULL,
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Batch 6B: full fee-payment shape (6A design). On pre-existing tables
  // the extra columns arrive via the swallowed ALTERs in ensureSchema;
  // receipt_no uniqueness arrives as a unique INDEX (see ensureSchema),
  // because SQLite cannot add a UNIQUE column to an existing table.
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    receipt_no TEXT,
    record_kind TEXT DEFAULT 'payment',
    billing_period TEXT,
    month_label TEXT,
    payment_date TEXT,
    amount_paid REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total_payable REAL,
    monthly_fee REAL,
    previous_balance REAL DEFAULT 0,
    credit_deducted REAL DEFAULT 0,
    remaining_balance REAL,
    excess_paid REAL DEFAULT 0,
    currency TEXT DEFAULT 'GBP',
    payment_method TEXT DEFAULT 'Bank Transfer',
    transaction_id TEXT,
    status TEXT DEFAULT 'Paid',
    status_label TEXT,
    is_prorated INTEGER DEFAULT 0,
    is_advance INTEGER DEFAULT 0,
    advance_months_count INTEGER DEFAULT 0,
    active_days INTEGER DEFAULT 0,
    joining_date TEXT,
    students_names TEXT,
    receipt_url TEXT,
    notes TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    cancelled_by TEXT,
    legacy_json TEXT,
    legacy_source TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    teacher_id TEXT,
    student_id TEXT,
    leave_date TEXT,
    end_date TEXT,
    reason TEXT,
    status TEXT DEFAULT 'Pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Teacher Cover / Substitute (2026-11-13, schema v9): one row per
  // covered student-day (kind='assign') and one row per leave banner
  // (kind='banner'). The cover teacher's portal renders covered classes
  // purely from the snapshot columns below, so no widening of the
  // students/class_schedules scope is needed (the cover teacher cannot
  // read those rows for a student assigned to someone else). Rows are
  // CANCELLED (status='cancelled'), never hard-deleted — the Worker
  // denies deletes for every role, like the other financial-adjacent
  // tables. The leave's salary choices live on the leave record itself
  // (teachers meta.leave_records), not here.
  `CREATE TABLE IF NOT EXISTS cover_assignments (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    leave_id TEXT NOT NULL,
    absent_teacher_id TEXT NOT NULL,
    absent_teacher_name TEXT,
    cover_teacher_id TEXT,
    cover_teacher_name TEXT,
    student_id TEXT,
    student_name TEXT,
    student_status TEXT,
    course_name TEXT,
    cover_date TEXT,
    start_date TEXT,
    end_date TEXT,
    reason TEXT,
    schedule_id TEXT,
    start_time TEXT,
    end_time TEXT,
    duration_mins INTEGER,
    meeting_link TEXT,
    status TEXT DEFAULT 'active',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS trial_students (
    id TEXT PRIMARY KEY,
    student_id TEXT,
    family_id TEXT,
    student_name TEXT,
    student_age INTEGER,
    student_gender TEXT,
    parent_name TEXT,
    whatsapp TEXT,
    country TEXT,
    timezone TEXT,
    course TEXT,
    teacher_id TEXT,
    trial_date TEXT,
    trial_time TEXT,
    zoom_link TEXT,
    status TEXT DEFAULT 'Scheduled',
    feedback TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  // Batch 2.1: append-only audit trail of manager writes (written by the
  // Worker directly; owner-only through the API — see worker.js).
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_role TEXT,
    action TEXT,
    table_name TEXT,
    record_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Batch 6B: one row per teacher per month. UNIQUE(teacher_id, period)
  // is the database-level guarantee; slip_no gets its own unique index
  // in ensureSchema.
  `CREATE TABLE IF NOT EXISTS salary_slips (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    period TEXT NOT NULL,
    slip_no TEXT,
    month_label TEXT,
    base_subtotal REAL DEFAULT 0,
    bonus REAL DEFAULT 0,
    deduction_total REAL DEFAULT 0,
    advance_deducted REAL DEFAULT 0,
    net_payable REAL DEFAULT 0,
    status TEXT DEFAULT 'Pending',
    paid_at TEXT,
    remarks TEXT,
    student_items_snapshot TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    cancelled_by TEXT,
    legacy_json TEXT,
    legacy_key TEXT,
    UNIQUE (teacher_id, period)
  )`,
  // Batch 6B: itemised bonus / deduction / advance records that feed a
  // month's slip (kind: 'bonus' | 'deduction' | 'advance'; the advance
  // columns stay unused until advance tracking ships).
  `CREATE TABLE IF NOT EXISTS salary_adjustments (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    period TEXT,
    kind TEXT,
    category TEXT,
    amount REAL DEFAULT 0,
    advance_remaining REAL,
    recovery_per_month REAL,
    reason TEXT,
    adjustment_date TEXT,
    status TEXT DEFAULT 'Applied',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    cancelled_at TEXT,
    cancel_reason TEXT,
    cancelled_by TEXT,
    legacy_json TEXT
  )`,
  // Salary-advance workflow (Batch B, 2026-10-29): a teacher's advance
  // salary request and its decision. Financial-adjacent: NEVER hard-
  // deleted (Worker denies deletes for every role, like the financial
  // tables); a decided request is terminal — no re-decide, no edit of
  // the decision through this table. The approved amount is materialised
  // as a salary_adjustments row (kind 'advance') by the decide endpoint,
  // linked here via adjustment_id; this row itself never moves money.
  // advance_type: 'full' | 'half' | 'custom'. period: 'YYYY-MM'
  // (the salary period the advance is recovered from). approved_amount
  // is NULL while Pending. No amount ever lives in audit_log — the
  // audit entry for a decision carries only actor + request id + period.
  // Salary Restructuring Phase 2 (2026-11-07): repayment-plan capture.
  // repayment_method: 'full' | 'fixed' | 'custom' | 'manual', chosen by
  // the teacher at request time; installment_amount is set only for
  // fixed/custom. Both are NULL on legacy requests (submitted before
  // plan capture, or by older clients). The columns are CAPTURE-ONLY in
  // Phase 2: the decide endpoint and every money path ignore them —
  // Phase 3 wires them into recovery.
  `CREATE TABLE IF NOT EXISTS advance_requests (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT,
    period TEXT NOT NULL,
    advance_type TEXT NOT NULL,
    repayment_method TEXT,
    installment_amount REAL,
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
  )`,
  // Salary Restructuring Phase 3 (2026-11-07): advance recovery events.
  // Written ONLY at salary-slip finalization by POST
  // /api/advances/apply-recovery — never at approval time and never by
  // the portals directly. balance_after is the adjustment's
  // advance_remaining immediately after this deduction; source is
  // 'auto' for plan-driven recovery (Phase 4 adds 'manual');
  // requested_amount stays NULL for auto rows (Phase 4 records the
  // teacher's submitted manual amount there). The UNIQUE constraint
  // makes a replayed finalization a no-op instead of a second
  // deduction. Rows are never hard-deleted (Worker-enforced, like the
  // other financial tables).
  `CREATE TABLE IF NOT EXISTS advance_recoveries (
    id TEXT PRIMARY KEY,
    adjustment_id TEXT NOT NULL,
    slip_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    period TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    requested_amount REAL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (slip_id, adjustment_id)
  )`,
  // Salary Restructuring Phase 4 (2026-11-07): per-cycle manual
  // repayment submissions. A teacher whose approved advance carries
  // the 'manual' repayment plan submits ONE amount per salary period
  // (amount); Administration confirms it as-is, adjusts it
  // (admin_amount + admin_reason, reason REQUIRED) or rejects it
  // (admin_reason REQUIRED) when that period's slip is generated.
  // status: 'pending' | 'confirmed' | 'adjusted' | 'rejected'. The
  // confirmed/adjusted amount is that period's planned recovery; it
  // becomes a real deduction only at slip finalization, when
  // /api/advances/apply-recovery writes the advance_recoveries row
  // (source 'manual', requested_amount = this row's amount) and stamps
  // recovery_id + applied_amount here. No row for a period (or a
  // rejected one) means ZERO recovery that period — owner Decision 7.
  // ONE ACTIVE submission per (teacher_id, period): "active" =
  // status IN ('pending','confirmed','adjusted') AND recovery_id IS
  // NULL. Enforced by the partial UNIQUE index below (SQLite/D1
  // support partial indexes; the Worker additionally pre-checks and
  // returns the existing row, so the index is the race-proof backstop,
  // not the user-facing error path). Rows are never hard-deleted.
  `CREATE TABLE IF NOT EXISTS advance_manual_requests (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    adjustment_id TEXT NOT NULL,
    period TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_amount REAL,
    admin_reason TEXT,
    applied_amount REAL,
    recovery_id TEXT,
    decided_by TEXT,
    decided_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_advance_manual_requests_active
     ON advance_manual_requests (teacher_id, period)
     WHERE status IN ('pending', 'confirmed', 'adjusted') AND recovery_id IS NULL`,
  // Assignment-based salary (Phase 2, 2026-11-03): one row per
  // student→teacher→course assignment period. start_date/end_date are
  // 'YYYY-MM-DD'; end_date NULL means the assignment is still open.
  // course_name is the catalogue course name in force for the period
  // (course_id carries the catalogue id when known). Rows are closed by
  // setting end_date + end_reason ('transferred' | 'course_changed' |
  // 'deactivated' | 'teacher_changed' | 'left' | 'teacher_left'); they
  // are never hard-deleted (Worker-enforced).
  `CREATE TABLE IF NOT EXISTS student_assignments (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    course_id TEXT,
    course_name TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    end_reason TEXT,
    slots REAL,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Batch 7A: authentication-hardening tables (throttle, revocation,
  // per-subject valid-after markers). Additive only; see
  // AUTH_TABLE_STATEMENTS above for the column contract.
  ...AUTH_TABLE_STATEMENTS
];

let _schemaInitialized = false;

// SLOW-CLASSES FIX (cold Worker): every cold isolate used to replay
// the whole DDL set below (~10 CREATEs + ~35 ALTERs + 6 index creates)
// on EVERY /api/db request before any data query ran — the cold-start
// tax behind slow first loads (and the probe itself paid it). Now the
// full DDL path runs only when the persisted schema_version marker
// differs (or is absent); a matching marker skips straight to the
// BUMP SCHEMA_VERSION whenever the statements below change. (Phase 1
// advance/Zoom commission: Batch B added the advance_requests table to
// these statements WITHOUT bumping the version, so live D1 — whose
// marker already read v2 — skipped schema creation entirely and the
// table was never created. The bump to v3 repairs that: the next
// Worker deploy re-runs the idempotent statements and creates it.
// Faster activation without a deploy: reset the live marker row
// (system_settings key 'schema_version') and the CURRENT live Worker
// creates the table on its next authenticated /api/db call.)
// Concurrent cold isolates may all run the DDL path (idempotent,
// errors swallowed) and all write the same marker — safe. A
// marker-read failure (e.g. brand-new DB where system_settings does
// not exist yet) falls back to the full DDL path; a marker-write
// failure only costs the next cold isolate a DDL replay. Neither
// failure ever fails the request.
const SCHEMA_VERSION = '2026-11-13-v9';
const SCHEMA_VERSION_KEY = 'schema_version';

async function ensureSchema(db) {
  if (_schemaInitialized || !db) return;
  // Fast path: persisted marker matches -> schema already applied.
  try {
    const row = await db.prepare('SELECT value FROM system_settings WHERE key = ?').bind(SCHEMA_VERSION_KEY).first();
    if (row && String(row.value) === SCHEMA_VERSION) {
      _schemaInitialized = true;
      return;
    }
  } catch (e) {
    // Marker unreadable -> fall through to the full DDL path below.
  }
  try {
    const batch = SCHEMA_STATEMENTS.map(sql => db.prepare(sql));
    await db.batch(batch);
    _schemaInitialized = true;
  } catch (err) {
    for (const sql of SCHEMA_STATEMENTS) {
      try { await db.prepare(sql).run(); } catch (e) {}
    }
    _schemaInitialized = true;
  }
  // Backward-compatible schema patches for families table
  try { await db.prepare('ALTER TABLE families ADD COLUMN parent_email TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE families ADD COLUMN email TEXT').run(); } catch (e) {}
  // Backward-compatible schema patches for attendance_logs table
  try { await db.prepare('ALTER TABLE attendance_logs ADD COLUMN date TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE attendance_logs ADD COLUMN lesson_notes TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE attendance_logs ADD COLUMN waiting_at TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE attendance_logs ADD COLUMN started_at TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE attendance_logs ADD COLUMN completed_at TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE attendance_logs ADD COLUMN recorded_at TEXT').run(); } catch (e) {}
  // Batch 6B: schema patches for the pre-existing payments table (fresh
  // installs already carry these columns from the CREATE TABLE above;
  // ADD COLUMN on an existing column errors and is swallowed, as above).
  try { await db.prepare('ALTER TABLE payments ADD COLUMN receipt_no TEXT').run(); } catch (e) {}
  try { await db.prepare("ALTER TABLE payments ADD COLUMN record_kind TEXT DEFAULT 'payment'").run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN billing_period TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN month_label TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN amount_paid REAL DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN discount REAL DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN total_payable REAL').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN monthly_fee REAL').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN previous_balance REAL DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN credit_deducted REAL DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN remaining_balance REAL').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN excess_paid REAL DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN transaction_id TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN status_label TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN is_prorated INTEGER DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN is_advance INTEGER DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN advance_months_count INTEGER DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN active_days INTEGER DEFAULT 0').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN joining_date TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN students_names TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN created_by TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN updated_at TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN cancelled_at TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN cancel_reason TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN cancelled_by TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN legacy_json TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE payments ADD COLUMN legacy_source TEXT').run(); } catch (e) {}
  // Batch 6B: indexes for the financial tables. These run AFTER the
  // payments ALTERs above so the indexed columns exist on pre-existing
  // tables; IF NOT EXISTS makes them no-ops once present. A UNIQUE index
  // (not a column constraint) is how receipt_no / slip_no uniqueness
  // reaches tables created before those columns existed — and the index
  // names deliberately contain the column name, because SQLite names the
  // INDEX (not the column) in its UNIQUE-constraint error text for
  // index-based constraints, and the engine maps errors by that text.
  try { await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_receipt_no_unique ON payments (receipt_no)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_payments_family_period ON payments (family_id, billing_period)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status)').run(); } catch (e) {}
  try { await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_slips_slip_no_unique ON salary_slips (slip_no)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_salary_slips_teacher_period ON salary_slips (teacher_id, period)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_salary_adjustments_teacher_period ON salary_adjustments (teacher_id, period)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_assignments_student ON student_assignments (student_id)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON student_assignments (teacher_id)').run(); } catch (e) {}
  // Teacher Cover / Substitute (schema v9): the three lookups the
  // portals run every day (cover teacher's Today list, leaving
  // teacher's exclusion list, leave's cover list).
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_cover_teacher_date ON cover_assignments (cover_teacher_id, cover_date)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_cover_absent_date ON cover_assignments (absent_teacher_id, cover_date)').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_cover_leave ON cover_assignments (leave_id)').run(); } catch (e) {}
  // Commission #2 Phase 1 (schema v5): the segment's slot count for
  // slot-based salary pricing. Fresh installs carry it from the CREATE
  // TABLE above; on pre-existing tables ADD COLUMN applies it, and on
  // tables that already have it the error is swallowed, as above.
  try { await db.prepare('ALTER TABLE student_assignments ADD COLUMN slots REAL').run(); } catch (e) {}
  // Salary Restructuring Phase 2 (schema v6): repayment-plan columns on
  // advance_requests (fresh installs carry them from the CREATE TABLE
  // above; ADD COLUMN applies them to pre-existing tables and the error
  // is swallowed where they already exist, as above).
  try { await db.prepare('ALTER TABLE advance_requests ADD COLUMN repayment_method TEXT').run(); } catch (e) {}
  try { await db.prepare('ALTER TABLE advance_requests ADD COLUMN installment_amount REAL').run(); } catch (e) {}
  // SLOW-CLASSES FIX: record the schema marker (best effort — never
  // fail the request if this write fails; see the note above).
  try {
    await db.prepare('INSERT INTO system_settings (id, key, value) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')').bind('SYS-SCHEMA-VERSION', SCHEMA_VERSION_KEY, SCHEMA_VERSION).run();
  } catch (e) {}
}

function generateId(table) {
  const prefixMap = {
    families: 'FAM-',
    students: 'STU-',
    teachers: 'TCH-',
    class_schedules: 'SCH-',
    attendance_logs: 'ATT-',
    payments: 'PAY-',
    leave_requests: 'LVR-',
    cover_assignments: 'COV-',
    trial_students: 'TRL-',
    system_settings: 'SYS-',
    salary_slips: 'SAL-',
    salary_adjustments: 'ADJ-',
    advance_manual_requests: 'AMR-'
  };
  const prefix = prefixMap[table] || 'ID-';
  return prefix + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function sanitizeColumn(col) {
  return String(col || '').replace(/[^a-zA-Z0-9_]/g, '');
}

// Render ONE filter (or one OR group) to { clause, params }. An OR group
// joins its members with OR; anything else renders as a single clause.
// Returns null when the filter produces nothing (unknown op, empty IN).
function renderFilterClause(f) {
  if (!f || typeof f !== 'object') return null;
  // Lesson History (UNION scope): a filter group { op: 'or', value: [...] }
  // renders as a parenthesised OR of its member filters (nested groups
  // supported). Members are joined with OR -- never AND.
  if (f.op === 'or' && Array.isArray(f.value)) {
    const parts = [];
    const params = [];
    for (const member of f.value) {
      const rendered = renderFilterClause(member);
      if (rendered) { parts.push(rendered.clause); params.push(...rendered.params); }
    }
    if (parts.length === 0) return null;
    return { clause: `(${parts.join(' OR ')})`, params };
  }
  const col = sanitizeColumn(f.column);
  if (!col) return null;
  const op = f.op;
  const val = f.value;

  if (op === 'eq') {
    if (val === null) return { clause: `${col} IS NULL`, params: [] };
    return { clause: `${col} = ?`, params: [val] };
  } else if (op === 'neq') {
    if (val === null) return { clause: `${col} IS NOT NULL`, params: [] };
    return { clause: `(${col} IS NULL OR ${col} != ?)`, params: [val] };
  } else if (op === 'gt') {
    return { clause: `${col} > ?`, params: [val] };
  } else if (op === 'gte') {
    return { clause: `${col} >= ?`, params: [val] };
  } else if (op === 'lt') {
    return { clause: `${col} < ?`, params: [val] };
  } else if (op === 'lte') {
    return { clause: `${col} <= ?`, params: [val] };
  } else if (op === 'like' || op === 'ilike') {
    return { clause: `LOWER(${col}) LIKE LOWER(?)`, params: [String(val || '')] };
  } else if (op === 'in' && Array.isArray(val) && val.length > 0) {
    const placeholders = val.map(() => '?').join(', ');
    return { clause: `${col} IN (${placeholders})`, params: [...val] };
  }
  return null;
}

function buildWhereClause(filters = []) {
  const clauses = [];
  const params = [];

  for (const f of filters) {
    const rendered = renderFilterClause(f);
    if (!rendered) continue;
    clauses.push(rendered.clause);
    params.push(...rendered.params);
  }

  const sql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return { sql, params };
}

async function hydrateRelationalJoins(db, table, rows, selectStr = '*') {
  if (!Array.isArray(rows) || rows.length === 0 || !selectStr) return rows;
  const sel = String(selectStr);

  // Batch 3.4 (audit P2-3): join hydration used to SELECT * the whole
  // target table for every join — at 321 families that is the entire
  // academy on every joined read. Only the ids the returned rows
  // actually reference are fetched now, chunked at JOIN_CHUNK_SIZE
  // (safely under D1's 100-parameter binding limit). Output is
  // identical whenever the full table fit in memory (every case
  // today), and stays bounded as the academy grows.
  const fetchByColumn = async (targetTable, column, values) => {
    const unique = [...new Set((values || []).map((v) => String(v)).filter((v) => v !== ''))];
    const out = [];
    for (let i = 0; i < unique.length; i += JOIN_CHUNK_SIZE) {
      const chunk = unique.slice(i, i + JOIN_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const { results } = await db.prepare(`SELECT * FROM ${targetTable} WHERE ${column} IN (${placeholders})`).bind(...chunk).all();
      out.push(...(results || []));
    }
    return out;
  };

  // 1. families -> students(*)
  if (table === 'families' && /students\s*\(/i.test(sel)) {
    const allStudents = await fetchByColumn('students', 'family_id', rows.map((f) => f.id));
    const stuByFam = new Map();
    for (const s of (allStudents || [])) {
      const fId = String(s.family_id || '');
      if (!stuByFam.has(fId)) stuByFam.set(fId, []);
      stuByFam.get(fId).push(s);
    }
    rows.forEach(f => {
      f.students = stuByFam.get(String(f.id || '')) || [];
    });
  }

  // 2. students / class_schedules / payments -> families(...)
  if ((table === 'students' || table === 'class_schedules' || table === 'payments') && /families\s*\(/i.test(sel)) {
    const allFamilies = await fetchByColumn('families', 'id', rows.map((r) => r.family_id));
    const famMap = new Map((allFamilies || []).map(f => [String(f.id), f]));
    rows.forEach(r => {
      r.families = famMap.get(String(r.family_id || '')) || null;
    });
  }

  // 3. class_schedules / attendance_logs -> students(...)
  if ((table === 'class_schedules' || table === 'attendance_logs') && /students\s*\(/i.test(sel)) {
    const allStudents = await fetchByColumn('students', 'id', rows.map((r) => r.student_id));
    const stuMap = new Map((allStudents || []).map(s => [String(s.id), s]));
    rows.forEach(r => {
      r.students = stuMap.get(String(r.student_id || '')) || null;
    });
  }

  // 4. students / class_schedules / attendance_logs -> teachers(...)
  if ((table === 'students' || table === 'class_schedules' || table === 'attendance_logs') && /teachers\s*\(/i.test(sel)) {
    const allTeachers = await fetchByColumn('teachers', 'id', rows.map((r) => r.teacher_id || r.assigned_teacher_id));
    const tchMap = new Map((allTeachers || []).map(t => [String(t.id), t]));
    rows.forEach(r => {
      const tKey = r.teacher_id || r.assigned_teacher_id;
      r.teachers = tchMap.get(String(tKey || '')) || null;
    });
  }

  return rows;
}

async function getTableColumns(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((results || []).map(c => c.name));
}

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Batch 3.4 (audit P2-4): pre-validates a financial INSERT batch's
// UNIQUE keys before anything is written. Returns { index, message }
// for the first conflicting row, or null. Checks the batch against
// both the table and itself (two rows in one batch sharing a receipt
// number would otherwise pass the table check and fail mid-batch).
// Keys mirror the real constraints: payments receipt_no (UNIQUE index),
// salary_slips slip_no (UNIQUE index) + (teacher_id, period) (UNIQUE),
// salary_adjustments id (PRIMARY KEY). NULL/empty keys are skipped —
// SQLite treats NULLs as distinct in UNIQUE indexes, so they never
// conflict. Only action==='insert' is pre-validated: an upsert whose
// id already exists takes the true UPDATE-by-id path, not INSERT.
async function findFinancialBatchConflict(d1, table, rows) {
  const seen = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const keys = [];
    if (table === 'payments') {
      const rn = row.receipt_no != null ? String(row.receipt_no).trim() : '';
      if (rn) keys.push(['receipt_no:' + rn, 'Duplicate receipt number']);
    } else if (table === 'salary_slips') {
      const sn = row.slip_no != null ? String(row.slip_no).trim() : '';
      if (sn) keys.push(['slip_no:' + sn, 'A slip already exists for this teacher and month']);
      const tid = row.teacher_id != null ? String(row.teacher_id).trim() : '';
      const per = row.period != null ? String(row.period).trim() : '';
      if (tid && per) keys.push(['pair:' + tid + '|' + per, 'A slip already exists for this teacher and month']);
    } else if (table === 'salary_adjustments') {
      const rid = row.id != null ? String(row.id).trim() : '';
      if (rid) keys.push(['id:' + rid, 'Record already exists']);
    }
    for (const [key, message] of keys) {
      if (seen.has(key)) return { index: i, message };
      seen.set(key, i);
    }
    // Table check (one query per key; batches are small and this runs
    // once per batch, not per portal render).
    if (table === 'payments' && keys.some(([k]) => k.startsWith('receipt_no:'))) {
      const rn = String(row.receipt_no).trim();
      const existing = await d1.prepare('SELECT id FROM payments WHERE receipt_no = ?').bind(rn).first();
      if (existing) return { index: i, message: 'Duplicate receipt number' };
    } else if (table === 'salary_slips') {
      if (keys.some(([k]) => k.startsWith('slip_no:'))) {
        const existing = await d1.prepare('SELECT id FROM salary_slips WHERE slip_no = ?').bind(String(row.slip_no).trim()).first();
        if (existing) return { index: i, message: 'A slip already exists for this teacher and month' };
      }
      if (keys.some(([k]) => k.startsWith('pair:'))) {
        const existing = await d1.prepare('SELECT id FROM salary_slips WHERE teacher_id = ? AND period = ?').bind(String(row.teacher_id).trim(), String(row.period).trim()).first();
        if (existing) return { index: i, message: 'A slip already exists for this teacher and month' };
      }
    } else if (table === 'salary_adjustments' && keys.some(([k]) => k.startsWith('id:'))) {
      const existing = await d1.prepare('SELECT id FROM salary_adjustments WHERE id = ?').bind(String(row.id).trim()).first();
      if (existing) return { index: i, message: 'Record already exists' };
    }
  }
  return null;
}

// Duplicate-schedule prevention (2026-11-05, investigation
// DUPLICATE-ASSIGNMENT-INVESTIGATION-2026-11-05 §4/§7): class_schedules
// has no database uniqueness rule, and booking payloads carry no row
// id, so any repeated submission (double-click, retry, re-save, or the
// browser-mirror sync pushing its own locally-id'd copies) used to mint
// fresh rows for a class that already exists. The natural key of a
// class is (student_id, teacher_id, day_of_week, start_time) with
// start_time compared on its first 5 chars ('HH:MM') so 'HH:MM' and
// 'HH:MM:SS' spellings of the same class collide. Rows missing any key
// component return null here and are left to existing validation.
// The Worker delegates /api/db to this module (cloudflare/worker.js
// imports onRequest from here), so this one guard covers both paths.
function scheduleNaturalKey(row) {
  if (!row || typeof row !== 'object') return null;
  const sid = row.student_id != null ? String(row.student_id).trim() : '';
  const tid = row.teacher_id != null ? String(row.teacher_id).trim() : '';
  const dayRaw = row.day_of_week != null ? String(row.day_of_week).trim() : '';
  const day = /^\d+$/.test(dayRaw) ? String(parseInt(dayRaw, 10)) : dayRaw;
  const start = row.start_time != null ? String(row.start_time).trim().slice(0, 5) : '';
  if (!sid || !tid || !day || !start) return null;
  return sid + '|' + tid + '|' + day + '|' + start;
}

function scheduleRowId(row) {
  return row && row.id != null && String(row.id).trim() !== '' ? String(row.id).trim() : null;
}

// One read of the existing schedule rows for every student named in
// the batch, indexed by natural key and by id.
async function loadScheduleKeyIndex(d1, rows) {
  const byKey = new Map();
  const ids = new Set();
  const studentIds = [...new Set(rows.map(r => (r && r.student_id != null ? String(r.student_id).trim() : '')).filter(Boolean))];
  if (!studentIds.length) return { byKey, ids };
  const placeholders = studentIds.map(() => '?').join(', ');
  const { results } = await d1.prepare(
    `SELECT id, student_id, teacher_id, day_of_week, start_time FROM class_schedules WHERE student_id IN (${placeholders})`
  ).bind(...studentIds).all();
  for (const er of results || []) {
    if (!er) continue;
    ids.add(String(er.id));
    const k = scheduleNaturalKey(er);
    if (k && !byKey.has(k)) byKey.set(k, String(er.id));
  }
  return { byKey, ids };
}

function duplicateScheduleMessage(row) {
  return `Duplicate class schedule: this student already has a class with this teacher on day ${row.day_of_week} at ${String(row.start_time).trim().slice(0, 5)}`;
}

// INSERT path: returns { index, message } for the first row whose
// natural key already exists under a DIFFERENT id — in D1, or earlier
// in the same batch — or null. A batch that conflicts writes NOTHING
// (the caller returns 409 before the write loop), mirroring
// findFinancialBatchConflict. A row repeating its OWN id + key is a
// replace, not a duplicate.
async function findScheduleBatchConflict(d1, rows) {
  const { byKey } = await loadScheduleKeyIndex(d1, rows);
  const seen = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const k = scheduleNaturalKey(row);
    if (!k) continue;
    const thisId = scheduleRowId(row);
    if (seen.has(k)) {
      const prevId = seen.get(k);
      if (!thisId || !prevId || thisId !== prevId) {
        return { index: i, message: duplicateScheduleMessage(row) };
      }
    } else {
      seen.set(k, thisId);
    }
    const existingId = byKey.get(k);
    if (existingId && existingId !== thisId) {
      return { index: i, message: duplicateScheduleMessage(row) };
    }
  }
  return null;
}

// UPSERT path (the mirror sync): returns the rows that may be written.
// Rows whose id already exists in D1 keep INSERT OR REPLACE semantics.
// A row with a NEW id whose natural key already exists under a
// different id is a mirror copy of an existing class — skipped
// silently so syncs stay idempotent and harmless; within the batch,
// the first occurrence of a key wins.
async function filterScheduleUpsertRows(d1, rows) {
  const { byKey, ids } = await loadScheduleKeyIndex(d1, rows);
  const seen = new Set();
  const kept = [];
  for (const row of rows) {
    const k = scheduleNaturalKey(row || {});
    if (!k) { kept.push(row); continue; }
    const thisId = scheduleRowId(row || {});
    if (thisId && ids.has(thisId)) { kept.push(row); continue; }
    if (seen.has(k)) continue;
    const existingId = byKey.get(k);
    if (existingId && existingId !== thisId) continue;
    seen.add(k);
    kept.push(row);
  }
  return kept;
}

// Batch 6B: map a UNIQUE-constraint failure on a financial table to a
// clear, user-facing message (returned as HTTP 409 by the insert path).
// SQLite names the failed column for table constraints
// ("UNIQUE constraint failed: salary_slips.teacher_id, ...") and the
// failed INDEX for index constraints ("... index 'idx_payments_receipt_no_unique'"),
// so both spellings are matched. Returns null for anything else, and the
// caller falls back to the existing generic-500 behaviour.
function financialUniqueErrorMessage(table, err) {
  const msg = String((err && err.message) || err || '');
  if (!/UNIQUE constraint failed/i.test(msg)) return null;
  if (table === 'payments') {
    if (/receipt_no/.test(msg)) return 'Duplicate receipt number';
    return null;
  }
  if (table === 'salary_slips') {
    if (/teacher_id|period|slip_no/.test(msg)) return 'A slip already exists for this teacher and month';
    return null;
  }
  if (table === 'salary_adjustments') return 'Record already exists';
  return null;
}

// Batch 7 (F1.2): student/family lifecycle guard helpers. The deactivated
// status set mirrors the client derivation in js/config.js
// (isStudentSelfDeactivated): anything outside it counts as ACTIVE,
// including a missing/empty status (which the derivation reads as
// 'Active').
const STUDENT_DEACTIVATED_STATUSES = new Set(['inactive', 'deactivated', 'deleted', 'left']);
function studentStatusCountsAsActive(status) {
  const st = String(status == null ? 'Active' : status).trim().toLowerCase();
  return !STUDENT_DEACTIVATED_STATUSES.has(st);
}
async function familyRowIsDeactivated(d1, familyId) {
  if (familyId == null || String(familyId).trim() === '') return false;
  try {
    const row = await d1.prepare('SELECT status FROM families WHERE id = ?').bind(String(familyId)).first();
    if (!row) return false;
    const st = String(row.status || '').trim().toLowerCase();
    return st === 'inactive' || st === 'deactivated';
  } catch (e) {
    return false;
  }
}
const STUDENT_ACTIVATION_BLOCKED_MESSAGE = 'This family is deactivated. Reactivate the family before activating its students.';

// Batch 7A: session-revocation bumps. When a teacher/manager/family account
// is deactivated or deleted through this engine, the subject's earlier
// tokens must stop working immediately. Before this change they stayed
// valid until their 8-hour expiry, because no server check consulted any
// status field. The engine writes a per-subject "valid after" marker that
// cloudflare/worker.js requireApiAuth enforces: tokens with iat earlier
// than the marker are rejected. The marker key is an HMAC of the subject
// id under WORKER_AUTH_SECRET (never a plaintext id in the marker table).
// If the secret is not configured (a standalone Pages deployment, which
// has no auth at all), the bump is skipped with a warning — the Worker
// path always has the secret, so a skipped bump there would indicate a
// misconfiguration, not a silent hole in the gated path. Bump failures
// never fail the data write itself.
const ACCOUNT_INACTIVE_STATUSES = {
  families: new Set(['inactive', 'deactivated']),
  teachers: new Set(['inactive', 'terminated', 'deactivated']),
};
function accountStatusCountsAsInactive(table, status) {
  const set = ACCOUNT_INACTIVE_STATUSES[table];
  if (!set) return false;
  return set.has(String(status == null ? '' : status).trim().toLowerCase());
}
async function hmacHexDb(secret, text) {
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(text)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function bumpSubjectValidAfter(d1, env, subjectId, reason) {
  const secret = env && env.WORKER_AUTH_SECRET;
  if (!secret) {
    console.warn('[db-api] valid-after bump skipped: WORKER_AUTH_SECRET not configured');
    return;
  }
  if (subjectId == null || String(subjectId) === '') return;
  try {
    const subjectHash = await hmacHexDb(secret, String(subjectId));
    const nowSec = Math.floor(Date.now() / 1000);
    await d1.prepare('INSERT INTO auth_subject_valid_after (subject_hash, valid_after, reason, updated_at) VALUES (?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET valid_after = excluded.valid_after, reason = excluded.reason, updated_at = excluded.updated_at').bind(subjectHash, nowSec, reason, new Date().toISOString()).run();
  } catch (e) {
    console.warn('[db-api] valid-after bump failed (data write unaffected):', e && e.message);
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = buildCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Batch 7 Part B: internal-invocation guard. This engine has no auth of
  // its own: it is safe ONLY behind the Worker, which delegates in-process
  // and stamps context.__lmsInternal (see cloudflare/worker.js). A remote
  // caller on a standalone Cloudflare Pages deploy can never set that
  // property (Pages builds context from the HTTP request), so any direct
  // call fails closed here with 403 — BEFORE ensureSchema() runs any DDL
  // and before any data path. The OPTIONS carve-out above returns headers
  // only and never touches data, so it stays exempt. Do NOT replace this
  // with a header check (any HTTP caller can send any header) and do NOT
  // invent a shared env secret for it.
  if (!context.__lmsInternal) {
    return jsonResponse(
      { ok: false, error: 'Forbidden' },
      403,
      corsHeaders
    );
  }

  const d1 = env.DB || env.ALHUDA_DB;
  if (!d1) {
    return jsonResponse(
      {
        ok: false,
        d1_bound: false,
        error: 'Cloudflare D1 database binding (DB) is not attached yet.'
      },
      503,
      corsHeaders
    );
  }

  await ensureSchema(d1);

  if (request.method === 'GET') {
    return jsonResponse(
      { ok: true, d1_bound: true, engine: 'Cloudflare D1 SQLite' },
      200,
      corsHeaders
    );
  }

  try {
    const body = await request.json();
    const { table, action, select = '*', filters = [], orders = [], limit = null, values = null, single = false } = body || {};

    if (!ALLOWED_TABLES.has(table)) {
      return jsonResponse(
        { data: null, error: { message: `Invalid table: ${table}` } },
        400,
        corsHeaders
      );
    }

    // Batch 6B: financial records are never hard-deleted, by any role —
    // they are cancelled with a reason instead. The Worker applies the
    // same rule before delegating; this engine-level check is the
    // guarantee even for a caller that reaches the engine directly.
    if (action === 'delete' && FINANCIAL_TABLES.has(table)) {
      return jsonResponse(
        { error: 'Financial records cannot be deleted. Cancel the record instead.' },
        403,
        corsHeaders
      );
    }

    const validCols = await getTableColumns(d1, table);

    // 1. SELECT
    if (action === 'select') {
      const { sql: whereSql, params } = buildWhereClause(filters);
      let orderSql = '';
      if (Array.isArray(orders) && orders.length > 0) {
        const parts = orders
          .map(o => {
            const c = sanitizeColumn(o.column);
            if (!c || !validCols.has(c)) return null;
            return `${c} ${o.ascending === false ? 'DESC' : 'ASC'}`;
          })
          .filter(Boolean);
        if (parts.length > 0) orderSql = ` ORDER BY ${parts.join(', ')}`;
      }
      // Batch 3.4 (audit P2-3): every SELECT carries a ceiling. An
      // absent limit used to mean "every row" (and LIMIT -5 meant
      // unlimited in SQLite, since a negative LIMIT is no limit) —
      // at 321 families the system_settings table alone is 751 rows
      // and growing, so an unguarded read is a slow denial-of-service
      // on the Worker and on the portal that renders it. Callers that
      // pass an explicit limit keep it (clamped to the ceiling);
      // callers that pass none get the default. The response reports
      // what was applied and whether the result hit the cap, so a
      // caller that needs the rest can page with offset instead of
      // silently receiving a partial table.
      const rawLimit = Number(limit);
      const limitApplied = (limit === null || limit === undefined || limit === '')
        ? SELECT_DEFAULT_LIMIT
        : Math.min(SELECT_MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : SELECT_DEFAULT_LIMIT));
      const rawOffset = Number(body.offset);
      const offsetApplied = (body.offset === null || body.offset === undefined || body.offset === '')
        ? 0
        : (Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0);
      const limitSql = ` LIMIT ${limitApplied} OFFSET ${offsetApplied}`;
      const query = `SELECT * FROM ${table}${whereSql}${orderSql}${limitSql}`;
      const stmt = d1.prepare(query).bind(...params);
      const { results } = await stmt.all();
      const hydrated = await hydrateRelationalJoins(d1, table, results || [], select);

      // Normalize family email aliases across both email and parent_email
      if (table === 'families') {
        const famList = Array.isArray(hydrated) ? hydrated : (hydrated ? [hydrated] : []);
        famList.forEach(f => {
          const em = String(f.email || f.parent_email || '').trim();
          f.email = em;
          f.parent_email = em;
        });
      }

      // Normalize attendance_logs date / class_date and lesson_notes / remarks
      if (table === 'attendance_logs') {
        const logList = Array.isArray(hydrated) ? hydrated : (hydrated ? [hydrated] : []);
        logList.forEach(l => {
          const dt = String(l.date || l.class_date || '').trim();
          l.date = dt;
          l.class_date = dt;
          const notes = String(l.lesson_notes || l.remarks || '').trim();
          l.lesson_notes = notes;
          l.remarks = notes;
        });
      }

      const data = single ? (hydrated[0] || null) : hydrated;
      return jsonResponse({ data, error: null, limitApplied, truncated: !single && (results || []).length >= limitApplied }, 200, corsHeaders);
    }

    // 2. INSERT / UPSERT
    if (action === 'insert' || action === 'upsert') {
      let rows = Array.isArray(values) ? values : [values || {}];
      const inserted = [];
      const isFinancial = FINANCIAL_TABLES.has(table);

      // Batch 6B: a payment must always name its family. The table cannot
      // enforce NOT NULL on installs that predate the column, so the
      // engine checks up front — before any row of the batch is written.
      if (table === 'payments') {
        for (const rawRow of rows) {
          const fam = rawRow && rawRow.family_id != null ? String(rawRow.family_id).trim() : '';
          if (!fam) {
            return jsonResponse(
              { error: 'family_id is required for payments' },
              400,
              corsHeaders
            );
          }
        }
      }

      // Phase 4 (audit P3-o): a salary slip must always name its
      // teacher and period (same reasoning as the payments check above;
      // UNIQUE(teacher_id, period) cannot help a row that omits them).
      if (table === 'salary_slips') {
        for (const rawRow of rows) {
          const tid = rawRow && rawRow.teacher_id != null ? String(rawRow.teacher_id).trim() : '';
          const per = rawRow && rawRow.period != null ? String(rawRow.period).trim() : '';
          if (!tid || !per) {
            return jsonResponse(
              { error: 'teacher_id and period are required for salary_slips' },
              400,
              corsHeaders
            );
          }
        }
      }

      // Batch 3.4 (audit P2-4): a multi-row financial insert used to
      // write rows one by one and stop at the first UNIQUE conflict,
      // leaving earlier rows written with no report of which ones
      // landed. Pre-validate the batch's UNIQUE keys up front so a
      // conflicting batch writes NOTHING (409, failedIndex, no rows
      // landed). The mid-batch race window (a conflicting row created
      // between the check and the write) is still reported exactly —
      // see the catch below. Non-financial tables use INSERT OR
      // REPLACE and cannot hit this path.
      if (isFinancial && action === 'insert') {
        const conflict = await findFinancialBatchConflict(d1, table, rows);
        if (conflict) {
          return jsonResponse(
            { data: null, error: { message: conflict.message }, failedIndex: conflict.index, insertedIds: [] },
            409,
            corsHeaders
          );
        }
      }
      // Duplicate-schedule prevention (2026-11-05): class_schedules
      // gets the same up-front treatment. INSERT pre-validates the
      // batch's natural keys — a conflicting batch writes NOTHING and
      // returns 409 (same shape as the financial guard above), so a
      // repeated booking request can never mint a second copy of a
      // class. UPSERT (the browser-mirror sync) instead drops natural-
      // key duplicates under different ids silently, keeping the sync
      // idempotent; rows whose id already exists keep replace
      // semantics, and the response keeps its current shape.
      if (table === 'class_schedules') {
        if (action === 'insert') {
          const conflict = await findScheduleBatchConflict(d1, rows);
          if (conflict) {
            return jsonResponse(
              { data: null, error: { message: conflict.message }, failedIndex: conflict.index, insertedIds: [] },
              409,
              corsHeaders
            );
          }
        } else {
          rows = await filterScheduleUpsertRows(d1, rows);
        }
      }
      // Batch 7 (F1.2): a students insert/upsert whose resulting status is
      // an "active" value is rejected while the student's family row is
      // Inactive/Deactivated. Deactivation is enforced at the data layer
      // so NO client path (stale mirror, old tab, direct call) can
      // resurrect a student inside a deactivated family. Authorized
      // reactivation sets the FAMILY row Active first, so legitimate
      // flows pass. (An omitted status counts as active: the column
      // default / derivation both read it as 'Active'.)
      if (table === 'students') {
        for (const rawRow of rows) {
          if (!rawRow) continue;
          const resultingStatus = rawRow.status == null ? 'Active' : rawRow.status;
          if (!studentStatusCountsAsActive(resultingStatus)) continue;
          if (await familyRowIsDeactivated(d1, rawRow.family_id)) {
            return jsonResponse(
              { error: STUDENT_ACTIVATION_BLOCKED_MESSAGE },
              403,
              corsHeaders
            );
          }
        }
      }

      // Batch 3.4 (audit P2-5): unknown keys on inserts are collected
      // for the response (see the return below) instead of vanishing.
      const droppedInsertColumns = new Set();
      for (const rawRow of rows) {
        const row = { ...rawRow };
        if (!row.id) row.id = generateId(table);
        if (!row.created_at && validCols.has('created_at')) {
          row.created_at = new Date().toISOString();
        }

        // Bridge email / parent_email for families
        if (table === 'families') {
          const em = String(row.email || row.parent_email || '').trim();
          if (em) {
            if (validCols.has('email')) row.email = em;
            if (validCols.has('parent_email')) row.parent_email = em;
          }
        }

        // Bridge date / class_date and lesson_notes / remarks for attendance_logs
        if (table === 'attendance_logs') {
          const dt = String(row.date || row.class_date || '').trim();
          if (dt) {
            if (validCols.has('date')) row.date = dt;
            if (validCols.has('class_date')) row.class_date = dt;
          }
          const notes = String(row.lesson_notes || row.remarks || '').trim();
          if (notes) {
            if (validCols.has('lesson_notes')) row.lesson_notes = notes;
            if (validCols.has('remarks')) row.remarks = notes;
          }
        }

        const cols = Object.keys(row).filter(k => validCols.has(k));
        for (const k of Object.keys(row)) if (!validCols.has(k)) droppedInsertColumns.add(k);
        const placeholders = cols.map(() => '?').join(', ');
        const bindVals = cols.map(k => {
          const v = row[k];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v === undefined ? null : v;
        });

        // Batch 6B: financial tables use plain INSERT — never REPLACE.
        // INSERT OR REPLACE resolves a UNIQUE conflict by DELETING the
        // conflicting row and inserting the new one, silently: one
        // receipt could overwrite another. A plain INSERT instead fails
        // and deletes NOTHING. An upsert on a financial table whose id
        // already exists takes the true UPDATE-by-id path below.
        let updateById = false;
        if (isFinancial && action === 'upsert') {
          const existing = await d1.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(row.id).first();
          updateById = !!existing;
        }

        try {
          if (updateById) {
            const setCols = cols.filter(c => c !== 'id');
            if (setCols.length > 0) {
              const setSql = setCols.map(c => `${c} = ?`).join(', ');
              const setVals = setCols.map(c => bindVals[cols.indexOf(c)]);
              await d1.prepare(`UPDATE ${table} SET ${setSql} WHERE id = ?`).bind(...setVals, row.id).run();
            }
          } else {
            const verb = isFinancial ? 'INSERT' : 'INSERT OR REPLACE';
            const sql = `${verb} INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
            await d1.prepare(sql).bind(...bindVals).run();
          }
        } catch (err) {
          // A UNIQUE conflict on a financial table is a user error, not
          // a server error: surface it as a clear 409. Nothing was
          // deleted by the failed write (plain INSERT semantics).
          if (isFinancial) {
            const uniqueMsg = financialUniqueErrorMessage(table, err);
            if (uniqueMsg) {
              // Batch 3.4 (audit P2-4): the race window — a conflicting
              // row created between the pre-validation above and this
              // write. Rows are pushed in order, so inserted.length is
              // exactly the failing row's index, and insertedIds names
              // every row that already landed. The caller can retry
              // with only the failed tail instead of guessing.
              return jsonResponse(
                { data: null, error: { message: uniqueMsg }, failedIndex: inserted.length, insertedIds: inserted.map((r) => r.id) },
                409,
                corsHeaders
              );
            }
          }
          throw err;
        }
        inserted.push(row);
      }

      const data = single ? (inserted[0] || null) : inserted;
      // Batch 7A: a families/teachers row written with an inactive status
      // invalidates that subject's earlier tokens (covers upsert-driven
      // deactivation as well as the update path below). Harmless for a
      // brand-new row: no token can predate the row, and a later login
      // mints a token with iat at or after the marker.
      if (table === 'families' || table === 'teachers') {
        for (const row of inserted) {
          if (row && accountStatusCountsAsInactive(table, row.status)) {
            await bumpSubjectValidAfter(d1, env, row.id, 'deactivated');
          }
        }
      }
      // Batch 3.4 (audit P2-5): inserts report dropped keys (a 400
      // would risk breaking live saves that carry UI-only keys, so
      // inserts report instead of rejecting — unlike updates, where a
      // zero-valid-column patch is unambiguously a typo).
      const insertResponse = { data, error: null };
      if (droppedInsertColumns.size > 0) insertResponse.droppedColumns = [...droppedInsertColumns];
      return jsonResponse(insertResponse, 200, corsHeaders);
    }

    // 3. UPDATE — empty filters are rejected: an unscoped UPDATE would
    // rewrite the entire table.
    if (action === 'update') {
      const patch = { ...(values || {}) };
      if (table === 'families') {
        const em = String(patch.email || patch.parent_email || '').trim();
        if (em) {
          if (validCols.has('email')) patch.email = em;
          if (validCols.has('parent_email')) patch.parent_email = em;
        }
      }

      const { sql: whereSql, params: whereParams } = buildWhereClause(filters);
      if (!whereSql) {
        return jsonResponse(
          { data: null, error: { message: 'update_requires_filter' } },
          400,
          corsHeaders
        );
      }

      // Batch 3.4 (audit P2-5): unknown columns used to be dropped
      // silently and the update still returned 200 with the
      // (unchanged) rows — a caller that mistyped a column believed
      // its write succeeded. A patch with NO valid column is now a
      // 400 naming the unknown keys; a patch with some valid columns
      // proceeds and reports the dropped keys, so the caller can fix
      // the typo without losing the valid part of the write. An empty
      // patch stays a no-op 200 (a re-read, not a typo).
      const patchKeys = Object.keys(patch);
      const droppedColumns = patchKeys.filter(k => !validCols.has(k));
      if (patchKeys.length > 0 && patchKeys.length === droppedColumns.length) {
        return jsonResponse(
          { data: null, error: { message: `Unknown columns: ${droppedColumns.join(', ')}` } },
          400,
          corsHeaders
        );
      }

      // Batch 7 (F1.2): the same deactivation guard for updates that SET
      // an active student status. Updates that do not touch `status`
      // (e.g. a parent writing leave-request notes on their own child)
      // are deliberately unaffected. The family is resolved from the
      // patch when the write also moves the student, otherwise from the
      // targeted rows themselves.
      if (table === 'students' && Object.prototype.hasOwnProperty.call(patch, 'status') && studentStatusCountsAsActive(patch.status)) {
        let guardFamilyIds;
        if (patch.family_id != null && String(patch.family_id).trim() !== '') {
          guardFamilyIds = [patch.family_id];
        } else {
          const { results: targets } = await d1.prepare(`SELECT family_id FROM students${whereSql}`).bind(...whereParams).all();
          guardFamilyIds = [...new Set((targets || []).map(t => t && t.family_id).filter(Boolean))];
        }
        for (const famId of guardFamilyIds) {
          if (await familyRowIsDeactivated(d1, famId)) {
            return jsonResponse(
              { error: STUDENT_ACTIVATION_BLOCKED_MESSAGE },
              403,
              corsHeaders
            );
          }
        }
      }

      const cols = Object.keys(patch).filter(k => validCols.has(k));
      if (cols.length > 0) {
        const setSql = cols.map(c => `${c} = ?`).join(', ');
        const setVals = cols.map(k => {
          const v = patch[k];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v === undefined ? null : v;
        });
        const updateSql = `UPDATE ${table} SET ${setSql}${whereSql}`;
        try {
          await d1.prepare(updateSql).bind(...setVals, ...whereParams).run();
        } catch (updErr) {
          // Phase 4 (audit P3-h): a UNIQUE collision on the UPDATE path
          // (e.g. reusing a receipt number) is a user error — map it to
          // the same 409 the insert path returns, not a generic 500.
          const uniqueMsg = financialUniqueErrorMessage(table, updErr);
          if (uniqueMsg) {
            return jsonResponse(
              { data: null, error: { message: uniqueMsg } },
              409,
              corsHeaders
            );
          }
          throw updErr;
        }
      }

      const { results } = await d1.prepare(`SELECT * FROM ${table}${whereSql}`).bind(...whereParams).all();
      const rawResults = results || [];
      if (table === 'families') {
        rawResults.forEach(f => {
          const em = String(f.email || f.parent_email || '').trim();
          f.email = em;
          f.parent_email = em;
        });
      }
      // Batch 7A: an update that SETS an inactive status invalidates that
      // subject's earlier tokens immediately (previously, deactivated
      // accounts kept working until their 8-hour token expired).
      if ((table === 'families' || table === 'teachers') && Object.prototype.hasOwnProperty.call(patch, 'status') && accountStatusCountsAsInactive(table, patch.status)) {
        for (const row of rawResults) {
          if (row && row.id) await bumpSubjectValidAfter(d1, env, row.id, 'deactivated');
        }
      }
      const data = single ? (rawResults[0] || null) : rawResults;
      // Batch 3.4 (audit P2-5): report dropped keys (see above).
      const updateResponse = { data, error: null };
      if (droppedColumns.length > 0) updateResponse.droppedColumns = droppedColumns;
      return jsonResponse(updateResponse, 200, corsHeaders);
    }

    // 4. DELETE — empty filters are rejected: an unscoped DELETE would
    // wipe the entire table.
    if (action === 'delete') {
      const { sql: whereSql, params: whereParams } = buildWhereClause(filters);
      if (!whereSql) {
        return jsonResponse(
          { data: null, error: { message: 'delete_requires_filter' } },
          400,
          corsHeaders
        );
      }
      // Batch 7A: deleting a teacher/manager/family account invalidates
      // that subject's earlier tokens (previously they survived deletion
      // until expiry). Ids are read BEFORE the delete, since the engine
      // returns no rows for deletes.
      let deletedSubjectIds = null;
      if (table === 'families' || table === 'teachers') {
        try {
          const { results: doomed } = await d1.prepare(`SELECT id FROM ${table}${whereSql}`).bind(...whereParams).all();
          deletedSubjectIds = (doomed || []).map(r => r && r.id).filter(Boolean);
        } catch (e) { deletedSubjectIds = null; }
      }
      const delRes = await d1.prepare(`DELETE FROM ${table}${whereSql}`).bind(...whereParams).run();
      if (deletedSubjectIds) {
        for (const id of deletedSubjectIds) await bumpSubjectValidAfter(d1, env, id, 'deleted');
      }
      // Phase 4 (audit P3-n): report how many rows actually matched, so
      // a no-match delete is no longer indistinguishable from a real
      // one. Additive field only — the { data: [], error: null } shape
      // existing callers rely on is unchanged.
      const delPayload = { data: [], error: null };
      const delChanges = delRes && delRes.meta && typeof delRes.meta.changes === 'number' ? delRes.meta.changes : null;
      if (delChanges !== null) delPayload.deleted = delChanges;
      return jsonResponse(delPayload, 200, corsHeaders);
    }

    return jsonResponse(
      { data: null, error: { message: `Unsupported action: ${action}` } },
      400,
      corsHeaders
    );
  } catch (err) {
    // Never leak internals (SQL, stack traces) to the client.
    console.error('[db-api] request failed:', err);
    return jsonResponse(
      { data: null, error: { message: 'internal_error' } },
      500,
      corsHeaders
    );
  }
}
