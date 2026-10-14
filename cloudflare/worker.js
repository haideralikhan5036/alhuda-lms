/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS â UNIFIED CLOUDFLARE WORKER + STATIC ASSETS
 * File: cloudflare/worker.js
 * Purpose: Works directly with `npx wrangler deploy` on Cloudflare Workers.
 *          Handles /api/auth/* (logins), /api/db (Cloudflare D1),
 *          /api/storage (Cloudflare R2), and serves static portal files
 *          via env.ASSETS.
 *
 * SECURITY MODEL (2026-10-14 hardening):
 *   - All logins are verified SERVER-SIDE here. The browser only ever holds
 *     a signed, expiring session token (see cloudflare/auth.js).
 *   - /api/db and /api/storage REQUIRE a worker-issued Bearer token
 *     (any authenticated role). Anonymous access is denied.
 *   - Browser-side session checks are UX only â this worker is the enforcer.
 *   - Phase 2 (2026-10-14): per-role DATA SCOPING is enforced in this file
 *     (see "Phase 2: per-role DATA SCOPING"). Owner = full access. Manager =
 *     full operational access (system_settings is read-only for managers;
 *     password fields are stripped on read AND write for every non-owner
 *     role). Teacher = own students/classes/logs only (families, payments,
 *     settings denied). Parent = own family/students/payments only, teacher
 *     records reduced to {id, full_name, zoom_link}; parents may update
 *     their own children's status/notes (leave flow), teachers may update
 *     their own students' notes (leave/reschedule requests).
 *   - Passwords are stored as sha256$salt$hash (see "Phase 2: password
 *     hashing"). Legacy plaintext still verifies during migration; the
 *     '12345678' default never authenticates. The owner migrates accounts
 *     via POST /api/auth/set-password.
 *
 * REQUIRED ENV VARS (set with `wrangler secret put <NAME>` â never in code):
 *   WORKER_AUTH_SECRET  - HMAC secret for session tokens (openssl rand -base64 48)
 *   OWNER_USERNAME      - owner login username
 *   OWNER_PASSWORD_HASH - sha256 hex of the owner password (echo -n 'pw' | sha256sum)
 *   ALLOWED_ORIGINS     - comma-separated allowed CORS origins
 * ============================================================================
 */

import { onRequest as handleDbRequest } from '../functions/api/db.js';
import { onRequest as handleStorageRequest } from '../functions/api/storage.js';
import {
  createSessionToken,
  verifySessionToken,
  sha256Hex,
  constantTimeEqualBytes,
} from './auth.js';

const te = new TextEncoder();

function allowedOrigins(env) {
  const raw = String((env && env.ALLOWED_ORIGINS) || '').trim();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeadersFor(request, env) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(request, env, data, status = 200) {
  // 204 No Content must not carry a body — `new Response("{}", {status:204})`
  // throws and turns every CORS preflight into a 500 (caught 2026-10-14:
  // all browser logins were blocked at preflight). Return a null body.
  if (status === 204) {
    return new Response(null, { status, headers: corsHeadersFor(request, env) });
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeadersFor(request, env),
  });
}

// --- Login rate limiting: max 10 attempts per IP per 10 minutes. -------------
// NOTE (limits): in-memory Map = per-isolate state. Resets on deploy, not
// shared across isolates. First line of defence; add a Cloudflare Rate
// Limiting rule in front of /api/auth/* for stronger guarantees.
const LOGIN_ATTEMPTS = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimited(ip) {
  const now = Date.now();
  const rec = LOGIN_ATTEMPTS.get(ip);
  if (!rec || now - rec.start > LOGIN_WINDOW_MS) {
    LOGIN_ATTEMPTS.set(ip, { count: 1, start: now });
    return false;
  }
  rec.count += 1;
  return rec.count > LOGIN_MAX_ATTEMPTS;
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function getDb(env) {
  return env.DB || env.ALHUDA_DB || null;
}

function parseJsonField(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch (e) {}
  }
  return {};
}

const DEFAULT_PASSWORD = '12345678';

function isUsablePassword(pw) {
  const s = String(pw || '').trim();
  return s.length >= 4 && s !== DEFAULT_PASSWORD;
}

