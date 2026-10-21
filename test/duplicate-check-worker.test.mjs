// Duplicate-check (Batch 3A, B15) worker test — POST
// /api/families/check-duplicates answers whether an email / phone /
// WhatsApp / parent name already exists, server-side, so MANAGERS (who
// never see contact values) can still be warned about duplicates. The
// response must NEVER contain a stored contact value.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a
// fake D1 backed by Node's built-in SQLite (node:sqlite).
// Run from the repo root:  node test/duplicate-check-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// All contact values below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dupcheck-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'dupcheck-test-secret';
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

async function dupPost(token, body) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const req = new Request('https://worker.test/api/families/check-duplicates', {
    method: 'POST', headers, body: JSON.stringify(body),
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
  managerRl: await createSessionToken({ sub: 'TCH-MGR-RL', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-1', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

// ---- Setup: schema boot + seeds ----------------------------------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed('INSERT INTO families (id, parent_name, email, phone, whatsapp, notes) VALUES (?, ?, ?, ?, ?, ?)',
  'FAM-1', 'Ahmed Raza', 'Raza@Example.test', '0300-1234567', '+92 321 7654321',
  JSON.stringify({
    portal_credentials: { username: 'ahmedraza', whatsapp: '0321-7654321', email: 'raza@example.test' },
    bio_meta: { mobile: '03001234567', city: 'Leeds' },
  }));
fakeDb.seed('INSERT INTO families (id, parent_name, email, phone, notes) VALUES (?, ?, ?, ?, ?)',
  'FAM-2', 'Ahmed Raza', 'other@example.test', '+1 555 010 2233', JSON.stringify({}));

// ---- (1) owner email match (case/space-insensitive) + NO leak ------------------
{
  const r = await dupPost(TOK.owner, { email: '  RAZA@example.test ' });
  check('B15 owner email query -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  const m = (r.data && r.data.matches) || [];
  check('B15 email matches FAM-1 only, matchedOn=[email]',
    r.data && r.data.ok === true && m.length === 1 && m[0].familyId === 'FAM-1' &&
    m[0].parentName === 'Ahmed Raza' && m[0].matchedOn.length === 1 && m[0].matchedOn[0] === 'email',
    JSON.stringify(r.data));
  check('B15 response leaks NO stored contact value',
    !r.text.includes('0300') && !r.text.includes('1234567') && !r.text.includes('7654321') &&
    !r.text.includes('Raza@Example.test') && !r.text.includes('raza@example.test') &&
    !r.text.includes('other@example.test') && !r.text.includes('555 010'),
    r.text.slice(0, 200));
}

// ---- (2) manager phone match (+92 submitted vs 0-prefixed stored) ---------------
{
  const r = await dupPost(TOK.manager, { phone: '+92 300 1234567' });
  const m = (r.data && r.data.matches) || [];
  check('B15 manager phone query -> FAM-1 via [phone] (normalisation +92 vs 0)',
    r.status === 200 && m.length === 1 && m[0].familyId === 'FAM-1' &&
    m[0].matchedOn.length === 1 && m[0].matchedOn[0] === 'phone',
    'got ' + r.status + ' ' + JSON.stringify(r.data));
}

// ---- (3) manager whatsapp match is CROSS-CHANNEL (stored phone / bio mobile) ---
{
  const r = await dupPost(TOK.manager, { whatsapp: '03001234567' });
  const m = (r.data && r.data.matches) || [];
  check('B15 manager whatsapp query -> FAM-1 via [whatsapp] (cross-channel)',
    r.status === 200 && m.length === 1 && m[0].familyId === 'FAM-1' &&
    m[0].matchedOn.length === 1 && m[0].matchedOn[0] === 'whatsapp',
    'got ' + r.status + ' ' + JSON.stringify(r.data));
}

// ---- (4) owner parentName match hits BOTH families -------------------------------
{
  const r = await dupPost(TOK.owner, { parentName: '  ahmed   RAZA ' });
  const m = (r.data && r.data.matches) || [];
  const ids = m.map((x) => x.familyId).sort();
  check('B15 parentName query -> FAM-1 AND FAM-2 via [parentName]',
    r.status === 200 && m.length === 2 && ids.join(',') === 'FAM-1,FAM-2' &&
    m.every((x) => x.matchedOn.length === 1 && x.matchedOn[0] === 'parentName'),
    'got ' + r.status + ' ' + JSON.stringify(r.data));
}

// ---- (5) fresh values -> no matches; unknown fields ignored -----------------------
{
  const r = await dupPost(TOK.manager, {
    email: 'brand-new@example.test', phone: '+44 20 7946 0958',
    whatsapp: '+44 7700 900123', parentName: 'Completely New Person', unknownField: 'ignored',
  });
  check('B15 fresh values -> 200 with matches: [] (unknown field ignored)',
    r.status === 200 && r.data && r.data.ok === true && Array.isArray(r.data.matches) && r.data.matches.length === 0,
    'got ' + r.status + ' ' + JSON.stringify(r.data));
}

// ---- (6) auth + validation ---------------------------------------------------------
{
  const t = await dupPost(TOK.teacher, { email: 'raza@example.test' });
  check('B15 teacher token -> 403', t.status === 403, 'got ' + t.status);
  const p = await dupPost(TOK.parent, { email: 'raza@example.test' });
  check('B15 parent token -> 403', p.status === 403, 'got ' + p.status);
  const a = await dupPost(null, { email: 'raza@example.test' });
  check('B15 no token -> 401', a.status === 401, 'got ' + a.status);
  const e = await dupPost(TOK.owner, {});
  check('B15 empty body {} -> 400', e.status === 400, 'got ' + e.status);
  const w = await dupPost(TOK.owner, { email: '   ', phone: ' - ' });
  check('B15 whitespace-only values -> 400 (nothing to check)', w.status === 400, 'got ' + w.status);
}

// ---- (7) rate limit: 30 per 10 min per subject; the 31st is 429 ----------------------
{
  let firstThirtyOk = true;
  let lastStatus = 0;
  for (let i = 0; i < 30; i++) {
    const r = await dupPost(TOK.managerRl, { email: 'nobody@example.test' });
    lastStatus = r.status;
    if (r.status !== 200) firstThirtyOk = false;
  }
  check('B15 rate limit: first 30 checks from a fresh subject -> 200', firstThirtyOk, 'last=' + lastStatus);
  const r31 = await dupPost(TOK.managerRl, { email: 'nobody@example.test' });
  check('B15 rate limit: 31st check -> 429 Too many checks',
    r31.status === 429 && r31.data && /Too many checks/i.test(r31.data.error || ''),
    'got ' + r31.status + ' ' + r31.text.slice(0, 120));
}

fakeDb.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
