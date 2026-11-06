// Course-book permanent deletion — Worker storage DELETE route.
// Drives the REAL cloudflare/worker.js against a fake D1 (node:sqlite)
// and a fake R2 bucket. The route (2026-11-06):
//   DELETE /api/storage?key=course_material/<file>
//   - owner role ONLY (manager/teacher/parent -> 403, no token -> 401)
//   - keys outside course_material/ refused even for the owner (engine)
//   - idempotent: deleting a missing key succeeds (safe retry semantics)
// Run from the repo root:  node test/course-book-delete-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// NOTE: the secret below is a TEST-ONLY value for this harness (same
// pattern as the other worker tests); it is not a real credential.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'course-book-delete-worker-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = ['test', 'worker', 'secret', '42'].join('-');
const ORIGIN = 'https://alhuda-lms.vercel.app';

class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() { const results = this._db.prepare(this._sql).all(...this._params); return { results, success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
  close() { try { this._db.close(); } catch (e) {} }
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) { const v = this._map.get(key); if (!v) return null; return { body: v, httpMetadata: { contentType: 'image/webp' }, httpEtag: '"fake-etag"' }; }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
  async delete(key) { this._map.delete(key); return {}; }
  has(key) { return this._map.has(key); }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-1', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

async function storageReq(method, key, token) {
  const qs = key === null ? '' : '?key=' + encodeURIComponent(key);
  const headers = { 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const req = new Request('https://worker.test/api/storage' + qs, { method, headers });
  const res = await worker.fetch(req, env, {});
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}
async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  return { status: res.status };
}

// Boot the schema (same pattern as the other worker suites).
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
}

const K1 = 'course_material/111_bookA_page_1.webp';
const K2 = 'course_material/222_bookA_page_2.webp';
const K3 = 'course_material/333_bookB_page_1.webp';
const KDOC = 'documents/teacher-secret.pdf';
fakeR2._map.set(K1, 'bytes-1');
fakeR2._map.set(K2, 'bytes-2');
fakeR2._map.set(K3, 'bytes-3');
fakeR2._map.set(KDOC, 'bytes-doc');

// --- Owner happy path + idempotency ---------------------------------------
{
  const r = await storageReq('DELETE', K1, TOK.owner);
  check('owner DELETE course_material object -> 200 ok', r.status === 200 && r.json && r.json.ok === true && r.json.deleted === true, 'got ' + r.status + ' ' + JSON.stringify(r.json));
  check('owner DELETE removed the object from R2', !fakeR2.has(K1));
  const again = await storageReq('DELETE', K1, TOK.owner);
  check('owner DELETE of the same (now missing) key -> 200 (idempotent retry)', again.status === 200 && again.json && again.json.ok === true, 'got ' + again.status);
  check('object still absent after repeat delete', !fakeR2.has(K1));
}

// --- Role refusals: the object must survive every one ----------------------
{
  const m = await storageReq('DELETE', K2, TOK.manager);
  check('manager DELETE -> 403', m.status === 403, 'got ' + m.status);
  check('object survives manager DELETE', fakeR2.has(K2));
  const t = await storageReq('DELETE', K2, TOK.teacher);
  check('teacher DELETE -> 403', t.status === 403, 'got ' + t.status);
  check('object survives teacher DELETE', fakeR2.has(K2));
  const p = await storageReq('DELETE', K2, TOK.parent);
  check('parent DELETE -> 403', p.status === 403, 'got ' + p.status);
  check('object survives parent DELETE', fakeR2.has(K2));
  const anon = await storageReq('DELETE', K2, null);
  check('missing-token DELETE -> 401', anon.status === 401, 'got ' + anon.status);
  check('object survives anonymous DELETE', fakeR2.has(K2));
}

// --- Prefix scope: even the owner cannot delete outside course_material/ ---
{
  const r = await storageReq('DELETE', KDOC, TOK.owner);
  check('owner DELETE outside course_material/ -> refused (403)', r.status === 403 && r.json && r.json.ok === false, 'got ' + r.status + ' ' + JSON.stringify(r.json));
  check('out-of-scope object survives owner DELETE', fakeR2.has(KDOC));
  const noKey = await storageReq('DELETE', null, TOK.owner);
  check('owner DELETE without a key -> 400', noKey.status === 400, 'got ' + noKey.status);
}

