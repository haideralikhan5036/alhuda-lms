/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS â UNIFIED CLOUDFLARE WORKER + STATIC ASSETS
 * File: cloudflare/worker.js
 * Purpose: Works directly with `npx wrangler deploy` on Cloudflare Workers.
 *          Handles /api/auth/* (logins), /api/db (Cloudflare D1),
 *          /api/storage (Cloudflare R2), /api/email/send (owner-only email
 *          relay), and serves static portal files via env.ASSETS.
 *
 * SECURITY MODEL (2026-10-14 hardening):
 *   - All logins are verified SERVER-SIDE here. The browser only ever holds
 *     a signed, expiring session token (see cloudflare/auth.js).
 *   - /api/db and /api/storage REQUIRE a worker-issued Bearer token
 *     (any authenticated role). Anonymous access is denied.
 *   - /api/email/send (2026-10-19): owner role ONLY. Forwards to the
 *     official email relay (Apps Script) server-side using the RELAY_URL /
 *     RELAY_SECRET secrets. The browser never sees the relay URL.
 *     Per-token rate limited; input validated; relay failures are reported
 *     truthfully (no blind success).
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
 *   RELAY_URL           - https URL of the official email relay (Apps Script web app)
 *   RELAY_SECRET        - shared secret the relay checks (empty until the
 *                         Apps Script is updated to verify it; the worker
 *                         still forwards without it during transition)
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

// --- Email relay rate limiting: max 100 sends per token per 10 minutes. -----
// Same in-memory Map-window approach as the login limiter. Sized for bulk
// fee-reminder runs (up to ~85 sequential sends), not just single emails.
const EMAIL_SEND_ATTEMPTS = new Map();
const EMAIL_SEND_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_SEND_MAX_ATTEMPTS = 100;

function emailSendRateLimited(key) {
  const now = Date.now();
  const rec = EMAIL_SEND_ATTEMPTS.get(key);
  if (!rec || now - rec.start > EMAIL_SEND_WINDOW_MS) {
    EMAIL_SEND_ATTEMPTS.set(key, { count: 1, start: now });
    return false;
  }
  rec.count += 1;
  return rec.count > EMAIL_SEND_MAX_ATTEMPTS;
}

// --- Duplicate-check rate limiting: max 30 checks per token per 10 minutes. -
// Same in-memory Map-window approach as the email limiter. The endpoint
// answers "does this contact already exist", so the cap also bounds
// probing for strangers' contact values by trial (Batch 3A, B15).
const DUPCHECK_ATTEMPTS = new Map();
const DUPCHECK_WINDOW_MS = 10 * 60 * 1000;
const DUPCHECK_MAX_ATTEMPTS = 30;

function dupCheckRateLimited(key) {
  const now = Date.now();
  const rec = DUPCHECK_ATTEMPTS.get(key);
  if (!rec || now - rec.start > DUPCHECK_WINDOW_MS) {
    DUPCHECK_ATTEMPTS.set(key, { count: 1, start: now });
    return false;
  }
  rec.count += 1;
  return rec.count > DUPCHECK_MAX_ATTEMPTS;
}

// --- Teacher email daily cap: max 30 advance-class emails per teacher per
// UTC day (Batch 5, B10), on top of the shared 10-minute send limiter. The
// UTC date inside the key is the window, in the same Map style as above.
const TEACHER_EMAIL_DAILY_ATTEMPTS = new Map();
const TEACHER_EMAIL_DAILY_MAX = 30;

function teacherEmailDailyLimited(sub) {
  const key = String(sub || '') + '|' + new Date().toISOString().slice(0, 10);
  const count = (TEACHER_EMAIL_DAILY_ATTEMPTS.get(key) || 0) + 1;
  TEACHER_EMAIL_DAILY_ATTEMPTS.set(key, count);
  return count > TEACHER_EMAIL_DAILY_MAX;
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
// Verifies manager/teacher/parent credentials against D1. Batch-1 hardening
// (B2/B3): an account may authenticate ONLY when the password slot login
// would check holds an owner-set HASHED value (see isHashedPassword).
// Legacy plaintext values, the '12345678' default, and missing/empty slots
// NEVER authenticate here. When the identifier matches an account but no
// honored slot holds a hashed value, the response is the distinct
// { ok:false, error:'no_password_set' } so portals can tell the user to ask
// the administrator to set a password. The owner sets/migrates passwords via
// POST /api/auth/set-password.
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
    let recordFullName = null;
    let recordEmpId = null;
    // Batch-1: track WHY login failed so an account that exists but has no
    // owner-set (hashed) password gets the distinct 'no_password_set' error,
    // while every other failure keeps the generic anti-enumeration message.
    let matchedAccount = false;
    let matchedHashed = false;

    if (role === 'parent') {
      const { results } = await db.prepare('SELECT id, parent_name, notes FROM families').all();
      for (const f of results || []) {
        const notes = parseJsonField(f.notes);
        const pc = parseJsonField(notes.portal_credentials);
        const parentName = String(f.parent_name || '');
        const derivedUser = ('parent_' + parentName).toLowerCase().replace(/[^a-z0-9_]/g, '');
        const usernames = [pc.username, derivedUser, String(f.id || '').toLowerCase()].filter(Boolean).map((u) => String(u).toLowerCase());
        if (!usernames.includes(identifier)) continue;
        matchedAccount = true;
        const pw = pc.password;
        // Only a hashed (owner-set) value may authenticate; legacy
        // plaintext / default / missing slots fall through to
        // 'no_password_set' below.
        if (!isHashedPassword(pw)) continue;
        matchedHashed = true;
        if (await verifyPassword(password, pw)) {
          recordId = f.id;
          recordFullName = f.parent_name || null;
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
        matchedAccount = true;
        // Slot precedence unchanged: address.password, then
        // address.teacher_account.password, then notes.password — the first
        // value present is the one login checks, and (Batch-1) it must be
        // in hashed format for the account to authenticate at all.
        const pw = meta.password || acc.password || notesMeta.password;
        if (!isHashedPassword(pw)) continue;
        matchedHashed = true;
        if (await verifyPassword(password, pw)) {
          // For manager role, require the record to actually be a manager.
          if (role === 'manager') {
            const empType = String(t.employee_type || meta.employee_type || meta.role || '').toLowerCase();
            const codeIds = [t.id, t.witness_name, meta.emp_id].map((s) => String(s || '').toUpperCase());
            const isManager = empType === 'manager' || codeIds.some((c) => c.startsWith('MGR-'));
            if (!isManager) continue;
          }
          recordId = t.id;
          recordFullName = t.full_name || null;
          recordEmpId = meta.emp_id || acc.emp_id || acc.teacher_id || meta.teacher_id || String(t.id);
          break;
        }
      }
    }

    if (!recordId) {
      if (matchedAccount && !matchedHashed) {
        // The account exists but has no owner-set (hashed) password yet —
        // distinct error so portals can show "No password set. Ask the
        // administrator to set one." instead of a misleading credential
        // error.
        return json(request, env, { ok: false, error: 'no_password_set' }, 401);
      }
      // Identical message for every other failure: no enumeration.
      return json(request, env, { ok: false, error: 'Invalid username or password.' }, 401);
    }

    const token = await createSessionToken(
      { sub: String(recordId), role },
      env.WORKER_AUTH_SECRET
    );
    // Batch 2 (B6): the portals' session guards require emp_id + full_name
    // alongside the id — return them so a server login can build a complete
    // session in one round trip.
    const loginPayload = { ok: true, token, id: recordId };
    if (recordFullName) loginPayload.full_name = recordFullName;
    if (role !== 'parent') loginPayload.emp_id = recordEmpId || String(recordId);
    return json(request, env, loginPayload);
  } catch (e) {
    console.error('[auth] staff login failed:', e);
    return json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503);
  }
}

// --- POST /api/auth/set-password  { role, identifier, newPassword } ---------
// Owner-only originally; Batch 2 also lets a MANAGER caller set TEACHER or
// PARENT passwords (never a manager record's — see the guards below).
// Migrates one account's password to the hashed format, or sets
// a fresh password. The caller finds the account by the same identifiers the
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
  if (!auth || (auth.role !== 'owner' && auth.role !== 'manager')) {
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
  // Batch 2: a manager caller may set TEACHER or PARENT passwords only.
  // Manager-account passwords remain owner-only.
  if (auth.role === 'manager' && role !== 'teacher' && role !== 'parent') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
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
      // Batch 2: a manager caller must never reset a manager record's
      // password, even when asking via the 'teacher' role — such records
      // are invisible to this endpoint for managers (404 if nothing else
      // matches).
      if (auth.role === 'manager' && isManagerStaffRecord(t)) continue;
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

// --- POST /api/email/send  { to, subject, html, text } -----------------------
// Owner-only email relay. The browser never talks to the Apps Script
// directly; this worker forwards server-side using the RELAY_URL /
// RELAY_SECRET secrets. Until the Apps Script is updated to verify the
// secret, the worker still works with the current open relay (the secret
// fields are simply ignored by the old script).
const EMAIL_ALLOWED_FIELDS = ['to', 'subject', 'html', 'text'];
const EMAIL_MAX_SUBJECT = 500;
const EMAIL_MAX_HTML = 200000;
const EMAIL_MAX_TEXT = 100000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared relay forwarding for the email endpoints (/api/email/send,
// /api/email/notify-parent, /api/email/advance-class).
// Never logs the secret, the relay URL, the recipient, or email bodies —
// metadata only. Returns { ok:true, relayStatus, quotaRemaining,
// quotaExceeded } on success, otherwise { ok:false, httpStatus, error,
// relayStatus, quotaRemaining, quotaExceeded } where relayStatus is 0 when
// the relay never produced a response. Batch 5 (B10): the relay's JSON
// verdict is read and honoured — { success:false, error, quotaRemaining }
// means the email was NOT sent even when the HTTP status is 200, and a
// success reply may carry the true remaining daily quota. The body is
// parsed for those fields only and is never logged.
async function forwardEmailViaRelay(env, { to, subject, html, text }) {
  const relayUrl = String(env.RELAY_URL || '').trim();
  if (!/^https:\/\//i.test(relayUrl)) {
    return { ok: false, httpStatus: 503, error: 'Email relay is not configured.', relayStatus: 0, quotaRemaining: null, quotaExceeded: false };
  }
  const relaySecret = String(env.RELAY_SECRET || '');

  const forwardBody = JSON.stringify({
    to: to,
    subject: subject,
    html: html || text,
    text: text || '',
    // Field names a relay may check; the current open script ignores
    // unknown fields, so both are safe during transition.
    secret: relaySecret,
    relaySecret: relaySecret,
  });

  // Follow redirects MANUALLY and re-POST the body on every hop: Apps
  // Script web apps answer the first POST with "302 Found" (verified live
  // 2026-10-19), and a spec-compliant fetch with redirect:'follow' would
  // rewrite that into a bodyless GET -- silently losing the email. Re-POSTing
  // to each Location keeps the payload intact on every hop.
  let relayStatus = 0;
  let relayBodyText = '';
  try {
    let url = relayUrl;
    let fwd = null;
    for (let hop = 0; hop < 5; hop++) {
      fwd = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: forwardBody,
      });
      const loc = fwd.headers.get('location');
      if (fwd.status >= 300 && fwd.status < 400 && loc) {
        try { await fwd.text(); } catch (e2) {}
        const next = new URL(loc, url).toString();
        if (!/^https:/i.test(next)) {
          console.warn('[email] refusing non-https redirect');
          return { ok: false, httpStatus: 502, error: 'Email relay failed (insecure redirect).', relayStatus: 0, quotaRemaining: null, quotaExceeded: false };
        }
        url = next;
        continue;
      }
      break;
    }
    relayStatus = fwd ? fwd.status : 0;
    // Read the final body (the redirect hops above were already drained):
    // the Batch 5 quota verdict lives in it. Parsed below, never logged.
    try { relayBodyText = await fwd.text(); } catch (e3) {}
  } catch (e) {
    console.warn('[email] relay unreachable');
    return { ok: false, httpStatus: 502, error: 'Email relay is unreachable. Please try again later.', relayStatus: 0, quotaRemaining: null, quotaExceeded: false };
  }

  // Interpret the relay's JSON verdict when it sent one:
  //   { success:true, quotaRemaining:N }                 -> sent, N left
  //   { success:false, error:'...', quotaRemaining:0 }   -> NOT sent
  // An Apps Script web app answers HTTP 200 for BOTH shapes, so the HTTP
  // status alone can no longer be trusted. Unparseable/absent bodies fall
  // back to the status-only judgement with quotaRemaining null.
  let quotaRemaining = null;
  let relayVerdict = null; // true | false | null (null = no JSON verdict)
  let relayError = null;
  if (relayBodyText) {
    try {
      const parsed = JSON.parse(relayBodyText);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.quotaRemaining === 'number') quotaRemaining = parsed.quotaRemaining;
        if (parsed.success === false || parsed.ok === false) {
          relayVerdict = false;
          relayError = (typeof parsed.error === 'string' && parsed.error)
            ? parsed.error
            : 'The email relay reported a failure.';
        } else if (parsed.success === true || parsed.ok === true) {
          relayVerdict = true;
        }
      }
    } catch (e) { /* not JSON — fall back to the HTTP status alone */ }
  }

  if (relayVerdict === false) {
    const quotaExceeded = quotaRemaining === 0 || /limit|quota/i.test(relayError || '');
    return { ok: false, httpStatus: 502, error: relayError, relayStatus, quotaRemaining, quotaExceeded };
  }
  if (relayStatus >= 200 && relayStatus < 300) {
    return { ok: true, relayStatus, quotaRemaining, quotaExceeded: quotaRemaining === 0 };
  }
  return { ok: false, httpStatus: 502, error: 'Email relay failed (HTTP ' + relayStatus + ').', relayStatus, quotaRemaining, quotaExceeded: quotaRemaining === 0 };
}