// --- Phase 2: password hashing ------------------------------------------------
// New hashes are stored as 'sha256$<salt-hex>$<hash-hex>' where
// hash = SHA-256(saltHex + ':' + password). Legacy plaintext values still
// verify during the migration period, but the '12345678' default and empty
// passwords NEVER authenticate. The owner migrates accounts to hashes via
// POST /api/auth/set-password below.
//
// PASSWORD LOCATIONS (canonical slots, verified from D1 schema + login code):
//   parent  -> families.notes  JSON -> portal_credentials.password
//   teacher -> teachers.address JSON -> password            (also honored by
//              login: teachers.address -> teacher_account.password,
//                      teachers.notes  -> password)
//   manager -> teachers.address JSON -> password  (same record shape as
//              teacher; the record counts as a manager when employee_type =
//              'manager' or id/emp_id starts with 'MGR-')
function isHashedPassword(s) {
  return /^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(String(s || ''));
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', te.encode(saltHex + ':' + password));
  const hashHex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, stored) {
  const s = String(stored || '');
  if (isHashedPassword(s)) {
    const parts = s.split('$');
    const saltHex = parts[1] || '';
    const expectedHex = (parts[2] || '').toLowerCase();
    const digest = await crypto.subtle.digest('SHA-256', te.encode(saltHex + ':' + password));
    const hashHex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return constantTimeEqualBytes(te.encode(hashHex), te.encode(expectedHex));
  }
  // Legacy plaintext (migration period). Default/empty still rejected.
  return isUsablePassword(s) && constantTimeEqualBytes(te.encode(password), te.encode(s));
}

function isStrongPassword(pw) {
  const s = String(pw || '');
  return s.length >= 10 && s.trim().length >= 10 && s !== DEFAULT_PASSWORD;
}

