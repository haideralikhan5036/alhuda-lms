// Manager-portal (Batch 2) worker test — B6/B7/B16 server-side enforcement.
// Drives the REAL cloudflare/worker.js (via a temp ESM copy) against a fake
// D1 backed by Node's built-in SQLite (node:sqlite), plus a mock Apps Script
// relay (local HTTPS, 302-redirect like the real script) for notify-parent.
// Run from the repo root:  node test/manager-portal-worker.test.mjs
// Requires: node >= 22.5 (node:sqlite), openssl (throwaway self-signed cert).
// All passwords / contact values below are SYNTHETIC test markers.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-portal-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
try { execSync('openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=127.0.0.1"', { cwd: TMP, stdio: 'ignore' }); }
catch (e) { console.error('openssl is required for this test'); process.exit(2); }
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-worker-auth-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const RELAY_SECRET = 'test-relay-secret-value';

// ---- capture worker logs to prove the notify path never logs the address --
// (the test's own check output goes through rawLog so it is NOT captured —
//  several check names legitimately mention the synthetic markers)
const rawLog = console.log.bind(console);
const capturedLogs = [];
for (const m of ['log', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => { capturedLogs.push(a.map(String).join(' ')); orig(...a); };
}

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

// ---- Mock relay (r1 302 -> r2 capture, like Apps Script) --------------------
const received = [];
const relay = https.createServer({ key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) }, (req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    if (req.url === '/r1' && req.method === 'POST') { res.writeHead(302, { Location: '/r2' }); res.end(); return; }
    if (req.url === '/r2') { let parsed = null; try { parsed = JSON.parse(data); } catch (e) {} received.push(parsed); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => relay.listen(0, '127.0.0.1', r));
const RELAY_PORT = relay.address().port;

const env = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  ALLOWED_ORIGINS: ORIGIN,
  RELAY_URL: `https://127.0.0.1:${RELAY_PORT}/r1`,
  RELAY_SECRET,
  DB: fakeDb,
};

// ---- Synthetic markers ------------------------------------------------------
function hashPw(pw) {
  const saltHex = randomBytes(16).toString('hex');
  const hashHex = createHash('sha256').update(saltHex + ':' + pw).digest('hex');
  return `sha256$${saltHex}$${hashHex}`;
}
const MANAGER_PW = 'Manager-Strong-99';
const TEACHER_PW = 'Teacher-Strong-99';
const PARENT_PW = 'Parent-Strong-99';
const FAM_EMAIL = 'fam1@example.test';
const FAM_PHONE = '+10000000001';
const FAM_WHATSAPP = '+10000000002';
const PC_WHATSAPP = '+10000000003';
const PC_EMAIL = 'portal@example.test';
const BIO_PHONE = '+10000000004';
const SYNC_WA = '+10000000005';
const SYNC_EMAIL = 'sync@example.test';
const STU_PHONE = '+10000000006';
const STU_GUARDIAN_WA = '+10000000008';
const TRL_WHATSAPP = '+10000000007';
const TRL_EMAIL = 'trial@example.test';
const SYNC_PW_1 = 'MARKER-SYNC-PARENT-PW-b2';
const SYNC_PW_2 = 'MARKER-SYNC-TEACHER-PW-b2';
const FAM_PC_HASH = hashPw(PARENT_PW);
const ALL_CONTACTS = [FAM_EMAIL, FAM_PHONE, FAM_WHATSAPP, PC_WHATSAPP, PC_EMAIL, BIO_PHONE, SYNC_WA, SYNC_EMAIL, STU_PHONE, STU_GUARDIAN_WA, TRL_WHATSAPP, TRL_EMAIL];

// ---- Helpers ---------------------------------------------------------------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  rawLog((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
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

let ipSeq = 0;
async function staffLogin(role, identifier, password) {
  ipSeq += 1;
  const req = new Request('https://worker.test/api/auth/staff-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.7.7.${ipSeq}` },
    body: JSON.stringify({ role, identifier, password }),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

let spSeq = 0;
async function setPassword(token, body) {
  spSeq += 1;
  const req = new Request('https://worker.test/api/auth/set-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'cf-connecting-ip': `10.8.8.${spSeq}` },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function notify(token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const req = new Request('https://worker.test/api/email/notify-parent', { method: 'POST', headers, body: JSON.stringify(body) });
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
function rowOf(resp, id) {
  const rows = (resp.data && resp.data.data) || [];
  return (Array.isArray(rows) ? rows : [rows]).find((r) => r && String(r.id) === String(id)) || null;
}
function parseJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// ---- Setup: schema boot + seeds ---------------------------------------------
{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', boot.status === 200, 'got ' + boot.status);
}

fakeDb.seed('INSERT INTO teachers (id, full_name, phone, address, witness_name, rate_per_slot) VALUES (?, ?, ?, ?, ?, ?)',
  'TCH-MGR-1', 'Manager One', '+10000000101',
  JSON.stringify({ username: 'mgruser', password: hashPw(MANAGER_PW), employee_type: 'manager', emp_id: 'MGR-001', salary_slips: { '2026-09': { amount: 90000, status: 'Paid' } }, monthly_salary: 90000 }),
  null, 3000);
fakeDb.seed('INSERT INTO teachers (id, full_name, phone, address, witness_name, rate_per_slot) VALUES (?, ?, ?, ?, ?, ?)',
  'TCH-MGR-2', 'Manager Two', '+10000000102',
  JSON.stringify({ username: 'mgrtwo', employee_type: 'manager', emp_id: 'MGR-002', salary_slips: { '2026-09': { amount: 80000 } }, teacher_account: { username: 'mgrtwo', salary_info: 'confidential' } }),
  null, 3500);
fakeDb.seed('INSERT INTO teachers (id, full_name, phone, address, witness_name, rate_per_slot) VALUES (?, ?, ?, ?, ?, ?)',
  'TCH-1', 'Regular Teacher', '+10000000103',
  JSON.stringify({ username: 'teachone', password: hashPw(TEACHER_PW), salary_slips: { '2026-09': { amount: 44000, status: 'Paid' } } }),
  null, 2200);

const famNotes = JSON.stringify({
  portal_credentials: { username: 'famuser', password: FAM_PC_HASH, whatsapp: PC_WHATSAPP, email: PC_EMAIL },
  bio_meta: { phone: BIO_PHONE, city: 'Leeds' },
  lms_shared_sync: {
    parent_accounts: { 'FAM-1': { username: 'famuser', password: SYNC_PW_1, whatsapp: SYNC_WA, email: SYNC_EMAIL } },
    teacher_accounts: { 'TCH-1': { username: 'teachone', password: SYNC_PW_2 } },
    teacher_salaries: { 'TCH-1': { amount: 44000 }, 'TCH-MGR-1': { amount: 90000 } },
  },
});
fakeDb.seed('INSERT INTO families (id, parent_name, email, phone, whatsapp, notes) VALUES (?, ?, ?, ?, ?, ?)',
  'FAM-1', 'Test Parent', FAM_EMAIL, FAM_PHONE, FAM_WHATSAPP, famNotes);
fakeDb.seed('INSERT INTO families (id, parent_name, email, notes) VALUES (?, ?, ?, ?)',
  'FAM-NOEMAIL', 'No Email Parent', null, JSON.stringify({}));
fakeDb.seed('INSERT INTO students (id, family_id, name, notes) VALUES (?, ?, ?, ?)',
  'STU-1', 'FAM-1', 'Kid One', JSON.stringify({ phone: STU_PHONE, level: 'Qaida', guardian: { whatsapp: STU_GUARDIAN_WA } }));
fakeDb.seed('INSERT INTO trial_students (id, student_name, whatsapp, notes) VALUES (?, ?, ?, ?)',
  'TRL-1', 'Trial Kid', TRL_WHATSAPP, JSON.stringify({ email: TRL_EMAIL, source: 'web' }));
fakeDb.seed('INSERT INTO payments (id, family_id, amount) VALUES (?, ?, ?)', 'PAY-1', 'FAM-1', 100);
for (const [id, key, value] of [
  ['SYS-1', 'alhuda_custom_books', '[]'],
  ['SYS-2', 'alhuda_custom_books_index', '[]'],
  ['SYS-3', 'BOOK_PAGE_book1_0', 'r2/key0'],
  ['SYS-4', 'alhuda_logo', 'logo-url'],
  ['SYS-5', 'alhuda_deleted_books', '[]'],
  ['SYS-6', 'relay_config', '{"x":1}'],
]) {
  fakeDb.seed('INSERT INTO system_settings (id, key, value) VALUES (?, ?, ?)', id, key, value);
}

// ---- (7) staff-login identity fields -----------------------------------------
{
  const r = await staffLogin('manager', 'mgruser', MANAGER_PW);
  check('B6 manager staff-login -> 200 + token', r.status === 200 && r.data && r.data.ok === true && typeof r.data.token === 'string', `got ${r.status} ${JSON.stringify(r.data)}`);
  check('B6 manager login response has emp_id (MGR-001) + full_name',
    r.data && r.data.emp_id === 'MGR-001' && r.data.full_name === 'Manager One', JSON.stringify(r.data));
}
{
  const r = await staffLogin('teacher', 'teachone', TEACHER_PW);
  check('B6 teacher login response has emp_id (record-id fallback) + full_name',
    r.status === 200 && r.data && r.data.emp_id === 'TCH-1' && r.data.full_name === 'Regular Teacher', `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await staffLogin('parent', 'famuser', PARENT_PW);
  check('B6 parent login response has full_name and NO emp_id',
    r.status === 200 && r.data && r.data.full_name === 'Test Parent' && !('emp_id' in r.data), `got ${r.status} ${JSON.stringify(r.data)}`);
}

// ---- (5) manager read masking -------------------------------------------------
let mgrFamRow = null;
{
  const r = await dbPost(TOK.manager, { table: 'families', action: 'select' });
  check('B7 manager families select -> 200', r.status === 200, 'got ' + r.status);
  mgrFamRow = rowOf(r, 'FAM-1');
  check('B7 manager sees family row', !!mgrFamRow, r.text.slice(0, 200));
  if (mgrFamRow) {
    check('B7 family contact COLUMNS masked (email/phone/whatsapp/parent_email)',
      mgrFamRow.email === 'Hidden' && mgrFamRow.phone === 'Hidden' && mgrFamRow.whatsapp === 'Hidden' && mgrFamRow.parent_email === 'Hidden',
      JSON.stringify({ email: mgrFamRow.email, phone: mgrFamRow.phone, whatsapp: mgrFamRow.whatsapp, parent_email: mgrFamRow.parent_email }));
    const notes = parseJson(mgrFamRow.notes) || {};
    const pc = notes.portal_credentials || {};
    check('B7 notes portal_credentials: password ABSENT (Batch 1 holds), contacts masked',
      !('password' in pc) && pc.whatsapp === 'Hidden' && pc.email === 'Hidden' && pc.username === 'famuser',
      JSON.stringify(pc));
    check('B7 notes bio_meta phone masked, non-contact data kept',
      notes.bio_meta && notes.bio_meta.phone === 'Hidden' && notes.bio_meta.city === 'Leeds', JSON.stringify(notes.bio_meta));
    const sync = notes.lms_shared_sync || {};
    const pa = (sync.parent_accounts || {})['FAM-1'] || {};
    check('B7 lms_shared_sync parent_accounts: password ABSENT, contacts masked',
      !('password' in pa) && pa.whatsapp === 'Hidden' && pa.email === 'Hidden', JSON.stringify(pa));
    const sal = sync.teacher_salaries || {};
    check('B7 lms_shared_sync teacher_salaries: manager entry REMOVED, teacher entry KEPT',
      !('TCH-MGR-1' in sal) && 'TCH-1' in sal, JSON.stringify(Object.keys(sal)));
  }
  for (const c of ALL_CONTACTS) {
    check(`B7 manager families response leaks NO contact value (${c})`, !r.text.includes(c), 'LEAKED');
  }
  check('B7 manager families response leaks NO portal password hash', !r.text.includes(FAM_PC_HASH), 'LEAKED');
  check('B7 manager families response leaks NO sync passwords', !r.text.includes(SYNC_PW_1) && !r.text.includes(SYNC_PW_2), 'LEAKED');
}
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  const f = rowOf(r, 'FAM-1');
  check('Owner families select UNCHANGED: real contacts + password hash + manager salary entry present',
    !!f && f.email === FAM_EMAIL && f.phone === FAM_PHONE &&
    // Batch 7A: the (7) parent login above transparently upgrades the
    // stored hash from legacy sha256$ to pbkdf2$ — so the value is no
    // longer literally FAM_PC_HASH, but it must still be a real hashed
    // password (never plaintext, never absent).
    (parseJson(f.notes)?.portal_credentials?.password === FAM_PC_HASH ||
     String(parseJson(f.notes)?.portal_credentials?.password || '').startsWith('pbkdf2$')) &&
    !!parseJson(f.notes)?.lms_shared_sync?.teacher_salaries?.['TCH-MGR-1'],
    r.text.slice(0, 200));
}
{
  const r = await dbPost(TOK.manager, { table: 'students', action: 'select' });
  const s = rowOf(r, 'STU-1');
  const notes = s ? parseJson(s.notes) || {} : {};
  check('B7 manager student notes contacts masked at depth (phone + nested whatsapp), other keys kept',
    !!s && notes.phone === 'Hidden' && notes.guardian && notes.guardian.whatsapp === 'Hidden' && notes.level === 'Qaida',
    JSON.stringify(notes));
  check('B7 manager students response leaks NO student contacts', !r.text.includes(STU_PHONE) && !r.text.includes(STU_GUARDIAN_WA), 'LEAKED');
}
{
  const r = await dbPost(TOK.manager, { table: 'trial_students', action: 'select' });
  const t = rowOf(r, 'TRL-1');
  const notes = t ? parseJson(t.notes) || {} : {};
  check('B7 manager trial_students: whatsapp column + notes email masked',
    !!t && t.whatsapp === 'Hidden' && notes.email === 'Hidden' && notes.source === 'web',
    JSON.stringify({ whatsapp: t && t.whatsapp, notes }));
  check('B7 manager trial response leaks NO trial contacts', !r.text.includes(TRL_WHATSAPP) && !r.text.includes(TRL_EMAIL), 'LEAKED');
}
{
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'select' });
  const m1 = rowOf(r, 'TCH-MGR-1');
  const m2 = rowOf(r, 'TCH-MGR-2');
  const t1 = rowOf(r, 'TCH-1');
  const a1 = m1 ? parseJson(m1.address) || {} : {};
  const a2 = m2 ? parseJson(m2.address) || {} : {};
  const at = t1 ? parseJson(t1.address) || {} : {};
  check('B7 manager read: manager record salary data stripped (salary_slips + salary keys gone, rate_per_slot null)',
    !!m1 && !('salary_slips' in a1) && !('monthly_salary' in a1) && m1.rate_per_slot === null && a1.username === 'mgruser',
    JSON.stringify({ keys: Object.keys(a1), rate: m1 && m1.rate_per_slot }));
  check('B7 manager read: second manager record — teacher_account salary keys stripped too',
    !!m2 && !('salary_slips' in a2) && !(a2.teacher_account && 'salary_info' in a2.teacher_account) && m2.rate_per_slot === null,
    JSON.stringify(a2));
  check('B7 manager read: NORMAL teacher untouched (salary_slips present, phone visible, rate kept)',
    !!t1 && !!at.salary_slips && at.salary_slips['2026-09'].amount === 44000 && t1.phone === '+10000000103' && t1.rate_per_slot === 2200,
    JSON.stringify({ at: Object.keys(at), phone: t1 && t1.phone, rate: t1 && t1.rate_per_slot }));
  check('B7 manager teachers response leaks NO stored password hash', !r.text.includes('sha256$'), 'LEAKED');
}
{
  const r = await dbPost(TOK.owner, { table: 'teachers', action: 'select' });
  const m1 = rowOf(r, 'TCH-MGR-1');
  const a1 = m1 ? parseJson(m1.address) || {} : {};
  check('Owner teachers select UNCHANGED: manager salary_slips present, rate kept',
    !!m1 && !!a1.salary_slips && m1.rate_per_slot === 3000, JSON.stringify(Object.keys(a1)));
}

// ---- teacher/parent scoping regression spot-checks -----------------------------
{
  const r = await dbPost(TOK.teacher, { table: 'families', action: 'select' });
  check('Regression: teacher families select still 403', r.status === 403, 'got ' + r.status);
}
{
  const r = await dbPost(TOK.teacher, { table: 'teachers', action: 'select' });
  const rows = (r.data && r.data.data) || [];
  check('Regression: teacher sees ONLY own teacher row', r.status === 200 && rows.length === 1 && rows[0].id === 'TCH-1', `status ${r.status} rows ${rows.length}`);
}
{
  const r = await dbPost(TOK.parent, { table: 'families', action: 'select' });
  const rows = (r.data && r.data.data) || [];
  const f = rows[0] || {};
  check('Regression: parent sees ONLY own family, contacts NOT masked for parent, password absent',
    r.status === 200 && rows.length === 1 && f.id === 'FAM-1' && f.email === FAM_EMAIL &&
    !('password' in (parseJson(f.notes)?.portal_credentials || {})),
    `status ${r.status} rows ${rows.length} email ${f.email}`);
}

// ---- (2)+(4b) delete + teachers write guards -----------------------------------
for (const [table, id] of [['families', 'FAM-1'], ['students', 'STU-1'], ['teachers', 'TCH-1'], ['payments', 'PAY-1']]) {
  const r = await dbPost(TOK.manager, { table, action: 'delete', filters: eqId(id) });
  check(`B2 manager DELETE ${table} -> 403`, r.status === 403, 'got ' + r.status + ' ' + r.text.slice(0, 120));
}
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('B2 rows survive manager delete attempts (family still there)', !!rowOf(r, 'FAM-1'));
}
{
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'insert', values: { id: 'TCH-EVIL-1', full_name: 'Evil One', address: JSON.stringify({ username: 'evil1', employee_type: 'manager' }) } });
  check('B2 manager INSERT manager-claiming teacher (address meta) -> 403', r.status === 403, 'got ' + r.status);
  const r2 = await dbPost(TOK.manager, { table: 'teachers', action: 'insert', values: { id: 'TCH-EVIL-2', full_name: 'Evil Two', employee_type: 'manager' } });
  check('B2 manager INSERT manager-claiming teacher (top-level field) -> 403', r2.status === 403, 'got ' + r2.status);
  const r3 = await dbPost(TOK.manager, { table: 'teachers', action: 'insert', values: { id: 'MGR-999', full_name: 'Evil Three', address: '{}' } });
  check('B2 manager INSERT teacher with MGR- id -> 403', r3.status === 403, 'got ' + r3.status);
  const r4 = await dbPost(TOK.manager, { table: 'teachers', action: 'upsert', values: { id: 'TCH-EVIL-4', full_name: 'Evil Four', address: JSON.stringify({ teacher_account: { employee_type: 'manager' } }) } });
  check('B2 manager UPSERT manager-claiming teacher (teacher_account meta) -> 403', r4.status === 403, 'got ' + r4.status);
}
{
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { full_name: 'Hacked Name' }, filters: eqId('TCH-MGR-1') });
  check('B2 manager UPDATE manager record by id -> 403', r.status === 403, 'got ' + r.status);
  const own = await dbPost(TOK.owner, { table: 'teachers', action: 'select' });
  check('B2 manager record unchanged after blocked update', (rowOf(own, 'TCH-MGR-1') || {}).full_name === 'Manager One');
}
{
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { address: JSON.stringify({ username: 'teachone', employee_type: 'manager' }) }, filters: eqId('TCH-1') });
  check('B2 manager UPDATE teacher patch promoting to manager (address) -> 403', r.status === 403, 'got ' + r.status);
  const r2 = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { employee_type: 'manager' }, filters: eqId('TCH-1') });
  check('B2 manager UPDATE teacher patch promoting to manager (top-level) -> 403', r2.status === 403, 'got ' + r2.status);
  const r3 = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { full_name: 'No Target' }, filters: [{ column: 'full_name', op: 'eq', value: 'Regular Teacher' }] });
  check('B2 manager UPDATE teacher with NO id filter -> 403 (unverifiable target)', r3.status === 403, 'got ' + r3.status);
}
{
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { full_name: 'Regular Teacher Jr', phone: '+10000000111' }, filters: eqId('TCH-1') });
  check('B2 manager UPDATE normal teacher profile -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  const own = await dbPost(TOK.owner, { table: 'teachers', action: 'select' });
  const t1 = rowOf(own, 'TCH-1');
  const a1 = t1 ? parseJson(t1.address) || {} : {};
  check('B2 teacher update applied AND salary_slips PRESERVED (patch did not carry address)',
    !!t1 && t1.full_name === 'Regular Teacher Jr' && t1.phone === '+10000000111' && !!a1.salary_slips && a1.salary_slips['2026-09'].amount === 44000,
    JSON.stringify({ name: t1 && t1.full_name, keys: Object.keys(a1) }));
  const ins = await dbPost(TOK.manager, { table: 'teachers', action: 'insert', values: { id: 'TCH-NEW', full_name: 'New Teacher', address: JSON.stringify({ username: 'newteach' }) } });
  check('B2 manager INSERT normal teacher -> 200', ins.status === 200, 'got ' + ins.status + ' ' + ins.text.slice(0, 160));
}

// ---- (4a) system_settings guards --------------------------------------------------
{
  const r = await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-1', key: 'alhuda_custom_books', value: '["book"]' } });
  check('S13 manager upsert alhuda_custom_books -> 200 (catalog path un-denied)', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 140));
  const r2 = await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-3', key: 'BOOK_PAGE_book1_0', value: 'r2/key0' } });
  check('S13 manager upsert BOOK_PAGE_* -> 200', r2.status === 200, 'got ' + r2.status);
  const r3 = await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-5', key: 'alhuda_deleted_books', value: '["x"]' } });
  check('B2 manager upsert alhuda_deleted_books -> 403 (owner-only key)', r3.status === 403, 'got ' + r3.status);
  const r4 = await dbPost(TOK.manager, { table: 'system_settings', action: 'upsert', values: { id: 'SYS-6', key: 'relay_config', value: '{}' } });
  check('B2 manager upsert other config key -> 403', r4.status === 403, 'got ' + r4.status);
  const r5 = await dbPost(TOK.manager, { table: 'system_settings', action: 'update', values: { value: '["b2"]' }, filters: [{ column: 'key', op: 'eq', value: 'alhuda_custom_books' }] });
  check('S13 manager UPDATE settings with eq key filter (catalog) -> 200', r5.status === 200, 'got ' + r5.status);
  const r6 = await dbPost(TOK.manager, { table: 'system_settings', action: 'update', values: { value: '["x"]' }, filters: [{ column: 'key', op: 'eq', value: 'alhuda_deleted_books' }] });
  check('B2 manager UPDATE settings with eq key filter (owner-only key) -> 403', r6.status === 403, 'got ' + r6.status);
  const r7 = await dbPost(TOK.manager, { table: 'system_settings', action: 'update', values: { value: '["x"]' }, filters: eqId('SYS-1') });
  check('B2 manager UPDATE settings with NO key filter -> 403', r7.status === 403, 'got ' + r7.status);
}
{
  const r = await dbPost(TOK.manager, { table: 'system_settings', action: 'select' });
  const keys = ((r.data && r.data.data) || []).map((x) => x.key).sort();
  // Phase 4 (audit P3-s): the tombstone is manager-readable now too.
  check('B2 manager SELECT system_settings returns ONLY catalog/logo/tombstone rows',
    r.status === 200 && keys.join(',') === 'BOOK_PAGE_book1_0,alhuda_custom_books,alhuda_custom_books_index,alhuda_deleted_books,alhuda_logo',
    'keys=' + keys.join(','));
  const own = await dbPost(TOK.owner, { table: 'system_settings', action: 'select' });
  const okeys = ((own.data && own.data.data) || []).map((x) => x.key);
  check('Owner SELECT system_settings UNCHANGED (all keys visible)',
    okeys.includes('alhuda_deleted_books') && okeys.includes('relay_config'), 'keys=' + okeys.join(','));
}

// ---- (4c) mask write-back protection ----------------------------------------------
{
  // Simulate the portal: manager edits the family using the MASKED row it
  // was shown (contacts echoed back as 'Hidden'), changing only the name.
  const patch = {
    parent_name: 'Renamed Parent',
    email: mgrFamRow.email, phone: mgrFamRow.phone, whatsapp: mgrFamRow.whatsapp,
    notes: mgrFamRow.notes,
  };
  const r = await dbPost(TOK.manager, { table: 'families', action: 'update', values: patch, filters: eqId('FAM-1') });
  check('B7 manager UPDATE family from masked read -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  const own = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  const f = rowOf(own, 'FAM-1');
  const notes = f ? parseJson(f.notes) || {} : {};
  check('B7 masked write-back did NOT wipe contacts (owner sees exact originals)',
    !!f && f.email === FAM_EMAIL && f.phone === FAM_PHONE && f.whatsapp === FAM_WHATSAPP,
    JSON.stringify({ email: f && f.email, phone: f && f.phone, whatsapp: f && f.whatsapp }));
  check('B7 masked write-back preserved notes contacts at all depths',
    notes.portal_credentials && notes.portal_credentials.whatsapp === PC_WHATSAPP && notes.portal_credentials.email === PC_EMAIL &&
    notes.bio_meta && notes.bio_meta.phone === BIO_PHONE &&
    notes.lms_shared_sync && notes.lms_shared_sync.parent_accounts['FAM-1'].whatsapp === SYNC_WA &&
    notes.lms_shared_sync.parent_accounts['FAM-1'].email === SYNC_EMAIL,
    JSON.stringify(notes).slice(0, 300));
  check('B7 the intended change DID apply (parent_name renamed)', !!f && f.parent_name === 'Renamed Parent', f && f.parent_name);
  const mgr2 = await dbPost(TOK.manager, { table: 'families', action: 'select' });
  const mf = rowOf(mgr2, 'FAM-1');
  check('B7 manager re-read after edit still shows Hidden', !!mf && mf.email === 'Hidden' && mf.phone === 'Hidden');
}
{
  const r = await dbPost(TOK.manager, { table: 'families', action: 'update', values: { phone: '+10000000999' }, filters: eqId('FAM-1') });
  check('B7 manager UPDATE family with a NEW real phone -> 200', r.status === 200, 'got ' + r.status);
  const own = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('B7 new real phone WAS stored (owner sees it)', (rowOf(own, 'FAM-1') || {}).phone === '+10000000999');
}
{
  const r = await dbPost(TOK.manager, {
    table: 'families', action: 'insert',
    values: { id: 'FAM-NEW', parent_name: 'Brand New', email: 'new@example.test', phone: '+10000000888', whatsapp: '+10000000889', notes: JSON.stringify({ portal_credentials: { username: 'newfam', whatsapp: '+10000000890' } }) },
  });
  check('B7 manager INSERT family with contacts -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  const own = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  const f = rowOf(own, 'FAM-NEW');
  check('B7 inserted contacts stored for real (owner sees them)',
    !!f && f.email === 'new@example.test' && f.phone === '+10000000888' && f.whatsapp === '+10000000889' &&
    (parseJson(f.notes)?.portal_credentials?.whatsapp === '+10000000890'),
    JSON.stringify(f && { email: f.email, phone: f.phone }));
  const mgr = await dbPost(TOK.manager, { table: 'families', action: 'select' });
  const mf = rowOf(mgr, 'FAM-NEW');
  check('B7 manager read of the family it just added shows Hidden',
    !!mf && mf.email === 'Hidden' && mf.phone === 'Hidden' && mf.whatsapp === 'Hidden');
}
{
  const r = await dbPost(TOK.manager, { table: 'trial_students', action: 'update', values: { whatsapp: 'Hidden', status: 'Completed' }, filters: eqId('TRL-1') });
  check('B7 manager UPDATE trial_student echoing masked whatsapp -> 200', r.status === 200, 'got ' + r.status);
  const own = await dbPost(TOK.owner, { table: 'trial_students', action: 'select' });
  const t = rowOf(own, 'TRL-1');
  check('B7 trial whatsapp NOT wiped by masked write-back; status change applied',
    !!t && t.whatsapp === TRL_WHATSAPP && t.status === 'Completed', JSON.stringify(t && { whatsapp: t.whatsapp, status: t.status }));
}

// ---- (6) set-password delegation -----------------------------------------------------
{
  const r = await setPassword(TOK.manager, { role: 'teacher', identifier: 'teachone', newPassword: 'NewTeach-Pass-1' });
  check('B8 manager sets a TEACHER password -> 200', r.status === 200 && r.data && r.data.ok === true, `got ${r.status} ${JSON.stringify(r.data)}`);
  const login = await staffLogin('teacher', 'teachone', 'NewTeach-Pass-1');
  check('B8 teacher can staff-login with the manager-set password', login.status === 200 && login.data && login.data.ok === true, `got ${login.status}`);
  // Batch 7A: a password change ends pre-change sessions, so the forged
  // TOK.teacher (issued at suite start) is now correctly invalid. Refresh it
  // from the login above; later sections must use the post-change token.
  if (login.data && login.data.token) TOK.teacher = login.data.token;
}
{
  const r = await setPassword(TOK.manager, { role: 'parent', identifier: 'famuser', newPassword: 'NewParent-Pass-1' });
  check('B8 manager sets a PARENT password -> 200', r.status === 200 && r.data && r.data.ok === true, `got ${r.status} ${JSON.stringify(r.data)}`);
  const login = await staffLogin('parent', 'famuser', 'NewParent-Pass-1');
  check('B8 parent can staff-login with the manager-set password', login.status === 200 && login.data && login.data.ok === true, `got ${login.status}`);
  // Batch 7A: same refresh as the teacher token above (parent password changed).
  if (login.data && login.data.token) TOK.parent = login.data.token;
}
{
  const r = await setPassword(TOK.manager, { role: 'manager', identifier: 'mgruser', newPassword: 'Whatever-Pass-1' });
  check('B8 manager setting role=manager -> 403', r.status === 403, `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await setPassword(TOK.manager, { role: 'teacher', identifier: 'mgrtwo', newPassword: 'Whatever-Pass-2' });
  check('B8 manager targeting a MANAGER record via role=teacher -> 404 (record invisible)', r.status === 404, `got ${r.status} ${JSON.stringify(r.data)}`);
}
{
  const r = await setPassword(TOK.owner, { role: 'manager', identifier: 'mgruser', newPassword: 'OwnerSet-Mgr-99' });
  check('Owner setting a manager password UNCHANGED -> 200', r.status === 200 && r.data && r.data.ok === true, `got ${r.status}`);
  const login = await staffLogin('manager', 'mgruser', 'OwnerSet-Mgr-99');
  check('Owner-set manager password logs in', login.status === 200 && login.data && login.data.ok === true, `got ${login.status}`);
  // Batch 7A: same refresh as above (manager password changed); B16 and
  // ReviewFix below must use the post-change token.
  if (login.data && login.data.token) TOK.manager = login.data.token;
}
{
  const r = await setPassword(TOK.teacher, { role: 'teacher', identifier: 'teachone', newPassword: 'Whatever-Pass-3' });
  check('Teacher token calling set-password -> 403', r.status === 403, `got ${r.status}`);
}

// ---- (8) notify-parent -----------------------------------------------------------------
{
  const before = received.length;
  const r = await notify(TOK.manager, { familyId: 'FAM-1', subject: 'Fee reminder', text: 'Please pay this month.' });
  check('B16 manager notify-parent -> 200 {ok:true}', r.status === 200 && r.data && r.data.ok === true, `got ${r.status} ${r.text.slice(0, 160)}`);
  check('B16 notify response contains NO recipient address', !r.text.includes(FAM_EMAIL), 'LEAKED in response');
  const hit = received[received.length - 1] || {};
  check('B16 relay received the family REAL email server-side + subject/body',
    received.length === before + 1 && hit.to === FAM_EMAIL && hit.subject === 'Fee reminder' && /Please pay/.test(hit.text || ''),
    JSON.stringify(hit).slice(0, 200));
}
{
  const r = await notify(TOK.owner, { familyId: 'FAM-1', subject: 'Owner note', text: 'hello' });
  check('B16 owner may also notify-parent -> 200', r.status === 200 && r.data && r.data.ok === true, `got ${r.status}`);
}
{
  const r = await notify(TOK.teacher, { familyId: 'FAM-1', subject: 'x', text: 'y' });
  check('B16 teacher token notify-parent -> 403', r.status === 403, 'got ' + r.status);
  const r2 = await notify(TOK.parent, { familyId: 'FAM-1', subject: 'x', text: 'y' });
  check('B16 parent token notify-parent -> 403', r2.status === 403, 'got ' + r2.status);
  const r3 = await notify(null, { familyId: 'FAM-1', subject: 'x', text: 'y' });
  check('B16 anonymous notify-parent -> 401', r3.status === 401, 'got ' + r3.status);
}
{
  const r = await notify(TOK.manager, { familyId: 'FAM-UNKNOWN', subject: 'x', text: 'y' });
  check('B16 unknown familyId -> 404 Family not found', r.status === 404 && r.data && /not found/i.test(r.data.error || ''), `got ${r.status} ${r.text.slice(0, 120)}`);
  const r2 = await notify(TOK.manager, { familyId: 'FAM-NOEMAIL', subject: 'x', text: 'y' });
  check('B16 family without email -> 422', r2.status === 422 && r2.data && /No email address on file/i.test(r2.data.error || ''), `got ${r2.status} ${r2.text.slice(0, 120)}`);
  const r3 = await notify(TOK.manager, { familyId: 'FAM-1', subject: 'x', text: 'y', to: 'attacker@example.test' });
  check('B16 caller-supplied recipient field -> 400 Unexpected field', r3.status === 400 && r3.data && /Unexpected field/i.test(r3.data.error || ''), `got ${r3.status}`);
  const r4 = await notify(TOK.manager, { familyId: 'FAM-1', text: 'y' });
  check('B16 missing subject -> 400', r4.status === 400, 'got ' + r4.status);
}
{
  const blob = capturedLogs.join('\n');
  check('B16 worker logs NEVER contain the family email address', !blob.includes(FAM_EMAIL), 'LEAKED in logs');
  check('B16 worker logs NEVER contain the relay secret', !blob.includes(RELAY_SECRET), 'LEAKED in logs');
}

// ---- (review fix) manager edits must not erase hidden credential slots ------
// A manager's update payload is built from their MASKED read: the portal
// password slot and the manager-keyed salary entries are absent from it.
// The stored values must survive the edit (PR #7 failure shape).
{
  const ownBefore = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  const notesBefore = parseJson((rowOf(ownBefore, 'FAM-1') || {}).notes) || {};
  const pwBefore = (notesBefore.portal_credentials || {}).password;
  const salBefore = ((notesBefore.lms_shared_sync || {}).teacher_salaries) || {};
  const mgrRead = await dbPost(TOK.manager, { table: 'families', action: 'select' });
  const mf = rowOf(mgrRead, 'FAM-1');
  const maskedNotes = mf ? parseJson(mf.notes) || {} : {};
  check('ReviewFix setup: manager masked notes carry NO portal password',
    !!maskedNotes.portal_credentials && !('password' in maskedNotes.portal_credentials));
  check('ReviewFix setup: manager masked blob lacks the manager salary entry',
    !!maskedNotes.lms_shared_sync && !!maskedNotes.lms_shared_sync.teacher_salaries &&
    !('TCH-MGR-1' in maskedNotes.lms_shared_sync.teacher_salaries) && ('TCH-1' in maskedNotes.lms_shared_sync.teacher_salaries));
  const r = await dbPost(TOK.manager, { table: 'families', action: 'update', values: { notes: mf.notes }, filters: eqId('FAM-1') });
  check('ReviewFix manager family update (masked notes) -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  const own = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  const notes = parseJson((rowOf(own, 'FAM-1') || {}).notes) || {};
  check('ReviewFix family portal password SURVIVED the manager edit',
    !!pwBefore && !!notes.portal_credentials && notes.portal_credentials.password === pwBefore,
    'before=' + String(pwBefore).slice(0, 24) + ' after=' + JSON.stringify(notes.portal_credentials || {}).slice(0, 120));
  const salAfter = ((notes.lms_shared_sync || {}).teacher_salaries) || {};
  check('ReviewFix blob manager salary entry restored, teacher entry kept',
    JSON.stringify(salAfter['TCH-MGR-1']) === JSON.stringify(salBefore['TCH-MGR-1']) &&
    JSON.stringify(salAfter['TCH-1']) === JSON.stringify(salBefore['TCH-1']),
    'after=' + JSON.stringify(salAfter).slice(0, 200));
}
{
  const ownBefore = await dbPost(TOK.owner, { table: 'teachers', action: 'select' });
  const pwBefore = (parseJson((rowOf(ownBefore, 'TCH-1') || {}).address) || {}).password;
  const mgrRead = await dbPost(TOK.manager, { table: 'teachers', action: 'select' });
  const mt = rowOf(mgrRead, 'TCH-1');
  const mgrAddr = mt ? parseJson(mt.address) || {} : {};
  check('ReviewFix setup: manager teacher address carries NO password', !!mt && !('password' in mgrAddr));
  const r = await dbPost(TOK.manager, { table: 'teachers', action: 'update', values: { address: mt.address }, filters: eqId('TCH-1') });
  check('ReviewFix manager teacher update (scrubbed address) -> 200', r.status === 200, 'got ' + r.status + ' ' + r.text.slice(0, 160));
  const ownAfter = await dbPost(TOK.owner, { table: 'teachers', action: 'select' });
  const pwAfter = (parseJson((rowOf(ownAfter, 'TCH-1') || {}).address) || {}).password;
  check('ReviewFix teacher password SURVIVED the manager edit',
    !!pwBefore && pwAfter === pwBefore,
    'before=' + String(pwBefore).slice(0, 24) + ' after=' + String(pwAfter).slice(0, 24));
}

relay.close();
fakeDb.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