async function handleEmailSend(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  // Owner role only. Managers/teachers/parents (and anonymous callers) are
  // rejected here; managers are additionally blocked from external dispatch
  // in the portal UI.
  const auth = await requireApiAuth(request, env);
  if (!auth) return unauthorized(request, env);
  if (auth.role !== 'owner') {
    return json(request, env, { ok: false, error: 'Only the owner can send email.' }, 403);
  }

  const rlKey = 'email:' + String(auth.sub || clientIp(request));
  if (emailSendRateLimited(rlKey)) {
    return json(request, env, { ok: false, error: 'Too many emails. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  for (const k of Object.keys(body)) {
    if (EMAIL_ALLOWED_FIELDS.indexOf(k) === -1) {
      return json(request, env, { ok: false, error: 'Unexpected field: ' + k + '.' }, 400);
    }
  }

  const to = String(body.to || '').trim();
  const subject = String(body.subject || '');
  const html = String(body.html || '');
  const text = String(body.text || '');

  if (!to || to.length > 254 || /[,;]/.test(to) || !EMAIL_RE.test(to)) {
    return json(request, env, { ok: false, error: 'A single valid recipient email address is required.' }, 400);
  }
  if (!subject || subject.length > EMAIL_MAX_SUBJECT) {
    return json(request, env, { ok: false, error: 'Subject is required (max ' + EMAIL_MAX_SUBJECT + ' characters).' }, 400);
  }
  if ((!html && !text) || html.length > EMAIL_MAX_HTML || text.length > EMAIL_MAX_TEXT) {
    return json(request, env, { ok: false, error: 'Email body is required and must be within size limits.' }, 400);
  }

  const result = await forwardEmailViaRelay(env, { to, subject, html, text });
  // This endpoint's own log line (owner path only): the recipient appears
  // here because the owner supplied it. The shared helper never logs it,
  // and the manager notify path below never sees the address at all.
  if (result.relayStatus) {
    console.log('[email] forwarded to=' + to + ' relayStatus=' + result.relayStatus);
  }
  if (result.ok) {
    return json(request, env, { ok: true, relayStatus: result.relayStatus, quotaRemaining: (typeof result.quotaRemaining === 'number' ? result.quotaRemaining : null), quotaExceeded: !!result.quotaExceeded });
  }
  return json(request, env, { ok: false, error: result.error, quotaRemaining: (typeof result.quotaRemaining === 'number' ? result.quotaRemaining : null), quotaExceeded: !!result.quotaExceeded }, result.httpStatus);
}

// --- POST /api/email/notify-parent  { familyId, subject, text?, html?, template? }
// Batch 2 (B16): managers must be able to email a family (fee reminders,
// invoices) WITHOUT ever seeing the address. The client names the family;
// the Worker resolves the recipient server-side from D1 and forwards
// through the same relay as the owner endpoint. The address never appears
// in any response or log line from this handler.
const NOTIFY_ALLOWED_FIELDS = ['familyId', 'subject', 'text', 'html', 'template'];

async function handleEmailNotifyParent(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  const auth = await requireApiAuth(request, env);
  if (!auth) return unauthorized(request, env);
  if (auth.role !== 'manager' && auth.role !== 'owner') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }

  const rlKey = 'notify:' + String(auth.sub || clientIp(request));
  if (emailSendRateLimited(rlKey)) {
    return json(request, env, { ok: false, error: 'Too many emails. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  for (const k of Object.keys(body)) {
    if (NOTIFY_ALLOWED_FIELDS.indexOf(k) === -1) {
      return json(request, env, { ok: false, error: 'Unexpected field: ' + k + '.' }, 400);
    }
  }

  const familyId = String(body.familyId || '').trim();
  const subject = String(body.subject || '');
  const html = String(body.html || '');
  const template = String(body.template || '');
  let text = String(body.text || '');
  if (!text && !html && template) text = template;

  if (!familyId || familyId.length > 200) {
    return json(request, env, { ok: false, error: 'A family id is required.' }, 400);
  }
  if (!subject || subject.length > EMAIL_MAX_SUBJECT) {
    return json(request, env, { ok: false, error: 'Subject is required (max ' + EMAIL_MAX_SUBJECT + ' characters).' }, 400);
  }
  if ((!html && !text) || html.length > EMAIL_MAX_HTML || text.length > EMAIL_MAX_TEXT || template.length > EMAIL_MAX_TEXT) {
    return json(request, env, { ok: false, error: 'Email body is required and must be within size limits.' }, 400);
  }

  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  let fam = null;
  try {
    fam = await db.prepare('SELECT email, parent_email FROM families WHERE id = ?').bind(familyId).first();
  } catch (e) {
    // Older databases may lack the parent_email alias column; the canonical
    // email column alone is enough.
    try {
      fam = await db.prepare('SELECT email FROM families WHERE id = ?').bind(familyId).first();
    } catch (e2) {
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
  }
  if (!fam) {
    return json(request, env, { ok: false, error: 'Family not found.' }, 404);
  }
  const to = String(fam.email || fam.parent_email || '').trim();
  if (!to || !EMAIL_RE.test(to)) {
    return json(request, env, { ok: false, error: 'No email address on file for this family.' }, 422);
  }

  const result = await forwardEmailViaRelay(env, { to, subject, html, text });
  // Metadata only: family id + relay status. NEVER the address.
  console.log('[email] notify-parent familyId=' + familyId + ' relayStatus=' + result.relayStatus);
  if (result.ok) {
    return json(request, env, { ok: true, relayStatus: result.relayStatus, quotaRemaining: (typeof result.quotaRemaining === 'number' ? result.quotaRemaining : null), quotaExceeded: !!result.quotaExceeded });
  }
  return json(request, env, { ok: false, error: result.error, quotaRemaining: (typeof result.quotaRemaining === 'number' ? result.quotaRemaining : null), quotaExceeded: !!result.quotaExceeded }, result.httpStatus);
}

// --- POST /api/email/advance-class  { studentId, template?, scheduledDate, bookTitle?, page?, lineRange?, sabaqResult?, rating?, remarks? }
// Batch 5 (B10): the teacher advance-class confirmation used to be posted
// DIRECTLY from teacher.html to a hard-coded Apps Script /exec URL (no
// secret, no-cors) and was marked sent unconditionally. It now goes
// through this endpoint instead: a valid TEACHER token is required, the
// student must be one of the teacher's own (resolveScopeIds), and the
// recipient is resolved SERVER-SIDE from the student's family — the
// parent's address never appears in any response or log line from this
// handler. The browser sends only ids and lesson facts; the subject and
// body are built here from the same template the portal used to render,
// so no arbitrary HTML can be injected. Sent via the shared relay path.
const ADVANCE_CLASS_ALLOWED_FIELDS = ['studentId', 'template', 'scheduledDate', 'bookTitle', 'page', 'lineRange', 'sabaqResult', 'rating', 'remarks'];

async function handleTeacherAdvanceClassEmail(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  const auth = await requireApiAuth(request, env);
  if (!auth) return unauthorized(request, env);
  if (auth.role !== 'teacher') {
    return json(request, env, { ok: false, error: 'Only teachers can send advance-class emails.' }, 403);
  }

  if (emailSendRateLimited('teacher-email:' + String(auth.sub)) ||
      emailSendRateLimited('teacher-email-ip:' + clientIp(request))) {
    return json(request, env, { ok: false, error: 'Too many emails. Please try again later.' }, 429);
  }
  if (teacherEmailDailyLimited(auth.sub)) {
    return json(request, env, { ok: false, error: 'Daily email limit for teachers reached. Please try again tomorrow.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  for (const k of Object.keys(body)) {
    if (ADVANCE_CLASS_ALLOWED_FIELDS.indexOf(k) === -1) {
      return json(request, env, { ok: false, error: 'Unexpected field: ' + k + '.' }, 400);
    }
  }
  if (body.template !== undefined && body.template !== null && String(body.template) !== '' && String(body.template) !== 'advance-class') {
    return json(request, env, { ok: false, error: 'Unknown email template.' }, 400);
  }

  const studentId = (body.studentId === undefined || body.studentId === null) ? '' : String(body.studentId).trim();
  if (!studentId || studentId.length > 64) {
    return json(request, env, { ok: false, error: 'A student id is required.' }, 400);
  }
  const scheduledDate = String(body.scheduledDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return json(request, env, { ok: false, error: 'A scheduled date (YYYY-MM-DD) is required.' }, 400);
  }
  const bookTitleInput = (body.bookTitle === undefined || body.bookTitle === null) ? '' : String(body.bookTitle).trim();
  if (bookTitleInput.length > 120) {
    return json(request, env, { ok: false, error: 'Book title is too long (max 120 characters).' }, 400);
  }
  const bookTitle = bookTitleInput || 'Course Material';
  const pageStr = (body.page === undefined || body.page === null) ? '' : String(body.page).trim();
  if (pageStr.length > 20) {
    return json(request, env, { ok: false, error: 'Page is too long (max 20 characters).' }, 400);
  }
  const lineRange = (body.lineRange === undefined || body.lineRange === null) ? '' : String(body.lineRange).trim();
  if (lineRange.length > 30) {
    return json(request, env, { ok: false, error: 'Line range is too long (max 30 characters).' }, 400);
  }
  const sabaqInput = (body.sabaqResult === undefined || body.sabaqResult === null) ? '' : String(body.sabaqResult).trim();
  if (sabaqInput.length > 60) {
    return json(request, env, { ok: false, error: 'Result is too long (max 60 characters).' }, 400);
  }
  const sabaqResult = sabaqInput || 'Completed';
  let rating = 5;
  if (body.rating !== undefined && body.rating !== null && body.rating !== '') {
    const r = Number(body.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return json(request, env, { ok: false, error: 'Rating must be a whole number from 1 to 5.' }, 400);
    }
    rating = r;
  }
  const remarks = (body.remarks === undefined || body.remarks === null) ? '' : String(body.remarks).trim();
  if (remarks.length > 300) {
    return json(request, env, { ok: false, error: 'Remarks are too long (max 300 characters).' }, 400);
  }

  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }

  // The teacher may only email parents of their OWN students.
  const scope = await resolveScopeIds(db, 'teacher', auth.sub);
  if (!scope || !Array.isArray(scope.studentIds) || !scope.studentIds.includes(studentId)) {
    return json(request, env, { ok: false, error: 'You can only email parents of your own students.' }, 403);
  }

  let student = null;
  try {
    student = await db.prepare('SELECT id, name, family_id FROM students WHERE id = ?').bind(studentId).first();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (!student) {
    return json(request, env, { ok: false, error: 'Student not found.' }, 404);
  }

  let teacherName = 'Instructor';
  try {
    const t = await db.prepare('SELECT full_name FROM teachers WHERE id = ?').bind(auth.sub).first();
    if (t && t.full_name) teacherName = String(t.full_name);
  } catch (e) { /* keep the fallback name */ }

  let fam = null;
  try {
    fam = await db.prepare('SELECT id, parent_name, email, parent_email, notes FROM families WHERE id = ?').bind(student.family_id).first();
  } catch (e) {
    // Older databases may lack the parent_email alias column; fall back to
    // the canonical columns (mirrors the notify-parent handler).
    try {
      fam = await db.prepare('SELECT id, parent_name, email, notes FROM families WHERE id = ?').bind(student.family_id).first();
    } catch (e2) {
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
  }
  if (!fam) {
    return json(request, env, { ok: false, error: 'Family not found.' }, 404);
  }

  // Recipient resolved server-side ONLY: family columns first, then any
  // email nested in the family notes. Never returned to the caller.
  let to = String(fam.email || '').trim() || String(fam.parent_email || '').trim();
  if (!to) {
    const contacts = collectFamilyContactsForDup(fam);
    for (const candidate of contacts.emails) { to = candidate; break; }
  }
  if (!to || !EMAIL_RE.test(to)) {
    return json(request, env, { ok: false, error: 'No email address on file for this family.' }, 422);
  }

  const studentName = String(student.name || 'Student');
  const parentName = String(fam.parent_name || 'Parent / Guardian');
  const conductedDate = new Date().toISOString().slice(0, 10);
  const subject = `🌟 Advance Class Completed: ${studentName} (${scheduledDate}) — Al-Huda Islamic Centre`;
  const text = `Assalamu Alaikum wa Rahmatullah ${parentName},\n\nWe pray you are in the best of health and Iman.\n\nThis is an official confirmation from Al-Huda Islamic Centre that the class for ${studentName} originally scheduled for ${scheduledDate} has been successfully conducted in advance today (${conductedDate}).\n\n══════════════════════════════════════\nADVANCE CLASS SESSION DETAILS:\n══════════════════════════════════════\n• Student Name: ${studentName}\n• Instructor: ${teacherName}\n• Course Material: ${bookTitle}${pageStr ? ` (Page ${pageStr}${lineRange ? ', Lines ' + lineRange : ''})` : ''}\n• Scheduled Class Date: ${scheduledDate}\n• Conducted & Completed On: ${conductedDate}\n• Performance: ${sabaqResult} (${rating} / 5 Stars)\n${remarks ? `• Teacher Remarks: ${remarks}\n` : ''}══════════════════════════════════════\n\nThe attendance and lesson Sabaq records have been updated in your Parent Portal.\n\nJazakumullahu Khairan!\nAl-Huda Islamic Centre Management\nOfficial Accounts Email: ceoislamiccentre@gmail.com`;
  const html = text.replace(/\n/g, '<br/>');

  const result = await forwardEmailViaRelay(env, { to, subject, html, text });
  // Metadata only: student id + relay status. NEVER the address or body.
  console.log('[teacher-email] student=' + studentId + ' relayStatus=' + result.relayStatus);
  const quotaRemaining = (typeof result.quotaRemaining === 'number' ? result.quotaRemaining : null);
  const quotaExceeded = !!result.quotaExceeded;
  if (result.ok) {
    return json(request, env, { ok: true, quotaRemaining, quotaExceeded });
  }
  return json(request, env, { ok: false, error: result.error, quotaRemaining, quotaExceeded }, result.httpStatus || 502);
}

// --- POST /api/families/check-duplicates  { email?, phone?, whatsapp?, parentName? }
// Batch 3A (B15): the Add Family duplicate warning must also work for
// MANAGERS, who never see contact values (Batch 2) — so the comparison
// happens here, server-side. The response names only the matching
// families (id + parent name) and which SUBMITTED fields matched; a
// stored contact value NEVER appears in it. Rate-limited so the check
// cannot be used to probe for a stranger's number by trial.
function normEmailForDup(v) {
  return String(v || '').trim().toLowerCase();
}

function normPhoneForDup(v) {
  const digits = String(v || '').replace(/\D+/g, '');
  if (!digits) return '';
  // Canonical form: the last 10 digits, so '0300-1234567',
  // '+92 300 1234567' and '3001234567' all compare equal.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normNameForDup(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Every contact value a family record carries: the columns plus the
// copies nested inside the notes JSON (portal_credentials, bio_meta and
// the notes object's own top-level contact keys).
function collectFamilyContactsForDup(row) {
  const emails = new Set();
  const phones = new Set();
  const addEmail = (v) => { const n = normEmailForDup(v); if (n) emails.add(n); };
  const addPhone = (v) => { const n = normPhoneForDup(v); if (n) phones.add(n); };
  const scan = (obj, emailKeys, phoneKeys) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of emailKeys) addEmail(obj[k]);
    for (const k of phoneKeys) addPhone(obj[k]);
  };
  addEmail(row.email);
  addEmail(row.parent_email);
  addPhone(row.phone);
  addPhone(row.whatsapp);
  const notes = parseJsonField(row.notes);
  scan(notes, ['email'], ['phone', 'whatsapp', 'mobile', 'telephone']);
  scan(notes.portal_credentials, ['email'], ['whatsapp']);
  scan(notes.bio_meta, ['email'], ['phone', 'mobile', 'telephone']);
  return { emails, phones };
}

async function handleFamilyDuplicateCheck(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }

  const auth = await requireApiAuth(request, env);
  if (!auth) return unauthorized(request, env);
  if (auth.role !== 'owner' && auth.role !== 'manager') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }

  const rlKey = 'dupcheck:' + String(auth.sub || clientIp(request));
  if (dupCheckRateLimited(rlKey)) {
    return json(request, env, { ok: false, error: 'Too many checks. Please try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  // Unknown fields are ignored; only these four are ever read.
  const subEmail = normEmailForDup(body.email);
  const subPhone = normPhoneForDup(body.phone);
  const subWhatsapp = normPhoneForDup(body.whatsapp);
  const subName = normNameForDup(body.parentName);
  if (!subEmail && !subPhone && !subWhatsapp && !subName) {
    return json(request, env, { ok: false, error: 'Provide at least one of email, phone, whatsapp or parentName.' }, 400);
  }

  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  let rows;
  try {
    const res = await db.prepare('SELECT id, parent_name, email, parent_email, phone, whatsapp, notes FROM families').all();
    rows = res.results || [];
  } catch (e) {
    // Older databases may lack the parent_email alias column; retry
    // without it (mirrors the notify-parent handler's fallback).
    try {
      const res = await db.prepare('SELECT id, parent_name, email, phone, whatsapp, notes FROM families').all();
      rows = res.results || [];
    } catch (e2) {
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
  }

  const matches = [];
  for (const row of rows) {
    const matchedOn = [];
    if (subEmail || subPhone || subWhatsapp) {
      const stored = collectFamilyContactsForDup(row);
      if (subEmail && stored.emails.has(subEmail)) matchedOn.push('email');
      // Cross-channel: a submitted phone OR whatsapp matches ANY stored
      // phone-like value (families often reuse one number for both).
      if (subPhone && stored.phones.has(subPhone)) matchedOn.push('phone');
      if (subWhatsapp && stored.phones.has(subWhatsapp)) matchedOn.push('whatsapp');
    }
    if (subName && normNameForDup(row.parent_name) === subName) matchedOn.push('parentName');
    if (matchedOn.length) {
      // ONLY the family id, its (non-contact) name and the submitted
      // field names — never a stored contact value.
      matches.push({ familyId: String(row.id), parentName: String(row.parent_name || ''), matchedOn });
      if (matches.length >= 5) break;
    }
  }
  return json(request, env, { ok: true, matches });
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
  // Batch 6B: financial rows (fee receipts, salary slips, salary
  // adjustments) are NEVER hard-deleted, by any role — the portals cancel
  // them with a reason instead. This runs before the owner allow-all.
  if (action === 'delete' && ['payments', 'salary_slips', 'salary_adjustments'].includes(table)) return 'deny';
  if (role === 'owner') return 'allow';
  // Batch 2.1: the audit log is owner-only through this API. The Worker
  // itself writes entries directly (never through /api/db), so no other
  // role may read, forge or erase the trail.
  if (table === 'audit_log') return 'deny';
  const write = WRITE_ACTIONS.has(action);

  if (role === 'manager') {
    // Batch 2: hard deletes of core records are owner-only (the portals use
    // cancel/reverse flows for managers instead). system_settings writes
    // are no longer blanket-denied here: handleScopedDbRequest adjudicates
    // them per key in the manager write guards (course-catalog keys only),
    // which un-denies the manager curriculum upload path (S13). Password
    // fields are stripped separately.
    if (action === 'delete' && ['families', 'students', 'teachers', 'payments', 'salary_slips', 'salary_adjustments'].includes(table)) return 'deny';
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
      case 'salary_slips':
      case 'salary_adjustments':
        // Batch 6B: teachers may read their OWN salary rows only — row
        // ownership is enforced in applyDbScope/rowInScope (teacher_id).
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
        return 'deny'; // system_settings, salary_slips, salary_adjustments (Batch 6B: parents have no salary access)
    }
  }

  return 'deny';
}

// Resolve the rows a restricted role may touch. Parents: own family + its
// students. Teachers: students assigned via students.assigned_teacher_id OR
// via class_schedules.teacher_id (both assignment paths exist in the app).
async function resolveScopeIds(db, role, sub) {
  const scope = { studentIds: [], managerIds: [] };
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
  // Batch 2: scrubRow needs the set of manager staff-record ids so manager
  // payroll data can be hidden from manager callers. Resolved in its own
  // try/catch so a failure here can never widen or narrow the
  // teacher/parent scopes above (fail closed: empty list).
  if (role === 'manager') {
    try {
      const { results } = await db.prepare('SELECT id, address, witness_name, notes FROM teachers').all();
      scope.managerIds = (results || []).filter((r) => isManagerStaffRecord(r)).map((r) => String(r.id));
    } catch (e) {
      scope.managerIds = [];
    }
  }
  return scope;
}

// Recursively strip every `password` key within a subtree (bounded depth,
// non-destructive). Used for the lms_shared_sync blob, whose nested account
// maps carry password fields the flat checks in withoutPasswordKeys miss.
function stripPasswordsDeep(value, depth) {
  if (depth <= 0 || !value || typeof value !== 'object') return { changed: false, value };
  let changed = false;
  const out = Array.isArray(value) ? [...value] : { ...value };
  if (!Array.isArray(out) && Object.prototype.hasOwnProperty.call(out, 'password')) {
    delete out.password;
    changed = true;
  }
  for (const key of Object.keys(out)) {
    const child = out[key];
    if (child && typeof child === 'object') {
      const r = stripPasswordsDeep(child, depth - 1);
      if (r.changed) { out[key] = r.value; changed = true; }
    }
  }
  return { changed, value: out };
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
  // Batch-1 (B5): the lms_shared_sync blob (families.notes) nests legacy
  // account maps — teacher_accounts / parent_accounts, each an object of
  // account objects that can carry their own `password` — plus other shared
  // state. Strip every password inside the account maps explicitly, then run
  // a bounded recursive strip (depth <= 4) over the whole blob so no other
  // nested password survives either.
  if (out.lms_shared_sync && typeof out.lms_shared_sync === 'object') {
    const syncCopy = { ...out.lms_shared_sync };
    for (const mapName of ['teacher_accounts', 'parent_accounts']) {
      const map = syncCopy[mapName];
      if (map && typeof map === 'object') {
        const cleanMap = {};
        for (const [k, acc] of Object.entries(map)) {
          if (acc && typeof acc === 'object' && 'password' in acc) {
            const cleanAcc = { ...acc };
            delete cleanAcc.password;
            cleanMap[k] = cleanAcc;
            changed = true;
          } else {
            cleanMap[k] = acc;
          }
        }
        syncCopy[mapName] = cleanMap;
      }
    }
    const deep = stripPasswordsDeep(syncCopy, 4);
    out.lms_shared_sync = deep.value;
    if (deep.changed) changed = true;
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

// --- Batch 2: manager permission model ---------------------------------------
// The Manager portal mirrors the Owner portal EXCEPT: no creating/editing
// manager or owner accounts, no manager payroll visibility, no hard deletes
// of core records, no family/student contact details on read, and
// system_settings limited to the course-catalog keys. Everything below is
// enforced server-side; the UI hiding is only a courtesy.
const CONTACT_MASK = 'Hidden';
const CONTACT_JSON_KEYS = new Set(['phone', 'whatsapp', 'email', 'parent_email', 'email_address', 'contact_phone', 'mobile', 'telephone']);
const FAMILY_CONTACT_COLUMNS = ['email', 'parent_email', 'phone', 'whatsapp'];

// True when a teachers-table row is really a MANAGER account. Mirrors the
// detection handleStaffLogin / handleSetPassword already used (employee_type
// or role in the address meta or the nested teacher_account, or an MGR-
// code id), plus the nested/meta teacher_id slots.
function isManagerStaffRecord(row) {
  if (!row || typeof row !== 'object') return false;
  const meta = parseJsonField(row.address);
  const acc = (meta && typeof meta.teacher_account === 'object' && meta.teacher_account) ? meta.teacher_account : {};
  const types = [row.employee_type, meta.employee_type, meta.role, acc.employee_type, acc.role];
  for (const v of types) {
    if (String(v || '').toLowerCase() === 'manager') return true;
  }
  const codes = [row.id, row.witness_name, meta.emp_id, meta.teacher_id, acc.emp_id, acc.teacher_id];
  return codes.some((c) => String(c || '').toUpperCase().startsWith('MGR-'));
}

// system_settings keys a manager may read/write: the course catalog itself
// (S13) plus the logo on read (rowInScope handles the logo separately).
function isCatalogSettingsKey(key) {
  const k = String(key || '');
  return k === 'alhuda_custom_books' || k === 'alhuda_custom_books_index' || k.startsWith('BOOK_PAGE_');
}

// Batch 6B: keys a manager may READ in system_settings = the catalog keys
// above + the shared logo + the fee_tables_v1 dual-write flag (portals
// must read the flag inside manager sessions too). WRITES stay
// catalog-only: applyManagerWriteGuards adjudicates them with
// isCatalogSettingsKey, which deliberately does NOT include the flag or
// the logo — toggling fee_tables_v1 is owner-only.
function isManagerReadableSettingsKey(key) {
  const k = String(key || '');
  return isCatalogSettingsKey(k) || k === 'alhuda_logo' || k === 'fee_tables_v1';
}

// Remove contact keys whose value is exactly the mask placeholder. A
// manager's edit form echoes the masked read back on save; the placeholder
// must never overwrite the stored value. Real values pass through.
function stripMaskPlaceholders(value, depth) {
  if (depth <= 0 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripMaskPlaceholders(v, depth - 1));
  const out = {};
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (CONTACT_JSON_KEYS.has(k.toLowerCase()) && v === CONTACT_MASK) continue;
    out[k] = (v && typeof v === 'object') ? stripMaskPlaceholders(v, depth - 1) : v;
  }
  return out;
}

// For manager UPDATEs: contact values the manager never saw (they were
// masked in the read) must survive the edit. Every contact key present in
// the CURRENT stored JSON but absent from the submitted object is restored
// at the same path; a submitted real value wins. Arrays stay as submitted.
function restoreMaskedContacts(current, submitted, depth) {
  if (depth <= 0 || !current || typeof current !== 'object' || Array.isArray(current) ||
      !submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    return submitted;
  }
  const out = { ...submitted };
  const submittedKeys = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  for (const k of Object.keys(current)) {
    const cv = current[k];
    if (CONTACT_JSON_KEYS.has(k.toLowerCase())) {
      if (!submittedKeys.has(k.toLowerCase())) out[k] = cv;
    } else if (cv && typeof cv === 'object' && !Array.isArray(cv)) {
      const sk = Object.keys(out).find((x) => x.toLowerCase() === k.toLowerCase());
      if (sk && out[sk] && typeof out[sk] === 'object' && !Array.isArray(out[sk])) {
        out[sk] = restoreMaskedContacts(cv, out[sk], depth - 1);
      }
    }
  }
  return out;
}

// Deep-mask contact values for manager reads (non-empty strings only).
function maskContactsDeep(value, depth) {
  if (depth <= 0 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => maskContactsDeep(v, depth - 1));
  const out = {};
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (CONTACT_JSON_KEYS.has(k.toLowerCase()) && typeof v === 'string' && v !== '') {
      out[k] = CONTACT_MASK;
    } else {
      out[k] = (v && typeof v === 'object') ? maskContactsDeep(v, depth - 1) : v;
    }
  }
  return out;
}

function maskNotesContactsForManager(row) {
  const v = row.notes;
  if (typeof v !== 'string' || !v.trim().startsWith('{')) return;
  try {
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === 'object') {
      row.notes = JSON.stringify(maskContactsDeep(parsed, 5));
    }
  } catch (e) {}
}

function maskFamilyRowForManager(row, scope) {
  for (const col of FAMILY_CONTACT_COLUMNS) {
    if (typeof row[col] === 'string' && row[col] !== '') row[col] = CONTACT_MASK;
  }
  const v = row.notes;
  if (typeof v !== 'string' || !v.trim().startsWith('{')) return;
  try {
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed !== 'object') return;
    const masked = maskContactsDeep(parsed, 5);
    // Manager payroll invisibility inside the shared blob: drop the
    // lms_shared_sync.teacher_salaries entries keyed by manager records.
    const sync = masked.lms_shared_sync;
    if (sync && typeof sync === 'object' && sync.teacher_salaries && typeof sync.teacher_salaries === 'object') {
      const mgrIds = (scope && scope.managerIds) || [];
      const kept = {};
      for (const [k, val] of Object.entries(sync.teacher_salaries)) {
        if (!mgrIds.includes(String(k))) kept[k] = val;
      }
      masked.lms_shared_sync = { ...sync, teacher_salaries: kept };
    }
    row.notes = JSON.stringify(masked);
  } catch (e) {}
}

function stripSalaryKeysFromObject(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase().includes('salary')) delete obj[k];
  }
  const acc = obj.teacher_account;
  if (acc && typeof acc === 'object') {
    for (const k of Object.keys(acc)) {
      if (k.toLowerCase().includes('salary')) delete acc[k];
    }
  }
}

// Manager records keep their identity visible to managers, but their
// payroll data (salary slips / any salary key in the address meta, and the
// per-slot rate) is owner-only.
function maskTeacherRowForManager(row) {
  if (!isManagerStaffRecord(row)) return;
  row.rate_per_slot = null;
  const v = row.address;
  if (typeof v !== 'string' || !v.trim().startsWith('{')) return;
  try {
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === 'object') {
      stripSalaryKeysFromObject(parsed);
      row.address = JSON.stringify(parsed);
    }
  } catch (e) {}
}

function maskTrialRowForManager(row) {
  if (typeof row.whatsapp === 'string' && row.whatsapp !== '') row.whatsapp = CONTACT_MASK;
  maskNotesContactsForManager(row);
}

function filterIdValues(filters) {
  const ids = [];
  for (const f of Array.isArray(filters) ? filters : []) {
    if (!f || String(f.column) !== 'id') continue;
    if (f.op === 'eq' && f.value != null) ids.push(String(f.value));
    if (f.op === 'in' && Array.isArray(f.value)) {
      for (const v of f.value) ids.push(String(v));
    }
  }
  return ids;
}

async function loadRowsByIds(db, table, ids) {
  if (!db || !ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const { results } = await db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).all();
  return results || [];
}

// Batch 2 manager write guards. Runs inside handleScopedDbRequest for
// role==='manager' writes BEFORE delegation; returns true to allow, false
// to deny (403, generic message). May transform body.values in place
// (mask write-back protection, item (c)). Batch 6B: a branch may instead
// return { deny: '<message>' } to deny with that exact English error in
// the 403 body (used by the salary-tables guard, item (d)).
async function applyManagerWriteGuards(db, body, scope) {
  const table = body.table;
  const action = body.action;
  const filters = Array.isArray(body.filters) ? body.filters : [];

  // (a) system_settings: only course-catalog keys may be written. Inserts
  // carry the key in every values row; updates/deletes must pin the key
  // with an eq filter.
  if (table === 'system_settings') {
    if (action === 'insert' || action === 'upsert') {
      const rows = Array.isArray(body.values) ? body.values : [body.values || {}];
      return rows.every((row) => isCatalogSettingsKey(row && row.key));
    }
    if (action === 'update' || action === 'delete') {
      const f = filters.find((x) => x && String(x.column) === 'key' && x.op === 'eq');
      return !!f && isCatalogSettingsKey(f.value);
    }
    return true;
  }

  // (b) teachers: a manager can never create a manager record, modify a
  // manager record, or turn any record into a manager.
  if (table === 'teachers') {
    if (action === 'insert' || action === 'upsert') {
      const rows = Array.isArray(body.values) ? body.values : [body.values || {}];
      return rows.every((row) => !isManagerStaffRecord(row || {}));
    }
    if (action === 'update') {
      const ids = filterIdValues(filters);
      if (!ids.length) return false; // unverifiable target: deny
      const patch = body.values || {};
      if (isManagerStaffRecord({ address: patch.address, employee_type: patch.employee_type })) return false;
      const targets = await loadRowsByIds(db, 'teachers', ids);
      if (targets.some((t) => isManagerStaffRecord(t))) return false;
      return true;
    }
    return true; // delete already denied in checkTableAccess
  }

  // (c) Mask write-back protection for family/student contact data.
  if (table === 'families' || table === 'students' || table === 'trial_students') {
    const contactCols = table === 'families' ? FAMILY_CONTACT_COLUMNS
      : table === 'trial_students' ? ['whatsapp'] : [];
    const rows = Array.isArray(body.values) ? body.values : [body.values || {}];
    const isUpdate = action === 'update';
    let currentNotes = null;
    let currentLoaded = false;
    if (isUpdate) {
      const ids = filterIdValues(filters);
      if (ids.length) {
        const cur = await loadRowsByIds(db, table, ids.slice(0, 1));
        if (cur.length) { currentNotes = cur[0].notes; currentLoaded = true; }
      }
    }
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const col of contactCols) {
        if (row[col] === CONTACT_MASK) delete row[col];
      }
      const parseObj = (s) => {
        if (typeof s !== 'string' || !s.trim().startsWith('{')) return null;
        try {
          const o = JSON.parse(s);
          return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
        } catch (e) { return null; }
      };
      const mergeCurrent = (submittedObj) => {
        if (!isUpdate || !currentLoaded) return submittedObj;
        const curObj = parseObj(currentNotes);
        return curObj ? restoreMaskedContacts(curObj, submittedObj, 5) : submittedObj;
      };
      if (typeof row.notes === 'string') {
        const parsed = parseObj(row.notes);
        if (parsed) {
          row.notes = JSON.stringify(mergeCurrent(stripMaskPlaceholders(parsed, 5)));
        }
        // Non-JSON notes strings: leave untouched.
      } else if (row.notes && typeof row.notes === 'object' && !Array.isArray(row.notes)) {
        row.notes = mergeCurrent(stripMaskPlaceholders(row.notes, 5));
      }
    }
    return true;
  }

  // (d) Batch 6B: salary tables — a manager can never create or edit a
  // salary slip or adjustment for a manager account (including their
  // own). Rows are keyed on the real teacher_id column (not blob keys),
  // against scope.managerIds resolved in resolveScopeIds.
  if (table === 'salary_slips' || table === 'salary_adjustments') {
    const managerIds = (scope && Array.isArray(scope.managerIds)) ? scope.managerIds : [];
    const denyMsg = 'Managers cannot create or edit salary records for manager accounts.';
    if (action === 'insert' || action === 'upsert' || action === 'update') {
      const rows = Array.isArray(body.values) ? body.values : [body.values || {}];
      for (const row of rows) {
        if (row && row.teacher_id != null && managerIds.includes(String(row.teacher_id))) {
          return { deny: denyMsg };
        }
      }
      // An update/upsert that does not carry teacher_id in its values:
      // check the STORED row it targets (same load-by-id pattern as the
      // teachers guard above) before letting it through.
      if (rows.some((row) => !row || row.teacher_id == null)) {
        const ids = new Set(filterIdValues(filters));
        for (const row of rows) { if (row && row.id != null) ids.add(String(row.id)); }
        if (ids.size) {
          const targets = await loadRowsByIds(db, table, [...ids]);
          if (targets.some((t) => managerIds.includes(String(t.teacher_id)))) {
            return { deny: denyMsg };
          }
        }
      }
    }
    return true; // delete already denied in checkTableAccess
  }

  return true;
}

