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
  'trial_students',
  'system_settings',
  // Batch 2.1: readable by the OWNER through this engine; the Worker
  // denies it to every other role before delegation (see worker.js).
  'audit_log',
  // Batch 6B: financial record tables (fee payments + payroll). See
  // FINANCIAL_TABLES below for the stricter write semantics they get.
  'salary_slips',
  'salary_adjustments'
]);

// Batch 6B: financial record tables. Inserts here are plain INSERTs — a
// UNIQUE conflict must surface as an error, never silently replace an
// existing record the way INSERT OR REPLACE would — and hard deletes are
// rejected for every role: financial rows are cancelled, not deleted.
const FINANCIAL_TABLES = new Set(['payments', 'salary_slips', 'salary_adjustments']);

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
  )`
];

let _schemaInitialized = false;

async function ensureSchema(db) {
  if (_schemaInitialized || !db) return;
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
    trial_students: 'TRL-',
    system_settings: 'SYS-',
    salary_slips: 'SAL-',
    salary_adjustments: 'ADJ-'
  };
  const prefix = prefixMap[table] || 'ID-';
  return prefix + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function sanitizeColumn(col) {
  return String(col || '').replace(/[^a-zA-Z0-9_]/g, '');
}

function buildWhereClause(filters = []) {
  const clauses = [];
  const params = [];

  for (const f of filters) {
    const col = sanitizeColumn(f.column);
    if (!col) continue;
    const op = f.op;
    const val = f.value;

    if (op === 'eq') {
      if (val === null) {
        clauses.push(`${col} IS NULL`);
      } else {
        clauses.push(`${col} = ?`);
        params.push(val);
      }
    } else if (op === 'neq') {
      if (val === null) {
        clauses.push(`${col} IS NOT NULL`);
      } else {
        clauses.push(`(${col} IS NULL OR ${col} != ?)`);
        params.push(val);
      }
    } else if (op === 'gt') {
      clauses.push(`${col} > ?`);
      params.push(val);
    } else if (op === 'gte') {
      clauses.push(`${col} >= ?`);
      params.push(val);
    } else if (op === 'lt') {
      clauses.push(`${col} < ?`);
      params.push(val);
    } else if (op === 'lte') {
      clauses.push(`${col} <= ?`);
      params.push(val);
    } else if (op === 'like' || op === 'ilike') {
      clauses.push(`LOWER(${col}) LIKE LOWER(?)`);
      params.push(String(val || ''));
    } else if (op === 'in' && Array.isArray(val) && val.length > 0) {
      const placeholders = val.map(() => '?').join(', ');
      clauses.push(`${col} IN (${placeholders})`);
      params.push(...val);
    }
  }

  const sql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return { sql, params };
}

async function hydrateRelationalJoins(db, table, rows, selectStr = '*') {
  if (!Array.isArray(rows) || rows.length === 0 || !selectStr) return rows;
  const sel = String(selectStr);

  // 1. families -> students(*)
  if (table === 'families' && /students\s*\(/i.test(sel)) {
    const { results: allStudents } = await db.prepare('SELECT * FROM students').all();
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
    const { results: allFamilies } = await db.prepare('SELECT * FROM families').all();
    const famMap = new Map((allFamilies || []).map(f => [String(f.id), f]));
    rows.forEach(r => {
      r.families = famMap.get(String(r.family_id || '')) || null;
    });
  }

  // 3. class_schedules / attendance_logs -> students(...)
  if ((table === 'class_schedules' || table === 'attendance_logs') && /students\s*\(/i.test(sel)) {
    const { results: allStudents } = await db.prepare('SELECT * FROM students').all();
    const stuMap = new Map((allStudents || []).map(s => [String(s.id), s]));
    rows.forEach(r => {
      r.students = stuMap.get(String(r.student_id || '')) || null;
    });
  }

  // 4. students / class_schedules / attendance_logs -> teachers(...)
  if ((table === 'students' || table === 'class_schedules' || table === 'attendance_logs') && /teachers\s*\(/i.test(sel)) {
    const { results: allTeachers } = await db.prepare('SELECT * FROM teachers').all();
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

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = buildCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
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
      const limitSql = limit ? ` LIMIT ${parseInt(limit, 10) || 100}` : '';
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
      return jsonResponse({ data, error: null }, 200, corsHeaders);
    }

    // 2. INSERT / UPSERT
    if (action === 'insert' || action === 'upsert') {
      const rows = Array.isArray(values) ? values : [values || {}];
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
              return jsonResponse(
                { data: null, error: { message: uniqueMsg } },
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
      return jsonResponse({ data, error: null }, 200, corsHeaders);
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

      const cols = Object.keys(patch).filter(k => validCols.has(k));
      if (cols.length > 0) {
        const setSql = cols.map(c => `${c} = ?`).join(', ');
        const setVals = cols.map(k => {
          const v = patch[k];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v === undefined ? null : v;
        });
        const updateSql = `UPDATE ${table} SET ${setSql}${whereSql}`;
        await d1.prepare(updateSql).bind(...setVals, ...whereParams).run();
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
      const data = single ? (rawResults[0] || null) : rawResults;
      return jsonResponse({ data, error: null }, 200, corsHeaders);
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
      await d1.prepare(`DELETE FROM ${table}${whereSql}`).bind(...whereParams).run();
      return jsonResponse({ data: [], error: null }, 200, corsHeaders);
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
