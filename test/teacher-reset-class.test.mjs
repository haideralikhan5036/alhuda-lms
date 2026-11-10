// Teacher Portal Update (owner commission, 2026-11-10):
// Student List redesign, Today's Classes Waiting flow, "Reset class"
// requests (teacher submit + Admin/Manager decision), and the new
// admin leave mechanics (leave ends schedule+assignment; return
// restores the previous teacher's roster as Not Scheduled).
//
//   Part 1 drives the REAL Worker against a fake D1: the teacher
//   role is DENIED attendance_logs DELETE (this is why the Waiting
//   row's tick/reset button is NOT built — the parent decides on a
//   Worker change separately), while manager/owner DELETE works and
//   is what Reset class approval uses.
//   Part 2 pins the structural contract in teacher.html /
//   js/leaves.js (counts, trimmed rows, gating, locks, request keys).
//   Part 3 executes the REAL teacher.html functions in a vm over a
//   fake DOM + fake db: Student List rendering (order, labels,
//   buttons), Leave/Absent preselect, Reset class submit (with and
//   without a note) and the duplicate-pending guard.
//   Part 4 executes the REAL js/leaves.js handlers in a vm: the
//   Requests scan, approve (log deleted -> Scheduled again),
//   refusal paths (schedule gone / status changed), decline, manager
//   parity, and the decision-3 leave cycle end-to-end through the
//   REAL js/assignments.js ledger + the REAL payroll proration
//   (payable only up to the last payable day; past months intact).
// Run from the repo root:  node test/teacher-reset-class.test.mjs
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
// Part 1 — REAL Worker: who may DELETE attendance_logs
// ===========================================================================
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-class-test-'));
for (const f of ['cloudflare/worker.js', 'cloudflare/auth.js', 'functions/api/db.js', 'functions/api/storage.js']) {
  const dst = path.join(TMP, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, f), dst);
}
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
process.chdir(TMP);
const worker = (await import(pathToFileURL(path.join(TMP, 'cloudflare/worker.js')).href)).default;
const { createSessionToken } = await import(pathToFileURL(path.join(TMP, 'cloudflare/auth.js')).href);

const WORKER_SECRET = '<MASKED_SECRET_001>';
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
  manager: await createSessionToken({ sub: 'TCH-MGR-1', role: 'manager' }, WORKER_SECRET),
  teacher: await createSessionToken({ sub: 'T-A', role: 'teacher' }, WORKER_SECRET),
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

// Trigger schema creation, then seed synthetic records.
await dbPost(TOK.owner, { table: 'students', action: 'select', filters: [] });
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('TCH-MGR-1', 'Manager One', 'Active')");
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-A', 'Teacher A', 'Active')");
fakeDb.seed("INSERT INTO families (id, parent_name) VALUES ('FAM-1', 'Parent One')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id, status) VALUES ('ST-1', 'FAM-1', 'Child One', 'T-A', 'Active')");
fakeDb.seed("INSERT INTO class_schedules (id, student_id, teacher_id, day_of_week, start_time, end_time) VALUES ('SCH-1', 'ST-1', 'T-A', 2, '10:00', '10:30')");
fakeDb.seed("INSERT INTO class_schedules (id, student_id, teacher_id, day_of_week, start_time, end_time) VALUES ('SCH-2', 'ST-1', 'T-A', 3, '11:00', '11:30')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-W', 'SCH-1', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Waiting')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-L', 'SCH-1', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Leave')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-2', 'SCH-2', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Leave')");

const delBody = { table: 'attendance_logs', action: 'delete', filters: [eqF('schedule_id', 'SCH-1'), eqF('date', '2026-11-10')] };
const teacherDel = await dbPost(TOK.teacher, delBody);
check('worker: teacher DELETE on attendance_logs is DENIED (Waiting-reset stop point)',
  teacherDel.status === 403, 'status=' + teacherDel.status);
check('worker: teacher delete attempt removed nothing',
  fakeDb.all("SELECT COUNT(*) AS n FROM attendance_logs WHERE schedule_id='SCH-1'")[0].n === 2);

const managerDel = await dbPost(TOK.manager, delBody);
check('worker: manager DELETE on attendance_logs is allowed (Reset class approval path)',
  managerDel.status === 200 && !managerDel.json.error, 'status=' + managerDel.status + ' body=' + managerDel.text.slice(0, 120));
check('worker: manager delete reports the deleted row count',
  managerDel.json && managerDel.json.deleted === 2, JSON.stringify(managerDel.json).slice(0, 120));