function parseJsonObjectValue(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const o = JSON.parse(raw);
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch (e) { return null; }
  }
  return null;
}

// Batch 2 review fix: a manager's update payload is built from their
// MASKED read, so it can never contain the credential slots the scrubber
// hid (families.notes -> portal_credentials, teachers address/notes
// password slots) or the manager-keyed salary entries masked out of the
// shared sync blob. The write sanitiser strips password keys from manager
// writes, so without this restore an ordinary manager edit would ERASE
// the stored password (the PR #7 failure shape) or drop a manager's
// salary entry from the blob. Runs on the SCOPED body (after the
// sanitiser) and restores only slots the manager could not have seen;
// the manager never supplies these values.
async function restoreManagerUpdateHiddenSlots(db, scopedBody, scope) {
  try {
    const table = scopedBody.table;
    if (table !== 'families' && table !== 'teachers') return;
    const vals = scopedBody.values;
    if (!vals || typeof vals !== 'object' || Array.isArray(vals)) return;
    const ids = filterIdValues(scopedBody.filters);
    if (!ids.length) return;
    const current = await loadRowsByIds(db, table, ids.slice(0, 1));
    if (!current.length) return;
    const cur = current[0];
    const fields = table === 'families' ? ['notes'] : ['address', 'notes'];
    for (const field of fields) {
      if (vals[field] == null || cur[field] == null) continue;
      const sObj = parseJsonObjectValue(vals[field]);
      const cObj = parseJsonObjectValue(cur[field]);
      if (!sObj || !cObj) continue;
      let changed = false;
      const restorePw = (cHolder, sHolder) => {
        if (cHolder && sHolder && typeof cHolder === 'object' && typeof sHolder === 'object' &&
            typeof cHolder.password === 'string' && cHolder.password !== '' && !('password' in sHolder)) {
          sHolder.password = cHolder.password;
          return true;
        }
        return false;
      };
      if (table === 'families') {
        const cPc = cObj.portal_credentials;
        if (cPc && typeof cPc === 'object') {
          if (!sObj.portal_credentials || typeof sObj.portal_credentials !== 'object') {
            sObj.portal_credentials = cPc;
            changed = true;
          } else if (restorePw(cPc, sObj.portal_credentials)) {
            changed = true;
          }
        }
        const cSync = cObj.lms_shared_sync;
        const sSync = sObj.lms_shared_sync;
        if (cSync && sSync && typeof cSync === 'object' && typeof sSync === 'object' &&
            cSync.teacher_salaries && typeof cSync.teacher_salaries === 'object') {
          if (!sSync.teacher_salaries || typeof sSync.teacher_salaries !== 'object') sSync.teacher_salaries = {};
          for (const k of Object.keys(cSync.teacher_salaries)) {
            if (((scope && scope.managerIds) || []).includes(String(k)) && !(k in sSync.teacher_salaries)) {
              sSync.teacher_salaries[k] = cSync.teacher_salaries[k];
              changed = true;
            }
          }
        }
      } else {
        if (restorePw(cObj, sObj)) changed = true;
        const cAcc = cObj.teacher_account;
        if (cAcc && typeof cAcc === 'object') {
          if (!sObj.teacher_account || typeof sObj.teacher_account !== 'object') {
            sObj.teacher_account = cAcc;
            changed = true;
          } else if (restorePw(cAcc, sObj.teacher_account)) {
            changed = true;
          }
        }
      }
      if (changed) {
        vals[field] = (typeof vals[field] === 'string') ? JSON.stringify(sObj) : sObj;
      }
    }
  } catch (e) {
    // Never let the restore step break a legitimate update.
    console.warn('[scope] hidden-slot restore skipped:', e && e.message);
  }
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
      const sanitized = sanitizeWriteValues(table, scoped.values);
      // sanitizeWriteValues always returns an array of rows; an update
      // patch must stay a single object or the db engine spreads the array
      // into a keyless no-op (Batch 2 fix — manager updates were silently
      // dropped). The sanitisation itself is unchanged.
      scoped.values = action === 'update' ? (sanitized[0] || {}) : sanitized;
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
    } else if ((table === 'salary_slips' || table === 'salary_adjustments') && action === 'select') {
      // Batch 6B: a teacher reads only their own salary rows. (Writes by
      // teachers on these tables are already denied in checkTableAccess.)
      filters.push(eq('teacher_id', sub));
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
      case 'trial_students':
      case 'salary_slips':
      case 'salary_adjustments': return String(row.teacher_id) === sub;
      default: return false;
    }
  }
  // Batch 2: managers may only ever receive course-catalog settings rows
  // (plus the shared logo). All other keys are owner-only.
  if (role === 'manager' && table === 'system_settings') {
    return isManagerReadableSettingsKey(row.key);
  }
  // Batch 6B: a manager never receives salary rows that belong to a
  // manager account (including their own) — keyed on the real teacher_id
  // column, not on blob keys. scope.managerIds is resolved for every
  // manager request in resolveScopeIds; tolerate it being absent.
  if (role === 'manager' && (table === 'salary_slips' || table === 'salary_adjustments')) {
    const managerIds = (scope && Array.isArray(scope.managerIds)) ? scope.managerIds : [];
    return !managerIds.includes(String(row.teacher_id));
  }
  // Batch 6B: payments rows ARE in scope for managers — their content is
  // controlled by scrubRow (legacy_json blanking) below.
  return true; // owner / manager
}

