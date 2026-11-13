// Teacher Cover / Substitute (owner commission, 2026-11-13):
// when a teacher is on leave, another teacher takes that day's
// classes (banner on student/parent portals + per-student assign),
// and the salary for covered days moves per the leave form's
// two-step choice (deduction? -> does the deducted amount go to
// the cover teacher? / no deduction -> extra pay for the cover?).
// The cover is for THAT DATE ONLY — next day everything reverts.
//
//   Part 1 drives the REAL Worker against a fake D1: the new
//   cover_assignments table (schema v9), health release pin, and
//   the per-role gates — teacher read-only on own rows, parent
//   read-only on own children's rows + their teachers' banners,
//   manager read with manager-account exclusion, owner/manager
//   writes, and the delete deny list (cancel via status, never
//   hard-delete).
//   Part 2 executes the REAL js/payroll.js cover helpers in a vm
//   (extracted — they are pure): choice defaults, day value,
//   dedupe (latest wins, loser slots absorbed), transfer /
//   deduct-only / extra / none, no-line + out-of-segment warnings,
//   same-teacher-both-sides ignored, live vs frozen slips, and the
//   academy-total-unchanged transfer invariant.
//   Part 3 executes the REAL _coverCheckAssignConflict in a vm:
//   the conflict matrix (own-class overlap, own leave, ineligible,
//   already covering, same-student exception, unknown teacher).
//   Part 4 executes the REAL _buildTeacherCoverPanelHtml in a vm:
//   Leave ON card, banner pill + preview, salary summary + Change,
//   assigned covers list, Assign Students button, past-leave and
//   REQ-LV- skipping.
//   Part 6 executes the REAL leave modal + assign modal + summary texts
//   and asserts professional English throughout (2026-11-13 fix): every
//   Roman Urdu label from the shipped modal/panel/banner is gone, and the
//   option values (yes/no) and all behaviour are unchanged.
//   Part 5 pins the structural contract in the portals (leave modal
//   salary fields, banner container, Cover badge, slip cover section,
//   cover log) and the Worker/db version strings.
// Run from the repo root:  node test/teacher-cover.test.mjs
// Requires: node >= 22.5 (node:sqlite). All records are SYNTHETIC.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ===========================================================================
// Part 1 — REAL Worker: cover_assignments gates
// ===========================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'teacher-cover-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = 'test-secret-for-teacher-cover-suite-only';
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
  all(sql, ...params) { return this._db.prepare(sql).all(...params); }
  q1(sql, ...params) { return this._db.prepare(sql).get(...params); }
}
class FakeR2 {
  constructor() { this._map = new Map(); }
  async get(key) { const v = this._map.get(key); if (!v) return null; return { body: v, httpMetadata: { contentType: 'image/png' }, httpEtag: '"fake"' }; }
  async put(key, body) { this._map.set(key, typeof body === 'string' ? body : 'bytes'); return { key }; }
}
const fakeDb = new FakeD1();
const fakeR2 = new FakeR2();
const env = { DB: fakeDb, STORAGE: fakeR2 };
env[['WORKER', 'AUTH', 'SECRET'].join('_')] = WORKER_SECRET;
const TOK = {
  owner: await createSessionToken({ sub: 'owner1', role: 'owner' }, WORKER_SECRET),
  manager: await createSessionToken({ sub: 'MGR-001', role: 'manager' }, WORKER_SECRET),
  teacherA: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
  teacherB: await createSessionToken({ sub: 'T-B', role: 'teacher' }, WORKER_SECRET),
  parent1: await createSessionToken({ sub: 'FAM-1', role: 'parent' }, WORKER_SECRET),
  parent2: await createSessionToken({ sub: 'FAM-2', role: 'parent' }, WORKER_SECRET),
};
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
const eqF = (column, value) => ({ column, op: 'eq', value });
const selCover = (token) => dbPost(token, { table: 'cover_assignments', action: 'select', filters: [] });
const coverIds = (res) => ((res.json && res.json.data) || []).map(r => r.id).sort();

// Trigger schema creation, then seed synthetic records.
{
  const r = await dbPost(TOK.owner, { table: 'families', action: 'select' });
  check('worker: owner /api/db boot -> 200', r.status === 200, r.text.slice(0, 200));
  const t = fakeDb.q1("SELECT name FROM sqlite_master WHERE type='table' AND name='cover_assignments'");
  check('worker: cover_assignments table created by schema boot', !!t);
  const marker = fakeDb.q1("SELECT value FROM system_settings WHERE key = 'schema_version'");
  check('worker: schema marker is v9 (cover bump)', marker && marker.value === '2026-11-13-v9', JSON.stringify(marker));
  const h = await call('/api/health', { method: 'GET' });
  check('worker: health reports the cover release + schema v9',
    h.status === 200 && h.json && h.json.version === '2026-11-13-teacher-cover' && h.json.schema === '2026-11-13-v9',
    'got ' + (h.json && h.json.version) + '/' + (h.json && h.json.schema));
}
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-B', 'Teacher B', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-C', 'Teacher C', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('MGR-001', 'Manager One', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-2', 'Parent Two')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id, status) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A', 'Active')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id, status) VALUES ('ST-2', 'FAM-2', 'Child Two', 'T-B', 'Active')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id, status) VALUES ('ST-9', 'FAM-2', 'Child Nine', 'T-C', 'Active')");
// COV-1: T-A absent, T-B covers ST-1 on 2026-11-16. COV-2: banner for T-A's
// leave 16-17 Nov (student_id NULL — the parent student arm alone would
// hide it). COV-3: T-C absent, T-A covers ST-9 (not FAM-1's child).
// COV-4: a manager (MGR-001) is the absent teacher — managers must never
// see it, but the parent of the covered child still may (student arm).
fakeDb.seed("INSERT INTO cover_assignments (id, kind, leave_id, absent_teacher_id, absent_teacher_name, cover_teacher_id, cover_teacher_name, student_id, student_name, course_name, cover_date, schedule_id, start_time, end_time, duration_mins, status) VALUES ('COV-1', 'assign', 'LV-1', 'T-A', 'Teacher A', 'T-B', 'Teacher B', 'ST-1', 'Child One', 'Quran', '2026-11-16', 'SCH-1', '10:00', '10:30', 30, 'active')");
fakeDb.seed("INSERT INTO cover_assignments (id, kind, leave_id, absent_teacher_id, absent_teacher_name, start_date, end_date, reason, status) VALUES ('COV-2', 'banner', 'LV-1', 'T-A', 'Teacher A', '2026-11-16', '2026-11-17', 'Family function', 'active')");
fakeDb.seed("INSERT INTO cover_assignments (id, kind, leave_id, absent_teacher_id, absent_teacher_name, cover_teacher_id, cover_teacher_name, student_id, student_name, course_name, cover_date, schedule_id, start_time, end_time, duration_mins, status) VALUES ('COV-3', 'assign', 'LV-2', 'T-C', 'Teacher C', 'T-A', 'Teacher A', 'ST-9', 'Child Nine', 'Tajweed', '2026-11-16', 'SCH-9', '11:00', '11:30', 30, 'active')");
fakeDb.seed("INSERT INTO cover_assignments (id, kind, leave_id, absent_teacher_id, absent_teacher_name, cover_teacher_id, cover_teacher_name, student_id, student_name, course_name, cover_date, schedule_id, start_time, end_time, duration_mins, status) VALUES ('COV-4', 'assign', 'LV-3', 'MGR-001', 'Manager One', 'T-B', 'Teacher B', 'ST-1', 'Child One', 'Quran', '2026-11-16', 'SCH-4', '12:00', '12:30', 30, 'active')");