// --- POST /api/auth/login  { username, password } -> { ok, token? } ----------
// Owner login, verified against env secrets. Fails closed if unconfigured.
async function handleOwnerLogin(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  const ip = clientIp(request);
  if (loginRateLimited(ip)) {
    return json(request, env, { ok: false, error: 'Too many login attempts. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }

  const username = String((body && body.username) || '');
  const password = String((body && body.password) || '');
  const expectedUser = String(env.OWNER_USERNAME || '');
  const expectedHash = String(env.OWNER_PASSWORD_HASH || '').toLowerCase();

  let valid = false;
  if (expectedUser && expectedHash && env.WORKER_AUTH_SECRET) {
    const userOk = constantTimeEqualBytes(te.encode(username), te.encode(expectedUser));
    const passHash = (await sha256Hex(password)).toLowerCase();
    const passOk = constantTimeEqualBytes(te.encode(passHash), te.encode(expectedHash));
    valid = userOk && passOk;
  }

  if (!valid) {
    return json(request, env, { ok: false, error: 'Invalid username or password.' }, 401);
  }

  const token = await createSessionToken(
    { sub: expectedUser, role: 'owner' },
    env.WORKER_AUTH_SECRET
  );
  return json(request, env, { ok: true, token });
}

// --- POST /api/auth/staff-login  { role, identifier, password } --------------
// Verifies manager/teacher/parent credentials against D1. Only EXPLICITLY
// set passwords are accepted â the '12345678' default and empty passwords
// NEVER authenticate here. If no explicit password exists for the account,
// login fails and the owner must set one via the owner portal first.
async function handleStaffLogin(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  const ip = clientIp(request);
  if (loginRateLimited(ip)) {
    return json(request, env, { ok: false, error: 'Too many login attempts. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }

  const role = String((body && body.role) || '').toLowerCase();
  const identifier = String((body && body.identifier) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');

  if (!['manager', 'teacher', 'parent'].includes(role) || !identifier || !password) {
    return json(request, env, { ok: false, error: 'Invalid username or password.' }, 401);
  }

  const db = getDb(env);
  if (!db || !env.WORKER_AUTH_SECRET) {
    return json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503);
  }

  try {
    let recordId = null;

    if (role === 'parent') {
      const { results } = await db.prepare('SELECT id, parent_name, notes FROM families').all();
      for (const f of results || []) {
        const notes = parseJsonField(f.notes);
        const pc = parseJsonField(notes.portal_credentials);
        const parentName = String(f.parent_name || '');
        const derivedUser = ('parent_' + parentName).toLowerCase().replace(/[^a-z0-9_]/g, '');
        const usernames = [pc.username, derivedUser, String(f.id || '').toLowerCase()].filter(Boolean).map((u) => String(u).toLowerCase());
        if (!usernames.includes(identifier)) continue;
        const pw = pc.password;
        if (await verifyPassword(password, pw)) {
          recordId = f.id;
          break;
        }
      }
    } else {
      // manager / teacher: credentials live on the teachers table.
      const { results } = await db.prepare('SELECT id, full_name, address, notes FROM teachers').all();
      for (const t of results || []) {
        const meta = parseJsonField(t.address);
        const notesMeta = parseJsonField(t.notes);
        const acc = meta.teacher_account || {};
        const firstName = String(t.full_name || 'teacher').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'teacher';
        const usernames = [
          meta.username, acc.username, notesMeta.username,
          firstName,
          meta.emp_id, meta.teacher_id, acc.emp_id,
          t.id,
        ].filter(Boolean).map((u) => String(u).toLowerCase());
        if (!usernames.includes(identifier)) continue;
        const pw = meta.password || acc.password || notesMeta.password;
        if (await verifyPassword(password, pw)) {
          // For manager role, require the record to actually be a manager.
          if (role === 'manager') {
            const empType = String(t.employee_type || meta.employee_type || meta.role || '').toLowerCase();
            const codeIds = [t.id, t.witness_name, meta.emp_id].map((s) => String(s || '').toUpperCase());
            const isManager = empType === 'manager' || codeIds.some((c) => c.startsWith('MGR-'));
            if (!isManager) continue;
          }
          recordId = t.id;
          break;
        }
      }
    }

    if (!recordId) {
      // Identical message for every failure: no enumeration.
      return json(request, env, { ok: false, error: 'Invalid username or password.' }, 401);
    }

    const token = await createSessionToken(
      { sub: String(recordId), role },
      env.WORKER_AUTH_SECRET
    );
    return json(request, env, { ok: true, token, id: recordId });
  } catch (e) {
    console.error('[auth] staff login failed:', e);
    return json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503);
  }
}

// --- POST /api/auth/set-password  { role, identifier, newPassword } ---------
// Owner-only. Migrates one account's password to the hashed format, or sets
// a fresh password. The owner finds the account by the same identifiers the
// login accepts, then the hash is written to the canonical password slot:
//   parent  -> families.notes JSON -> portal_credentials.password
//   manager/teacher -> teachers.address JSON -> password  (the slot
//                      staff-login checks first)
// New passwords must be >= 10 chars and not the '12345678' default.
async function handleSetPassword(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  const auth = await requireApiAuth(request, env);
  if (!auth || auth.role !== 'owner') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }

  const ip = clientIp(request);
  if (loginRateLimited(ip)) {
    return json(request, env, { ok: false, error: 'Too many attempts. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }

  const role = String((body && body.role) || '').toLowerCase();
  const identifier = String((body && body.identifier) || '').trim().toLowerCase();
  const newPassword = String((body && body.newPassword) || '');

  if (!['manager', 'teacher', 'parent'].includes(role) || !identifier) {
    return json(request, env, { ok: false, error: 'Invalid request.' }, 400);
  }
  if (!isStrongPassword(newPassword)) {
    return json(request, env, { ok: false, error: 'Password must be at least 10 characters and must not be a default password.' }, 400);
  }

  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503);
  }

  const hashed = await hashPassword(newPassword);

  try {
    if (role === 'parent') {
      const { results } = await db.prepare('SELECT id, parent_name, notes FROM families').all();
      for (const f of results || []) {
        const notes = parseJsonField(f.notes);
        const pc = parseJsonField(notes.portal_credentials);
        const parentName = String(f.parent_name || '');
        const derivedUser = ('parent_' + parentName).toLowerCase().replace(/[^a-z0-9_]/g, '');
        const usernames = [pc.username, derivedUser, String(f.id || '').toLowerCase()].filter(Boolean).map((u) => String(u).toLowerCase());
        if (!usernames.includes(identifier)) continue;
        const updated = { ...notes, portal_credentials: { ...pc, password: hashed } };
        await db.prepare('UPDATE families SET notes = ? WHERE id = ?').bind(JSON.stringify(updated), f.id).run();
        return json(request, env, { ok: true, id: f.id });
      }
      return json(request, env, { ok: false, error: 'Account not found.' }, 404);
    }

    // manager / teacher: credentials live on the teachers table.
    const { results } = await db.prepare('SELECT id, full_name, address, notes FROM teachers').all();
    for (const t of results || []) {
      const meta = parseJsonField(t.address);
      const notesMeta = parseJsonField(t.notes);
      const acc = meta.teacher_account || {};
      const firstName = String(t.full_name || 'teacher').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'teacher';
      const usernames = [
        meta.username, acc.username, notesMeta.username,
        firstName,
        meta.emp_id, meta.teacher_id, acc.emp_id,
        t.id,
      ].filter(Boolean).map((u) => String(u).toLowerCase());
      if (!usernames.includes(identifier)) continue;
      if (role === 'manager') {
        const empType = String(t.employee_type || meta.employee_type || meta.role || '').toLowerCase();
        const codeIds = [t.id, t.witness_name, meta.emp_id].map((s) => String(s || '').toUpperCase());
        const isManager = empType === 'manager' || codeIds.some((c) => c.startsWith('MGR-'));
        if (!isManager) continue;
      }
      const updated = { ...meta, password: hashed };
      await db.prepare('UPDATE teachers SET address = ? WHERE id = ?').bind(JSON.stringify(updated), t.id).run();
      return json(request, env, { ok: true, id: t.id });
    }
    return json(request, env, { ok: false, error: 'Account not found.' }, 404);
  } catch (e) {
    console.error('[auth] set-password failed:', e);
    return json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503);
  }
}

// --- Auth middleware for privileged APIs ------------------------------------
// Requires `Authorization: Bearer <token>` with a valid worker-issued
// session for any authenticated role. Anonymous requests are rejected.
// NOTE (Phase 2): per-role DATA SCOPING is not enforced here yet.
async function requireApiAuth(request, env) {
  const header = (request.headers.get('authorization') || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  let payload;
  try {
    payload = await verifySessionToken(m[1], env.WORKER_AUTH_SECRET);
  } catch (e) {
    return null;
  }
  if (!payload) return null;
  if (!['owner', 'manager', 'teacher', 'parent'].includes(payload.role)) return null;
  return payload;
}

function unauthorized(request, env) {
  return json(request, env, { ok: false, error: 'Authentication required.' }, 401);
}

function forbidden(request, env) {
  // Generic message on every denial: no detail leakage, no enumeration.
  return json(request, env, { ok: false, error: 'Access denied.' }, 403);
}

// --- Phase 2: per-role DATA SCOPING ------------------------------------------
// requireApiAuth proves WHO the caller is; the code below enforces WHAT each
// role may see or change. Tables/columns verified against
// functions/api/db.js SCHEMA_STATEMENTS (2026-10-14):
//   families(id, parent_name, ..., notes[JSON: portal_credentials{username,password}])
//   teachers(id, full_name, ..., address[JSON: username,password,emp_id,teacher_id,
//            teacher_account{username,password,emp_id}], notes[JSON: username,password])
//   students(id, family_id, name, ..., assigned_teacher_id, status, notes)
//   class_schedules(id, student_id, teacher_id, ...)
//   attendance_logs(id, schedule_id, student_id, teacher_id, ...)
//   payments(id, family_id, ...)              <- fee records live here
//   leave_requests(id, teacher_id, student_id, ...)
//   trial_students(id, student_id, family_id, ..., teacher_id)
//   system_settings(id, key, value)
// There is NO separate lesson_logs / fee_records / notices table in D1:
// lesson content travels in attendance_logs.lesson_notes/remarks.
//
// Compatibility notes (verified against the portal sources, 2026-10-14):
//  - teacher.html updates students.notes for its own students (leave /
//    reschedule / time-change requests are stored there), inserts/deletes
//    class_schedules for its own slots, and upserts attendance_logs.
//  - parent.html updates its own children's students.{status,notes} for the
//    "mark on leave" flow. Parents are otherwise read-only.
//  - parent.html renders teacher names for the child's classes, so parents
//    may read teachers but only the safe subset {id, full_name, zoom_link}.

const WRITE_ACTIONS = new Set(['insert', 'upsert', 'update', 'delete']);

// Decides table+action permission. Unknown tables fail closed for restricted
// roles; the downstream handler still 400s unknown tables for owner/manager.
function checkTableAccess(role, table, action) {
  if (role === 'owner') return 'allow';
  const write = WRITE_ACTIONS.has(action);

  if (role === 'manager') {
    // system_settings writes are owner-only (verified: manager portal never
    // writes system_settings). Password fields are stripped separately.
    if (table === 'system_settings' && write) return 'deny';
    return 'allow';
  }

  if (role === 'teacher') {
    switch (table) {
      case 'students':
        // update is notes-only (leave/reschedule requests) â enforced below.
        return (action === 'select' || action === 'update') ? 'allow' : 'deny';
      case 'teachers':
        return action === 'select' ? 'allow' : 'deny';
      case 'class_schedules':
        // Teachers manage their own slots (insert new, delete stale).
        return action === 'update' ? 'deny' : 'allow';
      case 'attendance_logs':
        return action === 'delete' ? 'deny' : 'allow';
      case 'leave_requests':
        return (action === 'select' || action === 'insert' || action === 'upsert') ? 'allow' : 'deny';
      case 'trial_students':
        return action === 'select' ? 'allow' : 'deny';
      default:
        return 'deny'; // families, payments, system_settings
    }
  }

  if (role === 'parent') {
    switch (table) {
      case 'students':
        // update is status/notes-only (mark-on-leave flow) â enforced below.
        return (action === 'select' || action === 'update') ? 'allow' : 'deny';
      case 'families':
      case 'teachers': // reduced to safe subset in post-processing
      case 'class_schedules':
      case 'attendance_logs':
      case 'payments':
      case 'leave_requests':
      case 'trial_students':
        return action === 'select' ? 'allow' : 'deny';
      default:
        return 'deny'; // system_settings
    }
  }

  return 'deny';
}

// Resolve the rows a restricted role may touch. Parents: own family + its
// students. Teachers: students assigned via students.assigned_teacher_id OR
// via class_schedules.teacher_id (both assignment paths exist in the app).
async function resolveScopeIds(db, role, sub) {
  const scope = { studentIds: [] };
  if (!db) return scope;
  try {
    if (role === 'parent') {
      const { results } = await db.prepare('SELECT id FROM students WHERE family_id = ?').bind(sub).all();
      scope.studentIds = (results || []).map((r) => String(r.id));
    } else if (role === 'teacher') {
      const { results: a } = await db.prepare('SELECT id FROM students WHERE assigned_teacher_id = ?').bind(sub).all();
      const { results: b } = await db.prepare('SELECT DISTINCT student_id AS id FROM class_schedules WHERE teacher_id = ?').bind(sub).all();
      const ids = new Set();
      for (const r of (a || [])) ids.add(String(r.id));
      for (const r of (b || [])) { if (r.id) ids.add(String(r.id)); }
      scope.studentIds = [...ids];
    }
  } catch (e) {
    console.error('[scope] resolve failed:', e);
  }
  return scope;
}

// Remove password-bearing keys from parsed JSON objects (non-destructive).
function withoutPasswordKeys(obj) {
  let changed = false;
  const out = { ...(obj || {}) };
  if (Object.prototype.hasOwnProperty.call(out, 'password')) { delete out.password; changed = true; }
  if (out.teacher_account && typeof out.teacher_account === 'object' && 'password' in out.teacher_account) {
    out.teacher_account = { ...out.teacher_account };
    delete out.teacher_account.password;
    changed = true;
  }
  if (out.portal_credentials && typeof out.portal_credentials === 'object' && 'password' in out.portal_credentials) {
    out.portal_credentials = { ...out.portal_credentials };
    delete out.portal_credentials.password;
    changed = true;
  }
  return { changed, value: out };
}

// Strip credential fields from a row object in place. Only touches values
// that are JSON objects containing password keys; plain-text notes are left
// exactly as they are.
function stripCredentialFieldsFromRow(table, row) {
  const targets = table === 'families' ? ['notes']
    : table === 'teachers' ? ['address', 'notes']
    : [];
  for (const f of targets) {
    const v = row[f];
    if (typeof v !== 'string' || !v.trim().startsWith('{')) continue;
    let parsed;
    try { parsed = JSON.parse(v); } catch (e) { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const { changed, value } = withoutPasswordKeys(parsed);
    if (changed) row[f] = JSON.stringify(value);
  }
}

function sanitizeWriteValues(table, values) {
  const rows = Array.isArray(values) ? values : [values || {}];
  return rows.map((row) => {
    const r = { ...(row || {}) };
    stripCredentialFieldsFromRow(table, r);
    return r;
  });
}

function forceTeacherValues(values, sub) {
  const rows = Array.isArray(values) ? values : [values || {}];
  return rows.map((r) => ({ ...(r || {}), teacher_id: sub }));
}

// Keep only whitelisted keys in an update patch (defense in depth: a teacher
// may touch notes, a parent may touch status/notes â never ids or links).
function whitelistPatch(values, allowedKeys) {
  const clean = {};
  const src = values || {};
  for (const k of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) clean[k] = src[k];
  }
  return clean;
}

// Inject server-side filters so a client can never widen its own scope.
// The db engine ANDs all filters, so injected constraints always apply.
// Returns the scoped body, or null to deny.
function applyDbScope(body, role, sub, scope) {
  const scoped = { ...(body || {}) };
  const table = scoped.table;
  const action = scoped.action;
  const filters = Array.isArray(scoped.filters) ? [...scoped.filters] : [];

  const eq = (column, value) => ({ column, op: 'eq', value });
  const inList = (column, values) => ({ column, op: 'in', value: values });
  const none = () => eq('id', '__no_such_row__'); // empty scope -> zero rows

  if (role === 'owner') return scoped;

  if (role === 'manager') {
    // Managers keep full operational access, but can never read or write
    // stored passwords through this API (owner uses /api/auth/set-password).
    if (WRITE_ACTIONS.has(action)) {
      scoped.values = sanitizeWriteValues(table, scoped.values);
    }
    return scoped;
  }

  if (role === 'teacher') {
    if (table === 'students') {
      if (action === 'select') {
        filters.push(scope.studentIds.length ? inList('id', scope.studentIds) : none());
      } else if (action === 'update') {
        filters.push(scope.studentIds.length ? inList('id', scope.studentIds) : none());
        scoped.values = whitelistPatch(scoped.values, ['notes']);
      }
    } else if (table === 'teachers' && action === 'select') {
      filters.push(eq('id', sub));
    } else if (table === 'class_schedules') {
      if (action === 'select' || action === 'delete') {
        filters.push(eq('teacher_id', sub));
      } else if (action === 'insert' || action === 'upsert') {
        scoped.values = forceTeacherValues(scoped.values, sub);
      }
    } else if (table === 'attendance_logs') {
      if (action === 'select' || action === 'update') {
        filters.push(eq('teacher_id', sub));
        if (action === 'update') scoped.values = forceTeacherValues(scoped.values, sub)[0];
      } else if (action === 'insert' || action === 'upsert') {
        scoped.values = forceTeacherValues(scoped.values, sub);
      }
    } else if (table === 'leave_requests') {
      if (action === 'select') {
        filters.push(eq('teacher_id', sub));
      } else if (action === 'insert' || action === 'upsert') {
        scoped.values = forceTeacherValues(scoped.values, sub);
      }
    } else if (table === 'trial_students' && action === 'select') {
      filters.push(eq('teacher_id', sub));
    }
    scoped.filters = filters;
    return scoped;
  }

  if (role === 'parent') {
    if (table === 'families') {
      filters.push(eq('id', sub));
    } else if (table === 'students') {
      if (action === 'select') {
        filters.push(eq('family_id', sub));
      } else if (action === 'update') {
        filters.push(eq('family_id', sub));
        scoped.values = whitelistPatch(scoped.values, ['status', 'notes']);
      }
    } else if (table === 'payments' || table === 'trial_students') {
      filters.push(eq('family_id', sub));
    } else if (table === 'attendance_logs' || table === 'leave_requests' || table === 'class_schedules') {
      filters.push(scope.studentIds.length ? inList('student_id', scope.studentIds) : none());
    }
    // teachers: no row filter â post-processing reduces to the safe subset.
    scoped.filters = filters;
    return scoped;
  }

  return null;
}

// Defense-in-depth row check applied to every returned row, including rows
// pulled in by the db engine's server-side relational joins.
function rowInScope(role, sub, scope, table, row) {
  if (!row || typeof row !== 'object') return false;
  if (role === 'parent') {
    switch (table) {
      case 'families': return String(row.id) === sub;
      case 'students':
      case 'payments':
      case 'trial_students': return String(row.family_id) === sub;
      case 'attendance_logs':
      case 'leave_requests':
      case 'class_schedules': return scope.studentIds.includes(String(row.student_id));
      case 'teachers': return true; // reduced to safe subset during scrub
      default: return false;
    }
  }
  if (role === 'teacher') {
    switch (table) {
      case 'students': return scope.studentIds.includes(String(row.id));
      case 'teachers': return String(row.id) === sub;
      case 'class_schedules':
      case 'attendance_logs':
      case 'leave_requests':
      case 'trial_students': return String(row.teacher_id) === sub;
      default: return false;
    }
  }
  return true; // owner / manager
}

function scrubRow(role, sub, scope, table, row) {
  const r = { ...(row || {}) };
  if (role !== 'owner') stripCredentialFieldsFromRow(table, r);

  // Scrub hydrated relations: the db engine's joins pull full tables
  // server-side, so relations must be re-scoped here.
  if (Array.isArray(r.students)) {
    r.students = r.students.filter((s) => rowInScope(role, sub, scope, 'students', s));
    if (role !== 'owner') r.students.forEach((s) => stripCredentialFieldsFromRow('students', s));
  } else if (r.students && typeof r.students === 'object') {
    if (!rowInScope(role, sub, scope, 'students', r.students)) r.students = null;
  }
  if (r.families && typeof r.families === 'object') {
    if (!rowInScope(role, sub, scope, 'families', r.families)) {
      r.families = null;
    } else if (role !== 'owner') {
      stripCredentialFieldsFromRow('families', r.families);
    }
  }
  if (r.teachers && typeof r.teachers === 'object') {
    if (role === 'parent') {
      r.teachers = { id: r.teachers.id, full_name: r.teachers.full_name, zoom_link: r.teachers.zoom_link };
    } else if (role !== 'owner') {
      stripCredentialFieldsFromRow('teachers', r.teachers);
    }
  }
  // Parents may read the teachers table but only the public identity.
  if (role === 'parent' && table === 'teachers') {
    return { id: r.id, full_name: r.full_name, zoom_link: r.zoom_link };
  }
  return r;
}

// Wraps the D1 handler: pre-check -> inject scope -> delegate -> scrub.
async function handleScopedDbRequest(ctx, auth) {
  const { request, env } = ctx;
  const role = auth.role;
  const sub = String(auth.sub || '');

  // Availability probe (GET) carries no table/action â pass through.
  if (request.method === 'GET') {
    return handleDbRequest(ctx);
  }

  let body = null;
  try {
    body = await request.clone().json();
  } catch (e) {
    return handleDbRequest(ctx);
  }
  const table = body && body.table;
  const action = body && body.action;

  if (checkTableAccess(role, table, action) === 'deny') {
    return forbidden(request, env);
  }

  const db = getDb(env);
  const scope = await resolveScopeIds(db, role, sub);
  const scopedBody = applyDbScope(body, role, sub, scope);
  if (!scopedBody) {
    return forbidden(request, env);
  }

  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  const scopedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(scopedBody),
  });

  let resp;
  try {
    resp = await handleDbRequest({ request: scopedRequest, env, ctx });
  } catch (e) {
    console.error('[scope] db handler failed:', e);
    return forbidden(request, env);
  }

  // Post-process: strip credentials and drop anything outside scope.
  let payload = null;
  try {
    payload = await resp.clone().json();
  } catch (e) {
    return resp;
  }
  if (!payload || payload.error || payload.data == null || role === 'owner') {
    return resp;
  }
  const single = !!(body && body.single);
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
  const scrubbed = [];
  for (const row of rows) {
    if (!rowInScope(role, sub, scope, table, row)) continue;
    scrubbed.push(scrubRow(role, sub, scope, table, row));
  }
  const data = single ? (scrubbed[0] || null) : scrubbed;
  return new Response(JSON.stringify({ ...payload, data }), {
    status: resp.status,
    headers: resp.headers,
  });
}

// --- Phase 2: storage scoping ------------------------------------------------
// R2 keys are "<folder>/<timestamp>_<name>". Restricted roles (teacher,
// parent) get a server-enforced folder prefix; the client-supplied folder is
// ignored for them. Reads are limited to the role's own prefix.
// NOTE: files uploaded before this scoping (e.g. under "documents/") are NOT
// under a scoped prefix, so restricted roles can no longer read them â
// manager/owner can. See PHASE2-NOTES.md for the one-time migration option.
function scopedStorageFolder(role, sub) {
  const safeSub = String(sub || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'unknown';
  return `scoped-${role}-${safeSub}`;
}

async function handleScopedStorageRequest(ctx, auth) {
  const { request, env } = ctx;
  const role = auth.role;
  const sub = String(auth.sub || '');
  const restricted = role === 'teacher' || role === 'parent';
  const url = new URL(request.url);

  // Status probe (?key absent) â pass through.
  if (request.method === 'GET' && !url.searchParams.get('key')) {
    return handleStorageRequest(ctx);
  }

  if (!restricted) {
    return handleStorageRequest(ctx);
  }

  const prefix = scopedStorageFolder(role, sub) + '/';

  if (request.method === 'GET') {
    const key = String(url.searchParams.get('key') || '');
    if (!key.startsWith(prefix)) {
      return forbidden(request, env);
    }
    return handleStorageRequest(ctx);
  }

  if (request.method === 'POST') {
    // Force the upload folder server-side; the client folder is ignored.
    const folder = scopedStorageFolder(role, sub);
    const contentType = request.headers.get('Content-Type') || '';
    const headers = new Headers(request.headers);
    let scopedRequest;
    if (contentType.includes('multipart/form-data')) {
      const fd = await request.clone().formData();
      fd.set('folder', folder);
      headers.delete('content-type'); // let the runtime set the boundary
      scopedRequest = new Request(request.url, { method: 'POST', headers, body: fd });
    } else {
      let body = {};
      try { body = await request.clone().json(); } catch (e) {}
      body.folder = folder;
      headers.set('Content-Type', 'application/json');
      scopedRequest = new Request(request.url, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    return handleStorageRequest({ request: scopedRequest, env, ctx });
  }

  return handleStorageRequest(ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 0. Logins (public endpoints, rate-limited)
    if (url.pathname === '/api/auth/login') {
      return handleOwnerLogin(request, env);
    }
    if (url.pathname === '/api/auth/staff-login') {
      return handleStaffLogin(request, env);
    }
    if (url.pathname === '/api/auth/set-password') {
      return handleSetPassword(request, env);
    }

    // 1. Database API (/api/db) -> Cloudflare D1   [AUTH-GATED + ROLE-SCOPED]
    if (url.pathname === '/api/db' || url.pathname.startsWith('/api/db/')) {
      // CORS preflights never carry Authorization; let the downstream
      // handler answer them so browsers can complete preflight.
      if (request.method === 'OPTIONS') {
        return handleDbRequest({ request, env, ctx });
      }
      const auth = await requireApiAuth(request, env);
      if (!auth) return unauthorized(request, env);
      return handleScopedDbRequest({ request, env, ctx }, auth);
    }

    // 2. File Storage API (/api/storage) -> Cloudflare R2   [AUTH-GATED + ROLE-SCOPED]
    if (url.pathname === '/api/storage' || url.pathname.startsWith('/api/storage/')) {
      if (request.method === 'OPTIONS') {
        return handleStorageRequest({ request, env, ctx });
      }
      const auth = await requireApiAuth(request, env);
      if (!auth) return unauthorized(request, env);
      return handleScopedStorageRequest({ request, env, ctx }, auth);
    }

    // 3. Clean portal URLs without .html
    const cleanRouteMap = {
      '/teacher': '/teacher.html',
      '/teacher/': '/teacher.html',
      '/parent': '/parent.html',
      '/parent/': '/parent.html',
      '/student': '/parent.html',
      '/student/': '/parent.html',
      '/manager': '/manager.html',
      '/manager/': '/manager.html',
      '/admin': '/index.html',
      '/admin/': '/index.html',
    };

    const mappedPath = cleanRouteMap[url.pathname.toLowerCase()];

    if (mappedPath && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const rewrittenUrl = new URL(request.url);
      rewrittenUrl.pathname = mappedPath;
      return env.ASSETS.fetch(new Request(rewrittenUrl.toString(), request));
    }

    // 4. All portal pages & static assets
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Al-Huda LMS Worker is running.', { status: 200 });
  },
};
