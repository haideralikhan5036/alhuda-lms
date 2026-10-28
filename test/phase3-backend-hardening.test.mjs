// Phase 3.4 backend hardening (audit P2-1–P2-10) tests.
// Drives the REAL cloudflare/worker.js (via temp ESM copies) against a
// fake D1 backed by Node's built-in SQLite (node:sqlite), plus a vm
// load of js/cloudflare-db.js for the stale-mirror disclosure (P2-9).
// Run from the repo root:  node test/phase3-backend-hardening.test.mjs
// Requires: node >= 22.5 (node:sqlite).
// Every check below is written to the POST-fix contract: on the
// pre-fix code the P2-1 denial, the P2-3 ceiling, the P2-4 empty
// batch, the P2-5 400, the P2-6 422, the P2-7 success run, the P2-8
// denial, the P2-9 banner and the P2-10 enforcing header would all
// fail (verified by reading the pre-fix code paths, not by re-running
// them — this suite was written after the fix landed).
// All addresses/names below are SYNTHETIC test markers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-test-'));
const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-test2-'));
for (const dir of [TMP, TMP2]) {
  for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
    const dst = path.join(dir, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f), dst);
  }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
}
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const worker2 = (await import(pathToFileURL(path.join(TMP2, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'phase34-test-worker-secret';
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
// A D1 binding whose every query throws: the P2-1 error window.
class ThrowingStatement {
  bind() { return this; }
  async all() { throw new Error('boom: D1 unavailable'); }
  async run() { throw new Error('boom: D1 unavailable'); }
  async first() { throw new Error('boom: D1 unavailable'); }
}
class ThrowingD1 {
  prepare() { return new ThrowingStatement(); }
  async batch() { throw new Error('boom: D1 unavailable'); }
  async exec() { throw new Error('boom: D1 unavailable'); }
}

const fakeDb = new FakeD1();
const baseEnv = { WORKER_AUTH_SECRET: WORKER_SECRET, ALLOWED_ORIGINS: ORIGIN, DB: fakeDb };

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  owner2: await createSessionToken({ sub: 'owner2', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacherA: await createSessionToken({ sub: 'TCH-A', role: 'teacher' }, WORKER_SECRET),
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

async function call(w, env, url, { method = 'POST', token = null, body = null, ip = null } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (ip) headers['cf-connecting-ip'] = ip;
  const req = new Request(url, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const res = await w.fetch(req, env, {});
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, data, headers: res.headers };
}
const dbPost = (token, body, env = baseEnv, w = worker) =>
  call(w, env, 'https://worker.test/api/db', { token, body });
const dbSelect = async (token, table, extra = {}) => {
  const r = await dbPost(token, { table, action: 'select', ...extra });
  return r;
};

// ---- Setup: schema boot + seeds ------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
}
fakeDb.seed('INSERT INTO families (id, parent_name, email, status, notes) VALUES (?, ?, ?, ?, ?)',
  'F1', 'Family One', 'fam1@example.test', 'Active', '{}');
fakeDb.seed('INSERT INTO families (id, parent_name, email, status, notes) VALUES (?, ?, ?, ?, ?)',
  'F2', 'Family Two', 'fam2@example.test', 'Active', '{}');
fakeDb.seed('INSERT INTO families (id, parent_name, email, status, notes) VALUES (?, ?, ?, ?, ?)',
  'F3', 'Family Three', 'fam3@example.test', 'Active', '{}');
fakeDb.seed('INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)',
  'TCH-A', 'Teacher Alpha', JSON.stringify({ username: 'teacha' }), 'Active');
fakeDb.seed('INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)',
  'TCH-MGR-1', 'Manager One', JSON.stringify({ employee_type: 'manager', username: 'mgrone' }), 'Active');
fakeDb.seed('INSERT INTO teachers (id, full_name, address, status) VALUES (?, ?, ?, ?)',
  'TCH-SETPW', 'Setpw Teacher', JSON.stringify({ username: 'setpwteach' }), 'Active');
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-1', 'F1', 'Student One', 'TCH-A');
fakeDb.seed('INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES (?, ?, ?, ?)',
  'STU-2', 'F2', 'Student Two', 'TCH-A');
fakeDb.seed('INSERT INTO payments (id, family_id, receipt_no) VALUES (?, ?, ?)',
  'PAY-OLD', 'F1', 'AH-REC-OLD1');
// P2-6 advance row: teacher A + STU-1, target 2026-10-25.
fakeDb.seed('INSERT INTO attendance_logs (id, student_id, teacher_id, class_date, status, lesson_notes) VALUES (?, ?, ?, ?, ?, ?)',
  'ATT-1', 'STU-1', 'TCH-A', '2026-10-25', 'Advance Class',
  JSON.stringify({ is_advance_class: true, advance_target_date: '2026-10-25' }));

// ---- P2-1: revocation/throttle fail CLOSED on D1 errors ------------------
{
  const throwingEnv = { ...baseEnv, DB: new ThrowingD1() };
  const ok = await dbPost(TOK.owner, { table: 'families', action: 'select' }, throwingEnv);
  check('P2-1: valid token + throwing D1 -> denied (401, never 200)', ok.status === 401, 'got ' + ok.status);
  // Revoke owner2's token on the healthy DB, then replay it under the error window.
  const logout = await call(worker, baseEnv, 'https://worker.test/api/auth/logout', { token: TOK.owner2, body: {} });
  check('P2-1 setup: logout revokes owner2 token', logout.status === 200, logout.text.slice(0, 200));
  const replay = await dbPost(TOK.owner2, { table: 'families', action: 'select' }, throwingEnv);
  check('P2-1: revoked token + throwing D1 -> denied (401, never passes)', replay.status === 401, 'got ' + replay.status);
  // /api/email/send with a throwing DB must also deny (fail closed),
  // while the same call with NO db binding passes auth (relay 503 proves it).
  const sendThrowing = await call(worker, throwingEnv, 'https://worker.test/api/email/send',
    { token: TOK.owner, body: { to: 'a@example.test', subject: 'Hi', text: 'Body' } });
  check('P2-1: /api/email/send + throwing D1 -> 401', sendThrowing.status === 401, 'got ' + sendThrowing.status);
  const sendNoDb = await call(worker, { ...baseEnv, DB: null }, 'https://worker.test/api/email/send',
    { token: TOK.owner, body: { to: 'a@example.test', subject: 'Hi', text: 'Body' } });
  check('P2-1: /api/email/send + no DB binding -> passes auth (503 relay, not 401)',
    sendNoDb.status === 503, 'got ' + sendNoDb.status + ' ' + sendNoDb.text.slice(0, 160));
}

// ---- P2-2: dup-check limiter counts GLOBALLY (D1, cross-isolate) ---------
{
  const ip = '203.0.113.50';
  let okCount = 0;
  for (let i = 0; i < 30; i++) {
    const r = await call(worker, baseEnv, 'https://worker.test/api/families/check-duplicates',
      { token: TOK.owner, body: { phone: '03001234567' }, ip });
    if (r.status === 200) okCount++;
  }
  check('P2-2: first 30 dup-checks from one IP -> 200', okCount === 30, 'ok=' + okCount + '/30');
  // The 31st call goes through a SECOND worker instance (separate module
  // state, same D1): a per-isolate in-memory limiter would let it pass.
  const r31 = await call(worker2, baseEnv, 'https://worker.test/api/families/check-duplicates',
    { token: TOK.owner, body: { phone: '03001234567' }, ip });
  check('P2-2: 31st dup-check via a second isolate -> 429 (counted globally)',
    r31.status === 429, 'got ' + r31.status + ' ' + r31.text.slice(0, 160));
  // The limiter keys by authenticated subject (sub first, IP only as a
  // fallback for anonymous callers), so a different IP under the SAME
  // owner token is still limited — the unaffected party is a different
  // subject, not a different IP.
  const otherSub = await call(worker2, baseEnv, 'https://worker.test/api/families/check-duplicates',
    { token: TOK.manager, body: { phone: '03001234567' }, ip: '203.0.113.51' });
  check('P2-2: dup-check from another subject still works', otherSub.status === 200, 'got ' + otherSub.status);
}

// ---- P2-3: SELECT ceiling + offset + bounded joins -----------------------
{
  const all = await dbSelect(TOK.owner, 'families');
  check('P2-3: no limit -> default limitApplied 5000, not truncated',
    all.data && all.data.limitApplied === 5000 && all.data.truncated === false,
    JSON.stringify({ limitApplied: all.data && all.data.limitApplied, truncated: all.data && all.data.truncated }));
  check('P2-3: no limit -> all 3 families returned', Array.isArray(all.data.data) && all.data.data.length === 3,
    'got ' + (all.data.data || []).length);
  const neg = await dbSelect(TOK.owner, 'families', { limit: -5 });
  check('P2-3: limit -5 clamps to 1 (SQLite negative LIMIT was unlimited)',
    neg.data && neg.data.limitApplied === 1 && neg.data.data.length === 1,
    JSON.stringify({ limitApplied: neg.data && neg.data.limitApplied, n: (neg.data.data || []).length }));
  const huge = await dbSelect(TOK.owner, 'families', { limit: 999999 });
  check('P2-3: limit 999999 clamps to ceiling 10000',
    huge.data && huge.data.limitApplied === 10000, 'got ' + (huge.data && huge.data.limitApplied));
  const page = await dbSelect(TOK.owner, 'families', { limit: 2, offset: 1, orders: [{ column: 'id', ascending: true }] });
  check('P2-3: limit 2 offset 1 pages (F2, F3)',
    Array.isArray(page.data.data) && page.data.data.map((r) => r.id).join(',') === 'F2,F3',
    'got ' + (page.data.data || []).map((r) => r.id).join(','));
  const joined = await dbSelect(TOK.owner, 'families', { select: '*, students(*)', filters: [{ column: 'id', op: 'eq', value: 'F1' }] });
  check('P2-3: families join returns only F1 students (key-restricted, not full table)',
    Array.isArray(joined.data.data) && joined.data.data.length === 1 &&
    Array.isArray(joined.data.data[0].students) && joined.data.data[0].students.length === 1 &&
    joined.data.data[0].students[0].id === 'STU-1',
    JSON.stringify(joined.data.data && joined.data.data[0] && joined.data.data[0].students));
}

// ---- P2-4: financial batch pre-validation + landed rows ------------------
{
  const batch = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: [
    { id: 'PAY-NEW1', family_id: 'F1', receipt_no: 'AH-REC-NEW1' },
    { id: 'PAY-DUP', family_id: 'F1', receipt_no: 'AH-REC-OLD1' },
  ] });
  check('P2-4: batch with a conflicting row -> 409, failedIndex 1, nothing landed',
    batch.status === 409 && batch.data && batch.data.failedIndex === 1 &&
    Array.isArray(batch.data.insertedIds) && batch.data.insertedIds.length === 0,
    'got ' + batch.status + ' ' + batch.text.slice(0, 200));
  const after = await dbSelect(TOK.owner, 'payments', { filters: [{ column: 'receipt_no', op: 'eq', value: 'AH-REC-NEW1' }] });
  check('P2-4: pre-validation wrote NOTHING (good row absent)',
    Array.isArray(after.data.data) && after.data.data.length === 0, 'got ' + (after.data.data || []).length);
  const intra = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: [
    { id: 'PAY-NEW2a', family_id: 'F1', receipt_no: 'AH-REC-NEW2' },
    { id: 'PAY-NEW2b', family_id: 'F1', receipt_no: 'AH-REC-NEW2' },
  ] });
  check('P2-4: intra-batch duplicate -> 409, failedIndex 1, insertedIds []',
    intra.status === 409 && intra.data && intra.data.failedIndex === 1 &&
    Array.isArray(intra.data.insertedIds) && intra.data.insertedIds.length === 0,
    'got ' + intra.status + ' ' + intra.text.slice(0, 200));
  const clean = await dbPost(TOK.owner, { table: 'payments', action: 'insert', values: [
    { id: 'PAY-OK1', family_id: 'F1', receipt_no: 'AH-REC-OK1' },
    { id: 'PAY-OK2', family_id: 'F1', receipt_no: 'AH-REC-OK2' },
  ] });
  check('P2-4: clean batch -> 200, both rows present',
    clean.status === 200 && Array.isArray(clean.data.data) && clean.data.data.length === 2,
    'got ' + clean.status + ' ' + clean.text.slice(0, 200));
}

// ---- P2-5: unknown columns ----------------------------------------------
{
  const onlyBad = await dbPost(TOK.owner, { table: 'families', action: 'update',
    values: { bogus_column_xyz: 1 }, filters: [{ column: 'id', op: 'eq', value: 'F1' }] });
  check('P2-5: update with ONLY unknown columns -> 400 naming the key',
    onlyBad.status === 400 && /bogus_column_xyz/.test(onlyBad.text), 'got ' + onlyBad.status + ' ' + onlyBad.text.slice(0, 200));
  const mixed = await dbPost(TOK.owner, { table: 'families', action: 'update',
    values: { parent_name: 'Family One Renamed', bogus_column_xyz: 1 },
    filters: [{ column: 'id', op: 'eq', value: 'F1' }] });
  check('P2-5: mixed update -> 200, droppedColumns reports the bad key, valid key applied',
    mixed.status === 200 && Array.isArray(mixed.data.droppedColumns) &&
    mixed.data.droppedColumns.includes('bogus_column_xyz') &&
    mixed.data.data[0].parent_name === 'Family One Renamed',
    'got ' + mixed.status + ' ' + mixed.text.slice(0, 300));
  const ins = await dbPost(TOK.owner, { table: 'families', action: 'insert',
    values: { id: 'F9', parent_name: 'Family Nine', bogus_column_xyz: 1 } });
  check('P2-5: insert with unknown key -> 200 + droppedColumns, row stored without it',
    ins.status === 200 && Array.isArray(ins.data.droppedColumns) &&
    ins.data.droppedColumns.includes('bogus_column_xyz'),
    'got ' + ins.status + ' ' + ins.text.slice(0, 300));
}

// ---- P2-6: advance-class email requires an advance lesson ----------------
{
  const advanceBody = (studentId, scheduledDate) => ({
    studentId, template: 'advance-class', scheduledDate,
    bookTitle: 'Noorani Qaida', page: 12, lineRange: '1-5',
    sabaqResult: 'Excellent', rating: 5, remarks: 'Great progress.',
  });
  const noRow = await call(worker, baseEnv, 'https://worker.test/api/email/advance-class',
    { token: TOK.teacherA, body: advanceBody('STU-1', '2026-11-02') });
  check('P2-6: advance email with no advance record for the date -> 422',
    noRow.status === 422 && /No advance class record/i.test(noRow.text),
    'got ' + noRow.status + ' ' + noRow.text.slice(0, 200));
  const hasRow = await call(worker, baseEnv, 'https://worker.test/api/email/advance-class',
    { token: TOK.teacherA, body: advanceBody('STU-1', '2026-10-25') });
  check('P2-6: advance email WITH a record passes the check (503 relay, not 422)',
    hasRow.status === 503, 'got ' + hasRow.status + ' ' + hasRow.text.slice(0, 200));
}

// ---- P2-7: set-password throttle counts failures only ---------------------
{
  const ip = '10.9.9.1';
  let okCount = 0;
  for (let i = 0; i < 35; i++) {
    const r = await call(worker, baseEnv, 'https://worker.test/api/auth/set-password',
      { token: TOK.owner, body: { role: 'teacher', identifier: 'tch-setpw', newPassword: 'Setpw-New-99' }, ip });
    if (r.status === 200) okCount++;
  }
  check('P2-7: 35 successful set-password calls do NOT trip the throttle', okCount === 35, 'ok=' + okCount + '/35');
  const failSeq = [];
  for (let i = 0; i < 30; i++) {
    failSeq.push(await call(worker, baseEnv, 'https://worker.test/api/auth/set-password',
      { token: TOK.owner, body: { role: 'teacher', identifier: 'nosuchuser', newPassword: 'Setpw-New-99' }, ip }));
  }
  check('P2-7: first 29 failed sets -> 404 (not 429)',
    failSeq.slice(0, 29).every((r) => r.status === 404), failSeq.map((r) => r.status).join(','));
  check('P2-7: 30th failed set -> 429 with Retry-After',
    failSeq[29].status === 429 && !!failSeq[29].headers.get('Retry-After'),
    'got ' + failSeq[29].status + ' ' + failSeq[29].text.slice(0, 160));
  const otherIp = await call(worker, baseEnv, 'https://worker.test/api/auth/set-password',
    { token: TOK.owner, body: { role: 'teacher', identifier: 'tch-setpw', newPassword: 'Setpw-New-99' }, ip: '10.9.9.2' });
  check('P2-7: set-password from another IP still works', otherIp.status === 200, 'got ' + otherIp.status);
}

// ---- P2-8: manager multi-row credential patches --------------------------
{
  const denied = await dbPost(TOK.manager, { table: 'families', action: 'update',
    values: { notes: '{}' }, filters: [{ column: 'id', op: 'in', value: ['F1', 'F2'] }] });
  check('P2-8: manager multi-row notes update -> 403 single-record message',
    denied.status === 403 && /single record/i.test(denied.text),
    'got ' + denied.status + ' ' + denied.text.slice(0, 200));
  const allowed = await dbPost(TOK.manager, { table: 'families', action: 'update',
    values: { parent_name: 'Bulk Name' }, filters: [{ column: 'id', op: 'in', value: ['F1', 'F2'] }] });
  check('P2-8: manager multi-row NON-notes update still works (denial is scoped)',
    allowed.status === 200 && Array.isArray(allowed.data.data) && allowed.data.data.length === 2 &&
    allowed.data.data.every((r) => r.parent_name === 'Bulk Name'),
    'got ' + allowed.status + ' ' + allowed.text.slice(0, 300));
}

// ---- P2-9: stale-mirror reads show the banner + flag (vm shim load) ------
{
  const shimSrc = fs.readFileSync(path.join(REPO_ROOT, 'js/cloudflare-db.js'), 'utf8');
  const store = new Map();
  store.set('alhuda_cloudflare_local_db_v1', JSON.stringify({
    families: [{ id: 'FM1', parent_name: 'Mirror Family', email: '', parent_email: '' }],
    students: [], teachers: [], class_schedules: [], attendance_logs: [],
    payments: [], salary_slips: [], salary_adjustments: [], leave_requests: [],
    trial_students: [], system_settings: [],
  }));
  store.set('alhuda_d1_initial_sync_done_v1', 'true');
  const storageStub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] || null,
  };
  const bannerEls = {};
  const documentStub = {
    body: { prepend(el) { bannerEls[el.id] = el; } },
    createElement() {
      return { id: '', style: {}, setAttribute() {}, remove() { delete bannerEls[this.id]; } };
    },
    getElementById: (id) => bannerEls[id] || null,
  };
  let fetchMode = 'offline';
  const sandbox = {
    console, setTimeout, clearTimeout, AbortController,
    window: null, document: documentStub, localStorage: storageStub, sessionStorage: storageStub,
    location: { hostname: 'test.local' },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    addEventListener: () => {}, dispatchEvent: () => {},
    fetch: async (url) => {
      if (fetchMode === 'offline') throw new Error('network down');
      if (String(url).endsWith('/api/db') && fetchMode === 'live-probe') {
        return { ok: true, status: 200, json: async () => ({ ok: true, d1_bound: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [], error: null }) };
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(shimSrc, sandbox);
  const mirrorRes = await sandbox.db.from('families').select('*');
  check('P2-9: offline read falls back to the mirror (tagged mirror)',
    mirrorRes && mirrorRes._lmsSource === 'mirror' && Array.isArray(mirrorRes.data) && mirrorRes.data.length === 1,
    JSON.stringify({ src: mirrorRes && mirrorRes._lmsSource, n: mirrorRes && mirrorRes.data && mirrorRes.data.length }));
  check('P2-9: mirror read sets window.__lmsMirrorStale + creates the banner',
    sandbox.__lmsMirrorStale === true && !!bannerEls['lms-mirror-stale-banner'],
    JSON.stringify({ stale: sandbox.__lmsMirrorStale, banner: !!bannerEls['lms-mirror-stale-banner'] }));
  // Back online: reset the probe cache, answer the probe + reads live.
  sandbox.resetCloudflareD1Availability();
  fetchMode = 'live-probe';
  const liveRes = await sandbox.db.from('families').select('*');
  check('P2-9: live read hides the banner and clears the flag',
    liveRes && liveRes._lmsSource === 'd1' && sandbox.__lmsMirrorStale === false &&
    !bannerEls['lms-mirror-stale-banner'],
    JSON.stringify({ src: liveRes && liveRes._lmsSource, stale: sandbox.__lmsMirrorStale }));
}

// ---- P2-10: Worker CSP enforcing, byte-identical to Vercel ---------------
{
  const vercelJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8'));
  const vercelCsp = vercelJson.routes[0].headers['Content-Security-Policy'];
  const health = await call(worker, baseEnv, 'https://worker.test/api/health', { method: 'GET' });
  check('P2-10: /api/health carries an ENFORCING CSP equal to the Vercel string',
    health.headers.get('content-security-policy') === vercelCsp,
    'got ' + JSON.stringify(health.headers.get('content-security-policy')));
  check('P2-10: no report-only CSP header anymore',
    health.headers.get('content-security-policy-report-only') === null,
    'got ' + JSON.stringify(health.headers.get('content-security-policy-report-only')));
  const unauth = await call(worker, baseEnv, 'https://worker.test/api/db', { method: 'POST', body: { table: 'families', action: 'select' } });
  check('P2-10: enforcing CSP also on the unauthenticated /api/db 401',
    unauth.status === 401 && unauth.headers.get('content-security-policy') === vercelCsp,
    'got ' + unauth.status + ' ' + JSON.stringify(unauth.headers.get('content-security-policy')));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length > 0) {
  for (const f of failed) console.log('FAILED: ' + f.name);
  process.exit(1);
}
try { fakeDb.close(); } catch (e) {}