check('worker: manager delete removed only the targeted schedule+date rows',
  fakeDb.all("SELECT COUNT(*) AS n FROM attendance_logs WHERE schedule_id='SCH-1'")[0].n === 0 &&
  fakeDb.all("SELECT COUNT(*) AS n FROM attendance_logs WHERE schedule_id='SCH-2'")[0].n === 1);

// ===========================================================================
// Part 2 — structural contract
// ===========================================================================
const TEACHER = read('teacher.html');
const LEAVES = read('js/leaves.js');
const WORKER = read('cloudflare/worker.js');
const PAYROLL = read('js/payroll.js');

check('student list: summary count chips exist (Total/Scheduled/Not Scheduled)',
  TEACHER.includes('id="studentListSummaryTotal"') && TEACHER.includes('id="studentListSummaryScheduled"') && TEACHER.includes('id="studentListSummaryUnscheduled"'));
check('student list: counts are deduped per student from real loaded records',
  TEACHER.includes('scheduledStudentIds') && TEACHER.includes("getElementById('studentListSummaryTotal')"));
check('student list: table has exactly the four commissioned columns',
  TEACHER.includes('<th class="p-3.5">Student Name</th>') && TEACHER.includes('<th class="p-3.5">Class Timing</th>') &&
  !TEACHER.includes('Weekly Schedule Slots &amp; Duration') && !TEACHER.includes('<th class="p-3.5">Status</th>'));

const studentListSrc = extractFunction(TEACHER, 'renderTeacherStudentListTable');
check('student list renderer: no Join Zoom / Mark Lesson / History / Start-Complete actions remain',
  !studentListSrc.includes('openTeacherLessonHistoryForStudent') && !studentListSrc.includes('handleTeacherStartClass') &&
  !studentListSrc.includes('handleTeacherCompleteClass') && !studentListSrc.includes('openAttendanceModal') &&
  !studentListSrc.includes('launchTeacherZoomClass') && !studentListSrc.includes('openLeaveAbsentModal'));
check('student list renderer: scheduled-first sort + exact "Not Scheduled" label',
  studentListSrc.includes('aSched - bSched') && studentListSrc.includes('> Not Scheduled'));
check('student list renderer: Change Time wired to the existing modal, scheduled students only',
  studentListSrc.includes("openTimeChangeRequestModal('${escapeJsAttr(firstScheduleId)}')") && studentListSrc.includes('firstScheduleId ?'));

const todaySrc = extractFunction(TEACHER, 'renderTeacherClassesTable');
check("today's classes: no Change Time button anywhere in the renderer",
  !todaySrc.includes('openTimeChangeRequestModal') && !todaySrc.includes('> Change Time'));
check("today's classes: Time Change Pending information badge kept",
  todaySrc.includes('Time Change Pending'));
check("today's classes: History button calls the existing lesson-history opener",
  todaySrc.includes("openTeacherLessonHistoryForStudent('${escapeJsAttr(c.student_id)}')"));
check("today's classes: Reset class action + pending state on Leave/Absent rows",
  todaySrc.includes("openResetClassRequestModal('${escapeJsAttr(c.id)}')") && todaySrc.includes('Reset Class Pending') && todaySrc.includes('⏳ Reset Class Pending'));
check("today's classes: overdue reminder still re-rendered (PR #97 preserved)",
  todaySrc.includes('checkOverdueClassReminder()'));

const zoomLockedSrc = extractFunction(TEACHER, 'launchTeacherZoomClassLocked');
check('start zoom: Zoom opens ONLY after the Waiting save succeeds',
  zoomLockedSrc.includes('!waitingRes || !waitingRes.success') && zoomLockedSrc.includes('Zoom was not opened') &&
  zoomLockedSrc.indexOf('!waitingRes || !waitingRes.success') < zoomLockedSrc.indexOf('window.open(rawMeetingLink'));
check('start zoom / start class: in-flight click locks present and consulted',
  TEACHER.includes('const _zoomLaunchInFlight = new Set();') && TEACHER.includes('const _startClassInFlight = new Set();') &&
  extractFunction(TEACHER, 'launchTeacherZoomClass').includes('_zoomLaunchInFlight.has(lockKey)') &&
  extractFunction(TEACHER, 'handleTeacherStartClass').includes('_startClassInFlight.has(lockKey)'));

const leaveModalSrc = extractFunction(TEACHER, 'openLeaveAbsentModal');
check('leave/absent modal: preselects the current outcome (Leave or Absent)',
  leaveModalSrc.includes('preselectOutcome') && leaveModalSrc.includes("currentOutcome === 'Leave' || currentOutcome === 'Absent'"));

