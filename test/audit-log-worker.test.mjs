// Audit-log (Batch 2.1) worker test — manager writes are recorded in the
// audit_log table; the log is owner-only and never contains record content.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a fake
// D1 backed by Node's built-in SQLite (node:sqlite).
// Run from the repo root:  node test/audit-log-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All contact values below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'audit-test-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';

// ---- Fake D1 over real in-memory SQLite ------------------------------------
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

const fakeDb = new FakeD1();
const env = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  DB: fakeDb,
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function dbPost(token, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, data };
}

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-1', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};
const eqId = (v) => [{ column: 'id', op: 'eq', value: v }];

async function auditRows() {
  const r = await dbPost(TOK.owner, { table: 'audit_log', action: 'select' });
  return { status: r.status, rows: (r.data && r.data.data) || [] };
}

// ---- Setup: schema boot (creates audit_log too) + seeds ----------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
  const a = await auditRows();
  check('setup: audit_log table exists and owner can read it (0 rows)', a.status === 200 && a.rows.length === 0,
    'status=' + a.status + ' rows=' + a.rows.length);
}
fakeDb.seed('INSERT INTO teachers (id, full_name, phone, address) VALUES (?, ?, ?, ?)',
  'TCH-1', 'Regular Teacher', '+10000000103', JSON.stringify({ username: 'teachone' }));
fakeDb.seed('INSERT INTO families (id, parent_name, email, phone, whatsapp, notes) VALUES (?, ?, ?, ?, ?, ?)',
  'FAM-1', 'Test Parent', 'audit-leak-check@example.test', '+10000000201', '+10000000202', JSON.stringify({}));

// ---- Manager writes ARE logged ----------------------------------------------
{
  const r = await dbPost(TOK.manager, {
    table: 'families', action: 'insert',
    values: { id: 'FAM-2', parent_name: 'Second Parent', email: 'second@example.test', phone: '+10000000203', whatsapp: '+10000000204', notes: JSON.stringify({}) },
  });
  check('manager INSERT family -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 140));
  const a = await auditRows();
  const row = a.rows[0] || {};
  check('audit: exactly 1 entry after the manager insert', a.rows.length === 1, 'rows=' + a.rows.length);
  check('audit: entry captures actor + action + table + record',
    row.actor_id === 'TCH-MGR-1' && row.actor_role === 'manager' && row.action === 'insert' &&
    row.table_name === 'families' && row.record_id === 'FAM-2' && !!row.created_at,
    JSON.stringify(row));
}
{
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { full_name: 'Renamed Teacher' }, filters: eqId('TCH-1') });
  check('manager UPDATE teacher -> 200', r.status === 200, 'got ' + r.status);
  const a = await auditRows();
  const row = a.rows.find((x) => x.action === 'update') || {};
  check('audit: update entry logged (teachers / TCH-1)',
    a.rows.length === 2 && row.table_name === 'teachers' && row.record_id === 'TCH-1',
    'rows=' + a.rows.length + ' ' + JSON.stringify(row));
}
{
  const r = await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-CB', key: 'alhuda_custom_books', value: '[]' } });
  check('manager catalog upsert -> 200', r.status === 200, 'got ' + r.status);
  const a = await auditRows();
  const row = a.rows.find((x) => x.table_name === 'system_settings') || {};
  check('audit: settings entry keyed by the settings KEY',
    a.rows.length === 3 && row.record_id === 'alhuda_custom_books' && row.action === 'upsert',
    'rows=' + a.rows.length + ' ' + JSON.stringify(row));
}

// ---- Failed / denied writes are NOT logged ------------------------------------
{
  const r = await dbPost(TOK.manager, { table: 'families', action: 'delete', filters: eqId('FAM-1') });
  check('manager DELETE family -> 403 (Batch 2 holds)', r.status === 403, 'got ' + r.status);
  const a = await auditRows();
  check('audit: denied write NOT logged (still 3 rows)', a.rows.length === 3, 'rows=' + a.rows.length);
}

// ---- Owner writes are NOT logged (the trail is for manager activity) ----------
{
  const r = await dbPost(TOK.owner, {
    table: 'families', action: 'insert',
    values: { id: 'FAM-3', parent_name: 'Owner Added', email: 'third@example.test', notes: JSON.stringify({}) },
  });
  check('owner INSERT family -> 200', r.status === 200, 'got ' + r.status);
  const a = await auditRows();
  check('audit: owner write NOT logged (still 3 rows)', a.rows.length === 3, 'rows=' + a.rows.length);
}

// ---- The log itself is owner-only ---------------------------------------------
{
  const m = await dbPost(TOK.manager, { table: 'audit_log', action: 'select' });
  check('manager SELECT audit_log -> 403', m.status === 403, 'got ' + m.status);
  const t = await dbPost(TOK.teacher, { table: 'audit_log', action: 'select' });
  check('teacher SELECT audit_log -> 403', t.status === 403, 'got ' + t.status);
  const p = await dbPost(TOK.parent, { table: 'audit_log', action: 'select' });
  check('parent SELECT audit_log -> 403', p.status === 403, 'got ' + p.status);
  const f = await dbPost(TOK.manager, { table: 'audit_log', action: 'insert', values: { id: 'AUD-FORGED', actor_id: 'x', actor_role: 'manager', action: 'delete', table_name: 'families', record_id: 'FAM-1' } });
  check('manager INSERT audit_log (forge) -> 403', f.status === 403, 'got ' + f.status);
  const d = await dbPost(TOK.manager, { table: 'audit_log', action: 'delete', filters: eqId('AUD-FORGED') });
  check('manager DELETE audit_log (erase) -> 403', d.status === 403, 'got ' + d.status);
  const a = await auditRows();
  check('audit: trail intact after forge/erase attempts (3 rows, no forged row)',
    a.rows.length === 3 && !a.rows.some((x) => x.id === 'AUD-FORGED'), 'rows=' + a.rows.length);
}

// ---- The log NEVER contains record content -------------------------------------
{
  const a = await auditRows();
  const blob = JSON.stringify(a.rows);
  check('audit: no contact values in any entry',
    !blob.includes('audit-leak-check@example.test') && !blob.includes('second@example.test') &&
    !blob.includes('+10000000201') && !blob.includes('+10000000203'),
    blob.slice(0, 300));
}

fakeDb.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
