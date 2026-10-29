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

import { onRequest as handleDbRequest, AUTH_TABLE_STATEMENTS } from '../functions/api/db.js';
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

// --- Batch 7 Part B: Worker release identity --------------------------------
// WORKER_RELEASE identifies the deployed Worker build. There is no
// version-metadata binding in wrangler.toml, so this constant is the only
// build identity /api/health can report. BUMP IT IN EVERY RELEASE PR so the
// "after every merge" checklist in SECURITY-SETUP.md can compare the live
// health version against the release being deployed.
// HEALTH_SCHEMA_VERSION is kept in sync by hand with SCHEMA_VERSION in
// functions/api/db.js (the D1 schema marker; v2 after Part A). It is hardcoded
// here on purpose: /api/health must never 500 because D1 is unreachable, and
// it must never cost an unauthenticated caller a D1 read.
const WORKER_RELEASE = '2026-10-29-salary-advance';
const HEALTH_SCHEMA_VERSION = '2026-10-29-v3';

// --- Batch 7 Part B: security headers (workers.dev responses) --------------
// Every response the Worker serves carries this set. The Content-Security-
// Policy is ENFORCING (Batch 3.4, audit P2-10) and mirrors the exact CSP
// string from vercel.json, which Vercel already enforces on the same
// files. Framing is still carried by X-Frame-Options: SAMEORIGIN alone
// (no frame-ancestors directive in the string): cross-origin framing of
// the portals is intentionally unsupported (no legitimate cross-origin
// embedding was found). Permissions-Policy denies
// only features the app never uses (verified by grep: no getUserMedia,
// MediaDevices, geolocation, PaymentRequest, or USB usage in app code).
// CORS handling (corsHeadersFor) is separate and untouched; Vercel's
// cache-control is NOT copied here (asset/R2 caching is handled per path).
// Batch 3.4 (audit P2-10): the Worker CSP is now ENFORCING, not
// report-only. The string is byte-identical to the CSP Vercel already
// enforces on the same files (see vercel.json), so Worker-enforcing
// cannot break anything Vercel does not already break: script-src
// already allows 'unsafe-inline' (the portals' inline scripts), every
// external host in HTML tags is one of the five allowlisted CDNs,
// connect-src/frame-src allow all https, and a static scan found no
// <object>/<embed>/<base> tags, no cross-origin form actions, no
// eval() and no dynamic script injection. The old report-only header
// is gone (not kept alongside — a report-only copy would double-report
// nothing and confuse the header audit).
const WORKER_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; connect-src 'self' https:; frame-src 'self' https:; object-src 'none'; base-uri 'self'";

function securityHeaders() {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': WORKER_CSP,
  };
}

