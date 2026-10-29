// Phase 4 Batch 4.3 — backend honesty & scoping (audit P3 items).
// Drives the REAL cloudflare/worker.js + functions/api/db.js against a
// FakeD1 (node:sqlite) + FakeR2, mirroring the house harness.
// a: parent teacher reads are scoped to their own children's teachers.
// s: alhuda_deleted_books readable by parent + manager (not just teacher).
// g: lesson-image gate = exact parsed image_key only, no substring match.
// j: staff login SELECTs carry witness_name (manager-by-witness login).
// h: UPDATE-path financial UNIQUE collision -> 409, not 500.
// o: salary_slips insert requires teacher_id + period.
// n: DELETE reports the matched-row count (additive `deleted`).
// d/m: structural — advance-email HTML escaping; relay fetch timeout.
// Run from the repo root:  node test/phase4-backend.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p43-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-p43';
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
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) { const v = this._map.get(key); if (!v) return null; return { body: v, httpMetadata: { contentType: 'image/png' }, httpEtag: '"fake"' }; }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
}

const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { WORKER_AUTH_SECRET: WORKER_SECRET, DB: fakeDb, STORAGE: fakeR2 };

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function call(pathname, { token = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const req = new Request('https://worker.test' + pathname, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}
const dbPost = (token, body) => call('/api/db', { token, body });
async function storageGet(token, key) {
  const req = new Request('https://worker.test/api/storage?key=' + encodeURIComponent(key), {
    headers: { 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
  });
  const res = await worker.fetch(req, env, {});
  return { status: res.status };
}
const eq = (column, value) => [{ column, op: 'eq', value }];

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'T-MGR', role: 'manager' }, WORKER_SECRET),
  parent1: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

// ---- Setup -------------------------------------------------------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: schema boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, zoom_link) VALUES ('T-A', 'Teacher A', 'https://zoom.us/j/111')");
fakeDb.seed("INSERT INTO teachers (id, full_name, zoom_link) VALUES ('T-B', 'Teacher B', 'https://zoom.us/j/222')");
fakeDb.seed("INSERT INTO teachers (id, full_name, zoom_link) VALUES ('T-C', 'Teacher C', 'https://zoom.us/j/333')");
fakeDb.seed("INSERT INTO teachers (id, full_name) VALUES ('T-MGR', 'Manager Person')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-2', 'Parent Two')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-2', 'FAM-2', 'Child Two', 'T-B')");
fakeDb.seed("INSERT INTO class_schedules (id, student_id, teacher_id, day_of_week, start_time, end_time) VALUES ('SC-1', 'ST-1', 'T-C', 'Monday', '10:00', '10:30')");
fakeDb.seed("INSERT INTO system_settings (key, value) VALUES ('alhuda_deleted_books', '[\"book-x\"]')");

// ---- (a) parent teacher scope --------------------------------------------------
{
  const r = await dbPost(TOK.parent1, { table: 'teachers', action: 'select' });
  const rows = (r.json && r.json.data) || [];
  const ids = rows.map(x => x.id).sort();
  check('a: parent sees ONLY own teachers (assigned + scheduled)', JSON.stringify(ids) === JSON.stringify(['T-A', 'T-C']), 'got ' + JSON.stringify(ids));
  check('a: rows still reduced to the safe subset', rows.every(x => Object.keys(x).sort().join(',') === 'full_name,id,zoom_link'));
  const all = await dbPost(TOK.owner, { table: 'teachers', action: 'select' });
  check('a: owner teacher read unaffected', ((all.json.data || []).length) === 4);
}

// ---- (s) tombstone readability ---------------------------------------------------
{
  const p = await dbPost(TOK.parent1, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_deleted_books') });
  check('s: parent can read alhuda_deleted_books', p.status === 200 && ((p.json.data || []).length) === 1, 'status ' + p.status);
  const m = await dbPost(TOK.manager, { table: 'system_settings', action: 'select', filters: eq('key', 'alhuda_deleted_books') });
  check('s: manager can read alhuda_deleted_books', m.status === 200 && ((m.json.data || []).length) === 1, 'status ' + m.status);
}

// ---- (g) lesson-image gate: no substring grant -----------------------------------
{
  const KEY_OK = 'uploads/real-page.png';
  const KEY_MENTIONED = 'uploads/mentioned-page.png';
  await fakeR2.put(KEY_OK, 'img'); await fakeR2.put(KEY_MENTIONED, 'img');
  fakeDb.seed("INSERT INTO attendance_logs (id, student_id, teacher_id, class_date, date, status, lesson_notes) VALUES ('L-OK', 'ST-1', 'T-A', '2026-10-10', '2026-10-10', 'Completed', ?)",
    JSON.stringify({ book_title: 'Qaida', image_key: KEY_OK }));
  fakeDb.seed("INSERT INTO attendance_logs (id, student_id, teacher_id, class_date, date, status, lesson_notes) VALUES ('L-MENTION', 'ST-1', 'T-A', '2026-10-11', '2026-10-11', 'Completed', ?)",
    'teacher note: see ' + KEY_MENTIONED + ' for the page photo');
  check('g: exact image_key still grants the parent', (await storageGet(TOK.parent1, KEY_OK)).status === 200);
  check('g: key merely mentioned in notes text is DENIED', (await storageGet(TOK.parent1, KEY_MENTIONED)).status === 403);
}

// ---- (j) manager login via witness_name ------------------------------------------
{
  const salt = randomBytes(16).toString('hex');
  const hash = `sha256$${salt}$${createHash('sha256').update(salt + ':' + 'mgr-pass-123').digest('hex')}`;
  fakeDb.seed("INSERT INTO teachers (id, full_name, address, witness_name, status) VALUES ('T-WIT', 'Witness Manager', ?, 'MGR-900', 'Active')",
    JSON.stringify({ username: 'mgrwitness', password: hash }));
  const login = await call('/api/auth/staff-login', { body: { identifier: 'mgrwitness', password: 'mgr-pass-123', role: 'manager' } });
  check('j: manager identified ONLY via witness_name can log in as manager', login.status === 200 && login.json && login.json.ok === true, 'status ' + login.status + ' ' + (login.text || '').slice(0, 120));
}

// ---- (h) update-path UNIQUE -> 409 -------------------------------------------------
{
  const p1 = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: { id: 'PAY-1', family_id: 'FAM-1', receipt_no: 'R-1', amount: 100 } });
  const p2 = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: { id: 'PAY-2', family_id: 'FAM-1', receipt_no: 'R-2', amount: 50 } });
  check('h: seed payments inserted', p1.status === 200 && p2.status === 200, p1.status + '/' + p2.status);
  const upd = await dbPost(TOK.owner, { table: 'payments', action: 'update', values: { receipt_no: 'R-1' }, filters: eq('id', 'PAY-2') });
  check('h: update colliding receipt_no -> 409 (not 500)', upd.status === 409, 'got ' + upd.status);
  check('h: 409 message is the friendly duplicate text', !!(upd.json && upd.json.error && /Duplicate receipt/.test(upd.json.error.message || '')));
}