check('reset class: modal + optional note field + submit wiring exist',
  TEACHER.includes('id="modalResetClassRequest"') && TEACHER.includes('id="resetClassNotes"') &&
  TEACHER.includes('onsubmit="submitResetClassRequest(event)"') && TEACHER.includes('(optional)'));
const resetSubmitSrc = extractFunction(TEACHER, 'submitResetClassRequest');
check('reset class submit: notes-JSON pattern with class date + current status recorded',
  resetSubmitSrc.includes("appendTeacherRequestToHistory(meta, 'reset_class_request', 'reset_class_history', reqObj)") &&
  resetSubmitSrc.includes('class_date: getPktNowParts().date') && resetSubmitSrc.includes('current_status: currentStatus'));
check('reset class submit: duplicate pending request is refused, not overwritten',
  resetSubmitSrc.includes("meta.reset_class_request.status === 'pending'") && resetSubmitSrc.includes('already pending'));

check('admin scan: reset_class_request joins the Requests queue',
  LEAVES.includes("requestType: 'reset_class'") && LEAVES.includes('meta.reset_class_request.status === \'pending\''));
const approveSrc = extractFunction(LEAVES, 'handleApproveTeacherRequest');
check('admin approve (reset_class): re-validates schedule + still-Leave/Absent before deleting the day log',
  approveSrc.includes("rType === 'reset_class'") &&
  approveSrc.includes("db.from('class_schedules').select('*').eq('id', req.schedule_id)") &&
  approveSrc.includes("latestDayLog.status !== 'Leave' && latestDayLog.status !== 'Absent'") &&
  approveSrc.includes("db.from('attendance_logs').delete().eq('schedule_id', req.schedule_id).eq('date', req.class_date)"));
{
  const branchStart = approveSrc.indexOf("rType === 'reset_class'");
  const branchSlice = approveSrc.slice(branchStart, branchStart + 6000);
  check('admin approve (reset_class): never writes lesson_notes; decision is stamped',
    branchSlice.includes("meta.reset_class_request.approved_by = CURRENT_ROLE") &&
    !/lesson_notes\s*:/.test(branchSlice) && !/lesson_notes\s*=[^=]/.test(branchSlice));
}
const declineSrc = extractFunction(LEAVES, 'handleDeclineTeacherRequest');
check('admin decline (reset_class): decision stamped, class status untouched (no attendance write)',
  declineSrc.includes("rType === 'reset_class'") && declineSrc.includes('meta.reset_class_request.declined_by = CURRENT_ROLE') &&
  !declineSrc.includes('attendance_logs'));

check('leave mechanics: helper + closeCurrent end_reason leave + unassign in the same write (both entry points)',
  LEAVES.includes('async function endStudentScheduleForLeave(') &&
  LEAVES.includes("end_reason: 'leave'") && LEAVES.includes('archived_schedules_before_leave') &&
  (LEAVES.match(/assigned_teacher_id: null/g) || []).length >= 2);
check('off-leave: restores the previous teacher from the leave snapshot and clears the stamp',
  LEAVES.includes('meta.leave_previous_teacher_id || st.assigned_teacher_id') &&
  LEAVES.includes('delete meta.assignment_end_date') && LEAVES.includes('Not Scheduled'));
check('payroll untouched by this commission (no leave/reset wiring in js/payroll.js)',
  !PAYROLL.includes('reset_class') && !PAYROLL.includes('leave_previous_teacher_id'));
check('worker: teacher attendance_logs delete rule is the documented deny (source of the Waiting-reset stop)',
  /case 'attendance_logs':\s*\n\s*return action === 'delete' \? 'deny' : 'allow';/.test(WORKER));

