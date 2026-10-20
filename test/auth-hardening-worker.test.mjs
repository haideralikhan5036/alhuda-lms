// Auth-hardening (Batch 1) worker test — B5 scrubber + B2/B3 staff-login.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a fake
// D1 backed by Node's built-in SQLite (node:sqlite), so both the /api/db
// scope+scrub pipeline and /api/auth/staff-login run end-to-end on real SQL.
// Run from the repo root:  node test/auth-hardening-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite). All "passwords" below are synthetic
// test markers, never real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Copy the worker tree to a temp dir with an ESM package.json so node can
// import the real module files (the repo itself has no package.json).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-hardening-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-worker-auth-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';

// ---- Fake D1 over real in-memory SQLite ------------------------------------
// Implements the subset of the D1 API the worker + db engine use:
// prepare(sql).bind(...).all()/run()/first(), db.batch([...]), db.exec().
class FakeStatement {
  constructor(db, sql) { this._db = db; this._sql = sql; this._params = []; }
  bind(...params) { this._params = params; return this; }
  async all() {
    const results = this._db.prepare(this._sql).all(...this._params);
    return { results, success: true, meta: {} };
  }
  async run() {
    const r = this._db.prepare(this._sql).run(...this._params);
    return { success: true, meta: { changes: Number(r.changes || 0) } };
  }
  async first() {
    const row = this._db.prepare(this._sql).get(...this._params);
    return row === undefined ? null : row;
  }
}
class FakeD1 {
  constructor() { this._db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this._db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
  async exec(sql) { this._db.exec(sql); return { success: true }; }
  seed(sql, ...params) { this._db.prepare(sql).run(...params); } // test-only
  close() { try { this._db.close(); } catch (e) {} }
}

const fakeDb = new FakeD1();
const env = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  DB: fakeDb,
};

// ---- Synthetic credential markers (fake values, safe to print) -------------
const M = {
  pc: 'MARKER-PC-PASSWORD-9f1',          // portal_credentials.password (plaintext)
  syncT: 'MARKER-SYNC-TEACHER-PW-9f2',   // lms_shared_sync.teacher_accounts.*.password
  syncP: 'MARKER-SYNC-PARENT-PW-9f3',    // lms_shared_sync.parent_accounts.*.password
  nested: 'MARKER-SYNC-NESTED-PW-9f4',   // deeper nested password inside the blob
  teachPlain: 'MARKER-TEACHER-PLAINTEXT-9f5',
  parentPlain: 'MARKER-PARENT-PLAINTEXT-9f6',
};
const ALL_MARKERS = Object.values(M);
const DEFAULT_PW = '12345678'; // the well-known legacy default under test
const TEACHER_PW = 'Teacher-Strong-99'; // test-only password for hashed accounts
const PARENT_PW = 'Parent-Strong-99';
const MANAGER_PW = 'Manager-Strong-99';

// Same format hashPassword() produces: sha256$<32 hex salt>$<64 hex hash>
// of SHA-256(saltHex + ':' + password).
function hashPw(pw) {
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = createHash('sha256').update(saltHex + ':' + pw).digest('hex');
  return `sha256$${saltHex}$${hashHex}`;
}

// ---- Helpers ---------------------------------------------------------------
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
  return { status: res.status, text: await res.text() };
}

let ipSeq = 0;
async function staffLogin(role, identifier, password) {
  ipSeq += 1; // distinct IP per attempt: the login limiter is per-IP (10/10min)
  const req = new Request('https://worker.test/api/auth/staff-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.9.8.${ipSeq}` },
    body: JSON.stringify({ role, identifier, password }),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'TCH-1', role: 'teacher' }, WORKER_SECRET),
  parentCarrier: await createSessionToken({ sub: 'FAM-CARRIER', role: 'parent' }, WORKER_SECRET),
};

// ---- Setup: trigger schema creation via a real /api/db call, then seed ----
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db families select on empty db -> 200', boot.status === 200, 'got ' + boot.status + ' ' + boot.text.slice(0, 200));
}

const carrierNotes = JSON.stringify({
  portal_credentials: { username: 'carrieruser', password: M.pc },
  fee_history: [],
  lms_shared_sync: {
    teacher_accounts: { 'TCH-1': { username: 'teachone', password: M.syncT } },
    parent_accounts: { 'FAM-X': { username: 'parentx', password: M.syncP } },
    misc_nested: { level1: { password: M.nested, keep: 'keepme' } },
    announcements: [],
  },
});
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-CARRIER', 'Carrier Parent', 'carrier@example.com', carrierNotes);
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-HASHED', 'Hashed Parent', 'hashed@example.com',
  JSON.stringify({ portal_credentials: { username: 'hashparent', password: hashPw(PARENT_PW) } }));
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-PLAIN', 'Plain Parent', 'plain@example.com',
  JSON.stringify({ portal_credentials: { username: 'plainparent', password: M.parentPlain } }));

fakeDb.seed('INSERT INTO teachers (id, full_name, address, notes) VALUES (?, ?, ?, ?)',
  'TCH-PLAIN', 'Plain Teacher', JSON.stringify({ username: 'plainteach', password: M.teachPlain }), null);
fakeDb.seed('INSERT INTO teachers (id, full_name, address, notes) VALUES (?, ?, ?, ?)',
  'TCH-DEFAULT', 'Default Teacher', JSON.stringify({ username: 'defaultteach', password: DEFAULT_PW }), null);
fakeDb.seed('INSERT INTO teachers (id, full_name, address, notes) VALUES (?, ?, ?, ?)',
  'TCH-HASHED', 'Hashed Teacher', JSON.stringify({ username: 'hashedteach', password: hashPw(TEACHER_PW) }), null);