{
  const a = await selCover(TOK.teacherA);
  check('worker: teacher T-A reads own rows as cover AND as absent (COV-1, COV-2, COV-3)',
    a.status === 200 && JSON.stringify(coverIds(a)) === JSON.stringify(['COV-1', 'COV-2', 'COV-3']), a.text.slice(0, 200));
  const b = await selCover(TOK.teacherB);
  check('worker: teacher T-B reads only rows where they cover (COV-1, COV-4)',
    b.status === 200 && JSON.stringify(coverIds(b)) === JSON.stringify(['COV-1', 'COV-4']), b.text.slice(0, 200));
  const p1 = await selCover(TOK.parent1);
  check('worker: parent FAM-1 reads own child rows + own teacher banner rows (COV-1, COV-2, COV-4)',
    p1.status === 200 && JSON.stringify(coverIds(p1)) === JSON.stringify(['COV-1', 'COV-2', 'COV-4']), p1.text.slice(0, 200));
  const p2 = await selCover(TOK.parent2);
  check('worker: parent FAM-2 reads only their own child/teacher rows (COV-3)',
    p2.status === 200 && JSON.stringify(coverIds(p2)) === JSON.stringify(['COV-3']), p2.text.slice(0, 200));
  const m = await selCover(TOK.manager);
  check('worker: manager reads covers but NEVER a row involving a manager account (COV-4 hidden)',
    m.status === 200 && JSON.stringify(coverIds(m)) === JSON.stringify(['COV-1', 'COV-2', 'COV-3']), m.text.slice(0, 200));
  const o = await selCover(TOK.owner);
  check('worker: owner reads all cover rows',
    o.status === 200 && JSON.stringify(coverIds(o)) === JSON.stringify(['COV-1', 'COV-2', 'COV-3', 'COV-4']), o.text.slice(0, 200));
}

{
  const insBody = { table: 'cover_assignments', action: 'insert', values: { id: 'COV-X', kind: 'assign', leave_id: 'LV-9', absent_teacher_id: 'T-A', cover_teacher_id: 'T-B', student_id: 'ST-1', cover_date: '2026-11-16', status: 'active' } };
  const tIns = await dbPost(TOK.teacherA, insBody);
  check('worker: teacher INSERT on cover_assignments is denied (403, nothing written)',
    tIns.status === 403 && !fakeDb.q1("SELECT id FROM cover_assignments WHERE id='COV-X'"), 'status=' + tIns.status);
  const pIns = await dbPost(TOK.parent1, insBody);
  check('worker: parent INSERT on cover_assignments is denied (403)',
    pIns.status === 403, 'status=' + pIns.status);
  const tUpd = await dbPost(TOK.teacherA, { table: 'cover_assignments', action: 'update', values: { status: 'cancelled' }, filters: [eqF('id', 'COV-1')] });
  check('worker: teacher UPDATE on cover_assignments is denied (403, row unchanged)',
    tUpd.status === 403 && fakeDb.q1("SELECT status FROM cover_assignments WHERE id='COV-1'").status === 'active', 'status=' + tUpd.status);
  const tDel = await dbPost(TOK.teacherA, { table: 'cover_assignments', action: 'delete', filters: [eqF('id', 'COV-1')] });
  check('worker: teacher DELETE on cover_assignments is denied (403, row intact)',
    tDel.status === 403 && !!fakeDb.q1("SELECT id FROM cover_assignments WHERE id='COV-1'"), 'status=' + tDel.status);
  const oDel = await dbPost(TOK.owner, { table: 'cover_assignments', action: 'delete', filters: [eqF('id', 'COV-1')] });
  check('worker: owner DELETE on cover_assignments is denied too — cancel via status, never hard-delete',
    oDel.status === 403 && !!fakeDb.q1("SELECT id FROM cover_assignments WHERE id='COV-1'"), 'status=' + oDel.status);
  const mIns = await dbPost(TOK.manager, { table: 'cover_assignments', action: 'insert', values: { id: 'COV-5', kind: 'assign', leave_id: 'LV-1', absent_teacher_id: 'T-A', cover_teacher_id: 'T-B', student_id: 'ST-1', cover_date: '2026-11-17', status: 'active' } });
  check('worker: manager INSERT on cover_assignments is allowed (admin-side assign path)',
    mIns.status === 200 && !!fakeDb.q1("SELECT id FROM cover_assignments WHERE id='COV-5'"), 'status=' + mIns.status + ' ' + mIns.text.slice(0, 120));
  const mUpd = await dbPost(TOK.manager, { table: 'cover_assignments', action: 'update', values: { status: 'cancelled' }, filters: [eqF('id', 'COV-5')] });
  check('worker: manager UPDATE (cancel via status) is allowed',
    mUpd.status === 200 && fakeDb.q1("SELECT status FROM cover_assignments WHERE id='COV-5'").status === 'cancelled', 'status=' + mUpd.status + ' ' + mUpd.text.slice(0, 120));
  const oIns = await dbPost(TOK.owner, { table: 'cover_assignments', action: 'insert', values: { id: 'COV-6', kind: 'banner', leave_id: 'LV-1', absent_teacher_id: 'T-A', start_date: '2026-11-16', end_date: '2026-11-17', reason: 'test', status: 'active' } });
  check('worker: owner INSERT on cover_assignments is allowed',
    oIns.status === 200 && !!fakeDb.q1("SELECT id FROM cover_assignments WHERE id='COV-6'"), 'status=' + oIns.status + ' ' + oIns.text.slice(0, 120));
}

