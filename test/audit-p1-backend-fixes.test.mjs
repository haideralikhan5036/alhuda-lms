// Audit P1 backend fixes — worker tests for P1-1 (deactivation status gate),
// P1-2 (teacher foreign-id insert rejection) and P1-4 (manager 360
// sub-record delete guard). Drives the REAL cloudflare/worker.js (via a
// temp ESM copy) against a fake D1 backed by Node's built-in SQLite, so
// the login gate, the requireApiAuth status check, the scoped insert
// guard and the manager notes-diff guard run end-to-end on real SQL.
// Run from the repo root:  node test/audit-p1-backend-fixes.test.mjs
// Requires: node >= 22.5 (node:sqlite). All "passwords" below are
// synthetic test markers, never real credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-p1-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'audit-p1-test-secret';
const ORIGIN = 'https://alhuda-lms.vercel.app';
const OWNER_USER = 'owner-test';
const OWNER_PW = 'Owner-Strong-99';

// ---- Fake D1 over real in-memory SQLite ------------------------------------
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
  raw(sql, ...params) { return this._db.prepare(sql).all(...params); } // test-only reads
  seed(sql, ...params) { this._db.prepare(sql).run(...params); } // test-only writes
  close() { try { this._db.close(); } catch (e) {} }
}

const fakeDb = new FakeD1();
const env = {
  WORKER_AUTH_SECRET: WORKER_SECRET,
  OWNER_USERNAME: OWNER_USER,
  OWNER_PASSWORD_HASH: createHash('sha256').update(OWNER_PW).digest('hex'),
  ALLOWED_ORIGINS: ORIGIN,
  DB: fakeDb,
};