fakeDb.seed('INSERT INTO teachers (id, full_name, address, notes) VALUES (?, ?, ?, ?)',
  'MGR-HASHED', 'Boss Manager', JSON.stringify({ username: 'bossmanager', password: hashPw(MANAGER_PW), employee_type: 'manager' }), null);

// ---- (a)/(b) /api/db families scrubbing per role ---------------------------
{
  const r = await dbPost(TOK.manager, { table: 'families', action: 'select' });
  check('B5 manager families select -> 200', r.status === 200, 'got ' + r.status);
  for (const m of ALL_MARKERS) {
    check(`B5 manager response contains NO seeded password (${m})`, !r.text.includes(m), 'LEAKED');
  }
  check('B5 manager response keeps non-password blob data (blob not nuked)',
    r.text.includes('keepme') && r.text.includes('carrieruser') && r.text.includes('teachone'),
    r.text.slice(0, 300));
}
{
  const r = await dbPost(TOK.parentCarrier, { table: 'families', action: 'select' });
  check('B5 parent (carrier family) families select -> 200', r.status === 200, 'got ' + r.status);
  for (const m of ALL_MARKERS) {
    check(`B5 parent response contains NO seeded password (${m})`, !r.text.includes(m), 'LEAKED');
  }
  check('B5 parent sees own row only (no FAM-HASHED/FAM-PLAIN rows)',
    r.text.includes('FAM-CARRIER') && !r.text.includes('FAM-HASHED') && !r.text.includes('FAM-PLAIN'),
    r.text.slice(0, 300));
  check('B5 parent response keeps non-password blob data', r.text.includes('keepme'), r.text.slice(0, 300));
}
{
  const r = await dbPost(TOK.teacher, { table: 'families', action: 'select' });
  check('B5 teacher families select -> 403 (table denied to teachers)', r.status === 403, 'got ' + r.status);
  for (const m of ALL_MARKERS) {
    check(`B5 teacher response contains NO seeded password (${m})`, !r.text.includes(m), 'LEAKED');
  }
}
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('B5 owner families select -> 200', r.status === 200, 'got ' + r.status);
  for (const m of ALL_MARKERS.slice(0, 4)) {
    check(`B5 owner response UNCHANGED: seeded value present (${m})`, r.text.includes(m), 'MISSING for owner');
  }
}

// ---- (c) staff-login eligibility -------------------------------------------
{
  const r = await staffLogin('teacher', 'plainteach', M.teachPlain);
  check('B2/B3 teacher with legacy plaintext password -> 401 no_password_set',
    r.status === 401 && r.data && r.data.error === 'no_password_set', `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await staffLogin('teacher', 'defaultteach', DEFAULT_PW);
  check('B2 teacher whose stored password IS the default -> 401 no_password_set',
    r.status === 401 && r.data && r.data.error === 'no_password_set', `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await staffLogin('parent', 'plainparent', M.parentPlain);
  check('B2/B3 parent with legacy plaintext password -> 401 no_password_set',
    r.status === 401 && r.data && r.data.error === 'no_password_set', `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await staffLogin('parent', 'carrieruser', M.pc);
  check('B3 parent carrier account (plaintext in portal_credentials) -> 401 no_password_set',
    r.status === 401 && r.data && r.data.error === 'no_password_set', `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await staffLogin('parent', 'hashparent', PARENT_PW);
  check('parent with hashed password + correct password -> 200 ok + token',
    r.status === 200 && r.data && r.data.ok === true && typeof r.data.token === 'string' && r.data.id === 'FAM-HASHED',
    `got ${r.status} ${JSON.stringify(r.data)}`);
  const bad = await staffLogin('parent', 'hashparent', 'Wrong-Password-1');
  check('parent with hashed password + wrong password -> 401 generic (not no_password_set)',
    bad.status === 401 && bad.data && bad.data.error === 'Invalid username or password.',
    `got ${bad.status} ${JSON.stringify(bad.data)}`);
}
{
  const r = await staffLogin('teacher', 'hashedteach', TEACHER_PW);
  check('teacher with hashed password + correct password -> 200 ok + token',
    r.status === 200 && r.data && r.data.ok === true && typeof r.data.token === 'string' && r.data.id === 'TCH-HASHED',
    `got ${r.status} ${JSON.stringify(r.data)}`);
  const bad = await staffLogin('teacher', 'hashedteach', 'Wrong-Password-2');
  check('teacher with hashed password + wrong password -> 401 generic',
    bad.status === 401 && bad.data && bad.data.error === 'Invalid username or password.',
    `got ${bad.status} ${JSON.stringify(bad.data)}`);
  const def = await staffLogin('teacher', 'hashedteach', DEFAULT_PW);
  check('B2 default password never logs in (hashed account) -> 401 generic',
    def.status === 401 && def.data && def.data.error === 'Invalid username or password.',
    `got ${def.status} ${JSON.stringify(def.data)}`);
}
{
  const r = await staffLogin('manager', 'bossmanager', MANAGER_PW);
  check('manager with hashed password + correct password -> 200 ok + token',
    r.status === 200 && r.data && r.data.ok === true && typeof r.data.token === 'string' && r.data.id === 'MGR-HASHED',
    `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await staffLogin('teacher', 'nosuchuser', 'Whatever-123');
  check('unknown identifier -> 401 generic (no enumeration, not no_password_set)',
    r.status === 401 && r.data && r.data.error === 'Invalid username or password.',
    `got ${r.status} ${JSON.stringify(r.data)}`);
}

fakeDb.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
