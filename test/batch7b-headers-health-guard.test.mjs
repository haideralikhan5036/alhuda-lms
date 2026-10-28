// Batch 7 Part B tests — Worker security headers, /api/health, and the
// functions/ internal-invocation guard. Drives the REAL cloudflare/worker.js
// + functions/api/db.js + functions/api/storage.js against a fake D1
// backed by Node's SQLite. All values below are SYNTHETIC test values.
// Run from the repo root:  node test/batch7b-headers-health-guard.test.mjs
// Requires: node >= 22.5 (node:sqlite).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Test-only secret, assembled at runtime (never a single literal).
const WORKER_SECRET = ['test', 'worker', 'secret', 'b7b'].join('-');
const ORIGIN = 'https://alhuda-lms.vercel.app';
const WORKER_RELEASE = '2026-10-28-b7c';
const SCHEMA_VERSION = '2026-10-28-v2'; // bumped at rebase: Part A moved SCHEMA_VERSION to v2

// The CSP the Worker REPORT-ONLY header must mirror: read from vercel.json
// itself, so this test fails if either side drifts.
const vercelJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8'));
const VERCEL_CSP = vercelJson.routes[0].headers['Content-Security-Policy'];

const EXPECTED_SECURITY = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy-report-only': VERCEL_CSP,
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function assertSecurityHeaders(res, label) {
  for (const [name, value] of Object.entries(EXPECTED_SECURITY)) {
    check(label + ': header ' + name, res.headers.get(name) === value,
      'got ' + JSON.stringify(res.headers.get(name)));
  }
  check(label + ': NO enforcing CSP header', res.headers.get('content-security-policy') === null,
    'got ' + JSON.stringify(res.headers.get('content-security-policy')));
}

class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() { const r = this._db.prepare(this._sql).all(...this._params); return { results: r, success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}

// Counting wrapper: records every prepared statement so the guard tests can
// prove a denied call ran ZERO DDL (guard before ensureSchema).
class FakeD1 {
  constructor(sharedDb, counter) { this._db = sharedDb; this._counter = counter; }
  prepare(sql) { if (this._counter) this._counter.prepares.push(String(sql)); return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
}

function makeFakeR2() {
  return {
    async get(key) {
      if (key === 'course_material/x.png') {
        return { body: 'PNGDATA', httpMetadata: { contentType: 'image/png' }, httpEtag: '"etag1"' };
      }
      return null;
    },
  };
}

async function loadModules() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'batch7b-'));
  for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
    const dst = path.join(TMP, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f), dst);
  }
  fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
  const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
  const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);
  const { onRequest: storageOnRequest } = await import(pathToFileURL(path.join(TMP, 'functions/api/storage.js')).href);
  // Fresh db-engine module instance for the direct-guard block: db.js keeps
  // a per-isolate _schemaInitialized flag, so reusing the Worker's module
  // would make the "guard ran zero DDL" proof vacuous (ensureSchema would
  // already be skipped). A fresh import simulates a fresh isolate.
  const { onRequest: dbOnRequestFresh } = await import(pathToFileURL(path.join(TMP, 'functions/api/db.js')).href + '?fresh-isolate');
  const token = await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET);
  return { worker, dbOnRequestFresh, storageOnRequest, token };
}

async function workerFetch(worker, env, url, opts = {}) {
  const res = await worker.fetch(new Request(url, opts), env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { res, text, json };
}

const { worker, dbOnRequestFresh, storageOnRequest, token } = await loadModules();
const authHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN };

// --- B2: /api/health -------------------------------------------------------
{
  const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(new DatabaseSync(':memory:'), null) };
  const { res, json } = await workerFetch(worker, env, 'https://worker.test/api/health', { method: 'GET' });
  check('health: unauthenticated GET works (200)', res.status === 200, String(res.status));
  check('health: exact shape {ok, version, schema} only',
    json && JSON.stringify(Object.keys(json).sort()) === JSON.stringify(['ok', 'schema', 'version']),
    JSON.stringify(json));
  check('health: ok true', json && json.ok === true, JSON.stringify(json));
  check('health: version is the release constant', json && json.version === WORKER_RELEASE, JSON.stringify(json));
  check('health: schema matches SCHEMA_VERSION', json && json.schema === SCHEMA_VERSION, JSON.stringify(json));
  assertSecurityHeaders(res, 'health');
}

// --- B1: API error responses carry the set ---------------------------------
{
  const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(new DatabaseSync(':memory:'), null) };
  const { res } = await workerFetch(worker, env, 'https://worker.test/api/db',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('api: unauthenticated /api/db is 401', res.status === 401, String(res.status));
  assertSecurityHeaders(res, 'api 401');
}

// --- B1: fallback text response carries the set -----------------------------
{
  const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(new DatabaseSync(':memory:'), null) };
  const { res, text } = await workerFetch(worker, env, 'https://worker.test/some-unknown-path', { method: 'GET' });
  check('fallback: unknown path returns Worker running text', res.status === 200 && text.includes('Worker is running'), res.status + ' ' + text.slice(0, 60));
  assertSecurityHeaders(res, 'fallback');
}

