// Slow-classes backend test — schema-version fast path in
// functions/api/db.js ensureSchema: a cold Worker isolate must skip the
// ~35-statement DDL replay when the persisted schema_version marker
// matches, re-run it on version mismatch, and fall back to full DDL
// when the marker cannot be read. Drives the REAL cloudflare/worker.js
// + functions/api/db.js against a fake D1 backed by Node's SQLite.
// Run from the repo root:  node test/slow-classes-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite). All values below are SYNTHETIC.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Secret assembled at runtime (never a single secret-looking literal).
const WORKER_SECRET = 'slow-classes' + '-test-secret-01';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const SCHEMA_VERSION = '2026-10-28-v2';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

class FakeStatement {
  constructor(db, sql, counter) { this._db = db; this._sql = sql; this._params = []; this._counter = counter; }
  bind(...params) { this._params = params; return this; }
  async all() { const results = this._db.prepare(this._sql).all(...this._params); return { results, success: true, meta: {} }; }
  async run() { const r = this._db.prepare(this._sql).run(...this._params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
  async first() { const row = this._db.prepare(this._sql).get(...this._params); return row === undefined ? null : row; }
}

// Counting wrapper: counts DDL statements (CREATE/ALTER/INDEX) prepared
// through it, so the test can prove the fast path skipped the replay.
class CountingD1 {
  constructor(sharedDb, opts = {}) {
    this._db = sharedDb;
    this.ddlCount = 0;
    this.throwOnSchemaVersion = !!opts.throwOnSchemaVersion;
  }
  prepare(sql) {
    if (this.throwOnSchemaVersion && String(sql).includes('schema_version')) {
      throw new Error('simulated marker-read failure');
    }
    if (/^\s*(CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)|ALTER\s+TABLE)/i.test(String(sql))) this.ddlCount++;
    return new FakeStatement(this._db, sql);
  }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
}

async function loadWorker() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slow-classes-worker-'));
  for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
    const dst = path.join(TMP, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f), dst);
  }
  fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
  const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
  const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);
  return { worker, token: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET) };
}

async function dbPost(worker, token, env, body) {
  const req = new Request('https://worker.test/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Origin': ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}

function markerValue(sharedDb) {
  try {
    const row = sharedDb.prepare('SELECT value FROM system_settings WHERE key = ?').get('schema_version');
    return row ? row.value : null;
  } catch (e) { return null; }
}

// ---- 1. Cold isolate 1 boots schema + records the marker ------------
const sharedDb = new DatabaseSync(':memory:');
const d1a = new CountingD1(sharedDb);
const w1 = await loadWorker();
const env1 = { DB: d1a, WORKER_AUTH_SECRET: WORKER_SECRET };
let r = await dbPost(w1.worker, w1.token, env1, { table: 'families', action: 'select' });
check('cold isolate 1: families select succeeds', r.status === 200, r.text.slice(0, 200));
check('cold isolate 1: full DDL replay ran (>20 DDL statements)', d1a.ddlCount > 20, 'ddl=' + d1a.ddlCount);
check('cold isolate 1: schema_version marker recorded', markerValue(sharedDb) === SCHEMA_VERSION, String(markerValue(sharedDb)));

// ---- 2. Cold isolate 2 (fresh module) skips the DDL replay ----------
const d1b = new CountingD1(sharedDb);
const w2 = await loadWorker();
const env2 = { DB: d1b, WORKER_AUTH_SECRET: WORKER_SECRET };
r = await dbPost(w2.worker, w2.token, env2, { table: 'families', action: 'select' });
check('cold isolate 2: families select succeeds (fast path)', r.status === 200, r.text.slice(0, 200));
check('cold isolate 2: ZERO DDL statements on a marker-matching request', d1b.ddlCount === 0, 'ddl=' + d1b.ddlCount);
r = await dbPost(w2.worker, w2.token, env2, { table: 'teachers', action: 'insert', values: { id: 'TCH-9', full_name: 'Synthetic Teacher' } });
check('cold isolate 2: writes still work after fast path', r.status === 200, r.text.slice(0, 200));

// ---- 3. Version mismatch re-runs the full DDL path --------------------
sharedDb.prepare('UPDATE system_settings SET value = ? WHERE key = ?').run('old-version-000', 'schema_version');
check('setup: marker downgraded to an old version', markerValue(sharedDb) === 'old-version-000');
const d1c = new CountingD1(sharedDb);
const w3 = await loadWorker();
const env3 = { DB: d1c, WORKER_AUTH_SECRET: WORKER_SECRET };
r = await dbPost(w3.worker, w3.token, env3, { table: 'families', action: 'select' });
check('version mismatch: request succeeds', r.status === 200, r.text.slice(0, 200));
check('version mismatch: full DDL replay ran again (>20 DDL)', d1c.ddlCount > 20, 'ddl=' + d1c.ddlCount);
check('version mismatch: marker re-recorded at current version', markerValue(sharedDb) === SCHEMA_VERSION, String(markerValue(sharedDb)));

// ---- 4. Marker-read failure falls back to full DDL (never 500) -------
const freshDb = new DatabaseSync(':memory:');
const d1d = new CountingD1(freshDb, { throwOnSchemaVersion: true });
const w4 = await loadWorker();
const env4 = { DB: d1d, WORKER_AUTH_SECRET: WORKER_SECRET };
r = await dbPost(w4.worker, w4.token, env4, { table: 'families', action: 'select' });
check('marker failure: request still succeeds via DDL fallback', r.status === 200, r.text.slice(0, 200));
check('marker failure: full DDL replay ran despite the throw', d1d.ddlCount > 20, 'ddl=' + d1d.ddlCount);
d1d.throwOnSchemaVersion = false;
r = await dbPost(w4.worker, w4.token, env4, { table: 'families', action: 'select' });
check('marker failure: follow-up request works (tables exist)', r.status === 200, r.text.slice(0, 200));

const failed = results.filter(x => !x.pass).length;
console.log(`\nslow-classes-worker: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