// ===========================================================================
// Shared vm fixtures (Parts 3-4)
// ===========================================================================
function fixtureEl() {
  const classes = new Set();
  return {
    value: '', innerText: '', innerHTML: '', textContent: '', className: '', disabled: false,
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    style: {},
  };
}
function makeRegistry(seedHidden = []) {
  const map = new Map();
  return {
    get(id) {
      if (!map.has(id)) {
        const el = fixtureEl();
        if (seedHidden.includes(id)) el.classList.add('hidden');
        map.set(id, el);
      }
      return map.get(id);
    },
  };
}
// Minimal Supabase-shaped fake db over in-memory tables, mirroring the
// js/cloudflare-db.js contract (delete reports the removed count).
function makeFakeDb(tables) {
  function builder(table) {
    const state = { action: 'select', filters: [], values: null, single: false };
    const matches = (row) => state.filters.every(f => {
      if (f.op === 'eq') return String(row[f.column]) === String(f.value);
      if (f.op === 'in') return (f.value || []).map(String).includes(String(row[f.column]));
      return true;
    });
    const run = () => {
      const rows = tables[table] || (tables[table] = []);
      if (state.action === 'select') {
        const out = rows.filter(matches).map(r => ({ ...r }));
        return { data: state.single ? (out[0] || null) : out, error: null };
      }
      if (state.action === 'update') {
        rows.forEach(r => { if (matches(r)) Object.assign(r, state.values); });
        return { data: [], error: null };
      }
      if (state.action === 'insert' || state.action === 'upsert') {
        const vals = Array.isArray(state.values) ? state.values : [state.values];
        vals.forEach(v => rows.push({ ...v }));
        return { data: vals, error: null };
      }
      if (state.action === 'delete') {
        const kept = rows.filter(r => !matches(r));
        tables[table] = kept;
        return { data: [], error: null, deleted: rows.length - kept.length };
      }
      return { data: null, error: { message: 'unsupported action' } };
    };
    const b = {
      select: () => b,
      insert: (v) => { state.action = 'insert'; state.values = v; return b; },
      upsert: (v) => { state.action = 'upsert'; state.values = v; return b; },
      update: (v) => { state.action = 'update'; state.values = v; return b; },
      delete: () => { state.action = 'delete'; return b; },
      eq: (c, v) => { state.filters.push({ column: c, op: 'eq', value: v }); return b; },
      in: (c, v) => { state.filters.push({ column: c, op: 'in', value: v }); return b; },
      order: () => b,
      limit: () => b,
      single: () => { state.single = true; return b; },
      maybeSingle: () => { state.single = true; return b; },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

// ===========================================================================
// Part 3 — REAL teacher.html functions: Student List render, Leave
// preselect, Reset class submit
// ===========================================================================
{
  const SECURITY = read('js/security.js');
  const registry = makeRegistry();
  const radios = { Absent: { checked: false, value: 'Absent' }, Leave: { checked: false, value: 'Leave' } };
  const notifies = [];
  const tables = {
    students: [
      { id: 'STU-R1', name: 'Child One', notes: '{}' },
      { id: 'STU-R2', name: 'Child Two', notes: '{}' },
    ],
  };
  const sandbox = {
    console,
    document: {
      getElementById: (id) => registry.get(id),
      querySelector: (sel) => {
        if (sel.includes(':checked')) return radios.Absent.checked ? radios.Absent : (radios.Leave.checked ? radios.Leave : null);
        if (sel.includes('value="Leave"')) return radios.Leave;
        if (sel.includes('value="Absent"')) return radios.Absent;
        return null;
      },
    },
    db: makeFakeDb(tables),
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    TODAY_CLASSES: [],
    ACTIVE_ASSIGNED_STUDENTS: [],
    LEAVE_ASSIGNED_STUDENTS: [],
    ALL_TEACHER_SCHEDULES: [],
    getPktNowParts: () => ({ date: '2026-11-10', day: 2, minutes: 600 }),
    lmsNotify: (msg) => { notifies.push(String(msg)); },
    loadTeacherPortalData: async () => {},
    pushTeacherModalHistory: () => {},
    popTeacherModalHistory: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = [
    extractFunction(SECURITY, 'escapeHtml'),
    extractFunction(SECURITY, 'escapeJsAttr'),
    extractFunction(TEACHER, 'getStudentCourseDisplay'),
    extractFunction(TEACHER, 'parseTeacherTimeToMinutes'),
    extractFunction(TEACHER, 'getTeacherSlotDurationMins'),
    extractFunction(TEACHER, 'appendTeacherRequestToHistory'),
    extractFunction(TEACHER, 'renderTeacherStudentListTable'),
    extractFunction(TEACHER, 'openLeaveAbsentModal'),
    extractFunction(TEACHER, 'updateLeaveAbsentModalUi'),
    extractFunction(TEACHER, 'openResetClassRequestModal'),
    extractFunction(TEACHER, 'closeResetClassRequestModal'),
    extractFunction(TEACHER, 'submitResetClassRequest'),
  ].join('\n');
  vm.runInContext(src, sandbox);

  // --- Student List rendering: order, labels, buttons
  sandbox.ACTIVE_ASSIGNED_STUDENTS = [
    { id: 'STU-B', name: 'Unscheduled Uma', notes: '{}' },
    { id: 'STU-A', name: 'Scheduled Sara', notes: '{}' },
    { id: 'STU-C', name: 'Scheduled Sana', notes: '{}' },
  ];
  sandbox.ALL_TEACHER_SCHEDULES = [
    { id: 'SCH-A2', student_id: 'STU-A', day_of_week: 3, start_time: '12:00', end_time: '12:30' },
    { id: 'SCH-A1', student_id: 'STU-A', day_of_week: 1, start_time: '10:00', end_time: '10:30' },
    { id: 'SCH-C1', student_id: 'STU-C', day_of_week: 2, start_time: '09:00', end_time: '09:30' },
  ];
  sandbox.TODAY_CLASSES = [];
  vm.runInContext('renderTeacherStudentListTable()', sandbox);
  const listHtml = registry.get('teacherStudentListTableBody').innerHTML;
  const posA = listHtml.indexOf('Scheduled Sara');
  const posC = listHtml.indexOf('Scheduled Sana');
  const posB = listHtml.indexOf('Unscheduled Uma');
  check('student list render: scheduled students first, unscheduled at the bottom',
    posA > -1 && posC > posA && posB > posC, listHtml.slice(0, 200));
  const unschedRow = listHtml.slice(listHtml.lastIndexOf('<tr', posB), listHtml.indexOf('</tr>', posB));
  check('student list render: unscheduled row is labelled "Not Scheduled" with NO Change Time button',
    unschedRow.includes('Not Scheduled') && !unschedRow.includes('openTimeChangeRequestModal'));
  const schedRow = listHtml.slice(listHtml.lastIndexOf('<tr', posA), listHtml.indexOf('</tr>', posA));
  check('student list render: scheduled row shows timing + Change Time on the first (day-sorted) schedule',
    schedRow.includes('10:00 - 10:30') && schedRow.includes("openTimeChangeRequestModal('SCH-A1')"));
  check('student list render: no Join Zoom / Mark Lesson / History actions anywhere',
    !listHtml.includes('Join Zoom') && !listHtml.includes('Mark Lesson') && !listHtml.includes('> History'));

  // --- Leave/Absent modal preselect
  sandbox.TODAY_CLASSES = [{ id: 'SCH-L1', student_id: 'STU-R1', log: { status: 'Leave' } }];
  radios.Absent.checked = true; radios.Leave.checked = false;
  vm.runInContext("openLeaveAbsentModal('SCH-L1', 'STU-R1', 'TCH-1', 'Child One')", sandbox);
  check('leave modal: adjusting a Leave-marked class preselects Leave', radios.Leave.checked === true);
  sandbox.TODAY_CLASSES = [{ id: 'SCH-L1', student_id: 'STU-R1', log: { status: 'Absent' } }];
  radios.Absent.checked = false; radios.Leave.checked = true;
  vm.runInContext("openLeaveAbsentModal('SCH-L1', 'STU-R1', 'TCH-1', 'Child One')", sandbox);
  check('leave modal: adjusting an Absent-marked class preselects Absent', radios.Absent.checked === true);
  sandbox.TODAY_CLASSES = [{ id: 'SCH-L1', student_id: 'STU-R1', log: null }];
  radios.Absent.checked = false; radios.Leave.checked = true;
  vm.runInContext("openLeaveAbsentModal('SCH-L1', 'STU-R1', 'TCH-1', 'Child One')", sandbox);
  check('leave modal: a fresh mark keeps the Absent default', radios.Absent.checked === true);

  // --- Reset class submit: with a note
  sandbox.TODAY_CLASSES = [{
    id: 'SCH-R1', student_id: 'STU-R1', start_time: '10:00:00', end_time: '10:30:00',
    log: { status: 'Leave' }, students: { name: 'Child One' }, pendingResetClassReq: null,
  }];
  vm.runInContext("openResetClassRequestModal('SCH-R1')", sandbox);
  check('reset class: modal opens for a Leave-marked class',
    registry.get('modalResetClassRequest').classList.contains('flex'));
  registry.get('resetClassNotes').value = 'Family confirmed the class can run';
  await vm.runInContext("submitResetClassRequest({ preventDefault() {} })", sandbox);
  const notesR1 = JSON.parse(tables.students[0].notes);
  check('reset class submit (with note): pending request stored with date, status, schedule and note',
    notesR1.reset_class_request.status === 'pending' &&
    notesR1.reset_class_request.class_date === '2026-11-10' &&
    notesR1.reset_class_request.current_status === 'Leave' &&
    notesR1.reset_class_request.schedule_label === '10:00 - 10:30 PKT' &&
    notesR1.reset_class_request.notes === 'Family confirmed the class can run' &&
    Array.isArray(notesR1.reset_class_history) && notesR1.reset_class_history.length === 1,
    JSON.stringify(notesR1.reset_class_request || {}));
  check('reset class submit: clear confirmation shown; class itself untouched (no attendance write)',
    notifies.some(m => m.includes('Reset class request submitted')));

  // --- Duplicate pending is refused
  const notifyCountBefore = notifies.length;
  await vm.runInContext("submitResetClassRequest({ preventDefault() {} })", sandbox);
  const notesR1b = JSON.parse(tables.students[0].notes);
  check('reset class submit: a second submit while pending is refused (history unchanged)',
    notesR1b.reset_class_history.length === 1 &&
    notifies.slice(notifyCountBefore).some(m => m.includes('already pending')));

  // --- Reset class submit: without a note (second student, Absent)
  sandbox.TODAY_CLASSES = [{
    id: 'SCH-R2', student_id: 'STU-R2', start_time: '11:00:00', end_time: '11:30:00',
    log: { status: 'Absent' }, students: { name: 'Child Two' }, pendingResetClassReq: null,
  }];
  vm.runInContext("openResetClassRequestModal('SCH-R2')", sandbox);
  registry.get('resetClassNotes').value = '';
  await vm.runInContext("submitResetClassRequest({ preventDefault() {} })", sandbox);
  const notesR2 = JSON.parse(tables.students[1].notes);
  check('reset class submit (empty note): submission succeeds with an empty note',
    notesR2.reset_class_request.status === 'pending' && notesR2.reset_class_request.notes === '' &&
    notesR2.reset_class_request.current_status === 'Absent');
}

// ===========================================================================
// Part 4 — REAL js/leaves.js handlers: scan, approve, refusals,
// decline, manager parity, and the decision-3 leave cycle
// ===========================================================================
const ASSIGNMENTS_SRC = read('js/assignments.js');
function makeLeavesWorld(role) {
  const registry = makeRegistry(['tab-leaves']);
  const notifies = [];
  const tables = { students: [], class_schedules: [], attendance_logs: [], student_assignments: [], advance_requests: [], teachers: [] };
  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: (id) => registry.get(id),
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    db: makeFakeDb(tables),
    CURRENT_ROLE: role,
    CURRENT_MATRIX_TEACHER: null,
    lmsNotify: (msg) => { notifies.push(String(msg)); },
    lmsConfirm: async () => true,
    lmsPrompt: async () => 'Cannot approve this week',
    closeModal: () => {},
    loadDashboardData: async () => {},
    syncTopCircleNotificationDots: () => {},
    renderPendingTimeChangeBanners: () => {},
    openReturnAlertsModal: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('var PENDING_TEACHER_REQUESTS = []; var OVERDUE_LEAVE_STUDENTS = []; var ALL_CLASS_SCHEDULES = []; var ALL_TEACHERS = []; var ALL_STUDENTS = [];', sandbox);
  vm.runInContext(ASSIGNMENTS_SRC, sandbox);
  const src = [
    extractFunction(LEAVES, 'isStudentOnLeaveNow'),
    extractFunction(LEAVES, 'checkLeaveReturnAlertsAndRequests'),
    extractFunction(LEAVES, 'openAdminTeacherRequestsModal'),
    extractFunction(LEAVES, 'handleApproveTeacherRequest'),
    extractFunction(LEAVES, 'handleDeclineTeacherRequest'),
    extractFunction(LEAVES, 'leaveDayBeforeStr'),
    extractFunction(LEAVES, 'endStudentScheduleForLeave'),
    extractFunction(LEAVES, 'handleSaveStudentLeave'),
    extractFunction(LEAVES, 'reactivateStudentFromLeave'),
  ].join('\n');
  vm.runInContext(src, sandbox);
  return { sandbox, tables, notifies, registry };
}
function seedResetWorld(role) {
  const w = makeLeavesWorld(role);
  w.tables.students.push({
    id: 'STU-A', name: 'Child A', status: 'Active', assigned_teacher_id: 'TCH-1', family_id: 'FAM-1',
    notes: JSON.stringify({
      reset_class_request: {
        id: 'RESET-1', type: 'reset_class_request', student_id: 'STU-A', student_name: 'Child A',
        schedule_id: 'SCH-A', teacher_id: 'TCH-1', teacher_name: 'Teacher One',
        class_date: '2026-11-10', schedule_label: '10:00 - 10:30 PKT', current_status: 'Leave',
        notes: 'please reset', status: 'pending', requested_at: '2026-11-10T05:10:00.000Z',
      },
      reset_class_history: [],
    }),
  });
  w.tables.class_schedules.push({ id: 'SCH-A', student_id: 'STU-A', teacher_id: 'TCH-1', day_of_week: 2, start_time: '10:00', end_time: '10:30' });
  w.tables.attendance_logs.push(
    { id: 'LOG-W', schedule_id: 'SCH-A', student_id: 'STU-A', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Waiting', created_at: '2026-11-10T05:00:00Z' },
    { id: 'LOG-L', schedule_id: 'SCH-A', student_id: 'STU-A', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Leave', created_at: '2026-11-10T05:05:00Z' },
  );
  return w;
}

{
  // Scan + approve happy path, decided by a MANAGER (owner decision:
  // manager-allowed, same as the other request types).
  const w = seedResetWorld('manager');
  await vm.runInContext("checkLeaveReturnAlertsAndRequests(false)", w.sandbox);
  check('admin scan: pending Reset class request joins the queue',
    vm.runInContext("PENDING_TEACHER_REQUESTS.some(i => i.requestType === 'reset_class' && i.student.id === 'STU-A')", w.sandbox));
  await vm.runInContext("handleApproveTeacherRequest('STU-A', 'reset_class')", w.sandbox);
  const stu = w.tables.students[0];
  const meta = JSON.parse(stu.notes);
  check('admin approve (manager): the day log chain is deleted — the class is Scheduled again',
    w.tables.attendance_logs.filter(l => l.schedule_id === 'SCH-A').length === 0);
  check('admin approve (manager): decision stamped with role + time',
    meta.reset_class_request.status === 'approved' && meta.reset_class_request.approved_by === 'manager' && !!meta.reset_class_request.approved_at);
  check('admin approve: teacher note preserved on the decided request',
    meta.reset_class_request.notes === 'please reset');
  check('admin approve: success message names the reset date',
    w.notifies.some(m => m.includes('Reset class approved') && m.includes('2026-11-10')));
}
{
  // Refusal: the class is no longer Leave/Absent at decision time.
  const w = seedResetWorld('owner');
  w.tables.attendance_logs.push({ id: 'LOG-R', schedule_id: 'SCH-A', student_id: 'STU-A', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Running', created_at: '2026-11-10T05:20:00Z' });
  await vm.runInContext("handleApproveTeacherRequest('STU-A', 'reset_class')", w.sandbox);
  const meta = JSON.parse(w.tables.students[0].notes);
  check('admin approve refusal: class no longer Leave/Absent → nothing deleted, request stays pending',
    w.tables.attendance_logs.length === 3 && meta.reset_class_request.status === 'pending' &&
    w.notifies.some(m => m.includes('no longer marked Leave/Absent') && m.includes('NOT approved')));
}
{
  // Refusal: the original schedule is gone — never invent a slot.
  const w = seedResetWorld('owner');
  w.tables.class_schedules.length = 0;
  await vm.runInContext("handleApproveTeacherRequest('STU-A', 'reset_class')", w.sandbox);
  const meta = JSON.parse(w.tables.students[0].notes);
  check('admin approve refusal: schedule deleted → nothing deleted, request stays pending, clear message',
    w.tables.attendance_logs.length === 2 && meta.reset_class_request.status === 'pending' &&
    w.notifies.some(m => m.includes('no longer exists or has been changed')));
}
{
  // Decline: status + note preserved, decision stamped.
  const w = seedResetWorld('owner');
  await vm.runInContext("handleDeclineTeacherRequest('STU-A', 'reset_class')", w.sandbox);
  const meta = JSON.parse(w.tables.students[0].notes);
  check('admin decline: Leave/Absent log untouched, note preserved, decision stamped',
    w.tables.attendance_logs.length === 2 &&
    meta.reset_class_request.status === 'declined' && meta.reset_class_request.declined_by === 'owner' &&
    meta.reset_class_request.decline_reason === 'Cannot approve this week' &&
    meta.reset_class_request.notes === 'please reset');
}
{
  // Decision-3 leave cycle, end to end through the real handlers and
  // the real Assignments ledger.
  const w = makeLeavesWorld('owner');
  w.tables.teachers.push({ id: 'TCH-1', full_name: 'Teacher One' });
  w.tables.students.push({ id: 'STU-L', name: 'Leave Child', status: 'Active', assigned_teacher_id: 'TCH-1', family_id: 'FAM-1', notes: '{}' });
  w.tables.class_schedules.push(
    { id: 'SCH-L1', student_id: 'STU-L', teacher_id: 'TCH-1', day_of_week: 1, start_time: '10:00', end_time: '10:30' },
    { id: 'SCH-L2', student_id: 'STU-L', teacher_id: 'TCH-1', day_of_week: 3, start_time: '10:00', end_time: '10:30' },
  );
  w.tables.student_assignments.push({ id: 'ASG-1', student_id: 'STU-L', teacher_id: 'TCH-1', course_name: 'Quran', start_date: '2026-10-01', end_date: null, end_reason: null });
  vm.runInContext("ALL_TEACHERS = [{ id: 'TCH-1', full_name: 'Teacher One' }]; ALL_STUDENTS = [{ id: 'STU-L' }];", w.sandbox);
  w.registry.get('leaveStudentSelect').value = 'STU-L';
  w.registry.get('leaveStartDate').value = '2026-11-12';
  w.registry.get('leaveReturnDate').value = '2026-11-26';
  w.registry.get('leaveReasonSelect').value = 'Family travel';
  await vm.runInContext("handleSaveStudentLeave({ preventDefault() {} })", w.sandbox);
  const stu = w.tables.students[0];
  const meta = JSON.parse(stu.notes);
  check('leave start: student unassigned (removed from the teacher roster completely)',
    stu.assigned_teacher_id === null);
  check('leave start: previous teacher snapshotted + schedule archived into notes',
    meta.leave_previous_teacher_id === 'TCH-1' && Array.isArray(meta.archived_schedules_before_leave) && meta.archived_schedules_before_leave.length === 2);
  check('leave start: schedule rows deleted, attendance history untouched pattern (no logs existed)',
    w.tables.class_schedules.filter(s => s.student_id === 'STU-L').length === 0);
  const asg = w.tables.student_assignments[0];
  check('leave start: assignment CLOSED at the last payable day (never deleted)',
    !!asg && asg.end_date === '2026-11-11' && asg.end_reason === 'leave', JSON.stringify(asg));
  check('leave start: assignment-end stamp written for payroll proration',
    meta.assignment_end_date === '2026-11-11' && meta.assignment_end_reason === 'leave');

  await vm.runInContext("reactivateStudentFromLeave('STU-L')", w.sandbox);
  const stu2 = w.tables.students[0];
  const meta2 = JSON.parse(stu2.notes);
  check('off-leave: student returns to the PREVIOUS teacher roster',
    stu2.assigned_teacher_id === 'TCH-1' && stu2.status === 'Active' && meta2.on_leave === false);
  check('off-leave: NOT rescheduled (no timetable restoration) and the stamp is cleared',
    w.tables.class_schedules.filter(s => s.student_id === 'STU-L').length === 0 && meta2.assignment_end_date === undefined);
  check('off-leave: closed assignment history preserved (row still closed, not reopened/deleted)',
    w.tables.student_assignments.length === 1 && w.tables.student_assignments[0].end_date === '2026-11-11');
}
{
  // REAL payroll proration: the leave stamp bounds the segment at
  // the last payable day; earlier months are untouched.
  const sandbox = { console, localStorage: { getItem: () => null, setItem: () => {} } };
  vm.createContext(sandbox);
  const src = [
    extractFunction(PAYROLL, 'parsePayrollMonthBounds'),
    extractFunction(PAYROLL, 'payrollDateMax'),
    extractFunction(PAYROLL, 'payrollDateMin'),
    extractFunction(PAYROLL, 'payrollDaysInclusive'),
    extractFunction(PAYROLL, 'extractStudentPayrollDates'),
    extractFunction(PAYROLL, 'assignmentSegmentProration'),
  ].join('\n');
  vm.runInContext(src, sandbox);
  const stu = { id: 'STU-L', name: 'Leave Child', status: 'Active', joining_date: '2026-01-05', notes: JSON.stringify({ assignment_end_date: '2026-11-11', assignment_end_reason: 'leave' }) };
  const asg = { start_date: '2026-10-01', end_date: '2026-11-11' };
  const nov = vm.runInContext(`assignmentSegmentProration(${JSON.stringify(stu)}, ${JSON.stringify(asg)}, 3000, '2026-11')`, sandbox);
  check('payroll: leave month pays only up to the last payable day (11 of 30 days)',
    nov.activeDays === 11 && nov.proratedRate === 1100, JSON.stringify(nov));
  const oct = vm.runInContext(`assignmentSegmentProration(${JSON.stringify(stu)}, ${JSON.stringify(asg)}, 3100, '2026-10')`, sandbox);
  check('payroll: a month fully before the leave is priced in full (history intact)',
    oct.activeDays === 31 && oct.proratedRate === 3100, JSON.stringify(oct));
}

const failed = results.filter(r => !r.pass);
console.log(`\nteacher-reset-class: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