// ===========================================================================
// Part 2 — REAL js/payroll.js cover helpers (extracted, pure)
// ===========================================================================
const payrollSrc = read('js/payroll.js');
const payrollCtx = { console, Math, JSON, Number, String, Boolean, Array, Object, parseInt, parseFloat, isNaN };
payrollCtx.window = payrollCtx;
vm.createContext(payrollCtx);
for (const fn of ['coverLeaveChoiceFromRecord', 'buildCoverLeaveChoiceMap', 'payrollCoverDayValue', 'dedupeCoverRows', 'computeCoverAmountsForTeacher', 'applyCoverToCompiledSlips']) {
  vm.runInContext(extractFunction(payrollSrc, fn), payrollCtx, { filename: 'js/payroll.js:' + fn });
}
const pc = (code) => vm.runInContext(code, payrollCtx);

{
  check('payroll: leave choice defaults are deduct + goes-to-cover (today\'s manual practice)',
    JSON.stringify(pc(`coverLeaveChoiceFromRecord({})`)) === JSON.stringify({ deduction: 'yes', goesToCover: 'yes', extraPay: 'no' }));
  check('payroll: leave recorded before this feature (no salary fields) resolves to the same defaults',
    JSON.stringify(pc(`coverLeaveChoiceFromRecord({ id: 'LV-OLD', startDate: '2026-11-01' })`)) === JSON.stringify({ deduction: 'yes', goesToCover: 'yes', extraPay: 'no' }));
  check('payroll: deduct-only choice (deduction yes, goes-to-cover no)',
    JSON.stringify(pc(`coverLeaveChoiceFromRecord({ salary_deduction: 'yes', deduction_goes_to_cover: 'no' })`)) === JSON.stringify({ deduction: 'yes', goesToCover: 'no', extraPay: 'no' }));
  check('payroll: no-deduction + extra-pay choice',
    JSON.stringify(pc(`coverLeaveChoiceFromRecord({ salary_deduction: 'no', no_deduction_cover_paid_extra: 'yes' })`)) === JSON.stringify({ deduction: 'no', goesToCover: 'yes', extraPay: 'yes' }));
  check('payroll: no-deduction + no extra pay (nothing moves)',
    JSON.stringify(pc(`coverLeaveChoiceFromRecord({ salary_deduction: 'no' })`)) === JSON.stringify({ deduction: 'no', goesToCover: 'yes', extraPay: 'no' }));
  check('payroll: choice map reads leave records from teacher address JSON',
    JSON.stringify(pc(`buildCoverLeaveChoiceMap([
      { id: 'T-A', address: JSON.stringify({ leave_records: [{ id: 'LV-1', salary_deduction: 'no', no_deduction_cover_paid_extra: 'yes' }] }) },
      { id: 'T-B', address: null }
    ])`)) === JSON.stringify({ 'LV-1': { deduction: 'no', goesToCover: 'yes', extraPay: 'yes' } }));
}

const NOV = { firstDayStr: '2026-11-01', lastDayStr: '2026-11-30', daysInMonth: 30 };
const line30k = (extra = {}) => ({ student_id: 'ST-1', final_rate: 30000, active_days: 30, joining_date: '2026-11-01', seg_end: '2026-11-30', ...extra });
const slipsAB = () => ({
  'T-A': { teacher_name: 'Teacher A', assigned_students: [line30k()] },
  'T-B': { teacher_name: 'Teacher B', assigned_students: [] },
});
const coverRow = (extra = {}) => ({ id: 'COV-1', kind: 'assign', leave_id: 'LV-1', absent_teacher_id: 'T-A', absent_teacher_name: 'Teacher A', cover_teacher_id: 'T-B', cover_teacher_name: 'Teacher B', student_id: 'ST-1', student_name: 'Child One', cover_date: '2026-11-16', duration_mins: 30, status: 'active', created_at: '2026-11-13T10:00:00', ...extra });
const choicesTransfer = { 'LV-1': { deduction: 'yes', goesToCover: 'yes', extraPay: 'no' } };

