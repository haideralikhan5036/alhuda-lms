// Lesson History page links — Worker: parent read-only catalog access.
// Drives the REAL cloudflare/worker.js against a fake D1 (node:sqlite).
// Run from the repo root:  node test/lesson-history-page-links-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// NOTE: the secret below is a TEST-ONLY value for this harness (same
// pattern as the other worker tests); it is not a real credential.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-page-links-worker-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'lesson-page-links-test-only-secret';
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
  seed(sql, ...params) { this._db.prepare(sql).run(...params); }
  close() { try { this._db.close(); } catch (e) {} }
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) { const v = this._map.get(key); if (!v) return null; return { body: v, httpMetadata: { contentType: 'image/png' }, httpEtag: '"fake-etag"' }; }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  parent1: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO students (id, family_id, name) VALUES ('ST-1', 'FAM-1', 'Student One')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('s1', 'alhuda_custom_books_index', '[]')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('s2', 'BOOK_PAGE_custom-1_0', 'https://worker.test/api/storage?key=course_material/p1.png')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('s3', 'BOOK_PAGE_custom-1_1', 'https://worker.test/api/storage?key=course_material/p2.png')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('s4', 'fee_tables_v1', 'on')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('s5', 'alhuda_deleted_books', '[\"x\"]')");
fakeDb.seed("INSERT INTO system_settings (id, key, value) VALUES ('s6', 'alhuda_logo', 'logo')");

{
  const r = await dbPost(TOK.parent1, { table: 'system_settings', action: 'select' });
  const keys = ((r.data && r.data.data) || []).map((row) => row.key).sort();
  check('parent catalog read: 200', r.status === 200, 'got ' + r.status);
  check('parent catalog read: index + BOOK_PAGE rows returned', keys.includes('alhuda_custom_books_index') && keys.includes('BOOK_PAGE_custom-1_0') && keys.includes('BOOK_PAGE_custom-1_1'), keys.join(','));
  check('parent catalog read: fee flag NOT returned', !keys.includes('fee_tables_v1'), keys.join(','));
  check('parent catalog read: tombstone NOT returned', !keys.includes('alhuda_deleted_books'), keys.join(','));
  check('parent catalog read: logo NOT returned', !keys.includes('alhuda_logo'), keys.join(','));
  const w = await dbPost(TOK.parent1, { table: 'system_settings', action: 'insert', values: { key: 'BOOK_PAGE_evil_0', value: 'x' } });
  check('parent catalog write: denied (not 200)', w.status !== 200, 'got ' + w.status);
  const after = await dbPost(TOK.owner, { table: 'system_settings', action: 'select', filters: [{ column: 'key', op: 'eq', value: 'BOOK_PAGE_evil_0' }] });
  check('parent catalog write: no row created', ((after.data && after.data.data) || []).length === 0);
  const anon = await dbPost('', { table: 'system_settings', action: 'select' });
  check('anonymous catalog read: denied', anon.status === 401 || anon.status === 403, 'got ' + anon.status);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nlesson-history-page-links-worker: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