function scrubRow(role, sub, scope, table, row) {
  const r = { ...(row || {}) };
  if (role !== 'owner') stripCredentialFieldsFromRow(table, r);

  // Batch 2: manager read masking (runs on the credential-stripped row).
  // Family/student contact details are replaced with the mask; manager
  // records lose their payroll data. Teacher contacts stay visible.
  if (role === 'manager') {
    if (table === 'families') maskFamilyRowForManager(r, scope);
    else if (table === 'students') maskNotesContactsForManager(r);
    else if (table === 'trial_students') maskTrialRowForManager(r);
    else if (table === 'teachers') maskTeacherRowForManager(r);
    else if (table === 'payments') {
      // Batch 6B: a payment row's legacy_json holds the original receipt
      // record VERBATIM, including contact snapshots (WhatsApp / email).
      // Managers must never receive it. scrubRow runs on EVERY row the
      // pipeline returns — selects and insert/update responses alike —
      // so blanking it here covers all response shapes. Only this copy
      // is changed; the stored row is untouched.
      r.legacy_json = null;
    }
  }

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
  // Batch 2: the same manager masking applies to hydrated relations
  // (students of a family, the family of a student/payment, the teacher of
  // a schedule) — contacts and manager payroll data must not leak sideways.
  if (role === 'manager') {
    if (Array.isArray(r.students)) {
      r.students.forEach((s) => maskNotesContactsForManager(s));
    } else if (r.students && typeof r.students === 'object') {
      maskNotesContactsForManager(r.students);
    }
    if (r.families && typeof r.families === 'object') {
      maskFamilyRowForManager(r.families, scope);
    }
    if (r.teachers && typeof r.teachers === 'object') {
      maskTeacherRowForManager(r.teachers);
    }
  }
  // Parents may read the teachers table but only the public identity.
  if (role === 'parent' && table === 'teachers') {
    return { id: r.id, full_name: r.full_name, zoom_link: r.zoom_link };
  }
  return r;
}