// ---- Helpers ---------------------------------------------------------------
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' :: ' + String(detail || '').slice(0, 300)}`);
}
const eq = (column, value) => [{ column, op: 'eq', value }];

async function call(pathname, { token = null, ip = null, body = null, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (ip) headers['cf-connecting-ip'] = ip;
  const req = new Request('https://worker.test' + pathname, {
    method, headers, body: body === null ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, {});
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, headers: res.headers, text, json };
}
const staffLogin = (identifier, password, ip, role = 'teacher') =>
  call('/api/auth/staff-login', { ip, body: { identifier, password, role } });
const ownerLogin = (username, password, ip) =>
  call('/api/auth/login', { ip, body: { username, password } });
const dbPost = (token, body) => call('/api/db', { token, body });

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
};

function hashLegacy(pw) {
  const saltHex = randomBytes(16).toString('hex');
  return `sha256$${saltHex}$${createHash('sha256').update(saltHex + ':' + pw).digest('hex')}`;
}
function hashPbkdf2(pw, iterations = 10000, saltHex = null) {
  const salt = saltHex || randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(pw, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}
async function seedTeacher(id, username, passwordHash, extra = {}) {
  const r = await dbPost(TOK.owner, { table: 'teachers', action: 'insert', values: { id, full_name: 'Test Teacher ' + id, address: JSON.stringify({ username, password: passwordHash, ...(extra.address || {}) }), ...(extra.row || {}) } });
  check(`seed teacher ${id}`, r.status === 200, r.text.slice(0, 200));
  return r;
}
async function seedFamily(id, username, passwordHash, extraRow = {}) {
  const r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id, parent_name: 'Test Family ' + id, status: 'Active', notes: JSON.stringify({ portal_credentials: { username, password: passwordHash } }), ...extraRow } });
  check(`seed family ${id}`, r.status === 200, r.text.slice(0, 200));
  return r;
}

// ---- Boot schema ------------------------------------------------------------
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' }); // boots ensureSchema
  check('schema boot', r.status === 200, r.text.slice(0, 200));
}

// ==== P1-1: deactivation status gate =========================================
await seedTeacher('TCH-ACT', 'activeteach', hashPbkdf2('Active-Teach-99'));
await seedTeacher('TCH-INACT', 'inactteach', hashPbkdf2('Inact-Teach-99'), { row: { status: 'Inactive' } });
await seedTeacher('TCH-TERM', 'termteach', hashPbkdf2('Term-Teach-99'), { row: { status: 'Terminated' } });
await seedTeacher('TCH-REACT', 'reactteach', hashPbkdf2('React-Teach-99'), { row: { status: 'Inactive' } });
await seedTeacher('TCH-MGR-INACT', 'inactmgr', hashPbkdf2('Inact-Mgr-99'), { address: { employee_type: 'manager' }, row: { status: 'Inactive' } });
await seedFamily('FAM-ACT', 'activefam', hashPbkdf2('Active-Fam-99'));
await seedFamily('FAM-INACT', 'inactfam', hashPbkdf2('Inact-Fam-99'), { status: 'Inactive' });
{
  // Active accounts log in normally.
  const ok = await staffLogin('activeteach', 'Active-Teach-99', '10.9.1.1');
  check('P1-1 active teacher login -> 200 + token', ok.status === 200 && !!ok.json.token, ok.text.slice(0, 200));
  const okFam = await staffLogin('activefam', 'Active-Fam-99', '10.9.1.2', 'parent');
  check('P1-1 active family login -> 200 + token', okFam.status === 200 && !!okFam.json.token, okFam.text.slice(0, 200));
  // Deactivated accounts cannot obtain a fresh session, even with the
  // correct password — and get a distinct, honest error (not a token).
  const inact = await staffLogin('inactteach', 'Inact-Teach-99', '10.9.1.3');
  check('P1-1 inactive teacher login -> 401 account_deactivated, no token', inact.status === 401 && inact.json && inact.json.error === 'account_deactivated' && !inact.json.token, inact.text.slice(0, 200));
  const term = await staffLogin('termteach', 'Term-Teach-99', '10.9.1.4');
  check('P1-1 terminated teacher login -> 401 account_deactivated', term.status === 401 && term.json && term.json.error === 'account_deactivated', term.text.slice(0, 200));
  const inactFam = await staffLogin('inactfam', 'Inact-Fam-99', '10.9.1.5', 'parent');
  check('P1-1 inactive family login -> 401 account_deactivated, no token', inactFam.status === 401 && inactFam.json && inactFam.json.error === 'account_deactivated' && !inactFam.json.token, inactFam.text.slice(0, 200));
  const inactMgr = await staffLogin('inactmgr', 'Inact-Mgr-99', '10.9.1.6', 'manager');
  check('P1-1 inactive manager login -> 401 account_deactivated', inactMgr.status === 401 && inactMgr.json && inactMgr.json.error === 'account_deactivated', inactMgr.text.slice(0, 200));
  // Reactivation through the owner /api/db path restores login (and the
  // worker clears its cached status entry for the subject on update).
  const denied = await staffLogin('reactteach', 'React-Teach-99', '10.9.1.7');
  check('P1-1 inactive-then-reactivated teacher denied before reactivation', denied.status === 401 && denied.json && denied.json.error === 'account_deactivated', denied.text.slice(0, 200));
  const upd = await dbPost(TOK.owner, { table: 'teachers', action: 'update', values: { status: 'Active' }, filters: eq('id', 'TCH-REACT') });
  check('P1-1 owner reactivation update -> 200', upd.status === 200, upd.text.slice(0, 200));
  const relogin = await staffLogin('reactteach', 'React-Teach-99', '10.9.1.8');
  check('P1-1 reactivated teacher login -> 200 + token', relogin.status === 200 && !!relogin.json.token, relogin.text.slice(0, 200));
  // Owner env-credential login is untouched by the gate.
  const owner = await ownerLogin(OWNER_USER, OWNER_PW, '10.9.1.9');
  check('P1-1 owner env login still -> 200 + token', owner.status === 200 && !!owner.json.token, owner.text.slice(0, 200));
}
{
  // requireApiAuth status gate, isolated from the marker: mint tokens for
  // subjects with NO prior /api/db call (so no status-cache entry exists),
  // then flip rows to Inactive with DIRECT seed updates (bypassing the
  // engine, so no marker is bumped). The same tokens must then be
  // rejected by /api/db on the status gate alone.
  await seedTeacher('TCH-GATE', 'gateteach', hashPbkdf2('Gate-Teach-99'));
  const tokGate = await createSessionToken({ sub: 'TCH-GATE', role: 'teacher' }, WORKER_SECRET);
  fakeDb.seed("UPDATE teachers SET status = 'Inactive' WHERE id = 'TCH-GATE'");
  const gated = await dbPost(tokGate, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-GATE') });
  check('P1-1 token after direct deactivation (no marker) -> 401', gated.status === 401, gated.text.slice(0, 200));
  // Cache round-trip: with NO prior call for this subject, a direct
  // deactivation is observed immediately (401, caching inactive=true);
  // an owner update back to Active clears this isolate's cache entry, so
  // the same token works again — proving the cache clear, with no marker
  // bumped at any step (both flips bypass or avoid the bump paths).
  // (Note: a subject WITH a fresh cached entry observes a deactivation
  // only after the documented 60 s cache bound, exactly like markers.)
  await seedTeacher('TCH-CACHE', 'cacheteach', hashPbkdf2('Cache-Teach-99'));
  const tokCache = await createSessionToken({ sub: 'TCH-CACHE', role: 'teacher' }, WORKER_SECRET);
  fakeDb.seed("UPDATE teachers SET status = 'Inactive' WHERE id = 'TCH-CACHE'");
  const cacheGated = await dbPost(tokCache, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-CACHE') });
  check('P1-1 cache-subject token after direct deactivation -> 401', cacheGated.status === 401, cacheGated.text.slice(0, 200));
  const cacheUpd = await dbPost(TOK.owner, { table: 'teachers', action: 'update', values: { status: 'Active' }, filters: eq('id', 'TCH-CACHE') });
  check('P1-1 cache-subject owner reactivation -> 200', cacheUpd.status === 200, cacheUpd.text.slice(0, 200));
  const cacheAfter = await dbPost(tokCache, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-CACHE') });
  check('P1-1 same token after reactivation (cache cleared) -> 200', cacheAfter.status === 200, cacheAfter.text.slice(0, 200));
  // A token whose subject row does not exist is not denied by the status
  // gate (fail-open on missing row, as documented); the row filter still
  // yields an empty 200 select.
  const ghost = await createSessionToken({ sub: 'TCH-GHOST', role: 'teacher' }, WORKER_SECRET);
  const ghostRes = await dbPost(ghost, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-GHOST') });
  check('P1-1 missing-row subject token not denied by status gate -> 200', ghostRes.status === 200, ghostRes.text.slice(0, 200));
  // Owner tokens are never status-gated.
  const ownerRes = await dbPost(TOK.owner, { table: 'teachers', action: 'select', filters: eq('id', 'TCH-ACT') });
  check('P1-1 owner token /api/db -> 200 (never gated)', ownerRes.status === 200, ownerRes.text.slice(0, 200));
}

// ==== P1-1 follow-up: parent API access in a deactivated family ===========
// Regression lock for the Batch 7 leave-flow exception: the API status
// gate deliberately exempts parents. A deactivated family's parent keeps
// notes-only access (leave requests); reactivation is still blocked by
// the engine guard (403, not 401). Fresh parent logins after deactivation
// are still refused by the login gate (see FAM-INACT case above).
{
  const seedDeadFam = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id: 'FAM-P1-1-DEAD', parent_name: 'Dead Family P1-1', status: 'Inactive', notes: '{}' } });
  check('seed deactivated family FAM-P1-1-DEAD', seedDeadFam.status === 200, seedDeadFam.text.slice(0, 200));
  const seedDeadStu = await dbPost(TOK.owner, { table: 'students', action: 'insert', values: { id: 'STU-P1-1-DEAD', family_id: 'FAM-P1-1-DEAD', name: 'Dead Kid', status: 'Inactive', notes: '{}' } });
  check('seed inactive student STU-P1-1-DEAD', seedDeadStu.status === 200, seedDeadStu.text.slice(0, 200));
  // Token minted AFTER the inactive seed, so the valid-after marker passes
  // deterministically (marker denies only iat < valid_after).
  const tokParentDead = await createSessionToken({ sub: 'FAM-P1-1-DEAD', role: 'parent' }, WORKER_SECRET);
  const notesOnly = await dbPost(tokParentDead, { table: 'students', action: 'update', values: { notes: '{"leave_request":{"reason":"parent leave"}}' }, filters: eq('id', 'STU-P1-1-DEAD') });
  check('P1-1 parent notes-only update in deactivated family -> 200 (leave flow)', notesOnly.status === 200, notesOnly.text.slice(0, 200));
  const reactivate = await dbPost(tokParentDead, { table: 'students', action: 'update', values: { status: 'Active' }, filters: eq('id', 'STU-P1-1-DEAD') });
  check('P1-1 parent reactivation in deactivated family -> 403 engine guard (not 401)', reactivate.status === 403 && reactivate.text.includes('Reactivate the family before activating its students'), reactivate.text.slice(0, 200));
}

// ==== P1-2: teacher foreign-id insert rejection ==============================
{
  await seedTeacher('TCH-OWN', 'ownteach', hashPbkdf2('Own-Teach-99'));
  await seedTeacher('TCH-OTHER', 'otherteach', hashPbkdf2('Other-Teach-99'));
  const tokOwn = await createSessionToken({ sub: 'TCH-OWN', role: 'teacher' }, WORKER_SECRET);
  const tokMgr = await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET);
  const seedLog = async (id, teacherId, status, notes) => {
    const r = await dbPost(TOK.owner, { table: 'attendance_logs', action: 'insert', values: { id, schedule_id: 'SCH-' + id, student_id: 'STU-1', teacher_id: teacherId, date: '2026-10-28', status, lesson_notes: notes } });
    check(`seed log ${id}`, r.status === 200, r.text.slice(0, 200));
  };
  await seedLog('LOG-OWN', 'TCH-OWN', 'Running', 'OWN-ORIGINAL');
  await seedLog('LOG-OTHER', 'TCH-OTHER', 'Completed', 'OTHER-ORIGINAL');
  const seedSched = await dbPost(TOK.owner, { table: 'class_schedules', action: 'insert', values: { id: 'SCH-OTHER', teacher_id: 'TCH-OTHER', student_id: 'STU-1', day_of_week: 1, start_time: '16:00:00', end_time: '16:30:00', status: 'Active' } });
  check('seed schedule SCH-OTHER', seedSched.status === 200, seedSched.text.slice(0, 200));
  const seedLeave = await dbPost(TOK.owner, { table: 'leave_requests', action: 'insert', values: { id: 'LEAVE-OTHER', teacher_id: 'TCH-OTHER', student_id: 'STU-1', leave_date: '2026-11-02', reason: 'other reason' } });
  check('seed leave LEAVE-OTHER', seedLeave.status === 200, seedLeave.text.slice(0, 200));

  const readLog = async (id) => {
    const r = await dbPost(TOK.owner, { table: 'attendance_logs', action: 'select', filters: eq('id', id) });
    return (r.json && r.json.data && r.json.data[0]) || null;
  };
  // Foreign id: denied, and the foreign row is untouched.
  const foreign = await dbPost(tokOwn, { table: 'attendance_logs', action: 'insert', values: { id: 'LOG-OTHER', schedule_id: 'SCH-X', student_id: 'STU-1', date: '2026-10-28', status: 'Completed', lesson_notes: 'HIJACK-ATTEMPT' } });
  check('P1-2 teacher insert with foreign log id -> 403', foreign.status === 403, foreign.text.slice(0, 200));
  const otherAfter = await readLog('LOG-OTHER');
  check('P1-2 foreign row untouched after denied insert', otherAfter && otherAfter.teacher_id === 'TCH-OTHER' && otherAfter.lesson_notes === 'OTHER-ORIGINAL', JSON.stringify(otherAfter));
  // Same shape on the other two teacher-writable tables.
  const foreignSched = await dbPost(tokOwn, { table: 'class_schedules', action: 'upsert', values: { id: 'SCH-OTHER', student_id: 'STU-1', day_of_week: 2, start_time: '17:00:00', end_time: '17:30:00', status: 'Active' } });
  check('P1-2 teacher upsert with foreign schedule id -> 403', foreignSched.status === 403, foreignSched.text.slice(0, 200));
  const foreignLeave = await dbPost(tokOwn, { table: 'leave_requests', action: 'upsert', values: { id: 'LEAVE-OTHER', student_id: 'STU-1', leave_date: '2026-11-03', reason: 'hijack' } });
  check('P1-2 teacher upsert with foreign leave id -> 403', foreignLeave.status === 403, foreignLeave.text.slice(0, 200));
  // Own id: genuine re-save still works.
  const own = await dbPost(tokOwn, { table: 'attendance_logs', action: 'insert', values: { id: 'LOG-OWN', schedule_id: 'SCH-LOG-OWN', student_id: 'STU-1', date: '2026-10-28', status: 'Completed', lesson_notes: 'OWN-UPDATED' } });
  check('P1-2 teacher insert with own log id -> 200', own.status === 200, own.text.slice(0, 200));
  const ownAfter = await readLog('LOG-OWN');
  check('P1-2 own row replaced by own re-save', ownAfter && ownAfter.teacher_id === 'TCH-OWN' && ownAfter.lesson_notes === 'OWN-UPDATED', JSON.stringify(ownAfter));
  // No id: engine generates a fresh id, unaffected by the guard.
  const noId = await dbPost(tokOwn, { table: 'attendance_logs', action: 'insert', values: { schedule_id: 'SCH-NEW', student_id: 'STU-1', date: '2026-10-28', status: 'Running', lesson_notes: 'FRESH-ROW' } });
  check('P1-2 teacher insert without id -> 200', noId.status === 200, noId.text.slice(0, 200));
  // Owner/manager flows keep INSERT OR REPLACE semantics (narrow fix:
  // scoped roles only). Owner re-save of a foreign id still lands.
  const ownerForeign = await dbPost(TOK.owner, { table: 'attendance_logs', action: 'insert', values: { id: 'LOG-OTHER', schedule_id: 'SCH-LOG-OTHER', student_id: 'STU-1', teacher_id: 'TCH-OTHER', date: '2026-10-28', status: 'Completed', lesson_notes: 'OWNER-RESAVE' } });
  check('P1-2 owner insert with existing id still -> 200 (unchanged semantics)', ownerForeign.status === 200, ownerForeign.text.slice(0, 200));
  const mgrForeign = await dbPost(tokMgr, { table: 'attendance_logs', action: 'insert', values: { id: 'LOG-OTHER', schedule_id: 'SCH-LOG-OTHER', student_id: 'STU-1', teacher_id: 'TCH-OTHER', date: '2026-10-28', status: 'Completed', lesson_notes: 'MGR-RESAVE' } });
  check('P1-2 manager insert with existing id still -> 200 (unchanged semantics)', mgrForeign.status === 200, mgrForeign.text.slice(0, 200));
}
// ==== P1-4: manager 360 sub-record delete guard ==============================
{
  const tokMgr = await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET);
  const famNotes = { manager_notes: [{ id: 'MN-1', text: 'a' }, { id: 'MN-2', text: 'b' }], teacher_notes: [{ id: 'TN-1', text: 'c' }], bio_meta: {} };
  const seedFamNotes = async (id, notes) => {
    const r = await dbPost(TOK.owner, { table: 'families', action: 'insert', values: { id, parent_name: 'Test Family ' + id, status: 'Active', notes: typeof notes === 'string' ? notes : JSON.stringify(notes) } });
    check(`seed family notes ${id}`, r.status === 200, r.text.slice(0, 200));
  };
  await seedFamNotes('FAM-360', famNotes);
  await seedFamNotes('FAM-360-OWNER', famNotes);
  await seedFamNotes('FAM-360-STR', famNotes);
  await seedFamNotes('FAM-PLAIN', 'just some plain text notes');
  const tchAddr = { deduction_records: [{ id: 'D-1', amount: 100 }, { id: 'D-2', amount: 200 }], leave_records: [{ id: 'L-1' }], documents: [{ id: 'DOC-1' }] };
  const seedTchAddr = async (id, address) => {
    const r = await dbPost(TOK.owner, { table: 'teachers', action: 'insert', values: { id, full_name: 'Test Teacher ' + id, address: typeof address === 'string' ? address : JSON.stringify(address) } });
    check(`seed teacher address ${id}`, r.status === 200, r.text.slice(0, 200));
  };
  await seedTchAddr('TCH-360', tchAddr);
  const stuNotes = { certificates: [{ id: 'C-1', title: 'x' }, { id: 'C-2', title: 'y' }] };
  const seedStu = await dbPost(TOK.owner, { table: 'students', action: 'insert', values: { id: 'STU-360', family_id: 'FAM-360', name: 'Test Student', status: 'Active', notes: JSON.stringify(stuNotes) } });
  check('seed student STU-360', seedStu.status === 200, seedStu.text.slice(0, 200));
  const readFamNotes = async (id) => {
    const r = await dbPost(TOK.owner, { table: 'families', action: 'select', filters: eq('id', id) });
    const row = (r.json && r.json.data && r.json.data[0]) || null;
    try { return row ? JSON.parse(row.notes) : null; } catch (e) { return row ? row.notes : null; }
  };
  const readTchAddr = async (id) => {
    const r = await dbPost(TOK.owner, { table: 'teachers', action: 'select', filters: eq('id', id) });
    const row = (r.json && r.json.data && r.json.data[0]) || null;
    try { return row ? JSON.parse(row.address) : null; } catch (e) { return row ? row.address : null; }
  };
  const readStuNotes = async (id) => {
    const r = await dbPost(TOK.owner, { table: 'students', action: 'select', filters: eq('id', id) });
    const row = (r.json && r.json.data && r.json.data[0]) || null;
    try { return row ? JSON.parse(row.notes) : null; } catch (e) { return row ? row.notes : null; }
  };
  // 1. Manager deleting a family manager note (list shrinkage) -> 403, stored intact.
  const delNote = await dbPost(tokMgr, { table: 'families', action: 'update', values: { notes: JSON.stringify({ ...famNotes, manager_notes: [{ id: 'MN-1', text: 'a' }] }) }, filters: eq('id', 'FAM-360') });
  check('P1-4 manager delete family manager note -> 403', delNote.status === 403, delNote.text.slice(0, 200));
  const famAfterDel = await readFamNotes('FAM-360');
  check('P1-4 family notes intact after denied delete', famAfterDel && famAfterDel.manager_notes && famAfterDel.manager_notes.length === 2, JSON.stringify(famAfterDel));
  // 2. Manager ADDING a note -> 200 (legitimate edit untouched).
  const addNote = await dbPost(tokMgr, { table: 'families', action: 'update', values: { notes: JSON.stringify({ ...famNotes, manager_notes: [...famNotes.manager_notes, { id: 'MN-3', text: 'd' }] }) }, filters: eq('id', 'FAM-360') });
  check('P1-4 manager add family note -> 200', addNote.status === 200, addNote.text.slice(0, 200));
  const famAfterAdd = await readFamNotes('FAM-360');
  check('P1-4 family notes show added note', famAfterAdd && famAfterAdd.manager_notes && famAfterAdd.manager_notes.length === 3, JSON.stringify(famAfterAdd));
  // 3. Manager EDITING a note in place (same id, changed text) -> 200.
  const editNote = await dbPost(tokMgr, { table: 'families', action: 'update', values: { notes: JSON.stringify({ ...famAfterAdd, manager_notes: famAfterAdd.manager_notes.map((n) => (n.id === 'MN-1' ? { ...n, text: 'a-edited' } : n)) }) }, filters: eq('id', 'FAM-360') });
  check('P1-4 manager edit note in place -> 200', editNote.status === 200, editNote.text.slice(0, 200));
  const famAfterEdit = await readFamNotes('FAM-360');
  check('P1-4 edited note text saved, siblings intact', famAfterEdit && famAfterEdit.manager_notes.find((n) => n.id === 'MN-1').text === 'a-edited' && famAfterEdit.manager_notes.length === 3, JSON.stringify(famAfterEdit));
  // 4. Manager submitting notes WITHOUT the list key (partial patch) -> 200
  // AND the list is restored, not wiped.
  const omitKey = await dbPost(tokMgr, { table: 'families', action: 'update', values: { notes: JSON.stringify({ teacher_notes: famNotes.teacher_notes, bio_meta: { lifecycle_status: 'ACTIVE' } }) }, filters: eq('id', 'FAM-360') });
  check('P1-4 manager partial notes patch (key omitted) -> 200', omitKey.status === 200, omitKey.text.slice(0, 200));
  const famAfterOmit = await readFamNotes('FAM-360');
  check('P1-4 omitted list restored, other field saved', famAfterOmit && famAfterOmit.manager_notes && famAfterOmit.manager_notes.length === 3 && famAfterOmit.bio_meta && famAfterOmit.bio_meta.lifecycle_status === 'ACTIVE', JSON.stringify(famAfterOmit));
  // 5. Manager deleting a teacher deduction record -> 403, stored intact.
  const delDed = await dbPost(tokMgr, { table: 'teachers', action: 'update', values: { address: JSON.stringify({ ...tchAddr, deduction_records: [{ id: 'D-1', amount: 100 }] }) }, filters: eq('id', 'TCH-360') });
  check('P1-4 manager delete teacher deduction -> 403', delDed.status === 403, delDed.text.slice(0, 200));
  const tchAfterDel = await readTchAddr('TCH-360');
  check('P1-4 teacher address intact after denied delete', tchAfterDel && tchAfterDel.deduction_records && tchAfterDel.deduction_records.length === 2, JSON.stringify(tchAfterDel));
  // 6. Manager ADDING a teacher document -> 200.
  const addDoc = await dbPost(tokMgr, { table: 'teachers', action: 'update', values: { address: JSON.stringify({ ...tchAddr, documents: [...tchAddr.documents, { id: 'DOC-2' }] }) }, filters: eq('id', 'TCH-360') });
  check('P1-4 manager add teacher document -> 200', addDoc.status === 200, addDoc.text.slice(0, 200));
  // 7. Manager deleting a student certificate -> 403, stored intact.
  const delCert = await dbPost(tokMgr, { table: 'students', action: 'update', values: { notes: JSON.stringify({ certificates: [{ id: 'C-1', title: 'x' }] }) }, filters: eq('id', 'STU-360') });
  check('P1-4 manager delete student certificate -> 403', delCert.status === 403, delCert.text.slice(0, 200));
  const stuAfterDel = await readStuNotes('STU-360');
  check('P1-4 student notes intact after denied delete', stuAfterDel && stuAfterDel.certificates && stuAfterDel.certificates.length === 2, JSON.stringify(stuAfterDel));
  // 8. Owner deleting the same note -> 200 (owner exempt; guard is manager-only).
  const ownerDel = await dbPost(TOK.owner, { table: 'families', action: 'update', values: { notes: JSON.stringify({ ...famNotes, manager_notes: [{ id: 'MN-1', text: 'a' }] }) }, filters: eq('id', 'FAM-360-OWNER') });
  check('P1-4 owner delete family note -> 200 (exempt)', ownerDel.status === 200, ownerDel.text.slice(0, 200));
  // 9. Manager replacing structured notes with a plain string -> 403 (would wipe lists).
  const plainWipe = await dbPost(tokMgr, { table: 'families', action: 'update', values: { notes: 'just a plain note' }, filters: eq('id', 'FAM-360-STR') });
  check('P1-4 manager plain-string notes over structured lists -> 403', plainWipe.status === 403, plainWipe.text.slice(0, 200));
  // 10. Manager writing notes where no protected lists exist -> 200 (no false denial).
  const plainOk = await dbPost(tokMgr, { table: 'families', action: 'update', values: { notes: JSON.stringify({ custom_notes: 'updated text' }) }, filters: eq('id', 'FAM-PLAIN') });
  check('P1-4 manager notes update without protected lists -> 200', plainOk.status === 200, plainOk.text.slice(0, 200));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(' - ' + f.name);
  process.exit(1);
}