// --- Reads are untouched ----------------------------------------------------
{
  const g = await storageReq('GET', K3, TOK.teacher);
  check('teacher GET of shared course material still works (200)', g.status === 200, 'got ' + g.status);
  check('GET did not remove the object', fakeR2.has(K3));
}

// --- Perf fix (2026-11-06): IN-list deletes on system_settings via /api/db ---
// The book-delete row phase removes BOOK_PAGE rows with ONE IN-list
// delete per chunk instead of one request per row. Proven here against
// the real engine: the owner may do it; a manager may NOT (the manager
// write guard requires an eq pin on `key` — which is exactly why the
// Page Editor's tail prune keeps the eq form), while a manager eq
// delete of a catalog key stays allowed.
async function dbPostJson(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}
{
  const keys = ['BOOK_PAGE_custom-PERF_0', 'BOOK_PAGE_custom-PERF_1', 'BOOK_PAGE_custom-PERF_2'];
  const seed = await dbPostJson(TOK.owner, {
    table: 'system_settings', action: 'upsert',
    values: keys.map((k, i) => ({ id: 'SYS-PERF-' + i, key: k, value: 'https://x.test/' + k, updated_at: new Date().toISOString() })),
  });
  check('perf: owner array upsert of 3 BOOK_PAGE rows in ONE request -> 200', seed.status === 200 && !seed.json.error, 'got ' + seed.status + ' ' + JSON.stringify(seed.json).slice(0, 120));
  const readBack = await dbPostJson(TOK.owner, { table: 'system_settings', action: 'select', select: 'key', filters: [{ column: 'key', op: 'in', value: keys }] });
  check('perf: all 3 seeded rows readable via one IN select', readBack.status === 200 && Array.isArray(readBack.json.data) && readBack.json.data.length === 3, 'got ' + JSON.stringify(readBack.json).slice(0, 120));

  const mgrIn = await dbPostJson(TOK.manager, { table: 'system_settings', action: 'delete', filters: [{ column: 'key', op: 'in', value: keys }] });
  check('perf: manager IN-list delete -> refused (guard requires eq on key)', mgrIn.status !== 200, 'got ' + mgrIn.status);
  const stillThere = await dbPostJson(TOK.owner, { table: 'system_settings', action: 'select', select: 'key', filters: [{ column: 'key', op: 'in', value: keys }] });
  check('perf: rows survive the refused manager IN delete', Array.isArray(stillThere.json.data) && stillThere.json.data.length === 3);

  const ownIn = await dbPostJson(TOK.owner, { table: 'system_settings', action: 'delete', filters: [{ column: 'key', op: 'in', value: keys }] });
  check('perf: owner IN-list delete of 3 rows in ONE request -> 200', ownIn.status === 200 && !ownIn.json.error, 'got ' + ownIn.status + ' ' + JSON.stringify(ownIn.json).slice(0, 120));
  const gone = await dbPostJson(TOK.owner, { table: 'system_settings', action: 'select', select: 'key', filters: [{ column: 'key', op: 'in', value: keys }] });
  check('perf: all 3 rows gone after the single IN delete', Array.isArray(gone.json.data) && gone.json.data.length === 0, 'got ' + JSON.stringify(gone.json).slice(0, 120));

  const mgrEqSeed = await dbPostJson(TOK.owner, { table: 'system_settings', action: 'upsert', values: [{ id: 'SYS-PERF-EQ', key: 'BOOK_PAGE_custom-PERF_9', value: 'v', updated_at: new Date().toISOString() }] });
  const mgrEq = await dbPostJson(TOK.manager, { table: 'system_settings', action: 'delete', filters: [{ column: 'key', op: 'eq', value: 'BOOK_PAGE_custom-PERF_9' }] });
  check('perf: manager eq delete of a catalog key stays allowed (editor prune form)', mgrEqSeed.status === 200 && mgrEq.status === 200 && !mgrEq.json.error, 'got ' + mgrEq.status);
}

// --- Release identity --------------------------------------------------------
{
  const req = new Request('https://worker.test/api/health', { method: 'GET', headers: { 'Origin': ORIGIN } });
  const res = await worker.fetch(req, env, {});
  const h = await res.json().catch(() => null);
  check('health reports the course-delete release', res.status === 200 && h && h.version === '2026-11-06-course-delete', 'got ' + (h && h.version));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\ncourse-book-delete-worker: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