// Wraps the D1 handler: pre-check -> inject scope -> delegate -> scrub.
// --- Batch 2.1: audit log ---------------------------------------------------
// Append-only record of MANAGER writes through /api/db: who (actor id +
// role), what (action + table), which record, when. Values and content
// are NEVER logged — no contacts, no notes, no passwords. Written
// directly against D1 (not through /api/db, which denies audit_log to
// every non-owner role), and a logging failure must never break the
// request it belongs to.
function auditRecordIds(body) {
  const ids = [];
  const push = (v) => { if (v != null && v !== '' && ids.length < 20) ids.push(String(v).slice(0, 200)); };
  const filters = Array.isArray(body && body.filters) ? body.filters : [];
  const rows = Array.isArray(body && body.values) ? body.values : (body && body.values ? [body.values] : []);
  if (body && body.table === 'system_settings') {
    // For settings rows the meaningful identifier is the key.
    for (const r of rows) push(r && r.key);
    for (const f of filters) {
      if (f && String(f.column) === 'key' && f.op === 'eq') push(f.value);
    }
    return [...new Set(ids)];
  }
  for (const id of filterIdValues(filters)) push(id);
  for (const r of rows) push(r && r.id);
  return [...new Set(ids)];
}

async function writeAuditLogEntries(db, auth, body) {
  try {
    if (!db || !body) return;
    const ids = auditRecordIds(body);
    const targets = ids.length ? ids : [''];
    const now = new Date().toISOString();
    for (const rid of targets) {
      const entryId = 'AUD-' + now.replace(/[^0-9]/g, '').slice(0, 17) + '-' + Math.random().toString(36).slice(2, 8);
      await db.prepare('INSERT INTO audit_log (id, actor_id, actor_role, action, table_name, record_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(entryId, String(auth.sub || ''), String(auth.role || ''), String(body.action || ''), String(body.table || ''), rid, now)
        .run();
    }
  } catch (e) {
    console.warn('[audit] log write skipped:', e && e.message);
  }
}

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
  // Batch 2: manager write guards (manager-record identity, system_settings
  // key allowlist, mask write-back protection) — deny BEFORE delegation.
  if (role === 'manager' && WRITE_ACTIONS.has(action)) {
    const guardResult = await applyManagerWriteGuards(db, body, scope);
    if (guardResult !== true) {
      // Batch 6B: a guard may deny with a specific English message
      // ({ deny: '...' }); the 403 body keeps the standard shape.
      if (guardResult && typeof guardResult === 'object' && guardResult.deny) {
        return json(request, env, { ok: false, error: guardResult.deny }, 403);
      }
      return forbidden(request, env);
    }
  }
  const scopedBody = applyDbScope(body, role, sub, scope);
  if (!scopedBody) {
    return forbidden(request, env);
  }
  // Batch 2 review fix: restore the credential/blob slots a manager's
  // masked read could not contain, so their edit cannot erase them.
  if (role === 'manager' && action === 'update') {
    await restoreManagerUpdateHiddenSlots(db, scopedBody, scope);
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
  // Batch 2.1: record successful MANAGER writes in the audit log.
  // Denied or failed writes never reach this point as successes and are
  // not logged.
  if (role === 'manager' && WRITE_ACTIONS.has(action) && resp.status >= 200 && resp.status < 300 && !(payload && payload.error)) {
    await writeAuditLogEntries(db, auth, body);
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
    // Shared published course material (uploaded by owner under course_material/)
    // is readable by any authenticated role. Writes remain owner-only: the POST
    // path below forces restricted roles into their own scoped folder.
    const isSharedCourseMaterial = key.startsWith('course_material/');
    if (!key.startsWith(prefix) && !isSharedCourseMaterial) {
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

    // 2b. Email relay (/api/email/send) -> official Apps Script relay.
    // Owner role ONLY (handleEmailSend enforces this). CORS preflights never
    // carry Authorization; answer them before auth like the other APIs.
    if (url.pathname === '/api/email/send') {
      return handleEmailSend(request, env);
    }

    // 2c. Manager/owner notify-a-parent relay (/api/email/notify-parent).
    // The recipient is resolved server-side from the family id; the
    // caller's role is enforced inside the handler.
    if (url.pathname === '/api/email/notify-parent') {
      return handleEmailNotifyParent(request, env);
    }

    // 2e. Teacher advance-class email (/api/email/advance-class).
    // Teacher role ONLY (enforced in the handler); the recipient is
    // resolved server-side from the student's family and never returned.
    if (url.pathname === '/api/email/advance-class') {
      return handleTeacherAdvanceClassEmail(request, env);
    }

    // 2d. Duplicate check for Add Family (/api/families/check-duplicates).
    // Owner/manager only (enforced in the handler); answers only WHETHER
    // a contact/name already exists (family id + name + which submitted
    // fields matched), never the stored contact value — so managers get
    // duplicate warnings without ever seeing contacts (Batch 3A, B15).
    if (url.pathname === '/api/families/check-duplicates') {
      return handleFamilyDuplicateCheck(request, env);
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