// ---- (o) salary_slips requirements --------------------------------------------------
{
  const bad = await dbPost(TOK.owner, { table: 'salary_slips', action: 'insert', values: { id: 'SL-BAD', base_salary: 1000 } });
  check('o: slip without teacher_id/period -> 400', bad.status === 400, 'got ' + bad.status);
  const good = await dbPost(TOK.owner, { table: 'salary_slips', action: 'insert', values: { id: 'SL-OK', teacher_id: 'T-A', period: '2026-10', base_salary: 1000 } });
  check('o: slip with teacher_id + period -> 200', good.status === 200, 'got ' + good.status);
}

// ---- (n) delete honesty ---------------------------------------------------------------
{
  const miss = await dbPost(TOK.owner, { table: 'students', action: 'delete', filters: eq('id', 'ST-NOPE') });
  check('n: no-match delete reports deleted: 0', miss.status === 200 && miss.json && miss.json.deleted === 0, 'got ' + miss.status + ' ' + JSON.stringify(miss.json).slice(0, 120));
  const hit = await dbPost(TOK.owner, { table: 'students', action: 'delete', filters: eq('id', 'ST-2') });
  check('n: real delete reports deleted: 1', hit.status === 200 && hit.json && hit.json.deleted === 1, 'got ' + JSON.stringify(hit.json).slice(0, 120));
}

// ---- (d) + (m) structural ----------------------------------------------------------------
{
  const W = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');
  check('d: advance email escapes HTML before <br/> conversion',
    W.includes("replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')"));
  const relayAt = W.indexOf('async function forwardEmailViaRelay');
  const relaySeg = W.slice(relayAt, relayAt + 4000);
  check('m: relay fetch carries an AbortController timeout', relaySeg.includes('AbortController') && relaySeg.includes('15000') && relaySeg.includes('signal: relayCtl.signal'));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