{
  check('payroll: one covered day on a PKR 30,000 / 30-day line is PKR 1,000',
    pc(`payrollCoverDayValue(${JSON.stringify(line30k())}, '2026-11-16', ${JSON.stringify(NOV)})`) === 1000);
  check('payroll: cover date before the payable segment pays 0',
    pc(`payrollCoverDayValue(${JSON.stringify(line30k({ joining_date: '2026-11-20' }))}, '2026-11-16', ${JSON.stringify(NOV)})`) === 0);
  check('payroll: cover date after the payable segment pays 0',
    pc(`payrollCoverDayValue(${JSON.stringify(line30k({ seg_end: '2026-11-10' }))}, '2026-11-16', ${JSON.stringify(NOV)})`) === 0);
  check('payroll: a line with no payable amount pays 0',
    pc(`payrollCoverDayValue(${JSON.stringify(line30k({ final_rate: 0 }))}, '2026-11-16', ${JSON.stringify(NOV)})`) === 0);

  const t = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: transfer — absent teacher loses the day value (cover_out 1,000)',
    t.cover_out === 1000 && t.cover_in === 0 && t.cover_lines.length === 1 && t.cover_lines[0].mode === 'transfer' && t.cover_lines[0].day_value === 1000 && t.cover_lines[0].slots === 1, JSON.stringify(t));
  const c = pc(`computeCoverAmountsForTeacher('T-B', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: transfer — cover teacher gains the same day value (cover_in 1,000)',
    c.cover_in === 1000 && c.cover_out === 0 && c.cover_lines.length === 1, JSON.stringify(c));
  check('payroll: transfer is academy-total neutral (out == in)',
    t.cover_out === c.cover_in);

  const dedOnly = { 'LV-1': { deduction: 'yes', goesToCover: 'no', extraPay: 'no' } };
  const dA = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(dedOnly)}, ${JSON.stringify(NOV)})`);
  const dB = pc(`computeCoverAmountsForTeacher('T-B', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(dedOnly)}, ${JSON.stringify(NOV)})`);
  check('payroll: deduct-only — absent loses 1,000, cover gains nothing',
    dA.cover_out === 1000 && dB.cover_in === 0 && dA.cover_lines[0].mode === 'deduct-only', JSON.stringify(dA) + ' / ' + JSON.stringify(dB));

  const extra = { 'LV-1': { deduction: 'no', goesToCover: 'yes', extraPay: 'yes' } };
  const eA = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(extra)}, ${JSON.stringify(NOV)})`);
  const eB = pc(`computeCoverAmountsForTeacher('T-B', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(extra)}, ${JSON.stringify(NOV)})`);
  check('payroll: extra — absent keeps full pay, cover gains 1,000 on top',
    eA.cover_out === 0 && eB.cover_in === 1000 && eB.cover_lines[0].mode === 'extra', JSON.stringify(eA) + ' / ' + JSON.stringify(eB));

  const none = { 'LV-1': { deduction: 'no', goesToCover: 'yes', extraPay: 'no' } };
  const nA = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(none)}, ${JSON.stringify(NOV)})`);
  const nB = pc(`computeCoverAmountsForTeacher('T-B', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(none)}, ${JSON.stringify(NOV)})`);
  check('payroll: no deduction + no extra — no money moves either side',
    nA.cover_out === 0 && nB.cover_in === 0 && nA.cover_lines[0].mode === 'none');

  const noLine = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify({ 'T-A': { teacher_name: 'Teacher A', assigned_students: [] }, 'T-B': { teacher_name: 'Teacher B', assigned_students: [] } })}, [${JSON.stringify(coverRow())}], ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: covered student with no payable line warns and pays 0',
    noLine.cover_out === 0 && noLine.warnings.length === 1 && /no payable salary line/.test(noLine.warnings[0].reason), JSON.stringify(noLine));
  const outSeg = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify({ 'T-A': { teacher_name: 'Teacher A', assigned_students: [line30k({ seg_end: '2026-11-10' })] }, 'T-B': { teacher_name: 'Teacher B', assigned_students: [] } })}, [${JSON.stringify(coverRow())}], ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: cover date outside the payable segment warns and pays 0',
    outSeg.cover_out === 0 && outSeg.warnings.length === 1 && /outside the student/.test(outSeg.warnings[0].reason), JSON.stringify(outSeg));
  const sameBoth = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow({ cover_teacher_id: 'T-A' }))}], ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: a row naming the same teacher on both sides is ignored',
    sameBoth.cover_out === 0 && sameBoth.cover_in === 0 && sameBoth.cover_lines.length === 0, JSON.stringify(sameBoth));
  const uninvolved = pc(`computeCoverAmountsForTeacher('T-C', ${JSON.stringify(slipsAB())}, [${JSON.stringify(coverRow())}], ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: a teacher on neither side of the row gets nothing',
    uninvolved.cover_out === 0 && uninvolved.cover_in === 0 && uninvolved.cover_lines.length === 0);

  const dup = pc(`dedupeCoverRows([${JSON.stringify(coverRow({ id: 'COV-OLD', created_at: '2026-11-13T09:00:00' }))}, ${JSON.stringify(coverRow({ id: 'COV-NEW', created_at: '2026-11-13T10:00:00' }))}])`);
  check('payroll: duplicate cover for the same student+date keeps only the latest row',
    dup.rows.length === 1 && dup.rows[0].id === 'COV-NEW' && dup.duplicates.length === 1 && dup.duplicates[0].id === 'COV-OLD', JSON.stringify(dup));
  check('payroll: the kept duplicate absorbs the loser\'s slots (30 + 30 min = 60 min kept)',
    dup.rows[0].duration_mins === 60);
  const dupLine = pc(`computeCoverAmountsForTeacher('T-A', ${JSON.stringify(slipsAB())}, ${JSON.stringify(dup.rows)}, ${JSON.stringify(choicesTransfer)}, ${JSON.stringify(NOV)})`);
  check('payroll: the absorbed duplicate still logs 2 slots but pays one day-value',
    dupLine.cover_lines[0].slots === 2 && dupLine.cover_lines[0].day_value === 1000, JSON.stringify(dupLine));
}

{
  // applyCoverToCompiledSlips mutates the slips object in place, so run it
  // inside the vm on vm-owned objects (not JSON copies from the host).
  vm.runInContext(`
    var __live = {
      'T-A': { teacher_name: 'Teacher A', assigned_students: [{ student_id: 'ST-1', final_rate: 30000, active_days: 30, joining_date: '2026-11-01', seg_end: '2026-11-30' }], base_subtotal: 30000, bonus: 0, deduction: 0, advance_deducted: 0, net_payable: 30000, frozen: false },
      'T-B': { teacher_name: 'Teacher B', assigned_students: [], base_subtotal: 20000, bonus: 0, deduction: 0, advance_deducted: 0, net_payable: 20000, frozen: false }
    };
    var __row = ${JSON.stringify(coverRow())};
    var __choices = ${JSON.stringify(choicesTransfer)};
    var __nov = ${JSON.stringify(NOV)};
    var __warnings = [];
    var __delta = applyCoverToCompiledSlips(__live, [__row], __choices, __nov, __warnings);
    var __frozen = {
      'T-A': { teacher_name: 'Teacher A', assigned_students: [{ student_id: 'ST-1', final_rate: 30000, active_days: 30, joining_date: '2026-11-01', seg_end: '2026-11-30' }], base_subtotal: 30000, bonus: 0, deduction: 0, advance_deducted: 0, net_payable: 30000, frozen: true, cover_out: 0, cover_in: 0, cover_lines: [] },
      'T-B': { teacher_name: 'Teacher B', assigned_students: [], base_subtotal: 20000, bonus: 0, deduction: 0, advance_deducted: 0, net_payable: 20000, frozen: true, cover_out: 0, cover_in: 0, cover_lines: [] }
    };
    var __deltaFrozen = applyCoverToCompiledSlips(__frozen, [__row], __choices, __nov, []);
  `, payrollCtx);
  const live = vm.runInContext(`({ aNet: __live['T-A'].net_payable, aOut: __live['T-A'].cover_out, bNet: __live['T-B'].net_payable, bIn: __live['T-B'].cover_in, delta: __delta, warnings: __warnings.length })`, payrollCtx);
  check('payroll: live slips take the transfer — absent net 29,000, cover net 21,000, total delta 0',
    live.aNet === 29000 && live.aOut === 1000 && live.bNet === 21000 && live.bIn === 1000 && live.delta === 0 && live.warnings === 0, JSON.stringify(live));
  const fr = vm.runInContext(`({ aOut: __frozen['T-A'].cover_out, aNet: __frozen['T-A'].net_payable, aStale: __frozen['T-A'].cover_stale, bStale: __frozen['T-B'].cover_stale, delta: __deltaFrozen })`, payrollCtx);
  check('payroll: frozen slips keep their saved cover amounts, gain cover_stale, net untouched',
    fr.aOut === 0 && fr.aNet === 30000 && fr.aStale === true && fr.bStale === true && fr.delta === 0, JSON.stringify(fr));
}

// ===========================================================================
// Part 3 — REAL _coverCheckAssignConflict (extracted) + panel helpers
// ===========================================================================
const p360Src = read('js/profiles360.js');
// Dates are relative to the local today (the helpers use local dates),
// so the suite stays green in any year it runs.
const fmtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmtLocal(d); };
const D_PLUS1 = addDays(1);
const D_PLUS2 = addDays(2);
const D_MINUS2 = addDays(-2);
const dowOf = (ds) => { const js = new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10))).getDay(); return js === 0 ? 7 : js; };
const DOW = dowOf(D_PLUS1);

// A thenable query stub: .eq() chains, await resolves { data: filtered }.
class Q {
  constructor(rows) { this.rows = rows; this.filters = []; }
  select() { return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  then(res, rej) {
    try {
      let out = this.rows;
      for (const [c, v] of this.filters) out = out.filter(r => String(r[c]) === String(v));
      res({ data: out });
    } catch (e) { rej(e); }
  }
}
let COVER_SCHEDS = [];
let COVER_ROWS = [];
const p360Ctx = {
  console, Math, JSON, Number, String, Boolean, Array, Object, parseInt, parseFloat, isNaN,
  Date,
  db: { from(table) { return new Q(table === 'class_schedules' ? COVER_SCHEDS : table === 'cover_assignments' ? COVER_ROWS : []); } },
  getTeacherAccounts() { return {}; },
  getTeacherCreds() { return {}; },
  // Mirrors js/config.js isEligibleTeacherRecord for the fixture shapes
  // used here (Active + teacher role; manager / deactivated excluded).
  getEligibleTeachers(list) {
    return (list || []).filter(t => {
      const st = String(t.status || 'Active').trim().toLowerCase();
      if (st === 'inactive' || st === 'deactivated' || st === 'terminated' || st === 'deleted') return false;
      try {
        const meta = typeof t.address === 'string' && t.address.trim().startsWith('{') ? JSON.parse(t.address) : {};
        if (String(meta.employee_type || meta.role || '').toLowerCase() === 'manager') return false;
      } catch (e) {}
      return true;
    });
  },
  ALL_TEACHERS: [],
  ALL_STUDENTS: [],
  ALL_CLASS_SCHEDULES: [],
  _COVER_ASSIGN_MODAL: { coversForDate: [] },
};
p360Ctx.window = p360Ctx;
vm.createContext(p360Ctx);
for (const fn of ['_coverTodayStr', '_coverDatesInRange', '_coverDayOfWeek', '_coverTimeToMinutes', '_coverTimesOverlap', '_resolveTeacherCustomMeta', '_coverIsTeacherOnLeaveOn', '_coverLeaveChoiceFromRecord', '_coverChoiceSummaryText', '_coverCheckAssignConflict', '_buildTeacherCoverPanelHtml', '_esc360']) {
  vm.runInContext(extractFunction(p360Src, fn), p360Ctx, { filename: 'js/profiles360.js:' + fn });
}
const p3 = (code) => vm.runInContext(code, p360Ctx);

{
  check('cover: _coverDatesInRange lists a 2-day leave inclusively',
    JSON.stringify(p3(`_coverDatesInRange('${D_PLUS1}', '${D_PLUS2}')`)) === JSON.stringify([D_PLUS1, D_PLUS2]));
  check('cover: _coverDatesInRange of a 1-day leave is one date',
    JSON.stringify(p3(`_coverDatesInRange('${D_PLUS1}', '${D_PLUS1}')`)) === JSON.stringify([D_PLUS1]));
  check('cover: _coverDatesInRange caps a long leave at 31 days',
    p3(`_coverDatesInRange('${D_PLUS1}', '2031-01-01').length`) === 31);
  check('cover: _coverDayOfWeek matches the class_schedules convention (Mon=1..Sun=7)',
    p3(`_coverDayOfWeek('2026-11-16')`) === 1 && p3(`_coverDayOfWeek('2026-11-15')`) === 7);
  check('cover: adjacent slots do not overlap (10:00-10:30 vs 10:30-11:00)',
    p3(`_coverTimesOverlap(600, 630, 630, 660)`) === false);
  check('cover: overlapping slots do overlap (10:00-10:30 vs 10:15-10:45)',
    p3(`_coverTimesOverlap(600, 630, 615, 645)`) === true);
}

const TEACHERS_FIX = [
  { id: 'T-A', full_name: 'Teacher A', status: 'Active' },
  { id: 'T-B', full_name: 'Teacher B', status: 'Active' },
  { id: 'T-C', full_name: 'Teacher C', status: 'Active', address: JSON.stringify({ leave_records: [{ id: 'LV-C', startDate: D_PLUS1, endDate: D_PLUS1, status: 'APPROVED' }] }) },
  { id: 'T-D', full_name: 'Teacher D', status: 'Deactivated' },
  { id: 'T-E', full_name: 'Teacher E', status: 'Active', address: JSON.stringify({ employee_type: 'manager' }) },
];
const STUDENTS_FIX = [
  { id: 'ST-1', name: 'Child One' },
  { id: 'ST-2', name: 'Child Two' },
  { id: 'ST-3', name: 'Child Three' },
];
const schedRow = { id: 'SCH-1', student_id: 'ST-1', start_time: '10:00', end_time: '10:30', duration_mins: 30 };
async function conflict(coverTeacherId, scheds = [], covers = []) {
  COVER_SCHEDS = scheds;
  COVER_ROWS = covers;
  p360Ctx.ALL_TEACHERS = TEACHERS_FIX;
  p360Ctx.ALL_STUDENTS = STUDENTS_FIX;
  p360Ctx.ALL_CLASS_SCHEDULES = scheds;
  return await p3(`_coverCheckAssignConflict('${coverTeacherId}', '${D_PLUS1}', ${JSON.stringify(schedRow)})`);
}
{
  const ok = await conflict('T-B');
  check('cover: assign is allowed when the cover teacher is free', ok.ok === true, JSON.stringify(ok));
  const own = await conflict('T-B', [{ id: 'SCH-2', teacher_id: 'T-B', student_id: 'ST-2', day_of_week: DOW, start_time: '10:00', end_time: '10:30' }]);
  check('cover: BLOCK when the cover teacher has their own overlapping class',
    own.ok === false && /already has a class with Child Two/.test(own.reason), JSON.stringify(own));
  const adj = await conflict('T-B', [{ id: 'SCH-2', teacher_id: 'T-B', student_id: 'ST-2', day_of_week: DOW, start_time: '10:30', end_time: '11:00' }]);
  check('cover: an adjacent (non-overlapping) own class does NOT block',
    adj.ok === true, JSON.stringify(adj));
  const otherDay = await conflict('T-B', [{ id: 'SCH-2', teacher_id: 'T-B', student_id: 'ST-2', day_of_week: DOW === 7 ? 1 : DOW + 1, start_time: '10:00', end_time: '10:30' }]);
  check('cover: an own class on another weekday does NOT block',
    otherDay.ok === true, JSON.stringify(otherDay));
  const sameStu = await conflict('T-B', [{ id: 'SCH-2', teacher_id: 'T-B', student_id: 'ST-1', day_of_week: DOW, start_time: '10:00', end_time: '10:30' }]);
  check('cover: an own class with the SAME student at the same time does NOT block',
    sameStu.ok === true, JSON.stringify(sameStu));
  const onLeave = await conflict('T-C');
  check('cover: BLOCK when the cover teacher is on leave themselves that day',
    onLeave.ok === false && /is on leave on/.test(onLeave.reason), JSON.stringify(onLeave));
  const deact = await conflict('T-D');
  check('cover: BLOCK for a deactivated teacher (not eligible)',
    deact.ok === false && /not an active eligible teacher/.test(deact.reason), JSON.stringify(deact));
  const mgr = await conflict('T-E');
  check('cover: BLOCK for a manager account (not an eligible teacher)',
    mgr.ok === false && /not an active eligible teacher/.test(mgr.reason), JSON.stringify(mgr));
  const busy = await conflict('T-B', [], [{ id: 'COV-9', kind: 'assign', cover_teacher_id: 'T-B', cover_date: D_PLUS1, start_time: '10:00', end_time: '10:30', student_id: 'ST-3', student_name: 'Child Three', status: 'active' }]);
  check('cover: BLOCK when the cover teacher is already covering another student at that time',
    busy.ok === false && /already covering Child Three/.test(busy.reason), JSON.stringify(busy));
  const busySame = await conflict('T-B', [], [{ id: 'COV-9', kind: 'assign', cover_teacher_id: 'T-B', cover_date: D_PLUS1, start_time: '10:00', end_time: '10:30', student_id: 'ST-1', student_name: 'Child One', status: 'active' }]);
  check('cover: already covering the SAME student does NOT block (re-assign path)',
    busySame.ok === true, JSON.stringify(busySame));
  const unknown = await conflict('T-ZZ');
  check('cover: BLOCK for an unknown teacher id',
    unknown.ok === false && /not found/.test(unknown.reason), JSON.stringify(unknown));
}

// ===========================================================================
// Part 4 — REAL _buildTeacherCoverPanelHtml (vm)
// ===========================================================================
{
  const state = {
    teacher: { id: 'T-A', full_name: 'Teacher A' },
    leaveRows: [
      { id: 'LV-1', startDate: D_PLUS1, endDate: D_PLUS2, reason: 'Family function', salary_deduction: 'yes', deduction_goes_to_cover: 'yes' },
      { id: 'LV-PAST', startDate: D_MINUS2, endDate: D_MINUS2, reason: 'Old leave' },
      { id: 'REQ-LV-9', startDate: D_PLUS1, endDate: D_PLUS1, reason: 'A request, not a custom leave' },
    ],
    coverRows: [
      { id: 'COV-1', kind: 'banner', leave_id: 'LV-1', status: 'active' },
      { id: 'COV-2', kind: 'assign', leave_id: 'LV-1', cover_date: D_PLUS1, student_name: 'Child One', cover_teacher_name: 'Teacher B', status: 'active' },
    ],
  };
  const html = p3(`_buildTeacherCoverPanelHtml(${JSON.stringify(state)})`);
  check('panel: renders the Teacher Cover section with Leave ON',
    html.includes('Teacher Cover') && html.includes('Leave ON'), html.slice(0, 200));
  check('panel: banner shows ON with the admin reason in the preview',
    html.includes('ON — students/parents see it') && html.includes('is on leave today') && html.includes('Family function'), html.slice(0, 400));
  check('panel: salary summary shows the transfer choice + Change button',
    html.includes('Deduction: Yes') && html.includes('goes to the substitute') && html.includes('Change'), html.slice(0, 400));
  check('panel: assigned cover lists the student and the cover teacher',
    html.includes('Child One') && html.includes('Teacher B') && html.includes('Unassign'), html.slice(0, 400));
  check('panel: Assign Students button is present for a current leave',
    html.includes('Assign Students'));
  check('panel: a past leave with no assigns and no banner is skipped',
    !html.includes('Old leave'));
  check('panel: a REQ-LV- request leave never gets a cover card',
    !html.includes('A request, not a custom leave'));
  check('panel: choice edit selects carry the stored values (deduction yes / to-cover yes / extra no)',
    html.includes('coverChoiceDeduct-LV-1') && html.includes('coverChoiceToCover-LV-1') && html.includes('coverChoiceExtra-LV-1'));

  const emptyHtml = p3(`_buildTeacherCoverPanelHtml(${JSON.stringify({ teacher: { id: 'T-A', full_name: 'Teacher A' }, leaveRows: [], coverRows: [] })})`);
  check('panel: no custom leaves means no panel at all', emptyHtml === '');
  const bannerOff = p3(`_buildTeacherCoverPanelHtml(${JSON.stringify({ teacher: { id: 'T-A', full_name: 'Teacher A' }, leaveRows: [{ id: 'LV-1', startDate: D_PLUS1, endDate: D_PLUS1, reason: 'x' }], coverRows: [] })})`);
  check('panel: a leave with no banner row shows Banner OFF + the on-button',
    bannerOff.includes('OFF') && bannerOff.includes('Turn banner on'));
  const deductOnly = p3(`_buildTeacherCoverPanelHtml(${JSON.stringify({ teacher: { id: 'T-A', full_name: 'Teacher A' }, leaveRows: [{ id: 'LV-1', startDate: D_PLUS1, endDate: D_PLUS1, salary_deduction: 'yes', deduction_goes_to_cover: 'no' }], coverRows: [] })})`);
  check('panel: deduct-only choice summarises in English',
    deductOnly.includes('deducted only'));
  const extraPay = p3(`_buildTeacherCoverPanelHtml(${JSON.stringify({ teacher: { id: 'T-A', full_name: 'Teacher A' }, leaveRows: [{ id: 'LV-1', startDate: D_PLUS1, endDate: D_PLUS1, salary_deduction: 'no', no_deduction_cover_paid_extra: 'yes' }], coverRows: [] })})`);
  check('panel: extra-pay choice summarises in English',
    extraPay.includes('paid extra on top'));
}

// ===========================================================================
// Part 5 — structural pins
// ===========================================================================
const WORKER_SRC = read('cloudflare/worker.js');
const DBJS = read('functions/api/db.js');
const P360 = read('js/profiles360.js');
const PAYROLL = read('js/payroll.js');
const TEACHER_HTML = read('teacher.html');
const PARENT_HTML = read('parent.html');
const INDEX_HTML = read('index.html');

check('struct: WORKER_RELEASE is the cover release', WORKER_SRC.includes("const WORKER_RELEASE = '2026-11-13-teacher-cover'"));
check('struct: HEALTH_SCHEMA_VERSION is v9', WORKER_SRC.includes("const HEALTH_SCHEMA_VERSION = '2026-11-13-v9'"));
check('struct: SCHEMA_VERSION is v9 in db.js', DBJS.includes("const SCHEMA_VERSION = '2026-11-13-v9'"));
check('struct: cover_assignments is allowlisted + created in db.js',
  DBJS.includes("'cover_assignments'") && DBJS.includes('CREATE TABLE IF NOT EXISTS cover_assignments'));
check('struct: db.js generates COV- ids for the table', DBJS.includes("cover_assignments: 'COV-'"));
check('struct: Worker delete deny list includes cover_assignments', WORKER_SRC.includes("'cover_assignments'") && /action === 'delete'[\s\S]{0,400}cover_assignments/.test(WORKER_SRC));
check('struct: leave modal has the salary two-step fields + banner checkbox',
  P360.includes('t360LvDeduct') && P360.includes('t360LvDeductToCoverWrap') && P360.includes('t360LvExtraPayWrap') && P360.includes('t360LvBanner'));
check('struct: leave save stores the salary choice + banner flag on the record',
  P360.includes('salary_deduction') && P360.includes('deduction_goes_to_cover') && P360.includes('no_deduction_cover_paid_extra') && P360.includes('show_banner'));
check('struct: leave save inserts a banner row; leave delete cancels the cover rows',
  P360.includes("kind: 'banner'") && P360.includes("update({ status: 'cancelled' }).eq('leave_id', leaveId)"));
check('struct: 360 leaves tab renders the cover panel; profile Phase 3 loads coverRows',
  P360.includes('_buildTeacherCoverPanelHtml(state)') && P360.includes("db.from('cover_assignments').select('*').eq('absent_teacher_id', teacher.id)"));
check('struct: assign modal + submit + cancel + banner toggle exist',
  P360.includes('openTeacherCoverAssignModal') && P360.includes('submitTeacherCoverAssign') && P360.includes('cancelTeacherCoverAssign') && P360.includes('toggleTeacherCoverBanner'));
check('struct: teacher Today loads today\'s cover rows (as cover + as absent)',
  TEACHER_HTML.includes('coversPromise') && TEACHER_HTML.includes("eq('cover_teacher_id', CURRENT_TEACHER.id)") && TEACHER_HTML.includes("eq('absent_teacher_id', CURRENT_TEACHER.id)"));
check('struct: covered classes leave the absent teacher\'s Today list',
  TEACHER_HTML.includes('coveredScheduleIds') && TEACHER_HTML.includes('coveredStudentIdsNoSched'));
check('struct: cover entries are synthesised with a Cover badge + violet row',
  TEACHER_HTML.includes('isCoverClass') && TEACHER_HTML.includes("Cover —") && TEACHER_HTML.includes('border-violet-500'));
check('struct: parent portal has the leave banner container above the live-class card',
  PARENT_HTML.includes('id="teacherCoverBanner"') && PARENT_HTML.includes('is on leave today'));
check('struct: parent portal fetches cover rows for the student\'s teacher and renders the cover-teacher line',
  PARENT_HTML.includes("db.from('cover_assignments').select('*').eq('absent_teacher_id', s.assigned_teacher_id)") && PARENT_HTML.includes('will be taught by'));
check('struct: salary slip has a separate cover section; payroll computes cover lines',
  INDEX_HTML.includes('id="slipCoverSection"') && PAYROLL.includes('renderSlipCoverSection') && PAYROLL.includes('computeCoverAmountsForTeacher') && PAYROLL.includes('applyCoverToCompiledSlips'));
check('struct: cover log card exists on the salaries screen',
  INDEX_HTML.includes('id="coverLogTableBody"') && PAYROLL.includes('renderTeacherCoverLog'));
check('struct: payroll net includes cover amounts; frozen slips keep saved cover + stale flag',
  PAYROLL.includes('- res.cover_out + res.cover_in') && PAYROLL.includes('cover_stale'));


// ===========================================================================
// Part 6 — Professional English strings (2026-11-13 fix): the leave modal,
// the assign modal, the salary summary and the rendered panel must read in
// English, with every Roman Urdu label from the shipped feature ABSENT.
// Option values (yes/no) and all behaviour are unchanged.
// ===========================================================================
{
  const ROMAN_URDU = ['chhutti', 'hogi', 'milegi', 'dikhayen', 'wajah', 'katay',
    'parhaye', 'laagu', 'hotay', 'aatay', 'chunein', 'jayega', 'ho saka',
    'ho gayi', 'kar diya', 'band karein', 'on karein', 'poori pay'];
  const hasRomanUrdu = (s) => ROMAN_URDU.some(w => String(s).toLowerCase().includes(w));

  // Load the two real renderers into the vm (same extraction as Part 3).
  vm.runInContext(extractFunction(p360Src, 'openTeacherRecordLeaveModal'), p360Ctx, { filename: 'js/profiles360.js:openTeacherRecordLeaveModal' });
  vm.runInContext(extractFunction(p360Src, '_buildCoverAssignModalHtml'), p360Ctx, { filename: 'js/profiles360.js:_buildCoverAssignModalHtml' });
  p360Ctx._TEACHER_360_MEM_CACHE = {};
  p360Ctx._openWorkspaceModal = (title, sub, html) => { p360Ctx.__capturedLeaveModal = { title, sub, html }; };
  p360Ctx.ALL_TEACHERS = [
    { id: 'T-A', full_name: 'Teacher A', status: 'Active' },
    { id: 'T-B', full_name: 'Teacher B', status: 'Active' },
  ];

  // 6a — the REAL leave modal renders in English (the screenshot's modal).
  p3(`openTeacherRecordLeaveModal('T-A')`);
  const modal = p360Ctx.__capturedLeaveModal;
  check('english: leave modal opens with the English title', modal && modal.title === 'Record Teacher Leave', JSON.stringify(modal && modal.title));
  const modalHtml = (modal && modal.html) || '';
  for (const s of ['Will salary be deducted?', 'Yes — pay for the leave day(s) will be deducted',
    'No — full pay will be paid', 'Will the deducted amount go to the substitute teacher?',
    'Yes — the deducted amount will be transferred to the substitute',
    'No — it will only be deducted; the substitute will not receive it',
    'Will the substitute teacher be paid extra on top?',
    'No — the substitute will receive nothing extra',
    'Yes — the substitute will be paid extra on top',
    'The teacher\'s own salary does not stop because of leave',
    'Show the student / parent banner', 'Your teacher is on leave today']) {
    check('english: leave modal shows "' + s + '"', modalHtml.includes(s), modalHtml.slice(0, 300));
  }
  check('english: leave modal keeps the yes/no option values (logic unchanged)',
    modalHtml.includes('value="yes"') && modalHtml.includes('value="no"') && modalHtml.includes('id="t360LvDeduct"'));
  check('english: leave modal contains NO Roman Urdu from the screenshot', !hasRomanUrdu(modalHtml), modalHtml.slice(0, 300));

  // 6b — the REAL salary summary in all four branches.
  const summaryCases = [
    [{ salary_deduction: 'yes', deduction_goes_to_cover: 'yes' }, 'Deduction: Yes → deducted amount goes to the substitute (transfer)'],
    [{ salary_deduction: 'yes', deduction_goes_to_cover: 'no' }, 'Deduction: Yes → deducted only, the substitute receives nothing'],
    [{ salary_deduction: 'no', no_deduction_cover_paid_extra: 'yes' }, 'Deduction: No → substitute is paid extra on top'],
    [{ salary_deduction: 'no' }, 'Deduction: No → substitute receives nothing extra'],
  ];
  for (const [rec, expected] of summaryCases) {
    const got = p3(`_coverChoiceSummaryText(${JSON.stringify(rec)})`);
    check('english: salary summary reads "' + expected + '"', got === expected, String(got));
    check('english: salary summary has no Roman Urdu', !hasRomanUrdu(got), String(got));
  }

  // 6c — the REAL assign modal renders in English.
  const teacherA = { id: 'T-A', full_name: 'Teacher A' };
  const leave1 = { id: 'LV-1', startDate: D_PLUS1, endDate: D_PLUS1, salary_deduction: 'yes', deduction_goes_to_cover: 'yes' };
  p360Ctx.ALL_CLASS_SCHEDULES = [{ id: 'SCH-1', teacher_id: 'T-A', student_id: 'ST-1', day_of_week: DOW, start_time: '10:00', end_time: '10:30', duration_mins: 30, course_name: 'Quran Reading' }];
  p360Ctx.ALL_STUDENTS = [{ id: 'ST-1', name: 'Child One', course: 'Quran Reading' }];
  const assignHtml = p3(`_buildCoverAssignModalHtml(${JSON.stringify(teacherA)}, ${JSON.stringify(leave1)}, ${JSON.stringify([D_PLUS1])}, ${JSON.stringify(D_PLUS1)}, [], [])`);
  for (const s of ['Choose a cover teacher', 'Choose a date:', 'Salary choice for that day:',
    'deducted amount goes to the substitute (transfer)', 'This choice can be changed from the Leave panel',
    'returns to their own teacher the next day', 'Child One']) {
    check('english: assign modal shows "' + s + '"', assignHtml.includes(s), assignHtml.slice(0, 300));
  }
  check('english: assign modal contains NO Roman Urdu', !hasRomanUrdu(assignHtml), assignHtml.slice(0, 300));
  p360Ctx.ALL_CLASS_SCHEDULES = [];
  const emptyAssignHtml = p3(`_buildCoverAssignModalHtml(${JSON.stringify(teacherA)}, ${JSON.stringify(leave1)}, ${JSON.stringify([D_PLUS1])}, ${JSON.stringify(D_PLUS1)}, [], [])`);
  check('english: assign modal with no classes that day says so in English',
    emptyAssignHtml.includes('No classes for Teacher A on this day (' + D_PLUS1 + ')'), emptyAssignHtml.slice(0, 300));

  // 6d — the rendered Cover panel has no Roman Urdu anywhere.
  const panelHtml = p3(`_buildTeacherCoverPanelHtml(${JSON.stringify({ teacher: { id: 'T-A', full_name: 'Teacher A' }, leaveRows: [{ id: 'LV-1', startDate: D_PLUS1, endDate: D_PLUS2, reason: 'Family function', salary_deduction: 'yes', deduction_goes_to_cover: 'yes' }], coverRows: [{ id: 'COV-1', kind: 'banner', leave_id: 'LV-1', status: 'active' }] })})`);
  check('english: cover panel banner toggle reads "Turn banner off" when ON', panelHtml.includes('Turn banner off'), panelHtml.slice(0, 400));
  check('english: cover panel explains the one-day cover in English',
    panelHtml.includes('When leave is ON, the banner and Assign Students appear here'), panelHtml.slice(0, 400));
  check('english: cover panel contains NO Roman Urdu', !hasRomanUrdu(panelHtml), panelHtml.slice(0, 400));

  // 6e — the parent banner template (source: it is inline in parent.html).
  check('english: parent banner template is English ("Your teacher … is on leave today")',
    PARENT_HTML.includes('Your teacher ${escapeHtml(teacherName)} is on leave today') && PARENT_HTML.includes("Today's class will be taught by"));
  check('english: parent banner has no Roman Urdu template left',
    !PARENT_HTML.includes('chhutti par hain') && !PARENT_HTML.includes('parhayenge'));

  // 6f — the exact shipped Roman Urdu strings are gone from the 360 source.
  for (const s of ['Salary deduction hogi?', 'chhutti wale din ki pay katay gi', 'poori pay mile gi',
    'Kati hui amount substitute teacher ko milegi?', 'kati hui amount substitute ko transfer hogi',
    'sirf katay gi, substitute ko nahi milegi', 'Substitute teacher ko upar se pay milegi?',
    'substitute ko extra kuch nahi milega', 'substitute ko upar se pay milegi',
    'Leave se teacher ki apni salary nahi rukti', 'banner dikhayen', 'Banner band kar diya',
    'Banner on kar diya', 'Cover salary choice save ho gayi', 'Cover teacher chunein',
    'Salary choice is din ke liye', 'Leave ON hotay hi banner', 'Abhi kisi student ke liye cover assign nahi hua',
    'Is cover assignment ko cancel karein', 'Cancel nahi ho saka', 'Cover assign nahi ho saka',
    'Deduction hogi?', 'Kati hui amount cover ko?']) {
    check('english: old string gone from profiles360.js — "' + s + '"', !P360.includes(s));
  }
}

// ===========================================================================
// Summary
// ===========================================================================
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED: ' + failed.map(f => f.name).join(' ; '));
  process.exitCode = 1;
}
