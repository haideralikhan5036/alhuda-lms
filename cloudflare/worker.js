/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — UNIFIED CLOUDFLARE WORKER + STATIC ASSETS
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
 *   - Browser-side session checks are UX only — this worker is the enforcer.
 *   - NOTE (Phase 2): per-role DATA SCOPING is not yet enforced here. Any
 *     authenticated role can currently query any table. Owner/manager have
 *     full access by design; teacher/parent scoping is the next step.
 *
 * REQUIRED ENV VARS (set with `wrangler secret put <NAME>` — never in code):
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
// set passwords are accepted — the '12345678' default and empty passwords
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
        if (isUsablePassword(pw) && constantTimeEqualBytes(te.encode(password), te.encode(String(pw)))) {
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
        if (isUsablePassword(pw) && constantTimeEqualBytes(te.encode(password), te.encode(String(pw)))) {
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

    // 1. Database API (/api/db) -> Cloudflare D1   [AUTH-GATED]
    if (url.pathname === '/api/db' || url.pathname.startsWith('/api/db/')) {
      // CORS preflights never carry Authorization; let the downstream
      // handler answer them so browsers can complete preflight.
      if (request.method !== 'OPTIONS') {
        const auth = await requireApiAuth(request, env);
        if (!auth) return unauthorized(request, env);
      }
      return handleDbRequest({ request, env, ctx });
    }

    // 2. File Storage API (/api/storage) -> Cloudflare R2   [AUTH-GATED]
    if (url.pathname === '/api/storage' || url.pathname.startsWith('/api/storage/')) {
      if (request.method !== 'OPTIONS') {
        const auth = await requireApiAuth(request, env);
        if (!auth) return unauthorized(request, env);
      }
      return handleStorageRequest({ request, env, ctx });
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
