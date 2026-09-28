/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — CLOUDFLARE D1 DATABASE API ENGINE
 * File: functions/api/db.js
 * Purpose: Zero-configuration Cloudflare Pages Function that automatically
 *          initializes D1 tables and executes Supabase-compatible queries.
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
  'system_settings'
]);

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
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    family_id TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'GBP',
    payment_month TEXT,
    payment_date TEXT,
    payment_method TEXT DEFAULT 'Bank Transfer',
    status TEXT DEFAULT 'Paid',
    receipt_url TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
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
    system_settings: 'SYS-'
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

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const d1 = env.DB || env.ALHUDA_DB;
  if (!d1) {
    return new Response(
      JSON.stringify({
        ok: false,
        d1_bound: false,
        error: 'Cloudflare D1 database binding (DB) is not attached yet.'
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  await ensureSchema(d1);

  if (request.method === 'GET') {
    return new Response(
      JSON.stringify({ ok: true, d1_bound: true, engine: 'Cloudflare D1 SQLite' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { table, action, select = '*', filters = [], orders = [], limit = null, values = null, single = false } = body || {};

    if (!ALLOWED_TABLES.has(table)) {
      return new Response(
        JSON.stringify({ data: null, error: { message: `Invalid table: ${table}` } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
      const data = single ? (hydrated[0] || null) : hydrated;
      return new Response(JSON.stringify({ data, error: null }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. INSERT / UPSERT
    if (action === 'insert' || action === 'upsert') {
      const rows = Array.isArray(values) ? values : [values || {}];
      const inserted = [];

      for (const rawRow of rows) {
        const row = { ...rawRow };
        if (!row.id) row.id = generateId(table);
        if (!row.created_at && validCols.has('created_at')) {
          row.created_at = new Date().toISOString();
        }

        const cols = Object.keys(row).filter(k => validCols.has(k));
        const placeholders = cols.map(() => '?').join(', ');
        const bindVals = cols.map(k => {
          const v = row[k];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v === undefined ? null : v;
        });

        const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
        await d1.prepare(sql).bind(...bindVals).run();
        inserted.push(row);
      }

      const data = single ? (inserted[0] || null) : inserted;
      return new Response(JSON.stringify({ data, error: null }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. UPDATE
    if (action === 'update') {
      const patch = values || {};
      const cols = Object.keys(patch).filter(k => validCols.has(k));
      if (cols.length > 0) {
        const setSql = cols.map(c => `${c} = ?`).join(', ');
        const setVals = cols.map(k => {
          const v = patch[k];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v === undefined ? null : v;
        });
        const { sql: whereSql, params: whereParams } = buildWhereClause(filters);
        const updateSql = `UPDATE ${table} SET ${setSql}${whereSql}`;
        await d1.prepare(updateSql).bind(...setVals, ...whereParams).run();
      }

      const { sql: whereSql, params: whereParams } = buildWhereClause(filters);
      const { results } = await d1.prepare(`SELECT * FROM ${table}${whereSql}`).bind(...whereParams).all();
      const data = single ? ((results || [])[0] || null) : (results || []);
      return new Response(JSON.stringify({ data, error: null }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. DELETE
    if (action === 'delete') {
      const { sql: whereSql, params: whereParams } = buildWhereClause(filters);
      if (whereSql) {
        await d1.prepare(`DELETE FROM ${table}${whereSql}`).bind(...whereParams).run();
      }
      return new Response(JSON.stringify({ data: [], error: null }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(
      JSON.stringify({ data: null, error: { message: `Unsupported action: ${action}` } }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ data: null, error: { message: err.message || String(err) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