// Rebuild a response with the security set merged over its existing
// headers (existing headers win except the security keys themselves, which
// the set owns). Body passes through untouched, so streaming is preserved;
// a null body (204 preflights) stays null.
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders())) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(request, env, data, status = 200, extraHeaders = {}) {
  // 204 No Content must not carry a body — `new Response("{}", {status:204})`
  // throws and turns every CORS preflight into a 500 (caught 2026-10-14:
  // all browser logins were blocked at preflight). Return a null body.
  // Batch 7 Part B: every API response also carries the security set
  // (the set owns its keys; extraHeaders — e.g. Retry-After — passes through).
  const headers = { ...corsHeadersFor(request, env), ...extraHeaders, ...securityHeaders() };
  if (status === 204) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

// --- Batch 7A: D1-backed login throttling + lockout --------------------------
// Replaces the old in-memory IP-only limiter as the primary guard (the
// in-memory Map below is kept ONLY as a fallback when D1 is unavailable,
// e.g. owner login on an isolate without a DB binding). Throttle state
// lives in the auth_throttle table (see functions/api/db.js
// AUTH_TABLE_STATEMENTS): one row per (kind, key_hash), where key_hash is
// HMAC-SHA-256 under WORKER_AUTH_SECRET of a normalized key — never a
// plaintext username or IP. Kinds: 'account' (role + login identifier),
// 'ip' (client IP), 'setpw' (set-password attempts from one IP).
//
// Policy (all windows 15 minutes):
//   account: 5 failed attempts lock the account 15 minutes, progressive
//     up to 1 hour on repeated lock cycles (a failure within 15 minutes
//     after a lock expires re-locks with double the duration, capped at
//     1 hour; a quiet 15 minutes resets the progression).
//   ip: 20 failed attempts block the IP 15 minutes (fixed, not
//     progressive — a shared/NAT IP must not be blocked for an hour
//     because of one attacker's failures).
//   setpw: 30 FAILED set-password attempts per IP per 15 minutes,
//     15-minute lock (authenticated action; the allowance is generous
//     for legitimate bulk password setting and the endpoint is
//     owner/manager-only). Batch 3.4 (audit P2-7): successes do NOT
//     count — counting them locked out legitimate migrations.
// A successful login resets the ACCOUNT counter only (the IP counter
// keeps counting — one account's good login must not forgive an IP-wide
// attack). Locks ALWAYS expire: there is no permanent-lock state, and a
// lock is never extended by attempts made while locked (rejected
// attempts record nothing, so an attacker cannot stretch a victim's lock
// by hammering). A lock never ends an already-valid session — it only
// blocks NEW logins; existing tokens die only via revocation (A2 below).
// Anti-lockout-abuse notes: account locks are short (15–60 min) and
// capped; the per-IP block (20 failures) engages before one IP can
// sustain an account lock indefinitely; and the owner unlock path
// (POST /api/auth/unlock, owner-only, on the password tool page) plus
// the WORKER_AUTH_SECRET-rotation emergency path (SECURITY-SETUP.md)
// exist for recovery. A lockout from one IP never blocks the same
// account from another IP unless that account's own counter also trips
// (the account counter counts failures from ALL IPs — by design, since
// the account itself is the thing being attacked; the owner unlock
// covers the residual risk).
// Concurrency note: the read-modify-write below is best-effort under
// concurrent attempts (two isolates may both read fail_count=4 and both
// write 5). The lock may engage a few attempts late under a burst, never
// unboundedly: every attempt still writes, and the thresholds are low.
// D1 serializes the writes themselves; no attempt is silently dropped.
const LOGIN_ATTEMPTS = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginRateLimited(ip) {
  // Fallback ONLY when D1 is unavailable (owner login without a DB
  // binding). Every D1-backed path below supersedes this.
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

const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_ACCOUNT_THRESHOLD = 5;
const THROTTLE_IP_THRESHOLD = 20;
const THROTTLE_SETPW_THRESHOLD = 30;
const THROTTLE_LOCK_BASE_MS = 15 * 60 * 1000;
const THROTTLE_LOCK_MAX_MS = 60 * 60 * 1000;

async function throttleKeyHash(env, key) {
  if (!env || !env.WORKER_AUTH_SECRET) return null;
  const cryptoKey = await crypto.subtle.importKey('raw', te.encode(String(env.WORKER_AUTH_SECRET)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, te.encode(String(key)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function throttleAccountKey(role, identifier) {
  return String(role || '').toLowerCase() + ':' + String(identifier || '').trim().toLowerCase();
}

async function ensureAuthTables(db) {
  // Idempotent; only called on throttle/revocation WRITES (login
  // failures, logout, bumps, unlock), never on the per-request read
  // path, so a cold isolate that has not served /api/db yet still
  // records its first failure instead of crashing on a missing table.
  for (const sql of AUTH_TABLE_STATEMENTS) {
    try { await db.prepare(sql).run(); } catch (e) {}
  }
}

async function getThrottleRow(db, kind, keyHash, strict = false) {
  try {
    return await db.prepare('SELECT kind, key_hash, fail_count, window_start, locked_until FROM auth_throttle WHERE kind = ? AND key_hash = ?').bind(kind, keyHash).first();
  } catch (e) {
    // Batch 3.4 (audit P2-1): a genuinely missing table (pre-deploy DB)
    // means no throttle state exists, so null is correct. Any OTHER D1
    // error is rethrown when the caller asked for strict reads (the lock
    // check below) so a D1 error window can never read as "unlocked".
    // Lenient callers (failure recording, best effort) keep null.
    if (strict && !isMissingTableError(e)) throw e;
    return null;
  }
}

// Batch 3.4 (audit P2-1): distinguishes "the auth tables do not exist
// yet" (correctly treated as empty state) from any other D1 failure
// (which must fail CLOSED, never as empty state). D1/SQLite report a
// missing table as "no such table: <name>".
function isMissingTableError(e) {
  const msg = String((e && e.message) || e || '');
  return /no such table/i.test(msg);
}

async function getThrottleLock(db, env, kind, key) {
  // Read-only lock check. Returns { locked, retryAfterSec }.
  // Batch 3.4 (audit P2-1): on a D1 read failure that is NOT a missing
  // table, this returns LOCKED (fail closed) instead of unlocked — a D1
  // error window must never admit logins or password sets that the
  // throttle would have blocked.
  const keyHash = await throttleKeyHash(env, key);
  if (!keyHash) return { locked: false, retryAfterSec: 0 };
  let row;
  try {
    row = await getThrottleRow(db, kind, keyHash, true);
  } catch (e) {
    return { locked: true, retryAfterSec: 60 };
  }
  if (!row || !row.locked_until) return { locked: false, retryAfterSec: 0 };
  const remainingMs = Number(row.locked_until) - Date.now();
  if (remainingMs <= 0) return { locked: false, retryAfterSec: 0 };
  return { locked: true, retryAfterSec: Math.ceil(remainingMs / 1000) };
}

function throttleLockResponse(request, env, retryAfterSec) {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return json(request, env, { ok: false, error: `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, 429, { 'Retry-After': String(retryAfterSec) });
}

async function recordThrottleFailure(db, env, kind, key, threshold, progressive) {
  // Records one failure and returns the lock state AFTER this failure.
  // Attempts made while already locked record nothing (see header note).
  await ensureAuthTables(db);
  const keyHash = await throttleKeyHash(env, key);
  if (!keyHash) return { locked: false, retryAfterSec: 0 };
  const now = Date.now();
  const row = await getThrottleRow(db, kind, keyHash);
  if (row && row.locked_until && Number(row.locked_until) > now) {
    return { locked: true, retryAfterSec: Math.ceil((Number(row.locked_until) - now) / 1000) };
  }
  let failCount;
  let windowStart;
  let lockedUntil = null;
  if (!row) {
    failCount = 1; windowStart = now;
  } else if (progressive && row.locked_until && now - Number(row.locked_until) < THROTTLE_WINDOW_MS) {
    // Repeat-offender cycle: a failure shortly after a lock expired
    // re-locks with double the duration, capped at 1 hour.
    failCount = Number(row.fail_count || 0) + 1; windowStart = now;
  } else {
    if (now - Number(row.window_start || 0) > THROTTLE_WINDOW_MS) { failCount = 0; windowStart = now; }
    else { failCount = Number(row.fail_count || 0); windowStart = Number(row.window_start || now); }
    failCount += 1;
  }
  if (failCount >= threshold) {
    const cycles = progressive ? Math.max(0, failCount - threshold) : 0;
    lockedUntil = now + Math.min(THROTTLE_LOCK_MAX_MS, THROTTLE_LOCK_BASE_MS * Math.pow(2, cycles));
  }
  try {
    await db.prepare('INSERT INTO auth_throttle (kind, key_hash, fail_count, window_start, locked_until, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(kind, key_hash) DO UPDATE SET fail_count = excluded.fail_count, window_start = excluded.window_start, locked_until = excluded.locked_until, updated_at = excluded.updated_at').bind(kind, keyHash, failCount, windowStart, lockedUntil, new Date().toISOString()).run();
  } catch (e) {}
  // Opportunistic purge of fully-expired rows (best effort; never fails
  // the login): rows whose lock expired over a window ago, or unlocked
  // rows whose window is long past.
  try {
    await db.prepare('DELETE FROM auth_throttle WHERE (locked_until IS NOT NULL AND locked_until < ?) OR (locked_until IS NULL AND window_start < ?)').bind(now - THROTTLE_WINDOW_MS, now - THROTTLE_WINDOW_MS).run();
  } catch (e) {}
  if (lockedUntil && lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((lockedUntil - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

async function resetThrottleRow(db, env, kind, key) {
  const keyHash = await throttleKeyHash(env, key);
  if (!keyHash) return;
  try { await db.prepare('DELETE FROM auth_throttle WHERE kind = ? AND key_hash = ?').bind(kind, keyHash).run(); } catch (e) {}
}

// --- Email relay rate limiting: max 100 sends per token per 10 minutes. -----
// Batch 3.4 (audit P2-2): the D1 counter (emailSendLimited below) is
// authoritative whenever a DB binding exists; this Map is ONLY the
// fallback for a binding-less deploy, because email/send is designed to
// work without D1. Sized for bulk fee-reminder runs (up to ~85
// sequential sends), not just single emails.
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

// --- Batch 3.4 (audit P2-2): D1-backed fixed-window counters -------------
// The per-isolate Maps below used to cap email/dup-check/teacher-daily
// sends per isolate, so a caller spread across isolates got N times the
// allowance. These counters now live in the Batch 7A auth_throttle table
// (same table, new kinds: 'email', 'dupcheck', 'teacher_email_daily'):
// fail_count is the count inside the window, window_start the window
// start, locked_until stays NULL (these are counters, not locks — the
// window reset, not a lock, is what re-admits the caller). Concurrency
// is best-effort like the login throttle: two isolates may both read
// count=N and both write N+1, so the limit can engage a couple of
// attempts late, never unboundedly. A D1 error fails CLOSED (limited),
// except a missing table, which is created first and retried once.
const DUPCHECK_WINDOW_MS = 10 * 60 * 1000;
const DUPCHECK_MAX_ATTEMPTS = 30;
const TEACHER_EMAIL_DAILY_MAX = 30;

async function d1WindowLimited(db, env, kind, key, windowMs, max) {
  const keyHash = await throttleKeyHash(env, key);
  if (!keyHash) return true;
  const selectRow = () => db.prepare('SELECT kind, key_hash, fail_count, window_start, locked_until FROM auth_throttle WHERE kind = ? AND key_hash = ?').bind(kind, keyHash).first();
  let row;
  try {
    row = await selectRow();
  } catch (e) {
    if (!isMissingTableError(e)) return true;
    await ensureAuthTables(db);
    try { row = await selectRow(); } catch (e2) { return true; }
  }
  const now = Date.now();
  let count;
  let windowStart;
  if (!row || now - Number(row.window_start || 0) > windowMs) { count = 1; windowStart = now; }
  else { count = Number(row.fail_count || 0) + 1; windowStart = Number(row.window_start || now); }
  try {
    await db.prepare('INSERT INTO auth_throttle (kind, key_hash, fail_count, window_start, locked_until, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(kind, key_hash) DO UPDATE SET fail_count = excluded.fail_count, window_start = excluded.window_start, locked_until = excluded.locked_until, updated_at = excluded.updated_at').bind(kind, keyHash, count, windowStart, null, new Date().toISOString()).run();
  } catch (e) {
    return true; // could not record: fail closed
  }
  // Opportunistic purge of expired counter rows (best effort).
  try {
    await db.prepare('DELETE FROM auth_throttle WHERE kind = ? AND locked_until IS NULL AND window_start < ?').bind(kind, now - windowMs).run();
  } catch (e) {}
  return count > max;
}

// Email sends are deliberately designed to work WITHOUT D1 (the relay
// needs no database), so when no DB binding exists the per-isolate Map
// below is the only available limiter. With a binding present the D1
// counter is authoritative and global across isolates.
async function emailSendLimited(db, env, key) {
  if (db) return d1WindowLimited(db, env, 'email', key, EMAIL_SEND_WINDOW_MS, EMAIL_SEND_MAX_ATTEMPTS);
  return emailSendRateLimited(key);
}

async function dupCheckLimited(db, env, key) {
  return d1WindowLimited(db, env, 'dupcheck', key, DUPCHECK_WINDOW_MS, DUPCHECK_MAX_ATTEMPTS);
}

async function teacherEmailDailyLimited(db, env, sub) {
  const key = String(sub || '') + '|' + new Date().toISOString().slice(0, 10);
  return d1WindowLimited(db, env, 'teacher_email_daily', key, 24 * 60 * 60 * 1000, TEACHER_EMAIL_DAILY_MAX);
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

// --- Batch 7A: PBKDF2 password hashing (WebCrypto) ---------------------------
// New hashes are stored as 'pbkdf2$<iterations>$<salt-hex>$<hash-hex>'
// where hash = PBKDF2-HMAC-SHA-256(password, salt, iterations), 32 bytes.
// The format carries its iteration count, so the count can be raised (or
// lowered) later by changing one constant: existing hashes keep verifying
// at their stored count, and each successful login transparently re-hashes
// to the current count (see staff-login upgrade below). Legacy formats
// keep verifying forever (see verifyPassword): no flag day, no mass reset.
//
// ITERATION CHOICE (10,000) — read this before raising it:
//   * Official Cloudflare Workers limits (developers.cloudflare.com/
//     workers/platform/limits/, retrieved 2026-10-28): Workers Free allows
//     10 ms CPU time per invocation; Workers Paid (Standard) allows 30 s
//     by default, up to 5 min. CPU time is execution time, not wall-clock:
//     D1/network waits do not count toward it.
//   * This account's Workers plan is UNVERIFIED (dashboard-only; nothing
//     in the repo states it) — so the count must be safe even on Free.
//   * Measured on this VM (Node v24.22.1, PBKDF2-HMAC-SHA-256, 32-byte
//     output): 100,000 iterations ≈ 24–28 ms; 210,000 ≈ 54–60 ms;
//     600,000 ≈ 158–162 ms (≈0.27 ms per 1,000 iterations). VM numbers are
//     NOT Workers numbers, but they set the scale: 100,000 iterations
//     would already exceed a Free 10 ms budget, while 10,000 (≈2.7 ms
//     interpolated) leaves headroom for the rest of the login request.
//   * 10,000 is below the 600,000 OWASP recommends for PBKDF2-HMAC-SHA-256
//     — stated honestly. It is still a large step up from the previous
//     single SHA-256, and it is the largest count defensible without
//     knowing the plan. If the account is confirmed on Workers Paid,
//     raise PBKDF2_ITERATIONS to 210,000 (≈57 ms) or 600,000 (≈160 ms)
//     with a one-constant redeploy; no migration is needed.
//   * FALLBACK if logins ever fail with CPU-limit errors after deploy:
//     lower PBKDF2_ITERATIONS and redeploy. Old hashes still verify at
//     their stored count, and logins re-hash to the new count. Never
//     raise the count past what the plan's CPU budget allows.
//
// PASSWORD LOCATIONS (canonical slots, verified from D1 schema + login code):
//   parent  -> families.notes  JSON -> portal_credentials.password
//   teacher -> teachers.address JSON -> password            (also honored by
//              login: teachers.address -> teacher_account.password,
//                      teachers.notes  -> password)
//   manager -> teachers.address JSON -> password  (same record shape as
//              teacher; the record counts as a manager when employee_type =
//              'manager' or id/emp_id starts with 'MGR-')
const PBKDF2_ITERATIONS = 10000;
const PBKDF2_MAX_ITERATIONS = 1000000; // fail-closed cap: a stored hash
// claiming more iterations than this is rejected without deriving (a
// crafted stored value must never be able to force a CPU-burning derive).

function isPbkdf2Password(s) {
  return /^pbkdf2\$[0-9]+\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(String(s || ''));
}

function isHashedPassword(s) {
  return isPbkdf2Password(s) || /^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(String(s || ''));
}

async function pbkdf2Hex(password, saltHex, iterations) {
  const saltBytes = new Uint8Array((String(saltHex).match(/../g) || []).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = await pbkdf2Hex(password, saltHex, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

async function verifyPassword(password, stored) {
  const s = String(stored || '');
  if (isPbkdf2Password(s)) {
    const parts = s.split('$');
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2] || '';
    const expectedHex = (parts[3] || '').toLowerCase();
    // Fail closed on absurd iteration claims (see PBKDF2_MAX_ITERATIONS).
    if (!Number.isFinite(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return false;
    const hashHex = await pbkdf2Hex(password, saltHex, iterations);
    return constantTimeEqualBytes(te.encode(hashHex), te.encode(expectedHex));
  }
  if (/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(s)) {
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

async function verifyOwnerEnvPassword(password, expectedHash) {
  // The owner credential lives in env, not D1, and the app can never
  // re-hash it (see PR body). The env value may be the legacy unsalted
  // SHA-256 hex OR a pbkdf2$... value (the documented migration target);
  // both verify here so the migration needs no flag day.
  const expected = String(expectedHash || '').toLowerCase();
  if (isPbkdf2Password(expected)) {
    const parts = expected.split('$');
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return false;
    const hashHex = await pbkdf2Hex(password, parts[2] || '', iterations);
    return constantTimeEqualBytes(te.encode(hashHex), te.encode((parts[3] || '').toLowerCase()));
  }
  const passHash = (await sha256Hex(password)).toLowerCase();
  return constantTimeEqualBytes(te.encode(passHash), te.encode(expected));
}

// Dummy PBKDF2 verification for unknown identifiers (staff-login): the
// failure path must cost roughly what a real PBKDF2 verification costs,
// so an unknown identifier is not trivially distinguishable from a wrong
// password by timing. The dummy hash is a fixed test vector, never a real
// credential, and its result is always discarded. Timing equality is
// approximate (network jitter dominates a few ms); the primary
// anti-enumeration defence is the identical 401 response, not timing.
function dummyPbkdf2Hash() {
  return 'pbkdf2$' + PBKDF2_ITERATIONS + '$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';
}
async function dummyPasswordVerify(password) {
  try { await verifyPassword(password, dummyPbkdf2Hash()); } catch (e) {}
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
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }

  const username = String((body && body.username) || '');
  const password = String((body && body.password) || '');
  const db = getDb(env);
  if (db) {
    const ipLock = await getThrottleLock(db, env, 'ip', ip);
    if (ipLock.locked) return throttleLockResponse(request, env, ipLock.retryAfterSec);
    // The account lock is only meaningful for a non-empty username.
    if (username.trim()) {
      const accountLock = await getThrottleLock(db, env, 'account', throttleAccountKey('owner', username));
      if (accountLock.locked) return throttleLockResponse(request, env, Math.max(ipLock.retryAfterSec, accountLock.retryAfterSec));
    }
  } else if (loginRateLimited(ip)) {
    return json(request, env, { ok: false, error: 'Too many login attempts. Please try again later.' }, 429);
  }

  const expectedUser = String(env.OWNER_USERNAME || '');
  const expectedHash = String(env.OWNER_PASSWORD_HASH || '').toLowerCase();

  let valid = false;
  if (expectedUser && expectedHash && env.WORKER_AUTH_SECRET) {
    const userOk = constantTimeEqualBytes(te.encode(username), te.encode(expectedUser));
    const passOk = await verifyOwnerEnvPassword(password, expectedHash);
    valid = userOk && passOk;
  }

  if (!valid) {
    if (db) {
      // A lock trips on the attempt that reaches the threshold (same as
      // the old limiter, which blocked the threshold-crossing attempt),
      // so the response is 429 right away, not only on the next attempt.
      const ipResult = await recordThrottleFailure(db, env, 'ip', ip, THROTTLE_IP_THRESHOLD, false);
      if (ipResult.locked) return throttleLockResponse(request, env, ipResult.retryAfterSec);
      if (username.trim()) {
        const accResult = await recordThrottleFailure(db, env, 'account', throttleAccountKey('owner', username), THROTTLE_ACCOUNT_THRESHOLD, true);
        if (accResult.locked) return throttleLockResponse(request, env, accResult.retryAfterSec);
      }
    }
    return json(request, env, { ok: false, error: 'Invalid username or password.' }, 401);
  }

  // Success resets the account counter (the IP counter is untouched).
  if (db && username.trim()) await resetThrottleRow(db, env, 'account', throttleAccountKey('owner', username));

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

  const ipLock = await getThrottleLock(db, env, 'ip', ip);
  if (ipLock.locked) return throttleLockResponse(request, env, ipLock.retryAfterSec);
  const accountLock = await getThrottleLock(db, env, 'account', throttleAccountKey(role, identifier));
  if (accountLock.locked) return throttleLockResponse(request, env, Math.max(ipLock.retryAfterSec, accountLock.retryAfterSec));

  try {
    let recordId = null;
    let recordFullName = null;
    let recordEmpId = null;
    // Audit P1-1: status of the record that authenticates, for the
    // deactivation gate below (null until a password verifies).
    let recordStatus = null;
    // Batch-1: track WHY login failed so an account that exists but has no
    // owner-set (hashed) password gets the distinct 'no_password_set' error,
    // while every other failure keeps the generic anti-enumeration message.
    let matchedAccount = false;
    let matchedHashed = false;
    // Batch 7A: the slot + hash the successful login verified against,
    // so a legacy-format success can transparently upgrade in place.
    let checkedHash = null;
    let checkedSlot = null;

    if (role === 'parent') {
      const { results } = await db.prepare('SELECT id, parent_name, notes, status FROM families').all();
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
          checkedHash = pw;
          recordId = f.id;
          recordFullName = f.parent_name || null;
          recordStatus = f.status;
          break;
        }
      }
    } else {
      // manager / teacher: credentials live on the teachers table.
      const { results } = await db.prepare('SELECT id, full_name, address, notes, status FROM teachers').all();
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
          checkedHash = pw;
          checkedSlot = meta.password ? 'address' : (acc.password ? 'teacher_account' : 'notes');
          // For manager role, require the record to actually be a manager.
          if (role === 'manager') {
            const empType = String(t.employee_type || meta.employee_type || meta.role || '').toLowerCase();
            const codeIds = [t.id, t.witness_name, meta.emp_id].map((s) => String(s || '').toUpperCase());
            const isManager = empType === 'manager' || codeIds.some((c) => c.startsWith('MGR-'));
            if (!isManager) continue;
          }
          recordId = t.id;
          recordFullName = t.full_name || null;
          recordStatus = t.status;
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
        // error. No throttle recording here: 'no_password_set' is not a
        // failed password guess, and recording it would let anyone lock
        // an unset-password account by knocking on it. (The IP counter
        // still counts the attempt: it measures failed logins from that
        // IP, and the attacker only hurts their own IP.) If that IP
        // record trips the IP block, the trip wins over the distinct
        // message, exactly as on the generic path.
        const ipResult = await recordThrottleFailure(db, env, 'ip', ip, THROTTLE_IP_THRESHOLD, false);
        if (ipResult.locked) return throttleLockResponse(request, env, ipResult.retryAfterSec);
        return json(request, env, { ok: false, error: 'no_password_set' }, 401);
      }
      // Identical message for every other failure: no enumeration. A
      // dummy verification runs so an unknown identifier costs roughly
      // what a wrong password costs (see dummyPasswordVerify). A lock
      // trips on the attempt that reaches the threshold (same as the
      // old limiter), so the response is 429 right away.
      await dummyPasswordVerify(password);
      const ipResult = await recordThrottleFailure(db, env, 'ip', ip, THROTTLE_IP_THRESHOLD, false);
      if (ipResult.locked) return throttleLockResponse(request, env, ipResult.retryAfterSec);
      const accResult = await recordThrottleFailure(db, env, 'account', throttleAccountKey(role, identifier), THROTTLE_ACCOUNT_THRESHOLD, true);
      if (accResult.locked) return throttleLockResponse(request, env, accResult.retryAfterSec);
      return json(request, env, { ok: false, error: 'Invalid username or password.' }, 401);
    }

    // Audit P1-1: a deactivated account cannot obtain a fresh session,
    // even with a correct password. No throttle state is touched here:
    // this is not a failed guess, and the account stays unusable until
    // reactivated. Portals map 'account_deactivated' to a plain-language
    // message; the owner env-credential path is untouched (it has no D1
    // row and never reaches this function).
    if (recordId && recordStatus != null) {
      const table = role === 'parent' ? 'families' : 'teachers';
      if (accountStatusIsInactive(table, recordStatus)) {
        return json(request, env, { ok: false, error: 'account_deactivated' }, 401);
      }
    }

    // Success resets the account counter (the IP counter is untouched).
    await resetThrottleRow(db, env, 'account', throttleAccountKey(role, identifier));

    // Batch 7A: transparent upgrade — a login that verified against an
    // older hash format re-hashes to PBKDF2 in the SAME slot that was
    // checked (never a different slot, never a dropped sibling key). A
    // failed upgrade write never fails the login; the next login retries.
    // The owner env credential is NEVER upgraded here (no D1 row exists
    // for it — see the PR body for the env-side migration).
    if (checkedHash && !isPbkdf2Password(checkedHash)) {
      try {
        const upgraded = await hashPassword(password);
        if (role === 'parent') {
          const famRow = await db.prepare('SELECT notes FROM families WHERE id = ?').bind(recordId).first();
          if (famRow) await writeParentPasswordSlot(db, recordId, parseJsonField(famRow.notes), upgraded);
        } else {
          const tRow = await db.prepare('SELECT address, notes FROM teachers WHERE id = ?').bind(recordId).first();
          if (tRow) await writeTeacherPasswordSlot(db, recordId, parseJsonField(tRow.address), parseJsonField(tRow.notes), upgraded, checkedSlot || 'address');
        }
      } catch (e) { console.error('[auth] password upgrade failed (login unaffected):', e); }
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

// --- Batch 7A: password-slot writers (shared by set-password and the
// login-time transparent upgrade) ------------------------------------------
// Writes a fresh hash into the canonical slot, preserving every other
// key of the stored JSON (a full-row JSON rewrite must never drop
// sibling fields). Parent: families.notes.portal_credentials.password.
// Teacher/manager: the slot staff-login checks first for that record:
// 'address' (address.password), 'teacher_account'
// (address.teacher_account.password), or 'notes' (notes.password).
async function writeParentPasswordSlot(db, familyId, notes, hashed) {
  const pc = parseJsonField(notes && notes.portal_credentials);
  const updated = { ...(notes || {}), portal_credentials: { ...pc, password: hashed } };
  await db.prepare('UPDATE families SET notes = ? WHERE id = ?').bind(JSON.stringify(updated), familyId).run();
}

async function writeTeacherPasswordSlot(db, teacherId, address, notesMeta, hashed, slot) {
  if (slot === 'notes') {
    const updated = { ...(notesMeta || {}), password: hashed };
    await db.prepare('UPDATE teachers SET notes = ? WHERE id = ?').bind(JSON.stringify(updated), teacherId).run();
    return;
  }
  const meta = { ...(address || {}) };
  if (slot === 'teacher_account') {
    const acc = parseJsonField(meta.teacher_account);
    meta.teacher_account = { ...acc, password: hashed };
  } else {
    meta.password = hashed;
  }
  await db.prepare('UPDATE teachers SET address = ? WHERE id = ?').bind(JSON.stringify(meta), teacherId).run();
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
  const dbPre = getDb(env);
  if (dbPre) {
    // D1 set-password throttle (see the throttle policy note): the IP
    // block from login failures also applies here. Batch 3.4 (audit
    // P2-7): only FAILED set-password calls count toward the per-IP
    // allowance — counting successes too locked out legitimate bulk
    // migrations (the 31st set in 15 minutes tripped even when every
    // prior set succeeded). A lock trips on the failing attempt that
    // reaches the threshold, as before.
    const setpwLock = await getThrottleLock(dbPre, env, 'setpw', ip);
    if (setpwLock.locked) return throttleLockResponse(request, env, setpwLock.retryAfterSec);
  } else if (loginRateLimited(ip)) {
    return json(request, env, { ok: false, error: 'Too many attempts. Please try again later.' }, 429);
  }
  // Records one set-password failure (see above); if that failure trips
  // the lock, the 429 replaces the original error. Successful sets
  // never call this. With no DB binding there is nothing to record.
  const recordSetpwFailure = async (resp) => {
    if (!dbPre) return resp;
    const r = await recordThrottleFailure(dbPre, env, 'setpw', ip, THROTTLE_SETPW_THRESHOLD, false);
    if (r.locked) return throttleLockResponse(request, env, r.retryAfterSec);
    return resp;
  };

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Invalid request body.' }, 400));
  }

  const role = String((body && body.role) || '').toLowerCase();
  const identifier = String((body && body.identifier) || '').trim().toLowerCase();
  const newPassword = String((body && body.newPassword) || '');

  if (!['manager', 'teacher', 'parent'].includes(role) || !identifier) {
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Invalid request.' }, 400));
  }
  // Batch 2: a manager caller may set TEACHER or PARENT passwords only.
  // Manager-account passwords remain owner-only.
  if (auth.role === 'manager' && role !== 'teacher' && role !== 'parent') {
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Access denied.' }, 403));
  }
  if (!isStrongPassword(newPassword)) {
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Password must be at least 10 characters and must not be a default password.' }, 400));
  }

  const db = getDb(env);
  if (!db) {
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503));
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
        await writeParentPasswordSlot(db, f.id, notes, hashed);
        // Batch 7A: a password change invalidates all earlier tokens of
        // this subject immediately (previously they lived until expiry).
        await bumpSubjectMarker(db, env, f.id, 'password_reset');
        return json(request, env, { ok: true, id: f.id });
      }
      return recordSetpwFailure(json(request, env, { ok: false, error: 'Account not found.' }, 404));
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
      await writeTeacherPasswordSlot(db, t.id, meta, notesMeta, hashed, 'address');
      // Batch 7A: a password change invalidates all earlier tokens of
      // this subject immediately (previously they lived until expiry).
      await bumpSubjectMarker(db, env, t.id, 'password_reset');
      return json(request, env, { ok: true, id: t.id });
    }
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Account not found.' }, 404));
  } catch (e) {
    console.error('[auth] set-password failed:', e);
    return recordSetpwFailure(json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503));
  }
}

// --- POST /api/auth/logout ---------------------------------------------------
// Revokes the PRESENTED token (single-token logout). Idempotent by
// design: a request with a Bearer token always answers { ok: true }
// (the frontend proceeds with local logout regardless), and only a
// signature-valid token is recorded — garbage tokens are a harmless
// no-op, never an error the UI must surface. No Bearer token → 401.
async function handleLogout(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }
  const header = (request.headers.get('authorization') || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return json(request, env, { ok: false, error: 'Authentication required.' }, 401);
  const db = getDb(env);
  if (db) {
    let expiresAt = null;
    try {
      const payload = await verifySessionToken(m[1], env.WORKER_AUTH_SECRET);
      if (payload && typeof payload.exp === 'number') expiresAt = payload.exp;
    } catch (e) {}
    if (expiresAt !== null) await revokeToken(db, env, m[1], expiresAt);
  }
  return json(request, env, { ok: true });
}

// --- POST /api/auth/unlock  { kind, role, identifier } -----------------------
// Owner-only. Clears throttle rows so a locked account (or a blocked IP)
// can log in again before its lock expires. kind: 'account' (role +
// identifier, exactly as used at login) or 'ip' (identifier is the IP
// address). The response is ALWAYS { ok: true } whether or not rows
// existed — revealing existence would let anyone probe for locked
// accounts. A manager can NEVER unlock anyone (403): otherwise the lock
// itself becomes a bypass.
// NOTE: this endpoint takes the login identifier, not a subject id,
// because throttle keys are HMACs of that identifier. If the owner does
// not know the exact identifier, the emergency path is
// WORKER_AUTH_SECRET rotation (SECURITY-SETUP.md).
async function handleUnlock(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }
  const auth = await requireApiAuth(request, env);
  if (!auth || auth.role !== 'owner') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }
  let body;
  try { body = await request.json(); } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  const kind = String((body && body.kind) || '').toLowerCase();
  const role = String((body && body.role) || '').toLowerCase();
  const identifier = String((body && body.identifier) || '').trim();
  const db = getDb(env);
  if (db && identifier) {
    if (kind === 'account' && ['owner', 'manager', 'teacher', 'parent'].includes(role)) {
      await resetThrottleRow(db, env, 'account', throttleAccountKey(role, identifier));
    } else if (kind === 'ip') {
      await resetThrottleRow(db, env, 'ip', identifier);
    }
  }
  return json(request, env, { ok: true });
}

// --- POST /api/auth/sign-out-everywhere  { subject } -------------------------
// Owner-only. Bumps the per-subject valid-after marker to now, so every
// token issued before this call stops working (within the 60-second
// cache bound across isolates; immediately in this isolate). subject is
// a token sub: a teacher/manager row id, a family id, or the owner
// username. If the owner signs out their own username, their own current
// session ends too — that is the point; they log in again afterwards.
async function handleSignOutEverywhere(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }
  const auth = await requireApiAuth(request, env);
  if (!auth || auth.role !== 'owner') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }
  let body;
  try { body = await request.json(); } catch (e) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  const subject = String((body && body.subject) || '').trim();
  if (!subject) {
    return json(request, env, { ok: false, error: 'Invalid request.' }, 400);
  }
  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Authentication service unavailable.' }, 503);
  }
  await bumpSubjectMarker(db, env, subject, 'sign_out_everywhere');
  return json(request, env, { ok: true });
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
  if (await emailSendLimited(getDb(env), env, rlKey)) {
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
  if (await emailSendLimited(getDb(env), env, rlKey)) {
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

  // Batch 3.4 (audit P2-2): the D1-backed limiters below need the
  // binding, so the no-DB 503 moves up here (same outcome as before,
  // just earlier — the endpoint cannot work without D1 anyway).
  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }

  if (await emailSendLimited(db, env, 'teacher-email:' + String(auth.sub)) ||
      await emailSendLimited(db, env, 'teacher-email-ip:' + clientIp(request))) {
    return json(request, env, { ok: false, error: 'Too many emails. Please try again later.' }, 429);
  }
  if (await teacherEmailDailyLimited(db, env, auth.sub)) {
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
  // Batch 3.4 (audit P2-6): the confirmation states the class "has been
  // successfully conducted in advance" — it must never be sendable for
  // a student/date with no advance lesson on file. An advance lesson is
  // an attendance_logs row for this teacher + student with status
  // 'Advance Class' or the is_advance_class payload flag; when the row
  // carries an advance_target_date it must equal the requested
  // scheduledDate. Rows without a parseable target date (legacy saves)
  // pass on the status/flag alone, so old records are not stranded.
  let advanceOk = false;
  try {
    const { results: advRows } = await db.prepare(`SELECT status, lesson_notes FROM attendance_logs WHERE teacher_id = ? AND student_id = ? AND (status = 'Advance Class' OR lesson_notes LIKE '%is_advance_class%')`).bind(auth.sub, studentId).all();
    for (const r of (advRows || [])) {
      const notesStr = String(r.lesson_notes || '');
      const isAdv = String(r.status || '') === 'Advance Class' || /"is_advance_class"\s*:\s*true/.test(notesStr);
      if (!isAdv) continue;
      let target = null;
      try {
        const parsed = JSON.parse(notesStr);
        if (parsed && typeof parsed === 'object') target = parsed.advance_target_date || null;
      } catch (e) { /* unparseable notes: status/flag alone suffices */ }
      if (target == null || String(target) === scheduledDate) { advanceOk = true; break; }
    }
  } catch (e) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (!advanceOk) {
    return json(request, env, { ok: false, error: 'No advance class record found for this student and date. Save the advance lesson first, then send the confirmation.' }, 422);
  }

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
  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (await dupCheckLimited(db, env, rlKey)) {
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

// --- Batch 7A: server-side session revocation --------------------------------
// Two mechanisms, both enforced in requireApiAuth below:
//   (a) Single-token logout: POST /api/auth/logout inserts SHA-256 of the
//       presented token into auth_revoked_tokens. The token itself is
//       never stored. This check is NOT cached: it is one indexed D1
//       lookup per authenticated request, so a logout takes effect on
//       the very next request in every isolate.
//   (b) Per-subject valid-after marker: auth_subject_valid_after holds
//       one row per subject (HMAC of the token sub). Tokens with iat
//       earlier than the marker are rejected. The marker is bumped on
//       password set/reset, deactivation/deletion (via the db engine),
//       and owner "sign out everywhere". Because iat has 1-second
//       granularity, the comparison is STRICT (iat < valid_after): a
//       token minted in the exact second of the marker still passes, so
//       a reset-then-immediately-login flow is never broken by its own
//       marker; the residual window is at most 1 second.
//   Cache: the marker lookup is cached per isolate for 60 seconds
//   (VALID_AFTER_CACHE_TTL_MS) to bound D1 reads on hot paths. MAXIMUM
//   revocation delay for marker-based revocation is therefore 60 seconds
//   across isolates; single-token logout has no such delay. The cache
//   entry for a subject is deleted whenever THIS isolate writes that
//   subject's marker (read-your-write within the isolate), and the
//   user-visible logout effect is immediate regardless: the portals
//   wipe all local state on logout before any server round trip could
//   matter. A 60-second bounded tail is acceptable because the token
//   itself still expires within 8 hours, the attacker would need the
//   exact token string, and every other gate (role, scope, masks) still
//   applies during the tail.
//   Missing-table tolerance: if the auth tables do not exist yet (a
//   cold isolate that has never served /api/db since this deploy),
//   reads treat the state as empty — which is CORRECT, not fail-open:
//   no revocation could have been recorded in a table that does not
//   exist. Writes create the tables first (ensureAuthTables).
//   Batch 3.4 (audit P2-1) precision: this tolerance applies ONLY to a
//   genuinely missing table ("no such table"). Any other D1 error
//   during a revocation/marker/status/throttle read fails CLOSED
//   (deny) — see isMissingTableError and the requireApiAuth gates.
const VALID_AFTER_CACHE = new Map();
const VALID_AFTER_CACHE_TTL_MS = 60 * 1000;

async function getValidAfter(db, env, sub) {
  const subjectHash = await throttleKeyHash(env, String(sub));
  if (!subjectHash) return null;
  const hit = VALID_AFTER_CACHE.get(subjectHash);
  if (hit && Date.now() - hit.cachedAtMs < VALID_AFTER_CACHE_TTL_MS) return hit.validAfter;
  let validAfter = null;
  try {
    const row = await db.prepare('SELECT valid_after FROM auth_subject_valid_after WHERE subject_hash = ?').bind(subjectHash).first();
    validAfter = row ? Number(row.valid_after) : null;
  } catch (e) {
    // Batch 3.4 (audit P2-1): a missing table means no marker could
    // exist (correctly null); any other D1 error is rethrown so the
    // caller fails CLOSED instead of caching a false "no marker".
    if (!isMissingTableError(e)) throw e;
    validAfter = null;
  }
  VALID_AFTER_CACHE.set(subjectHash, { validAfter, cachedAtMs: Date.now() });
  return validAfter;
}

async function clearValidAfterCache(env, sub) {
  const subjectHash = await throttleKeyHash(env, String(sub));
  if (subjectHash) VALID_AFTER_CACHE.delete(subjectHash);
}

async function bumpSubjectMarker(db, env, subjectId, reason) {
  // Worker-side marker write (set-password, sign-out-everywhere). The
  // db engine has its own equivalent for deactivation/deletion bumps.
  await ensureAuthTables(db);
  const subjectHash = await throttleKeyHash(env, String(subjectId));
  if (!subjectHash) return;
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await db.prepare('INSERT INTO auth_subject_valid_after (subject_hash, valid_after, reason, updated_at) VALUES (?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET valid_after = excluded.valid_after, reason = excluded.reason, updated_at = excluded.updated_at').bind(subjectHash, nowSec, reason, new Date().toISOString()).run();
  } catch (e) {}
  VALID_AFTER_CACHE.delete(subjectHash);
}

async function revokeToken(db, env, token, expiresAtSec) {
  await ensureAuthTables(db);
  const tokenHash = await sha256Hex(token);
  try {
    await db.prepare('INSERT OR IGNORE INTO auth_revoked_tokens (token_hash, expires_at, created_at) VALUES (?,?,?)').bind(tokenHash, expiresAtSec || null, new Date().toISOString()).run();
  } catch (e) {}
  // Opportunistic purge of expired revocation rows.
  try {
    await db.prepare('DELETE FROM auth_revoked_tokens WHERE expires_at IS NOT NULL AND expires_at < ?').bind(Math.floor(Date.now() / 1000)).run();
  } catch (e) {}
}

// --- Audit P1-1: account-status gate ----------------------------------------
// A deactivated family/teacher/manager account must not obtain a fresh
// session, and a token minted before deactivation must stop working even
// when its marker check passes (e.g. the same-second mint window). Status
// values mirror the db engine's ACCOUNT_INACTIVE_STATUSES
// (functions/api/db.js): families inactive/deactivated, teachers
// inactive/terminated/deactivated. Anything else (including a missing or
// empty status) counts as ACTIVE, matching the engine's derivation.
// Only a positive inactive read denies; a missing row or a lookup error
// allows — the same missing-table tolerance as the marker check, and
// test fixtures use synthetic subjects without rows. The lookup is cached
// per isolate for 60 seconds, the same bound as the marker cache, so the
// maximum cross-isolate delay for a deactivation to take effect here is
// 60 seconds (the marker itself usually kills the token sooner).
const ACCOUNT_INACTIVE_STATUSES_WORKER = {
  families: new Set(['inactive', 'deactivated']),
  teachers: new Set(['inactive', 'terminated', 'deactivated']),
};
function accountStatusIsInactive(table, status) {
  const set = ACCOUNT_INACTIVE_STATUSES_WORKER[table];
  if (!set) return false;
  return set.has(String(status == null ? '' : status).trim().toLowerCase());
}
const ACCOUNT_STATUS_CACHE = new Map();
const ACCOUNT_STATUS_CACHE_TTL_MS = 60 * 1000;
async function isAccountDeactivated(db, env, role, sub) {
  const table = role === 'parent' ? 'families' : 'teachers';
  const cacheKey = role + ':' + String(sub);
  const hit = ACCOUNT_STATUS_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.cachedAtMs < ACCOUNT_STATUS_CACHE_TTL_MS) return hit.inactive;
  let inactive = false;
  try {
    const row = await db.prepare(`SELECT status FROM ${table} WHERE id = ?`).bind(String(sub)).first();
    inactive = !!(row && accountStatusIsInactive(table, row.status));
  } catch (e) {
    // Batch 3.4 (audit P2-1): same rule as the marker check — a missing
    // table is correctly "not deactivated"; any other D1 error is
    // rethrown so the caller fails CLOSED instead of caching "active".
    if (!isMissingTableError(e)) throw e;
    inactive = false;
  }
  ACCOUNT_STATUS_CACHE.set(cacheKey, { inactive, cachedAtMs: Date.now() });
  return inactive;
}
async function clearAccountStatusCache(role, sub) {
  ACCOUNT_STATUS_CACHE.delete(role + ':' + String(sub));
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
  // Batch 7A revocation gates (see the module note above). At most two
  // indexed D1 lookups: the revoked-token check (never cached) and the
  // per-subject marker check (cached 60 s per isolate).
  // Batch 3.4 (audit P2-1): every gate below fails CLOSED on a D1 error
  // that is not a genuinely missing table. A missing table still means
  // "no revocation could have been recorded" (correct, not fail-open);
  // any other error denies the request — including for /api/email/send,
  // which needs no D1 itself but must still respect revocation during
  // a D1 error window. When there is no DB binding at all (db === null),
  // the gates are skipped as before: no revocation state can exist
  // without a database, production always binds DB (wrangler.toml), and
  // the email relay is deliberately designed to work without D1.
  const db = getDb(env);
  if (db) {
    try {
      const tokenHash = await sha256Hex(m[1]);
      const revoked = await db.prepare('SELECT token_hash FROM auth_revoked_tokens WHERE token_hash = ?').bind(tokenHash).first();
      if (revoked) return null;
    } catch (e) { if (!isMissingTableError(e)) return null; }
    try {
      const validAfter = await getValidAfter(db, env, payload.sub);
      if (validAfter !== null && Number(payload.iat) < validAfter) return null;
    } catch (e) { if (!isMissingTableError(e)) return null; }
    // Audit P1-1: status gate for STAFF accounts only (manager/teacher).
    // The marker above kills tokens that predate a deactivation in the
    // common case; this closes the residual same-second window and any
    // path where the marker was missed. The owner env credential has no
    // D1 row and is never gated here. Parents are deliberately EXEMPT:
    // Batch 7 established that a deactivated family's parent keeps
    // notes-only access (the leave flow), with reactivation still
    // blocked by the engine guard — denying all parent API access here
    // would break that flow. A deactivated family's fresh parent logins
    // are still refused by the handleStaffLogin gate, and pre-existing
    // parent tokens are still ended by the marker above.
    if (payload.role === 'manager' || payload.role === 'teacher') {
      try {
        if (await isAccountDeactivated(db, env, payload.role, payload.sub)) return null;
      } catch (e) { if (!isMissingTableError(e)) return null; }
    }
  }
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
  // them with a reason instead. Salary-advance requests are
  // financial-adjacent records with the same rule: a decided request is
  // terminal history, never erased. This runs before the owner allow-all.
  if (action === 'delete' && ['payments', 'salary_slips', 'salary_adjustments', 'advance_requests'].includes(table)) return 'deny';
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
    // Salary-advance workflow: managers READ requests (their own portal's
    // Requests area) but must decide ONLY through POST /api/advances/decide,
    // where the transaction is created atomically with the decision. A raw
    // /api/db write that flipped a request to Approved would create no
    // salary record, so manager writes on this table are denied here.
    if (table === 'advance_requests') return action === 'select' ? 'allow' : 'deny';
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
      case 'system_settings':
        // URGENT FIX (Issue 2): teachers may SELECT course-catalog settings
        // rows only — the key filter lives in rowInScope
        // (isTeacherReadableSettingsKey). Every teacher write to
        // system_settings stays denied, as do all other keys.
        return action === 'select' ? 'allow' : 'deny';
      case 'salary_slips':
      case 'salary_adjustments':
        // Batch 6B: teachers may read their OWN salary rows only — row
        // ownership is enforced in applyDbScope/rowInScope (teacher_id).
        return action === 'select' ? 'allow' : 'deny';
      case 'advance_requests':
        // Salary-advance workflow: teachers READ their own requests only
        // (the Salary section's request list). Creation and decisions go
        // through POST /api/advances/*, where amounts are computed and
        // validated server-side — never through a raw /api/db write.
        return action === 'select' ? 'allow' : 'deny';
      default:
        return 'deny'; // families, payments
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
      case 'system_settings':
        // Lesson History page links: parents may SELECT course-catalog
        // settings rows only — the key filter lives in rowInScope
        // (isParentReadableSettingsKey). Without this, parent devices
        // can never hydrate custom books and open the wrong book.
        // Every parent write to system_settings stays denied, as do
        // all other keys (logo, tombstone, anything else).
        return action === 'select' ? 'allow' : 'deny';
      default:
        return 'deny'; // system_settings (non-catalog, non-flag keys), salary_slips, salary_adjustments (Batch 6B: parents have no salary access)
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

// Batch 3.1 (audit P1-5): the three finance read-switch flags. These keys
// carry only 'off' / 'compare' / 'on' — no contacts, notes, credentials,
// or financial values — so restricted roles may READ them (per-row, via
// the predicates below) to evaluate their own read switches. Without this,
// a parent/manager/teacher read of a flag row is silently dropped and the
// switch can never take effect for that role. WRITES are untouched:
// parents/teachers may never write system_settings (checkTableAccess) and
// manager writes stay catalog-gated (applyManagerWriteGuards).
function isFeeReadFlagKey(key) {
  const k = String(key || '');
  return k === 'fee_read_parent' || k === 'fee_read_360' || k === 'salary_read_v1';
}

// system_settings keys a manager may read/write: the course catalog itself
// (S13) plus the logo on read (rowInScope handles the logo separately).
function isCatalogSettingsKey(key) {
  const k = String(key || '');
  return k === 'alhuda_custom_books' || k === 'alhuda_custom_books_index' || k.startsWith('BOOK_PAGE_');
}

// Batch 6B: keys a manager may READ in system_settings = the catalog keys
// above + the shared logo + the fee_tables_v1 dual-write flag (portals
// must read the flag inside manager sessions too). Batch 3.1: + the three
// finance read-switch flags, so the 360/salary switches can take effect
// for managers too. WRITES stay catalog-only: applyManagerWriteGuards
// adjudicates them with isCatalogSettingsKey, which deliberately does NOT
// include the flags or the logo — toggling the flags is owner-only.
function isManagerReadableSettingsKey(key) {
  const k = String(key || '');
  return isCatalogSettingsKey(k) || k === 'alhuda_logo' || k === 'fee_tables_v1' || isFeeReadFlagKey(k);
}

// URGENT FIX (Issue 2): keys a teacher may READ in system_settings = the
// course-catalog keys + the deleted-books tombstone, so the teacher
// portal's catalog hydrate converges with the admin portal's (before this,
// the teacher select was denied outright and the portal silently fell back
// to a per-browser local mirror). Batch 3.1: + the finance read-switch
// flags, so a teacher can evaluate salary_read_v1 for the 6D-3 salary read
// switch. WRITES stay denied in checkTableAccess, and every other key
// stays denied via rowInScope. This read exposes no contacts, notes,
// flags beyond the three switch values, or credentials — catalog rows,
// the tombstone, and the switch values only.
function isTeacherReadableSettingsKey(key) {
  const k = String(key || '');
  return isCatalogSettingsKey(k) || k === 'alhuda_deleted_books' || isFeeReadFlagKey(k);
}

// Lesson History page links: keys a parent may READ in system_settings =
// the course-catalog keys ONLY (custom books index + BOOK_PAGE_* rows).
// Batch 3.1 (audit P1-5): + the three finance read-switch flags, so a
// parent can observe fee_read_parent='on' and the payments-table fee
// history renders. Deliberately NOT the tombstone or logo — those stay
// denied for parents, exactly as before. WRITES stay denied in
// checkTableAccess.
function isParentReadableSettingsKey(key) {
  return isCatalogSettingsKey(key) || isFeeReadFlagKey(key);
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

// Audit P1-4: manager 360 sub-record delete guard. The six 360 delete
// buttons (teacher deduction/leave/document, family manager/teacher
// note, student certificate) are notes/address-JSON UPDATEs, not
// DELETEs, so the "no hard deletes" deny-list never saw them. This guard
// diffs the submitted JSON field against the stored row and:
//   - DENIES an update/upsert that drops an entry from a protected list
//     (by entry id, or by deep equality for id-less entries). Adding
//     entries, editing an entry in place, and editing any other field
//     still pass — legitimate manager notes edits are untouched.
//   - RESTORES a protected list the submitted JSON omits entirely while
//     the stored row still has it. A partial notes patch must never
//     silently wipe a list the manager never meant to touch (this also
//     mirrors the existing masked-contact restore in guard (c)).
//   - DENIES a plain-string field value that would replace stored
//     structured JSON holding protected lists (a whole-column wipe).
// Scope is deliberately the audit-listed lists only: teachers.address
// (deduction_records, leave_records, documents — 360 saves persist
// there, not in notes), families.notes (manager_notes, teacher_notes),
// students.notes (certificates). Owner writes are never guarded here.
// When target ids cannot be determined the guard allows (same posture
// as guard (c)'s first-row-only merge); the listed 360 saves always
// carry an id filter.
const MANAGER_PROTECTED_LISTS = {
  teachers: { field: 'address', keys: ['deduction_records', 'leave_records', 'documents'] },
  families: { field: 'notes', keys: ['manager_notes', 'teacher_notes'] },
  students: { field: 'notes', keys: ['certificates'] },
};
const MANAGER_LIST_DELETE_DENY = 'Managers cannot delete official records. Ask the owner to remove this entry.';
function managerListEntriesMissing(oldList, newList) {
  if (!Array.isArray(oldList) || oldList.length === 0) return false;
  if (!Array.isArray(newList)) return true;
  const newById = new Map();
  const newWithoutId = [];
  for (const e of newList) {
    if (e && typeof e === 'object' && e.id != null) newById.set(String(e.id), e);
    else newWithoutId.push(e);
  }
  for (const old of oldList) {
    if (old && typeof old === 'object' && old.id != null) {
      if (!newById.has(String(old.id))) return true;
    } else {
      const oldJson = JSON.stringify(old);
      if (!newWithoutId.some((e) => JSON.stringify(e) === oldJson)) return true;
    }
  }
  return false;
}
function managerListGuardDiffRow(spec, storedRaw, submittedRaw) {
  // Returns 'allow', 'deny', or { restored: <field value> }.
  const stored = parseJsonObjectValue(storedRaw);
  if (!stored) return 'allow'; // stored field is not structured JSON: nothing to protect
  const hasProtected = spec.keys.some((k) => Array.isArray(stored[k]) && stored[k].length > 0);
  if (!hasProtected) return 'allow';
  if (submittedRaw == null) return 'allow'; // patch does not touch the field
  const submitted = parseJsonObjectValue(submittedRaw);
  if (!submitted) return 'deny'; // plain-string value would wipe the structured lists
  let restored = false;
  for (const key of spec.keys) {
    const oldList = stored[key];
    if (!Array.isArray(oldList) || oldList.length === 0) continue;
    if (!(key in submitted)) {
      submitted[key] = oldList;
      restored = true;
      continue;
    }
    if (managerListEntriesMissing(oldList, submitted[key])) return 'deny';
  }
  if (!restored) return 'allow';
  return { restored: (typeof submittedRaw === 'string') ? JSON.stringify(submitted) : submitted };
}
async function managerNotesListGuard(db, table, action, body) {
  const spec = MANAGER_PROTECTED_LISTS[table];
  if (!spec || !db) return true;
  if (action === 'update') {
    const ids = filterIdValues(Array.isArray(body.filters) ? body.filters : []);
    if (!ids.length) return true;
    const patch = (body.values && typeof body.values === 'object' && !Array.isArray(body.values)) ? body.values : null;
    if (!patch) return true;
    const currents = await loadRowsByIds(db, table, ids);
    for (const cur of currents) {
      const verdict = managerListGuardDiffRow(spec, cur[spec.field], patch[spec.field]);
      if (verdict === 'deny') return { deny: MANAGER_LIST_DELETE_DENY };
      if (verdict !== 'allow') patch[spec.field] = verdict.restored;
    }
    return true;
  }
  if (action === 'upsert') {
    const rows = Array.isArray(body.values) ? body.values : [body.values || {}];
    const ids = rows.map((r) => (r && r.id != null ? String(r.id) : null)).filter(Boolean);
    if (!ids.length) return true;
    const currents = await loadRowsByIds(db, table, ids);
    const byId = new Map(currents.map((c) => [String(c.id), c]));
    for (const row of rows) {
      if (!row || row.id == null) continue;
      const cur = byId.get(String(row.id));
      if (!cur) continue; // brand-new row: nothing to protect
      const verdict = managerListGuardDiffRow(spec, cur[spec.field], row[spec.field]);
      if (verdict === 'deny') return { deny: MANAGER_LIST_DELETE_DENY };
      if (verdict !== 'allow') row[spec.field] = verdict.restored;
    }
    return true;
  }
  return true;
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
      if (!rows.every((row) => !isManagerStaffRecord(row || {}))) return false;
      // Audit P1-4: an upsert that replaces an existing teacher row runs
      // the same list-shrinkage diff as an update (inserts are new rows).
      if (action === 'upsert') return managerNotesListGuard(db, 'teachers', action, body);
      return true;
    }
    if (action === 'update') {
      const ids = filterIdValues(filters);
      if (!ids.length) return false; // unverifiable target: deny
      const patch = body.values || {};
      // Batch 3.4 (audit P2-8): the hidden-slot restore below can only
      // restore from ONE stored row, so a credential-JSON patch aimed
      // at several rows would merge the first row's slots into all of
      // them (wrong-row merge / erasure for rows 2+). Multi-row
      // address/notes updates must be done one row at a time; the UI
      // never sends them (typical updates are single-row).
      if (patch && typeof patch === 'object' && !Array.isArray(patch) &&
          ('address' in patch || 'notes' in patch) && new Set(ids).size > 1) {
        return { deny: 'Updates to teacher notes or address must target a single record.' };
      }
      if (isManagerStaffRecord({ address: patch.address, employee_type: patch.employee_type })) return false;
      const targets = await loadRowsByIds(db, 'teachers', ids);
      if (targets.some((t) => isManagerStaffRecord(t))) return false;
      // Audit P1-4: 360 sub-record deletes arrive as notes/address-JSON
      // UPDATEs; the diff guard below denies list shrinkage.
      return managerNotesListGuard(db, 'teachers', action, body);
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
        // Batch 3.4 (audit P2-8): the notes merge below restores masked
        // contacts from ONE stored row; a notes patch aimed at several
        // rows would merge the first row's contacts into all of them.
        // Multi-row notes updates must be done one row at a time.
        const patchTouchesNotes = body.values && typeof body.values === 'object' && !Array.isArray(body.values) && ('notes' in body.values);
        if (patchTouchesNotes && new Set(ids).size > 1) {
          return { deny: 'Updates to notes must target a single record.' };
        }
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
    // Audit P1-4: after the mask merge above, diff the submitted notes
    // against stored notes and deny 360 sub-record deletions (families:
    // manager/teacher notes; students: certificates). Updates and
    // upserts both run the guard; inserts are new rows.
    if (action === 'update' || action === 'upsert') {
      return managerNotesListGuard(db, table, action, body);
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
    if (!vals || typeof vals !== 'object') return;
    const fields = table === 'families' ? ['notes'] : ['address', 'notes'];
    const restoreInto = (target, cur) => {
      for (const field of fields) {
        if (target[field] == null || cur[field] == null) continue;
        const sObj = parseJsonObjectValue(target[field]);
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
          target[field] = (typeof target[field] === 'string') ? JSON.stringify(sObj) : sObj;
        }
      }
    };
    // Batch 3.4 (audit P2-8): array-valued updates restore PER ELEMENT
    // (matched by the element's own id) instead of returning early —
    // the old early return left every array element unrestored. The
    // engine currently no-ops array-valued updates, so this is
    // defence-in-depth for the day that changes.
    if (Array.isArray(vals)) {
      const ids = filterIdValues(scopedBody.filters);
      const byId = new Map();
      if (ids.length) {
        for (const r of await loadRowsByIds(db, table, ids)) byId.set(String(r.id), r);
      }
      for (const el of vals) {
        if (!el || typeof el !== 'object' || el.id == null) continue;
        let cur = byId.get(String(el.id));
        if (!cur) {
          const rows = await loadRowsByIds(db, table, [String(el.id)]);
          cur = rows[0];
        }
        if (cur) restoreInto(el, cur);
      }
      return;
    }
    // Single-object updates: the manager guard above already denies a
    // credential-JSON patch aimed at several rows, so restoring from
    // the filter's first id is correct-by-construction here.
    const ids = filterIdValues(scopedBody.filters);
    if (!ids.length) return;
    const current = await loadRowsByIds(db, table, ids.slice(0, 1));
    if (!current.length) return;
    restoreInto(vals, current[0]);
  } catch (e) {
    // Never let the restore step break a legitimate update.
    console.warn('[scope] hidden-slot restore skipped:', e && e.message);
  }
}

// Audit P1-2: for teacher insert/upsert rows that carry an id, verify the
// id is either new or already owned by the caller (stored teacher_id =
// sub). Returns true when a foreign-owned id is supplied (caller must be
// denied). Rows without an id are unaffected: the engine generates a
// fresh id for them, so they can never collide. A missing db handle or a
// lookup error allows — the delegation itself would fail without a db,
// and this helper must never invent a denial.
async function teacherInsertOwnsIds(db, table, sub, values) {
  if (!db) return false;
  const rows = Array.isArray(values) ? values : [values || {}];
  const ids = [];
  for (const row of rows) {
    if (row && row.id != null && String(row.id) !== '') ids.push(String(row.id));
  }
  if (!ids.length) return false;
  try {
    const placeholders = ids.map(() => '?').join(', ');
    const { results } = await db.prepare(`SELECT id, teacher_id FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).all();
    for (const r of (results || [])) {
      if (String(r.teacher_id) !== String(sub)) return true;
    }
  } catch (e) { return false; }
  return false;
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
    } else if ((table === 'salary_slips' || table === 'salary_adjustments' || table === 'advance_requests') && action === 'select') {
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
      // Lesson History UNION scope (owner correction, 2026-10-28): a teacher
      // reading history sees logs they personally recorded (teacher_id =
      // sub) OR logs of students currently assigned to them (scope.studentIds
      // = assigned_teacher_id + class_schedules students, resolveScopeIds).
      // The old teacher does NOT lose their own logs on reassignment, and
      // the new teacher sees the shifted student's full past performance.
      // WRITES stay own-record only: update/insert/upsert are unchanged.
      if (action === 'select') {
        const assigned = Array.isArray(scope.studentIds) ? scope.studentIds : [];
        if (assigned.length > 0) {
          filters.push({ op: 'or', value: [eq('teacher_id', sub), inList('student_id', assigned)] });
        } else {
          filters.push(eq('teacher_id', sub));
        }
      } else if (action === 'update') {
        filters.push(eq('teacher_id', sub));
        scoped.values = forceTeacherValues(scoped.values, sub)[0];
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
      case 'system_settings':
        // Lesson History page links: catalog keys + finance read-switch
        // flags for parents.
        return isParentReadableSettingsKey(row.key);
      default: return false;
    }
  }
  if (role === 'teacher') {
    switch (table) {
      case 'students': return scope.studentIds.includes(String(row.id));
      case 'teachers': return String(row.id) === sub;
      case 'system_settings':
        // URGENT FIX (Issue 2): catalog keys + tombstone + finance
        // read-switch flags; all other keys (logo, anything else)
        // stay denied for teachers.
        return isTeacherReadableSettingsKey(row.key);
      case 'class_schedules':
      case 'leave_requests':
      case 'trial_students':
      case 'salary_slips':
      case 'salary_adjustments':
      case 'advance_requests': return String(row.teacher_id) === sub;
      case 'attendance_logs':
        // UNION scope (mirror of the SQL filter above): own recordings OR
        // rows of currently assigned students.
        return String(row.teacher_id) === sub || scope.studentIds.includes(String(row.student_id));
      default: return false;
    }
  }
  // Batch 2: managers may only ever receive course-catalog settings rows
  // (plus the shared logo, fee_tables_v1, and the finance read-switch
  // flags). All other keys are owner-only.
  if (role === 'manager' && table === 'system_settings') {
    return isManagerReadableSettingsKey(row.key);
  }
  // Batch 6B: a manager never receives salary rows that belong to a
  // manager account (including their own) — keyed on the real teacher_id
  // column, not on blob keys. scope.managerIds is resolved for every
  // manager request in resolveScopeIds; tolerate it being absent.
  // Salary-advance requests follow the same rule: a manager never sees
  // (and therefore never decides) a manager account's advance request.
  if (role === 'manager' && (table === 'salary_slips' || table === 'salary_adjustments' || table === 'advance_requests')) {
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
    // Batch 7 Part B: the Worker delegates in-process, so it stamps the
    // internal-invocation marker the engine guard requires (see
    // functions/api/db.js onRequest). A remote caller can never set it.
    return handleDbRequest({ ...ctx, __lmsInternal: true });
  }

  let body = null;
  try {
    body = await request.clone().json();
  } catch (e) {
    return handleDbRequest({ ...ctx, __lmsInternal: true });
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
  // Audit P1-2: a teacher INSERT/UPSERT that supplies the id of a row
  // owned by another teacher must not silently replace it (the engine's
  // INSERT OR REPLACE would delete the foreign row and insert the
  // caller's copy). Owner/manager flows are untouched: they keep
  // INSERT OR REPLACE semantics (admin re-saves, mirror sync under
  // owner/manager sessions). Parent inserts are already denied in
  // checkTableAccess, so no parent branch is needed here.
  if (role === 'teacher' && (action === 'insert' || action === 'upsert') &&
      (table === 'class_schedules' || table === 'attendance_logs' || table === 'leave_requests')) {
    if (await teacherInsertOwnsIds(db, table, sub, scopedBody.values)) {
      return json(request, env, { ok: false, error: 'You cannot overwrite another teacher\'s record.' }, 403);
    }
  }
  // Audit P2-22: a teacher schedule insert/upsert must name a student in
  // the teacher's own scope — the same scope resolveScopeIds grants for
  // reads (assigned_teacher_id OR an existing slot under this teacher).
  // The browser checks this too (submitTeacherAddScheduleSlot verifies
  // active + assigned before insert), but a direct /api/db caller could
  // otherwise schedule an unassigned student under their own teacher_id
  // (forceTeacherValues only stamps teacher_id, it never checks
  // student_id). Owner/manager flows are untouched: this branch is
  // teacher-only. A missing student_id fails closed, like the rest of
  // the teacher scope (an empty scope list denies rather than allows).
  // Attendance/leave inserts are deliberately NOT scoped here: P2-22 is
  // about scheduling, and the Lesson History UNION scope intentionally
  // lets teachers write/read shifted students' logs.
  if (role === 'teacher' && (action === 'insert' || action === 'upsert') && table === 'class_schedules') {
    const schedRows = Array.isArray(scopedBody.values) ? scopedBody.values : [scopedBody.values || {}];
    const allowedStudents = new Set((scope.studentIds || []).map(String));
    const outOfScope = schedRows.some((r) => !r || r.student_id == null || String(r.student_id) === '' || !allowedStudents.has(String(r.student_id)));
    if (outOfScope) {
      return json(request, env, { ok: false, error: 'You cannot schedule a student who is not assigned to you.' }, 403);
    }
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
    resp = await handleDbRequest({ request: scopedRequest, env, ctx, __lmsInternal: true });
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
  // Batch 7A: an update that deactivated families/teachers through this
  // path already bumped their markers inside the engine; clear this
  // isolate's cached markers for those subjects so the revocation is
  // read-your-write here (other isolates still see it within the 60 s
  // cache bound; deletes carry no rows in the response, so they rely on
  // the bound alone).
  if (payload && !payload.error && (table === 'families' || table === 'teachers') && action === 'update' && payload.data != null) {
    const updatedRows = Array.isArray(payload.data) ? payload.data : [payload.data];
    for (const row of updatedRows) {
      if (row && row.id && row.status != null) {
        const st = String(row.status).trim().toLowerCase();
        if (st === 'inactive' || st === 'terminated' || st === 'deactivated') {
          try { await clearValidAfterCache(env, String(row.id)); } catch (e) {}
        }
      }
      // Audit P1-1: also drop this isolate's cached account-status entry
      // for the updated subject, so a deactivation (or a reactivation)
      // is read-your-write here instead of waiting out the 60 s cache.
      // A teachers row may back a teacher token or a manager token, so
      // both keys are cleared; a families row backs a parent token.
      if (row && row.id) {
        try {
          if (table === 'families') await clearAccountStatusCache('parent', String(row.id));
          else {
            await clearAccountStatusCache('teacher', String(row.id));
            await clearAccountStatusCache('manager', String(row.id));
          }
        } catch (e) {}
      }
    }
  }
  // Batch 7A, deletes: the engine bumped the markers, but the delete
  // response carries no rows, so recover the ids from the request's own
  // id filters and clear this isolate's cached markers for them. (The
  // 60-second bound still applies to OTHER isolates.)
  if (payload && !payload.error && (table === 'families' || table === 'teachers') && action === 'delete' && body && Array.isArray(body.filters)) {
    for (const f of body.filters) {
      if (f && f.column === 'id' && f.op === 'eq' && f.value != null) {
        try { await clearValidAfterCache(env, String(f.value)); } catch (e) {}
      }
    }
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

// Lesson History: is this R2 key the image_key of an attendance_logs row
// the caller is allowed to see? Parent = own family's rows; teacher = UNION
// scope (own recordings OR currently assigned students' rows). The check
// is a server-side D1 lookup on the record -- never trust in the key itself
// (no key-guessing: an unrelated key, even a well-formed one, stays 403).
// Returns false (fail closed) when D1 is unavailable.
async function isLessonImageKeyReadable(db, role, sub, key) {
  if (!db || !key) return false;
  try {
    let rows = [];
    if (role === 'parent') {
      const res = await db.prepare(
        'SELECT lesson_notes FROM attendance_logs WHERE student_id IN (SELECT id FROM students WHERE family_id = ?)'
      ).bind(sub).all();
      rows = res.results || [];
    } else if (role === 'teacher') {
      const scope = await resolveScopeIds(db, 'teacher', sub);
      const assigned = Array.isArray(scope.studentIds) ? scope.studentIds : [];
      const own = await db.prepare(
        'SELECT lesson_notes FROM attendance_logs WHERE teacher_id = ?'
      ).bind(sub).all();
      rows = own.results || [];
      if (assigned.length > 0) {
        const placeholders = assigned.map(() => '?').join(', ');
        const res = await db.prepare(
          `SELECT lesson_notes FROM attendance_logs WHERE student_id IN (${placeholders})`
        ).bind(...assigned).all();
        rows = rows.concat(res.results || []);
      }
    } else {
      return false;
    }
    for (const r of rows) {
      const notes = r && r.lesson_notes;
      if (!notes) continue;
      try {
        const parsed = typeof notes === 'string' ? JSON.parse(notes) : notes;
        if (parsed && parsed.image_key === key) return true;
      } catch (e) {}
      if (typeof notes === 'string' && notes.includes(key)) return true;
    }
    return false;
  } catch (e) {
    console.error('[storage] lesson-image scope check failed:', e);
    return false;
  }
}

async function handleScopedStorageRequest(ctx, auth) {
  const { request, env } = ctx;
  const role = auth.role;
  const sub = String(auth.sub || '');
  const restricted = role === 'teacher' || role === 'parent';
  const url = new URL(request.url);

  // Status probe (?key absent) â pass through.
  if (request.method === 'GET' && !url.searchParams.get('key')) {
    // Batch 7 Part B: internal-invocation marker, as for /api/db (see
    // functions/api/storage.js onRequest). A remote caller can never set it.
    return handleStorageRequest({ ...ctx, __lmsInternal: true });
  }

  if (!restricted) {
    return handleStorageRequest({ ...ctx, __lmsInternal: true });
  }

  const prefix = scopedStorageFolder(role, sub) + '/';

  if (request.method === 'GET') {
    const key = String(url.searchParams.get('key') || '');
    // Shared published course material (uploaded by owner under course_material/)
    // is readable by any authenticated role. Writes remain owner-only: the POST
    // path below forces restricted roles into their own scoped folder.
    const isSharedCourseMaterial = key.startsWith('course_material/');
    if (!key.startsWith(prefix) && !isSharedCourseMaterial) {
      // Lesson History: a lesson image referenced by an in-scope
      // attendance_logs row is readable even though it lives under another
      // teacher's scoped prefix. Teachers must NOT write into
      // course_material/ to dodge this -- the POST path still force-scopes.
      if (await isLessonImageKeyReadable(getDb(env), role, sub, key)) {
        return handleStorageRequest({ ...ctx, __lmsInternal: true });
      }
      return forbidden(request, env);
    }
    return handleStorageRequest({ ...ctx, __lmsInternal: true });
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
    return handleStorageRequest({ request: scopedRequest, env, ctx, __lmsInternal: true });
  }

  return handleStorageRequest({ ...ctx, __lmsInternal: true });
}

// ============================================================================
// Salary-advance workflow (Batch B, 2026-10-29).
//
// A teacher requests an advance against ONE salary period; an owner or a
// manager (never for a manager account, never the requester themselves)
// approves or rejects it. Approval creates EXACTLY ONE salary_adjustments
// row (kind 'advance') and folds the amount into that period's slip
// (advance_deducted + recomputed net_payable) — in the table AND in the
// teacher.address blob slip entry, so the Admin payroll view (blob) and
// the Teacher voucher view (table+blob merge) show the same numbers.
// Pending and rejected requests never touch any salary figure.
//
// Canonical net formula (matches payroll.js / profiles360.js, extended
// with the previously dormant advance_deducted column — legacy slips
// carry 0 there, so their results are unchanged):
//   net = max(0, base_subtotal + bonus - deduction_total - advance_deducted)
//
// Recovery rule (the ONE business rule needing the owner's confirmation):
// an approved advance is recovered IN FULL from the SAME period it was
// requested for. The recovery period is stored explicitly on both the
// request and the adjustment row; no instalment schedule is invented
// (recovery_per_month = the full approved amount, advance_remaining = 0
// once applied). If the owner wants multi-month recovery later, that is
// a new policy decision, not a silent default.
//
// Idempotency: the request id is the idempotency key. A second approval
// of an already-approved request returns the existing adjustment (no new
// row); a second identical pending submission returns the existing
// pending request (no duplicate row). A decided request is terminal:
// a different decision afterwards is a 409, never a silent flip.
// ============================================================================
const ADVANCE_MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function advanceGenerateId(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

// 'YYYY-MM' -> 'Month YYYY', or null when malformed.
function advancePeriodLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return ADVANCE_MONTH_LABELS[month - 1] + ' ' + m[1];
}

// 'Month YYYY' (the portal's slip-month label) -> 'YYYY-MM', or null.
function advancePeriodFromLabel(label) {
  if (label == null) return null;
  const m = String(label).trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = ADVANCE_MONTH_LABELS.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return null;
  return m[2] + '-' + String(idx + 1).padStart(2, '0');
}

// Current salary month in PKT (the academy's working timezone), as
// 'YYYY-MM'. Advances may only target the current month or earlier.
function advanceCurrentPktPeriod() {
  const pkt = new Date(Date.now() + 5 * 3600 * 1000);
  return pkt.toISOString().slice(0, 7);
}

function advanceNetPayable(base, bonus, deductionTotal, advanceDeducted) {
  const v = (Number(base) || 0) + (Number(bonus) || 0) - (Number(deductionTotal) || 0) - (Number(advanceDeducted) || 0);
  return v > 0 ? v : 0;
}

// Resolve the authoritative salary figures for one teacher + period.
// Table row first (it is the financial record); the teacher.address blob
// slip entry second (a slip saved while fee_tables_v1 was off has no
// table row yet). Returns null when neither exists — the caller then
// refuses the request honestly instead of inventing a salary.
async function resolveAdvanceSalary(db, teacherId, period) {
  const label = advancePeriodLabel(period);
  try {
    const row = await db.prepare(
      'SELECT * FROM salary_slips WHERE teacher_id = ? AND period = ? AND cancelled_at IS NULL ORDER BY updated_at DESC, created_at DESC LIMIT 1'
    ).bind(String(teacherId), period).first();
    if (row) {
      return {
        source: 'table',
        slipId: row.id || null,
        slipNo: row.slip_no || null,
        monthLabel: row.month_label || label,
        baseSubtotal: Number(row.base_subtotal) || 0,
        bonus: Number(row.bonus) || 0,
        deductionTotal: Number(row.deduction_total) || 0,
        advanceDeducted: Number(row.advance_deducted) || 0,
        netPayable: advanceNetPayable(row.base_subtotal, row.bonus, row.deduction_total, row.advance_deducted),
        status: row.status || 'Pending',
        paidAt: row.paid_at || null
      };
    }
  } catch (e) { if (!isMissingTableError(e)) throw e; }
  try {
    const tRow = await db.prepare('SELECT id, address FROM teachers WHERE id = ?').bind(String(teacherId)).first();
    const meta = parseJsonField(tRow && tRow.address);
    const slips = (meta && typeof meta.salary_slips === 'object' && meta.salary_slips) || {};
    for (const key of Object.keys(slips)) {
      const s = slips[key];
      if (!s || typeof s !== 'object') continue;
      const sPeriod = advancePeriodFromLabel(s.month) || (typeof s.period === 'string' ? s.period : null);
      if (sPeriod === period) {
        return {
          source: 'blob',
          slipKey: key,
          slipNo: s.slip_no || null,
          monthLabel: s.month || label,
          baseSubtotal: Number(s.base_subtotal) || 0,
          bonus: Number(s.bonus) || 0,
          deductionTotal: Number(s.deduction) || 0,
          advanceDeducted: Number(s.advance_deducted) || 0,
          netPayable: advanceNetPayable(s.base_subtotal, s.bonus, s.deduction, s.advance_deducted),
          status: s.status || 'Pending',
          paidAt: s.paid_at || null
        };
      }
    }
  } catch (e) { if (!isMissingTableError(e)) throw e; }
  return null;
}

// Metadata-only audit entry for an advance decision. Amounts NEVER go
// into audit_log (metadata-only convention); the request row itself
// carries the figures and this entry links to it by id. Best-effort:
// a failed audit write never fails the decision it records.
async function writeAdvanceAuditEntry(db, auth, requestId, decision) {
  try {
    if (!db) return;
    const now = new Date().toISOString();
    const entryId = 'AUD-' + now.replace(/[^0-9]/g, '').slice(0, 17) + '-' + Math.random().toString(36).slice(2, 8);
    await db.prepare(
      'INSERT INTO audit_log (id, actor_id, actor_role, action, table_name, record_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(entryId, String(auth.sub || ''), String(auth.role || ''), decision === 'approved' ? 'advance_approve' : 'advance_reject', 'advance_requests', String(requestId), now).run();
  } catch (e) {
    console.warn('[advance] audit write skipped:', e && e.message);
  }
}

function advancePublicRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    teacher_name: row.teacher_name || null,
    period: row.period,
    period_label: advancePeriodLabel(row.period),
    advance_type: row.advance_type,
    requested_amount: Number(row.requested_amount) || 0,
    approved_amount: row.approved_amount != null ? Number(row.approved_amount) : null,
    status: row.status,
    reason: row.reason || null,
    reviewer_comment: row.reviewer_comment || null,
    reviewed_by: row.reviewed_by || null,
    adjustment_id: row.adjustment_id || null,
    requested_at: row.requested_at || null,
    decided_at: row.decided_at || null
  };
}

async function readAdvanceRequestBody(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body;
}

// --- POST /api/advances/request  { period, advance_type, custom_amount?, reason? }
// Teacher role ONLY. The teacher id comes from the token, never the body:
// a teacher can request only for their own authenticated account. Full
// and half amounts are computed here from the authoritative salary
// record; a frontend-supplied amount is accepted ONLY for custom type
// and is validated against the same record.
async function handleAdvanceRequest(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }
  const auth = await requireApiAuth(request, env);
  if (!auth) return unauthorized(request, env);
  if (auth.role !== 'teacher') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }
  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (await d1WindowLimited(db, env, 'advance_request', 'advreq:' + String(auth.sub), 10 * 60 * 1000, 10)) {
    return json(request, env, { ok: false, error: 'Too many requests. Please try again later.' }, 429);
  }
  const body = await readAdvanceRequestBody(request);
  if (!body) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  const period = String(body.period || '').trim();
  const label = advancePeriodLabel(period);
  if (!label) {
    return json(request, env, { ok: false, error: 'A valid salary period (YYYY-MM) is required.' }, 400);
  }
  if (period > advanceCurrentPktPeriod()) {
    return json(request, env, { ok: false, error: 'An advance cannot be requested for a future salary period.' }, 400);
  }
  const advanceType = String(body.advance_type || '').trim();
  if (!['full', 'half', 'custom'].includes(advanceType)) {
    return json(request, env, { ok: false, error: 'Advance type must be full, half, or custom.' }, 400);
  }
  const reason = body.reason != null ? String(body.reason).trim() : '';
  if (reason.length > 500) {
    return json(request, env, { ok: false, error: 'The reason must be 500 characters or fewer.' }, 400);
  }
  let salary;
  try {
    salary = await resolveAdvanceSalary(db, auth.sub, period);
  } catch (e) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  // Phase 1 (advance/Zoom commission): a period WITHOUT a generated slip
  // is no longer a hard block at REQUEST time. Full/half are undefined
  // without a net, so they still need a slip — but a custom amount may
  // be requested now; it stays Pending, uncapped, until Administration
  // generates the slip AND approves it (the decide handler still
  // requires a slip and caps against the then-current net). Submitting
  // creates no payment, slip, deduction, or ledger entry.
  const hasSalary = !!salary;
  const net = hasSalary ? salary.netPayable : null;
  if (hasSalary && !(net > 0)) {
    return json(request, env, { ok: false, error: 'There is no payable salary for this period to advance against.' }, 422);
  }
  let requested;
  if (advanceType === 'full' || advanceType === 'half') {
    if (!hasSalary) {
      return json(request, env, { ok: false, error: 'A full or half advance needs a generated salary slip for this period. Enter a custom amount instead — it stays pending until Administration generates the slip and approves it.' }, 422);
    }
    requested = advanceType === 'full' ? net : Math.floor(net / 2);
  } else {
    const custom = Number(body.custom_amount);
    if (!Number.isFinite(custom) || custom <= 0) {
      return json(request, env, { ok: false, error: 'A custom advance amount must be a positive number.' }, 400);
    }
    if (hasSalary && custom > net) {
      return json(request, env, { ok: false, error: 'A custom advance cannot exceed the payable salary for this period.', salary_net: net }, 400);
    }
    requested = custom;
  }
  if (!(requested > 0)) {
    return json(request, env, { ok: false, error: 'The requested advance amount must be greater than zero.' }, 422);
  }
  try {
    // Idempotent re-submit: an identical pending request (same teacher,
    // period, type, amount) returns the existing row instead of a
    // duplicate. A different amount/type for the same period is a new
    // request; the decision-time cap keeps total approvals within net.
    const existing = await db.prepare(
      "SELECT * FROM advance_requests WHERE teacher_id = ? AND period = ? AND advance_type = ? AND requested_amount = ? AND status = 'Pending' ORDER BY created_at ASC LIMIT 1"
    ).bind(String(auth.sub), period, advanceType, requested).first();
    if (existing) {
      return json(request, env, { ok: true, duplicate: true, request: advancePublicRow(existing), salary_net: net, salary_pending: !hasSalary, period_label: label });
    }
    let teacherName = null;
    try {
      const tRow = await db.prepare('SELECT full_name FROM teachers WHERE id = ?').bind(String(auth.sub)).first();
      teacherName = (tRow && tRow.full_name) || null;
    } catch (e) {}
    const now = new Date().toISOString();
    const id = advanceGenerateId('ADV-');
    await db.prepare(
      'INSERT INTO advance_requests (id, teacher_id, teacher_name, period, advance_type, requested_amount, status, reason, requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, String(auth.sub), teacherName, period, advanceType, requested, 'Pending', reason || null, now, now, now).run();
    const created = await db.prepare('SELECT * FROM advance_requests WHERE id = ?').bind(id).first();
    return json(request, env, { ok: true, request: advancePublicRow(created), salary_net: net, salary_pending: !hasSalary, period_label: label });
  } catch (e) {
    if (isMissingTableError(e)) {
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
    console.error('[advance] request failed:', e && e.message);
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
}

// --- POST /api/advances/decide  { request_id, decision, reviewer_comment?, approved_amount? }
// Owner or manager ONLY. A teacher can never approve their own request:
// the role check denies every teacher token, and the reviewer-sub check
// below additionally denies a manager deciding a request addressed to
// their own staff record. Manager reviewers are additionally barred from
// manager-account targets (mirroring the salary-table manager guard).
async function handleAdvanceDecide(request, env) {
  if (request.method === 'OPTIONS') return json(request, env, {}, 204);
  if (request.method !== 'POST') {
    return json(request, env, { ok: false, error: 'Method not allowed.' }, 405);
  }
  const auth = await requireApiAuth(request, env);
  if (!auth) return unauthorized(request, env);
  if (auth.role !== 'owner' && auth.role !== 'manager') {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }
  const db = getDb(env);
  if (!db) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (await d1WindowLimited(db, env, 'advance_decide', 'advdec:' + String(auth.sub), 10 * 60 * 1000, 30)) {
    return json(request, env, { ok: false, error: 'Too many decisions. Please try again later.' }, 429);
  }
  const body = await readAdvanceRequestBody(request);
  if (!body) {
    return json(request, env, { ok: false, error: 'Invalid request body.' }, 400);
  }
  const requestId = String(body.request_id || '').trim();
  const decision = String(body.decision || '').trim();
  if (!requestId) {
    return json(request, env, { ok: false, error: 'request_id is required.' }, 400);
  }
  if (!['approved', 'rejected'].includes(decision)) {
    return json(request, env, { ok: false, error: 'decision must be approved or rejected.' }, 400);
  }
  const reviewerComment = body.reviewer_comment != null ? String(body.reviewer_comment).trim() : '';
  if (reviewerComment.length > 500) {
    return json(request, env, { ok: false, error: 'The reviewer comment must be 500 characters or fewer.' }, 400);
  }
  let reqRow;
  try {
    reqRow = await db.prepare('SELECT * FROM advance_requests WHERE id = ?').bind(requestId).first();
  } catch (e) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (!reqRow) {
    return json(request, env, { ok: false, error: 'Advance request not found.' }, 404);
  }
  // The reviewer must never be the requester, and a manager must never
  // decide a manager account's request.
  if (String(reqRow.teacher_id) === String(auth.sub)) {
    return json(request, env, { ok: false, error: 'Access denied.' }, 403);
  }
  if (auth.role === 'manager') {
    try {
      // NOTE: select only columns the teachers table actually has
      // (id, address, witness_name, notes) — employee_type lives inside
      // the address JSON, never as a column; selecting it throws and
      // would turn this guard into a 503.
      const tRow = await db.prepare('SELECT id, address, witness_name, notes FROM teachers WHERE id = ?').bind(String(reqRow.teacher_id)).first();
      if (tRow && isManagerStaffRecord(tRow)) {
        return json(request, env, { ok: false, error: 'Access denied.' }, 403);
      }
    } catch (e) {
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
  }
  const storedStatus = String(reqRow.status || '');
  // Idempotent replay: the same decision again returns the existing
  // outcome (and the existing adjustment for approvals) with NO new
  // rows. A different decision on a decided request is a conflict —
  // decided requests are terminal history, never silently flipped.
  if (storedStatus === 'Approved' || storedStatus === 'Rejected') {
    const wanted = decision === 'approved' ? 'Approved' : 'Rejected';
    if (storedStatus === wanted) {
      return json(request, env, { ok: true, replayed: true, request: advancePublicRow(reqRow) });
    }
    return json(request, env, { ok: false, error: 'This request has already been decided and cannot be changed.' }, 409);
  }
  if (storedStatus !== 'Pending') {
    return json(request, env, { ok: false, error: 'This request is no longer pending.' }, 409);
  }
  const now = new Date().toISOString();
  if (decision === 'rejected') {
    try {
      await db.prepare(
        'UPDATE advance_requests SET status = ?, reviewed_by = ?, reviewer_comment = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = ?'
      ).bind('Rejected', String(auth.sub), reviewerComment || null, now, now, requestId, 'Pending').run();
      await writeAdvanceAuditEntry(db, auth, requestId, 'rejected');
      const updated = await db.prepare('SELECT * FROM advance_requests WHERE id = ?').bind(requestId).first();
      return json(request, env, { ok: true, request: advancePublicRow(updated) });
    } catch (e) {
      console.error('[advance] reject failed:', e && e.message);
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
  }
  // --- Approval: create exactly one financial record. ---
  // approved_amount defaults to the requested amount; a reviewer may
  // approve LESS (never more). It must fit the CURRENT net payable for
  // the period — the salary may have changed since the request — so an
  // approval that would overdraw the period is refused (409) and the
  // request stays Pending for the reviewer to reject with a comment or
  // for the teacher to re-request. No silent clamping, no negative net.
  let approvedAmount = reqRow.requested_amount != null ? Number(reqRow.requested_amount) : NaN;
  if (body.approved_amount != null && body.approved_amount !== '') {
    approvedAmount = Number(body.approved_amount);
  }
  if (!Number.isFinite(approvedAmount) || approvedAmount <= 0) {
    return json(request, env, { ok: false, error: 'Approved amount must be a positive number.' }, 400);
  }
  // Parent review fix: the comment above promises "never more" — enforce
  // it. A reviewer may approve less than requested, never more: approving
  // above what the teacher asked for would grant an unrequested amount.
  const requestedAmount = reqRow.requested_amount != null ? Number(reqRow.requested_amount) : NaN;
  if (Number.isFinite(requestedAmount) && approvedAmount > requestedAmount) {
    return json(request, env, { ok: false, error: 'Approved amount cannot exceed the requested amount.' }, 400);
  }
  let salary;
  try {
    salary = await resolveAdvanceSalary(db, reqRow.teacher_id, reqRow.period);
  } catch (e) {
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
  if (!salary) {
    return json(request, env, { ok: false, error: 'No salary record exists for this period anymore. The request cannot be approved.' }, 422);
  }
  const currentNet = salary.netPayable;
  if (approvedAmount > currentNet) {
    return json(request, env, { ok: false, error: 'The salary for this period has changed since the request. The approved amount cannot exceed the current net payable.', current_net: currentNet, period_label: salary.monthLabel }, 409);
  }
  try {
    // Crash-window guard: if a previous approval attempt inserted the
    // adjustment but died before marking the request, reuse it instead
    // of creating a second one. The request id is embedded in the
    // adjustment's legacy_json at creation time.
    const priorAdj = await db.prepare(
      "SELECT * FROM salary_adjustments WHERE kind = 'advance' AND teacher_id = ? AND period = ? AND legacy_json LIKE ? AND cancelled_at IS NULL ORDER BY created_at ASC LIMIT 1"
    ).bind(String(reqRow.teacher_id), reqRow.period, '%"advance_request_id":"' + requestId + '"%').first();
    let adjustmentId;
    if (priorAdj && priorAdj.id) {
      adjustmentId = priorAdj.id;
    } else {
      adjustmentId = advanceGenerateId('ADJ-');
      await db.prepare(
        'INSERT INTO salary_adjustments (id, teacher_id, period, kind, category, amount, advance_remaining, recovery_per_month, reason, adjustment_date, status, created_by, created_at, legacy_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        adjustmentId, String(reqRow.teacher_id), reqRow.period, 'advance', 'Salary Advance', approvedAmount,
        0, approvedAmount, reqRow.reason || 'Approved advance salary request',
        now.slice(0, 10), 'Applied', String(auth.sub), now,
        JSON.stringify({ advance_request_id: requestId, advance_type: reqRow.advance_type, recovery_period: reqRow.period })
      ).run();
    }
    // Fold the advance into the period's slip (table + blob, same
    // numbers both sides) and recompute net with the canonical formula.
    const newAdvanceDeducted = salary.advanceDeducted + approvedAmount;
    const newNet = advanceNetPayable(salary.baseSubtotal, salary.bonus, salary.deductionTotal, newAdvanceDeducted);
    let slipKey = salary.slipKey || null;
    if (salary.source === 'table' && salary.slipId) {
      await db.prepare(
        'UPDATE salary_slips SET advance_deducted = ?, net_payable = ?, updated_at = ? WHERE id = ?'
      ).bind(newAdvanceDeducted, newNet, now, salary.slipId).run();
      slipKey = slipKey || (String(reqRow.teacher_id) + '_' + String(salary.monthLabel || '').replace(/\s+/g, '_'));
    } else {
      // No table row (blob-only slip): promote it to a table row first
      // so the financial record exists in exactly one authoritative
      // place going forward, then apply the advance to it.
      const slipNo = salary.slipNo || ('AH-SAL-' + String(reqRow.period).replace('-', '') + '-' + Math.random().toString(36).substring(2, 8).toUpperCase());
      const newSlipId = advanceGenerateId('SAL-');
      await db.prepare(
        'INSERT INTO salary_slips (id, teacher_id, period, slip_no, month_label, base_subtotal, bonus, deduction_total, advance_deducted, net_payable, status, paid_at, created_by, created_at, updated_at, legacy_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        newSlipId, String(reqRow.teacher_id), reqRow.period, slipNo, salary.monthLabel,
        salary.baseSubtotal, salary.bonus, salary.deductionTotal, newAdvanceDeducted, newNet,
        salary.status, salary.paidAt, String(auth.sub), now, now,
        slipKey || (String(reqRow.teacher_id) + '_' + String(salary.monthLabel || '').replace(/\s+/g, '_'))
      ).run();
      slipKey = slipKey || (String(reqRow.teacher_id) + '_' + String(salary.monthLabel || '').replace(/\s+/g, '_'));
    }
    // Blob mirror: the Admin payroll view reads the blob, so the same
    // advance_deducted + net land in the teacher.address slip entry.
    // Only that entry's financial fields are touched; every other key
    // of the address JSON is preserved byte-for-byte in value.
    try {
      const tRow = await db.prepare('SELECT id, address FROM teachers WHERE id = ?').bind(String(reqRow.teacher_id)).first();
      if (tRow) {
        const meta = parseJsonField(tRow.address);
        const base = (meta && typeof meta === 'object') ? meta : {};
        const slips = (base.salary_slips && typeof base.salary_slips === 'object') ? base.salary_slips : {};
        const entry = (slipKey && slips[slipKey] && typeof slips[slipKey] === 'object') ? { ...slips[slipKey] } : {};
        entry.teacher_id = String(reqRow.teacher_id);
        entry.month = salary.monthLabel;
        entry.base_subtotal = salary.baseSubtotal;
        entry.bonus = salary.bonus;
        entry.deduction = salary.deductionTotal;
        entry.advance_deducted = newAdvanceDeducted;
        entry.net_payable = newNet;
        if (!entry.status) entry.status = salary.status;
        if (!entry.slip_key) entry.slip_key = slipKey;
        slips[slipKey] = entry;
        base.salary_slips = slips;
        await db.prepare('UPDATE teachers SET address = ? WHERE id = ?').bind(JSON.stringify(base), String(reqRow.teacher_id)).run();
      }
    } catch (blobErr) {
      // The table transaction above is already committed; a blob-mirror
      // failure must not pretend the approval failed. The teacher
      // preview's table-first merge still shows the advance, and the
      // admin can re-sync from the table. Logged, not hidden.
      console.warn('[advance] blob mirror skipped:', blobErr && blobErr.message);
    }
    // Mark the request decided LAST, guarded on still-Pending: if two
    // reviewers race, only the first update lands and the second caller
    // re-reads the decided row (replay path) instead of double-applying.
    const upd = await db.prepare(
      'UPDATE advance_requests SET status = ?, approved_amount = ?, reviewed_by = ?, reviewer_comment = ?, adjustment_id = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = ?'
    ).bind('Approved', approvedAmount, String(auth.sub), reviewerComment || null, adjustmentId, now, now, requestId, 'Pending').run();
    if (!upd || !upd.success || Number(upd.meta && upd.meta.changes || 0) === 0) {
      const raced = await db.prepare('SELECT * FROM advance_requests WHERE id = ?').bind(requestId).first();
      if (raced && String(raced.status) === 'Approved' && raced.adjustment_id) {
        return json(request, env, { ok: true, replayed: true, request: advancePublicRow(raced) });
      }
      // The financial rows above were written but the request could not
      // be marked: report honestly instead of claiming success, so the
      // reviewer retries the (now idempotent) decision rather than
      // approving a second time.
      return json(request, env, { ok: false, error: 'The advance was recorded but the request status could not be updated. Please retry the decision — it will not create a second record.', adjustment_id: adjustmentId }, 503);
    }
    await writeAdvanceAuditEntry(db, auth, requestId, 'approved');
    const updated = await db.prepare('SELECT * FROM advance_requests WHERE id = ?').bind(requestId).first();
    return json(request, env, {
      ok: true,
      request: advancePublicRow(updated),
      adjustment_id: adjustmentId,
      updated_slip: {
        slip_key: slipKey,
        month: salary.monthLabel,
        period: reqRow.period,
        base_subtotal: salary.baseSubtotal,
        bonus: salary.bonus,
        deduction: salary.deductionTotal,
        advance_deducted: newAdvanceDeducted,
        net_payable: newNet,
        status: salary.status
      }
    });
  } catch (e) {
    if (isMissingTableError(e)) {
      return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
    }
    console.error('[advance] approve failed:', e && e.message);
    return json(request, env, { ok: false, error: 'Service unavailable.' }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 0a. Health (Batch 7 Part B, PUBLIC, GET only). Deliberately minimal:
    // { ok, version, schema } and nothing else — no secrets, no counts, no
    // data, no D1 read (the schema value is the hardcoded constant kept in
    // sync with functions/api/db.js, so this endpoint can never 500 on a
    // D1 error). Non-GET methods fall through to the asset handler below.
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json(request, env, { ok: true, version: WORKER_RELEASE, schema: HEALTH_SCHEMA_VERSION });
    }

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
    // 0b. Batch 7A: logout, unlock, sign-out-everywhere (auth enforced
    // inside each handler; logout is idempotent by design).
    if (url.pathname === '/api/auth/logout') {
      return handleLogout(request, env);
    }
    if (url.pathname === '/api/auth/unlock') {
      return handleUnlock(request, env);
    }
    if (url.pathname === '/api/auth/sign-out-everywhere') {
      return handleSignOutEverywhere(request, env);
    }

    // 1. Database API (/api/db) -> Cloudflare D1   [AUTH-GATED + ROLE-SCOPED]
    // Batch 7 Part B: engine responses bypass json(), so the branch return
    // itself is wrapped with the security set (covers API errors, engine
    // JSON, and the OPTIONS preflight alike).
    if (url.pathname === '/api/db' || url.pathname.startsWith('/api/db/')) {
      // CORS preflights never carry Authorization; let the downstream
      // handler answer them so browsers can complete preflight.
      if (request.method === 'OPTIONS') {
        return withSecurityHeaders(await handleDbRequest({ request, env, ctx }));
      }
      const auth = await requireApiAuth(request, env);
      if (!auth) return unauthorized(request, env);
      return withSecurityHeaders(await handleScopedDbRequest({ request, env, ctx }, auth));
    }

    // 2. File Storage API (/api/storage) -> Cloudflare R2   [AUTH-GATED + ROLE-SCOPED]
    // Batch 7 Part B: same branch wrap as /api/db — this is what covers
    // the storage-download path (attachment disposition and private
    // no-store caching set by the engine are preserved; only the security
    // keys are added).
    if (url.pathname === '/api/storage' || url.pathname.startsWith('/api/storage/')) {
      if (request.method === 'OPTIONS') {
        return withSecurityHeaders(await handleStorageRequest({ request, env, ctx }));
      }
      const auth = await requireApiAuth(request, env);
      if (!auth) return unauthorized(request, env);
      return withSecurityHeaders(await handleScopedStorageRequest({ request, env, ctx }, auth));
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

    // 2f. Salary-advance workflow (/api/advances/request, /api/advances/decide).
    // Request: teacher role ONLY, amounts computed server-side from the
    // period's salary record. Decide: owner/manager ONLY (a manager never
    // for a manager account, never the requester); approval creates
    // exactly one salary_adjustments row. Roles enforced in the handlers.
    if (url.pathname === '/api/advances/request') {
      return handleAdvanceRequest(request, env);
    }
    if (url.pathname === '/api/advances/decide') {
      return handleAdvanceDecide(request, env);
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
      // Batch 7 Part B: asset bytes pass through the Worker, so the
      // security set is merged here (existing Content-Type/Cache-Control
      // preserved; body streams through untouched).
      return withSecurityHeaders(await env.ASSETS.fetch(new Request(rewrittenUrl.toString(), request)));
    }

    // 4. All portal pages & static assets
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }

    // Batch 7 Part B: fallback text response carries the security set too.
    return new Response('Al-Huda LMS Worker is running.', { status: 200, headers: securityHeaders() });
  },
};
