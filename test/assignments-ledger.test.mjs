// Assignment ledger — Phase 2 PR-A (2026-11-03). Foundation only: the
// student_assignments table, its Worker access rules, the
// js/assignments.js helper (executed in a vm against a fake db) and the
// flow hooks that open/close periods. The payroll engine does not read
// the ledger until PR-B. Drives the REAL Worker via the house harness.
// Run from the repo root:  node test/assignments-ledger.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asg-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-' + 'y'.repeat(48);
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
const eq = (column, value) => [{ column, op: 'eq', value }];

const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
  parent: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
};

{
  const boot = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('setup: schema boot -> 200 (student_assignments DDL runs)', boot.status === 200, 'got ' + boot.status);
}
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('TCH-MGR-1', 'Manager One', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A')");

// ---- Worker access rules for the ledger ----
{
  const ins = await dbPost(TOK.owner, { table: 'student_assignments', action: 'insert', values: { id: 'ASG-1', student_id: 'ST-1', teacher_id: 'T-A', course_name: 'Noorani Qaida', start_date: '2026-11-01' } });
  check('owner CAN insert an assignment row', ins.status === 200 && !ins.json.error, 'status ' + ins.status + ' ' + ins.text.slice(0, 120));
  const sel = await dbPost(TOK.owner, { table: 'student_assignments', action: 'select', filters: eq('student_id', 'ST-1') });
  check('owner CAN read assignment rows', sel.status === 200 && ((sel.json.data || []).length) === 1, 'rows ' + ((sel.json.data || []).length));

  const t = await dbPost(TOK.teacher, { table: 'student_assignments', action: 'select' });
  check('teacher CANNOT read the ledger', t.status !== 200 || ((t.json.data || []).length) === 0, 'status ' + t.status + ' rows ' + ((t.json.data || []).length));
  const p = await dbPost(TOK.parent, { table: 'student_assignments', action: 'select' });
  check('parent CANNOT read the ledger', p.status !== 200 || ((p.json.data || []).length) === 0, 'status ' + p.status + ' rows ' + ((p.json.data || []).length));
  const tw = await dbPost(TOK.teacher, { table: 'student_assignments', action: 'insert', values: { id: 'ASG-FORGE', student_id: 'ST-1', teacher_id: 'T-A', start_date: '2026-11-01' } });
  const afterForge = await dbPost(TOK.owner, { table: 'student_assignments', action: 'select', filters: eq('id', 'ASG-FORGE') });
  check('teacher CANNOT insert into the ledger', ((afterForge.json.data || []).length) === 0, 'status ' + tw.status);

  const mi = await dbPost(TOK.manager, { table: 'student_assignments', action: 'insert', values: { id: 'ASG-2', student_id: 'ST-1', teacher_id: 'T-A', course_name: 'Quran Reading with Tajweed', start_date: '2026-11-02' } });
  const msel = await dbPost(TOK.manager, { table: 'student_assignments', action: 'select', filters: eq('id', 'ASG-2') });
  check('manager CAN insert + read (flows run in manager sessions too)', mi.status === 200 && ((msel.json.data || []).length) === 1, 'ins ' + mi.status + ' rows ' + ((msel.json.data || []).length));

  await dbPost(TOK.manager, { table: 'student_assignments', action: 'delete', filters: eq('id', 'ASG-2') });
  const afterMgrDel = await dbPost(TOK.owner, { table: 'student_assignments', action: 'select', filters: eq('id', 'ASG-2') });
  check('manager CANNOT hard-delete a ledger row', ((afterMgrDel.json.data || []).length) === 1);
  await dbPost(TOK.owner, { table: 'student_assignments', action: 'delete', filters: eq('id', 'ASG-1') });
  const afterOwnerDel = await dbPost(TOK.owner, { table: 'student_assignments', action: 'select', filters: eq('id', 'ASG-1') });
  check('owner CANNOT hard-delete a ledger row either (history is closed, never erased)', ((afterOwnerDel.json.data || []).length) === 1);

  const upd = await dbPost(TOK.owner, { table: 'student_assignments', action: 'update', values: { end_date: '2026-11-15', end_reason: 'transferred' }, filters: eq('id', 'ASG-1') });
  const afterUpd = await dbPost(TOK.owner, { table: 'student_assignments', action: 'select', filters: eq('id', 'ASG-1') });
  check('closing a row (update end_date) works', upd.status === 200 && ((afterUpd.json.data || [])[0] || {}).end_reason === 'transferred', 'status ' + upd.status);

  const h = await call('/api/health', { method: 'GET' });
  check('health reports assignments release + schema v4', h.status === 200 && h.json && h.json.version === '2026-11-05-slots' && h.json.schema === '2026-11-05-v5', JSON.stringify(h.json));
}

// ---- js/assignments.js executed against a fake db shim ----
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/assignments.js'), 'utf8');
const writes = [];
const fakeRows = [];
function fakeQuery(table) {
  const q = {
    _filters: {},
    select() { return Promise.resolve({ data: fakeRows.slice(), error: null }); },
    insert(row) { writes.push({ op: 'insert', row }); fakeRows.push({ ...row }); return Promise.resolve({ data: [row], error: null }); },
    update(vals) { q._vals = vals; return q; },
    eq(col, val) {
      if (q._vals) {
        writes.push({ op: 'update', vals: q._vals, col, val });
        const r = fakeRows.find((x) => x[col] === val);
        if (r) Object.assign(r, q._vals);
        return Promise.resolve({ data: [], error: null });
      }
      return q;
    },
  };
  return q;
}
const sandbox = {
  console,
  document: { readyState: 'complete', addEventListener: () => {} },
  db: { from: (t) => fakeQuery(t) },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const A = sandbox.window.Assignments;

{
  check('module exposes Assignments', !!A && typeof A.open === 'function' && typeof A.deriveFor === 'function');
  await A.loadAll();
  await A.open({ student_id: 'S1', teacher_id: 'T1', course_name: 'Noorani Qaida', start_date: '2026-11-01' });
  check('open() inserts one row', writes.filter((w) => w.op === 'insert').length === 1, JSON.stringify(writes).slice(0, 160));
  await A.open({ student_id: 'S1', teacher_id: 'T1', course_name: 'Noorani Qaida', start_date: '2026-11-01' });
  check('open() dedupes an identical open period', writes.filter((w) => w.op === 'insert').length === 1);
  await A.transition({ student_id: 'S1', teacher_id: 'T2', course_name: 'Noorani Qaida', start_date: '2026-11-16', end_reason: 'transferred' });
  const updW = writes.find((w) => w.op === 'update');
  check('transition() closes the old period the day before the new start', !!updW && updW.vals.end_date === '2026-11-15' && updW.vals.end_reason === 'transferred', JSON.stringify(updW || {}));
  check('transition() opens the new teacher period', fakeRows.some((r) => r.teacher_id === 'T2' && r.start_date === '2026-11-16' && !r.end_date));
  await A.closeCurrent('S1', { end_date: '2026-11-30', end_reason: 'deactivated' });
  check('closeCurrent() closes the remaining open row', fakeRows.filter((r) => r.student_id === 'S1').every((r) => !!r.end_date));

  const students = [
    { id: 'S1', assigned_teacher_id: 'T2', joining_date: '2026-09-01', notes: JSON.stringify({ course: 'Noorani Qaida' }) },
    { id: 'S2', assigned_teacher_id: 'T9', joining_date: '2026-10-05', notes: JSON.stringify({ course_name: 'Islamic Studies & Tarbiyah' }) },
    { id: 'S3', assigned_teacher_id: null, joining_date: '2026-10-05', notes: '{}' },
  ];
  const derived = A.deriveFor(students, fakeRows);
  check('deriveFor skips students who already have real rows', derived.length === 1 && derived[0].student_id === 'S2', JSON.stringify(derived).slice(0, 160));
  check('deriveFor builds the synthetic period from the current record', derived[0].teacher_id === 'T9' && derived[0].course_name === 'Islamic Studies & Tarbiyah' && derived[0].start_date === '2026-10-05' && derived[0].synthetic === true);
  check('dayBefore handles month boundaries', A.dayBefore('2026-03-01') === '2026-02-28' && A.dayBefore('2024-03-01') === '2024-02-29');
}

// ---- Structural: hooks + include ----
{
  const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  check('index.html loads assignments.js', html.includes('<script src="js/assignments.js"></script>'));
  const fam = fs.readFileSync(path.join(REPO_ROOT, 'js/families.js'), 'utf8');
  check('Add Student save opens an assignment', fam.includes('Assignments.open({ student_id: id, teacher_id: assigned_teacher_id'));
  const tri = fs.readFileSync(path.join(REPO_ROOT, 'js/trials.js'), 'utf8');
  check('trial conversion opens an assignment (only when the save did not fail)', tri.includes('!convertSaveFailed && window.Assignments') && tri.includes('Assignments.open({ student_id: canonicalStuId'));
  const sch = fs.readFileSync(path.join(REPO_ROOT, 'js/schedule.js'), 'utf8');
  check('shift flow transitions the assignment', sch.includes("Assignments.transition({ student_id: studentId, teacher_id: toTeacherId"));
  const cfg = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');
  check('deactivation helper closes the assignment', cfg.includes("Assignments.closeCurrent(studentId, { end_date:") && cfg.includes("end_reason: 'deactivated'"));
  const p360 = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');
  check('360 edit handles reactivation + teacher change + course change', p360.includes("end_reason: 'teacher_changed'") && p360.includes("end_reason: 'course_changed'") && p360.includes('const oldCourseName'));
  const dbjs = fs.readFileSync(path.join(REPO_ROOT, 'functions/api/db.js'), 'utf8');
  check('schema creates student_assignments + allowlists it', dbjs.includes('CREATE TABLE IF NOT EXISTS student_assignments') && dbjs.includes("'student_assignments'") && dbjs.includes("SCHEMA_VERSION = '2026-11-05-v5'"));
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' ; ')); process.exit(1); }