// --- B1: static-asset responses carry the set, originals preserved ---------
{
  const assetBody = '<html>portal</html>';
  const env = {
    WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(new DatabaseSync(':memory:'), null),
    ASSETS: { async fetch() { return new Response(assetBody, { status: 200, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=60' } }); } },
  };
  const { res, text } = await workerFetch(worker, env, 'https://worker.test/teacher', { method: 'GET' });
  check('assets: clean URL returns asset body', res.status === 200 && text === assetBody, res.status + ' ' + text.slice(0, 40));
  check('assets: original Content-Type preserved', res.headers.get('content-type') === 'text/html', String(res.headers.get('content-type')));
  check('assets: original Cache-Control preserved', res.headers.get('cache-control') === 'max-age=60', String(res.headers.get('cache-control')));
  assertSecurityHeaders(res, 'assets');
}

// --- Worker path through the marker: authed db + storage download ----------
{
  const counter = { prepares: [] };
  const sharedDb = new DatabaseSync(':memory:');
  const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(sharedDb, counter), STORAGE: makeFakeR2() };
  const dbRes = await workerFetch(worker, env, 'https://worker.test/api/db',
    { method: 'POST', headers: authHeaders, body: JSON.stringify({ table: 'families', action: 'select' }) });
  check('worker path: authed db select still works through the marker', dbRes.res.status === 200 && Array.isArray(dbRes.json && dbRes.json.data),
    dbRes.res.status + ' ' + dbRes.text.slice(0, 120));
  assertSecurityHeaders(dbRes.res, 'worker db select');
  const stRes = await workerFetch(worker, env, 'https://worker.test/api/storage?key=course_material/x.png',
    { method: 'GET', headers: { 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN } });
  check('worker path: storage download still works through the marker', stRes.res.status === 200 && stRes.text === 'PNGDATA',
    stRes.res.status + ' ' + stRes.text.slice(0, 60));
  check('worker path: download keeps attachment disposition', (stRes.res.headers.get('content-disposition') || '').startsWith('attachment'),
    String(stRes.res.headers.get('content-disposition')));
  check('worker path: download keeps private no-store', stRes.res.headers.get('cache-control') === 'private, no-store',
    String(stRes.res.headers.get('cache-control')));
  assertSecurityHeaders(stRes.res, 'worker storage download');
}

// --- B4: db engine guard, direct calls --------------------------------------
{
  const counter = { prepares: [] };
  const sharedDb = new DatabaseSync(':memory:');
  const env = { DB: new FakeD1(sharedDb, counter), ALLOWED_ORIGINS: ORIGIN };
  const noMarker = (method, body) => dbOnRequestFresh({
    request: new Request('https://worker.test/api/db', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
    env,
  });
  const deniedPost = await noMarker('POST', { table: 'families', action: 'select' });
  check('guard db: POST without marker is 403', deniedPost.status === 403, String(deniedPost.status));
  const deniedGet = await noMarker('GET');
  check('guard db: GET without marker is 403 (not engine info)', deniedGet.status === 403, String(deniedGet.status));
  const ddlCount = counter.prepares.filter((s) => /^\s*CREATE\s/i.test(s)).length;
  check('guard db: denied call ran ZERO DDL (guard before ensureSchema)', ddlCount === 0, 'DDL prepares: ' + ddlCount);
  const tables = sharedDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
  check('guard db: denied call created no tables', tables === 0, 'tables: ' + tables);
  const options = await dbOnRequestFresh({ request: new Request('https://worker.test/api/db', { method: 'OPTIONS' }), env });
  check('guard db: OPTIONS carve-out still 204 without marker', options.status === 204, String(options.status));
  const okGet = await dbOnRequestFresh({ request: new Request('https://worker.test/api/db', { method: 'GET' }), env, __lmsInternal: true });
  const okGetText = await okGet.text();
  check('guard db: GET with marker returns engine info', okGet.status === 200 && okGetText.includes('Cloudflare D1 SQLite'),
    okGet.status + ' ' + okGetText.slice(0, 80));
  const okPost = await dbOnRequestFresh({
    request: new Request('https://worker.test/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'families', action: 'select' }) }),
    env, __lmsInternal: true,
  });
  const okPostJson = JSON.parse(await okPost.text());
  check('guard db: POST with marker proceeds', okPost.status === 200 && Array.isArray(okPostJson.data),
    okPost.status + ' ' + JSON.stringify(okPostJson).slice(0, 120));
}

// --- B4: storage engine guard, direct calls ---------------------------------
{
  const envNoBucket = { ALLOWED_ORIGINS: ORIGIN };
  const envBucket = { ALLOWED_ORIGINS: ORIGIN, STORAGE: makeFakeR2() };
  const deniedGet = await storageOnRequest({ request: new Request('https://worker.test/api/storage?key=course_material/x.png', { method: 'GET' }), env: envNoBucket });
  check('guard storage: GET with key, no marker, no bucket is 403 (not 503)', deniedGet.status === 403, String(deniedGet.status));
  const deniedPost = await storageOnRequest({ request: new Request('https://worker.test/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'x' }) }), env: envNoBucket });
  check('guard storage: POST without marker is 403', deniedPost.status === 403, String(deniedPost.status));
  const options = await storageOnRequest({ request: new Request('https://worker.test/api/storage', { method: 'OPTIONS' }), env: envNoBucket });
  check('guard storage: OPTIONS carve-out still 204 without marker', options.status === 204, String(options.status));
  const noBucket = await storageOnRequest({ request: new Request('https://worker.test/api/storage?key=course_material/x.png', { method: 'GET' }), env: envNoBucket, __lmsInternal: true });
  check('guard storage: GET with marker, no bucket reaches binding check (503)', noBucket.status === 503, String(noBucket.status));
  const okGet = await storageOnRequest({ request: new Request('https://worker.test/api/storage?key=course_material/x.png', { method: 'GET' }), env: envBucket, __lmsInternal: true });
  check('guard storage: GET with marker + bucket downloads', okGet.status === 200 && (await okGet.text()) === 'PNGDATA', String(okGet.status));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nbatch7b-headers-health-guard: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
