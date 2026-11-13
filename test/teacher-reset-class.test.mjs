// Teacher Portal Update (owner commission, 2026-11-10):
// Student List redesign, Today's Classes Waiting flow, "Reset class"
// requests (teacher submit + Admin/Manager decision), and the new
// admin leave mechanics (leave ends schedule+assignment; return
// restores the previous teacher's roster as Not Scheduled).
//
//   Part 1 drives the REAL Worker against a fake D1: manager/owner
//   DELETE on attendance_logs works and is what Reset class
//   approval uses; a teacher delete of a set containing a Leave row
//   is denied. Part 1b proves the teacher SELF-RESET guard (owner
//   decision, later the same day): a teacher may delete ONLY their
//   own Waiting/Running rows for one schedule+date — everything
//   else is a 403 with nothing removed.
//   Part 2 pins the structural contract in teacher.html /
//   js/leaves.js (counts, trimmed rows, gating, locks, request keys).
//   Part 3 executes the REAL teacher.html functions in a vm over a
//   fake DOM + fake db: Student List rendering (order, labels,
//   buttons), Leave/Absent preselect, Reset class submit (with and
//   without a note) and the duplicate-pending guard. Part 3b runs
//   the REAL self-reset handler (Waiting/Running): happy paths,
//   the (schedule_id, today) delete shape, stale-status refusal,
//   confirm-decline, and the server-refusal path.
//   Part 4 executes the REAL js/leaves.js handlers in a vm: the
//   Requests scan, approve (log deleted -> Scheduled again),
//   refusal paths (schedule gone / status changed), decline, manager
//   parity, and the decision-3 leave cycle end-to-end through the
//   REAL js/assignments.js ledger + the REAL payroll proration
//   (payable only up to the last payable day; past months intact).
//
//   Follow-on (owner decision, later the same day): the Status
//   Change modal's "Reschedule to Another Day" option is replaced
//   by a "Reset class" sentinel that files the SAME
//   reset_class_request from a Completed/Present class (reset by
//   request — no self-reset, no Worker change). The filing
//   construction moved into the shared helper fileResetClassRequest
//   used by both teacher entry points. Part 2 pins the dropdown
//   contract + the sentinel branch + the Completed-row pending
//   badge; Part 3c executes the REAL Status Change submit; Part 4
//   covers approval/decline for a Completed class (owner + manager)
//   and the legacy Reschedule regressions (a stored 'Reschedule'
//   row still summarises as excluded; an already-filed Reschedule
//   request still approves verbatim through the untouched branch).
//   Part 5 executes the REAL teacher.html per-student History path
//   in a vm: a Today's Classes History button scopes the History
//   tab to that student even on a fresh boot (when the student
//   dropdown is still empty), the sidebar History button returns
//   to "All students", and the dropdown is the way back to all.
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
check('worker: teacher delete of a MIXED Waiting+Leave set is DENIED (Leave is never teacher-resettable)',
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
// Part 1b — REAL Worker: the teacher SELF-RESET delete guard.
// A teacher may delete ONLY their own rows for one schedule+date
// whose stored statuses are all Waiting/Running. Any other status
// in the matched set, another teacher's rows, or an unconstrained
// delete is denied and removes nothing.
// ===========================================================================
const tokTeacherB = await createSessionToken({ sub: 'T-B', role: 'teacher' }, WORKER_SECRET);
fakeDb.seed("INSERT INTO teachers (id, full_name, status) VALUES ('T-B', 'Teacher B', 'Active')");
fakeDb.seed("INSERT INTO students (id, family_id, name, assigned_teacher_id, status) VALUES ('ST-2', 'FAM-1', 'Child Two', 'T-B', 'Active')");
for (const [sid, stid, tid, tm] of [['SCH-B1', 'ST-2', 'T-B', '09:00'], ['SCH-3', 'ST-1', 'T-A', '12:00'], ['SCH-4', 'ST-1', 'T-A', '13:00'], ['SCH-5', 'ST-1', 'T-A', '14:00'], ['SCH-6', 'ST-1', 'T-A', '15:00']]) {
  fakeDb.seed(`INSERT INTO class_schedules (id, student_id, teacher_id, day_of_week, start_time, end_time) VALUES ('${sid}', '${stid}', '${tid}', 2, '${tm}', '${tm}')`);
}
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-WB', 'SCH-B1', 'ST-2', 'T-B', '2026-11-10', '2026-11-10', 'Waiting')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-W3', 'SCH-3', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Waiting')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-R3', 'SCH-3', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Running')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-C4', 'SCH-4', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Completed')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-W5a', 'SCH-5', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Waiting')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-W5b', 'SCH-5', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Waiting')");
fakeDb.seed("INSERT INTO attendance_logs (id, schedule_id, student_id, teacher_id, class_date, date, status) VALUES ('LOG-W6', 'SCH-6', 'ST-1', 'T-A', '2026-11-10', '2026-11-10', 'Waiting')");
const rowsFor = (sid) => fakeDb.all('SELECT COUNT(*) AS n FROM attendance_logs WHERE schedule_id=?', sid)[0].n;
const delFor = (sid, dateCol = 'date') => ({ table: 'attendance_logs', action: 'delete', filters: [eqF('schedule_id', sid), eqF(dateCol, '2026-11-10')] });

const selfWait = await dbPost(TOK.teacher, delFor('SCH-5'));
check('self-reset worker: teacher deletes their OWN all-Waiting rows (200, count reported)',
  selfWait.status === 200 && selfWait.json && selfWait.json.deleted === 2 && rowsFor('SCH-5') === 0,
  'status=' + selfWait.status + ' body=' + selfWait.text.slice(0, 120));
const selfRun = await dbPost(TOK.teacher, delFor('SCH-3'));
check('self-reset worker: teacher deletes a Waiting+Running chain (every row resettable)',
  selfRun.status === 200 && selfRun.json && selfRun.json.deleted === 2 && rowsFor('SCH-3') === 0,
  'status=' + selfRun.status + ' body=' + selfRun.text.slice(0, 120));
const selfCompleted = await dbPost(TOK.teacher, delFor('SCH-4'));
check('self-reset worker: a Completed row in the set denies the delete (403, row intact)',
  selfCompleted.status === 403 && rowsFor('SCH-4') === 1, 'status=' + selfCompleted.status);
const selfLeave = await dbPost(TOK.teacher, delFor('SCH-2'));
check('self-reset worker: a Leave row denies the delete (403, row intact — admin approval path only)',
  selfLeave.status === 403 && rowsFor('SCH-2') === 1, 'status=' + selfLeave.status);
const selfForeign = await dbPost(TOK.teacher, delFor('SCH-B1'));
check("self-reset worker: another teacher's rows are outside scope (no-op, their rows intact)",
  selfForeign.status === 200 && selfForeign.json && selfForeign.json.deleted === 0 && rowsFor('SCH-B1') === 1,
  'status=' + selfForeign.status + ' body=' + selfForeign.text.slice(0, 120));
const selfNoFilters = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'delete', filters: [] });
check('self-reset worker: an UNCONSTRAINED teacher delete is denied',
  selfNoFilters.status === 403, 'status=' + selfNoFilters.status);
const selfNoDate = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'delete', filters: [eqF('schedule_id', 'SCH-6')] });
check('self-reset worker: schedule_id without a date is denied (row intact)',
  selfNoDate.status === 403 && rowsFor('SCH-6') === 1, 'status=' + selfNoDate.status);
const selfNoSched = await dbPost(TOK.teacher, { table: 'attendance_logs', action: 'delete', filters: [eqF('date', '2026-11-10')] });
check('self-reset worker: a date without schedule_id is denied',
  selfNoSched.status === 403, 'status=' + selfNoSched.status);
const selfClassDate = await dbPost(TOK.teacher, delFor('SCH-6', 'class_date'));
check('self-reset worker: the class_date column constrains the delete just like date',
  selfClassDate.status === 200 && selfClassDate.json && selfClassDate.json.deleted === 1 && rowsFor('SCH-6') === 0,
  'status=' + selfClassDate.status + ' body=' + selfClassDate.text.slice(0, 120));
const mgrCompleted = await dbPost(TOK.manager, delFor('SCH-4'));
check('self-reset worker: manager delete is UNCHANGED (a Completed row still deletes via the portal path)',
  mgrCompleted.status === 200 && mgrCompleted.json && mgrCompleted.json.deleted === 1 && rowsFor('SCH-4') === 0,
  'status=' + mgrCompleted.status + ' body=' + mgrCompleted.text.slice(0, 120));

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
const fileResetSrc = extractFunction(TEACHER, 'fileResetClassRequest');
check('reset class submit: notes-JSON pattern with class date + current status recorded (shared filing helper)',
  fileResetSrc.includes("appendTeacherRequestToHistory(meta, 'reset_class_request', 'reset_class_history', reqObj)") &&
  fileResetSrc.includes('class_date: getPktNowParts().date') && fileResetSrc.includes('current_status: currentStatus'));
check('reset class submit: duplicate pending request is refused, not overwritten',
  fileResetSrc.includes("meta.reset_class_request.status === 'pending'") && fileResetSrc.includes("return 'duplicate'") &&
  resetSubmitSrc.includes('fileResetClassRequest(') && resetSubmitSrc.includes('already pending'));

{
  const selStart = TEACHER.indexOf('id="reschedNewStatus"');
  const selBlock = TEACHER.slice(selStart, TEACHER.indexOf('</select>', selStart));
  check('status change dropdown: ResetClass option present; the Reschedule STATUS option is gone; Present/Absent/Leave unchanged',
    selBlock.includes('<option value="ResetClass">') && selBlock.includes('Reset class') &&
    !selBlock.includes('value="Reschedule"') && !selBlock.includes('Reschedule to Another Day') &&
    selBlock.includes('<option value="Present">') && selBlock.includes('<option value="Absent">') && selBlock.includes('<option value="Leave">'));
  const reasonStart = TEACHER.indexOf('id="reschedReasonSelect"');
  const reasonBlock = TEACHER.slice(reasonStart, TEACHER.indexOf('</select>', reasonStart));
  check('status change dropdown: reason select unchanged (incl. the rescheduled-with-student REASON)',
    reasonBlock.includes('Class was rescheduled with student') && reasonBlock.includes('Marked by mistake'));
}
const reschedSubmitSrc = extractFunction(TEACHER, 'submitRescheduleRequest');
check('status change submit: ResetClass sentinel branches to the shared reset filing BEFORE any reschedule_request is built',
  reschedSubmitSrc.includes("newStatus === 'ResetClass'") &&
  reschedSubmitSrc.includes('fileResetClassRequest(') &&
  reschedSubmitSrc.includes('c?.pendingResetClassReq') &&
  reschedSubmitSrc.indexOf("newStatus === 'ResetClass'") < reschedSubmitSrc.indexOf("type: 'reschedule_request'"));
check('status change submit: the sentinel value is never stored as a requested status',
  !reschedSubmitSrc.includes("requested_status: 'ResetClass'") &&
  reschedSubmitSrc.includes('requested_status: newStatus'));
{
  const iComp = todaySrc.indexOf("stStatus === 'Completed'");
  const iAbs = todaySrc.indexOf("stStatus === 'Absent'");
  check("today's classes: Completed branch shows the Reset Class Pending badge while a reset is pending",
    todaySrc.slice(iComp, iAbs).includes('c.pendingResetClassReq') && todaySrc.slice(iComp, iAbs).includes('Reset Class Pending'));
}

check('admin scan: reset_class_request joins the Requests queue',
  LEAVES.includes("requestType: 'reset_class'") && LEAVES.includes('meta.reset_class_request.status === \'pending\''));
const approveSrc = extractFunction(LEAVES, 'handleApproveTeacherRequest');
check('admin approve (reset_class): re-validates schedule + still-marked (Leave/Absent/Completed/Present) before deleting the day log',
  approveSrc.includes("rType === 'reset_class'") &&
  approveSrc.includes("db.from('class_schedules').select('*').eq('id', req.schedule_id)") &&
  approveSrc.includes("!['Leave', 'Absent', 'Completed', 'Present'].includes(latestDayLog.status)") &&
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
check('worker: teacher attendance delete is GUARDED, no longer blanket-denied (self-reset rule)',
  WORKER.includes('attendanceTeacherSelfResetDeleteDenied') &&
  WORKER.includes("const RESETTABLE = new Set(['Waiting', 'Running'])") &&
  WORKER.includes("role === 'teacher' && table === 'attendance_logs' && action === 'delete'") &&
  WORKER.includes("filters.push(eq('teacher_id', sub));") &&
  !WORKER.includes("return action === 'delete' ? 'deny' : 'allow';"));
check('worker: release marker bumped for the self-reset deploy',
  WORKER.includes("const WORKER_RELEASE = '2026-11-13-teacher-cover';"));

check("today's classes: self-reset button is wired exactly twice (Waiting + Running branches)",
  (todaySrc.match(/handleTeacherSelfResetClass\('/g) || []).length === 2);
{
  const iW = todaySrc.indexOf("stStatus === 'Waiting'");
  const iR = todaySrc.indexOf("stStatus === 'Running'");
  const iC = todaySrc.indexOf("stStatus === 'Completed'");
  const iA = todaySrc.indexOf("stStatus === 'Absent'");
  const iS = todaySrc.indexOf('Scheduled / Free');
  check('self-reset: present on Waiting and Running rows',
    todaySrc.slice(iW, iR).includes('handleTeacherSelfResetClass') &&
    todaySrc.slice(iR, iC).includes('handleTeacherSelfResetClass'));
  check('self-reset: absent from Completed + Leave/Absent (request flow lives there) + Scheduled rows',
    !todaySrc.slice(iC, iA).includes('handleTeacherSelfResetClass') &&
    !todaySrc.slice(iA, iS).includes('handleTeacherSelfResetClass') &&
    todaySrc.slice(iA, iS).includes('openResetClassRequestModal') &&
    !todaySrc.slice(iS).includes('handleTeacherSelfResetClass'));
}
const selfResetSrc = extractFunction(TEACHER, 'handleTeacherSelfResetClass');
check('self-reset handler: in-flight lock + persisted re-read BEFORE any delete',
  selfResetSrc.includes('_selfResetInFlight.has(lockKey)') &&
  selfResetSrc.includes(".select('*').eq('schedule_id', scheduleId).eq('date', todayDate)") &&
  selfResetSrc.indexOf(".select('*')") < selfResetSrc.indexOf('.delete()'));
check('self-reset handler: refuses when the latest status left Waiting/Running; confirms via lmsConfirm',
  selfResetSrc.includes("latestLog.status !== 'Waiting' && latestLog.status !== 'Running'") &&
  selfResetSrc.includes('no longer Waiting or Running') && selfResetSrc.includes('await lmsConfirm({'));
check('self-reset handler: delete uses the approval-path shape (schedule_id + date); a server refusal is an error, never a success',
  selfResetSrc.includes(".delete().eq('schedule_id', scheduleId).eq('date', todayDate)") &&
  selfResetSrc.includes('The class was NOT reset'));

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
      toggle: (c, force) => {
        if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        else if (force) classes.add(c); else classes.delete(c);
        return classes.has(c);
      },
    },
    style: {},
    scrollIntoView: () => {},
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
    extractFunction(TEACHER, 'fileResetClassRequest'),
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
// Part 3b — REAL teacher.html self-reset handler (Waiting/Running)
// in a vm over a fake db: happy paths, the (schedule_id, today)
// delete shape proven by untouched control rows, stale-status
// refusal, confirm-decline, and the server-refusal (403) path.
// ===========================================================================
{
  const notifies = [];
  let reloads = 0;
  let confirmAnswer = true;
  const tables = { attendance_logs: [] };
  const sandbox = {
    console,
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    TODAY_CLASSES: [],
    db: null,
    getPktNowParts: () => ({ date: '2026-11-10', day: 2, minutes: 600 }),
    lmsNotify: (msg, opts) => { notifies.push({ msg: String(msg), type: (opts && opts.type) || '' }); },
    lmsConfirm: async () => confirmAnswer,
    loadTeacherPortalData: async () => { reloads++; },
    notifyClassSessionSync: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const lockDecl = TEACHER.slice(TEACHER.indexOf('const _selfResetInFlight'), TEACHER.indexOf(';', TEACHER.indexOf('const _selfResetInFlight')) + 1);
  vm.runInContext(lockDecl + '\n' + extractFunction(TEACHER, 'handleTeacherSelfResetClass'), sandbox);

  const todayRows = () => tables.attendance_logs.filter(r => r.schedule_id === 'SCH-S1' && r.date === '2026-11-10');
  const controlRows = () => tables.attendance_logs.filter(r => !(r.schedule_id === 'SCH-S1' && r.date === '2026-11-10'));
  function arm(status, dbOverride) {
    tables.attendance_logs = [
      { schedule_id: 'SCH-S1', student_id: 'ST-1', teacher_id: 'TCH-1', date: '2026-11-10', status, created_at: '2026-11-10T05:00:00Z' },
      { schedule_id: 'SCH-S1', student_id: 'ST-1', teacher_id: 'TCH-1', date: '2026-11-09', status: 'Waiting', created_at: '2026-11-09T05:00:00Z' },
      { schedule_id: 'SCH-OTHER', student_id: 'ST-1', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Waiting', created_at: '2026-11-10T05:00:00Z' },
    ];
    sandbox.TODAY_CLASSES = [{ id: 'SCH-S1', student_id: 'ST-1', students: { name: 'Child One' }, log: { status } }];
    sandbox.db = dbOverride || makeFakeDb(tables);
    notifies.length = 0; reloads = 0; confirmAnswer = true;
  }
  function makeDeleteFailingDb(t) {
    const inner = makeFakeDb(t);
    return {
      from(table) {
        const b = inner.from(table);
        let isDelete = false;
        const origDelete = b.delete;
        b.delete = () => { isDelete = true; return origDelete(); };
        const origThen = b.then;
        b.then = (res, rej) => isDelete
          ? Promise.resolve({ data: null, error: { message: 'Forbidden' } }).then(res, rej)
          : origThen(res, rej);
        return b;
      },
    };
  }

  arm('Waiting');
  await vm.runInContext("handleTeacherSelfResetClass('SCH-S1')", sandbox);
  check('self-reset click (Waiting): today\'s rows deleted — class is Scheduled again',
    todayRows().length === 0 && notifies.some(n => n.msg.includes('Scheduled again')));
  check('self-reset click: the delete was constrained to (schedule_id, today) — control rows untouched',
    controlRows().length === 2);
  check('self-reset click: the portal data reloads after a successful reset', reloads >= 1);

  arm('Running');
  await vm.runInContext("handleTeacherSelfResetClass('SCH-S1')", sandbox);
  check('self-reset click (Running): today\'s rows deleted with a success message',
    todayRows().length === 0 && notifies.some(n => n.msg.includes('Scheduled again')));

  arm('Running');
  tables.attendance_logs[0].status = 'Completed'; // persisted state moved on after the row rendered
  await vm.runInContext("handleTeacherSelfResetClass('SCH-S1')", sandbox);
  check('self-reset click: a class that became Completed is REFUSED (re-read wins over the stale row)',
    todayRows().length === 1 && notifies.some(n => n.type === 'error' && n.msg.includes('no longer Waiting or Running')));

  arm('Waiting');
  confirmAnswer = false;
  await vm.runInContext("handleTeacherSelfResetClass('SCH-S1')", sandbox);
  check('self-reset click: declining the confirmation deletes nothing',
    todayRows().length === 1 && !notifies.some(n => n.msg.includes('Scheduled again')));

  arm('Waiting', makeDeleteFailingDb(tables));
  await vm.runInContext("handleTeacherSelfResetClass('SCH-S1')", sandbox);
  check('self-reset click: a server refusal (403) shows an error and deletes nothing — never a silent success',
    todayRows().length === 1 && notifies.some(n => n.type === 'error' && n.msg.includes('NOT reset')) &&
    !notifies.some(n => n.msg.includes('Scheduled again')));
}

// ===========================================================================
// Part 3c — REAL teacher.html Status Change submit with the
// "Reset class" sentinel (owner follow-on, 2026-11-10): selecting
// ResetClass on a Completed class files a reset_class_request via
// the shared helper, writes NO reschedule_request, changes NO
// attendance row, and refuses a duplicate pending request twice
// over (the row flag, then the notes-level guard). The normal
// status path still files a reschedule_request exactly as before.
// ===========================================================================
{
  const registry = makeRegistry();
  const notifies = [];
  const tables = {
    students: [
      { id: 'STU-C1', name: 'Completed Child', notes: '{}' },
      { id: 'STU-C2', name: 'Second Child', notes: '{}' },
    ],
    attendance_logs: [
      { id: 'LOG-C1', schedule_id: 'SCH-C1', student_id: 'STU-C1', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Completed', lesson_notes: '{"sabaq":"recorded lesson"}', created_at: '2026-11-10T05:30:00Z' },
    ],
  };
  const logsBefore = JSON.stringify(tables.attendance_logs);
  const sandbox = {
    console,
    document: { getElementById: (id) => registry.get(id) },
    db: makeFakeDb(tables),
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    TODAY_CLASSES: [],
    getPktNowParts: () => ({ date: '2026-11-10', day: 2, minutes: 600 }),
    lmsNotify: (msg) => { notifies.push(String(msg)); },
    loadTeacherPortalData: async () => {},
    pushTeacherModalHistory: () => {},
    popTeacherModalHistory: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = [
    extractFunction(TEACHER, 'appendTeacherRequestToHistory'),
    extractFunction(TEACHER, 'closeRescheduleRequestModal'),
    extractFunction(TEACHER, 'fileResetClassRequest'),
    extractFunction(TEACHER, 'submitRescheduleRequest'),
  ].join('\n');
  vm.runInContext(src, sandbox);

  function armStatusChange(pending) {
    sandbox.TODAY_CLASSES = [{
      id: 'SCH-C1', student_id: 'STU-C1', start_time: '09:00:00', end_time: '09:30:00',
      log: { status: 'Completed' }, students: { name: 'Completed Child' }, pendingResetClassReq: pending,
    }];
    registry.get('reschedScheduleId').value = 'SCH-C1';
    registry.get('reschedNewStatus').value = 'ResetClass';
    registry.get('reschedReasonSelect').value = 'Marked by mistake';
    registry.get('reschedNotes').value = 'Class was marked complete by mistake';
    notifies.length = 0;
  }

  armStatusChange(null);
  await vm.runInContext("submitRescheduleRequest({ preventDefault() {} })", sandbox);
  const metaC1 = JSON.parse(tables.students[0].notes);
  check('status change submit (ResetClass on Completed): exactly one pending reset_class_request is filed',
    !!metaC1.reset_class_request && metaC1.reset_class_request.status === 'pending' &&
    metaC1.reset_class_request.type === 'reset_class_request' &&
    Array.isArray(metaC1.reset_class_history) && metaC1.reset_class_history.length === 1,
    JSON.stringify(metaC1.reset_class_request || {}));
  check('status change submit (ResetClass): request carries today (PKT), the Completed status and the full context',
    metaC1.reset_class_request.class_date === '2026-11-10' &&
    metaC1.reset_class_request.current_status === 'Completed' &&
    metaC1.reset_class_request.schedule_id === 'SCH-C1' &&
    metaC1.reset_class_request.student_id === 'STU-C1' &&
    metaC1.reset_class_request.teacher_id === 'TCH-1' &&
    metaC1.reset_class_request.schedule_label === '09:00 - 09:30 PKT');
  check('status change submit (ResetClass): the modal reason + note are carried into the request note',
    metaC1.reset_class_request.notes === 'Marked by mistake — Class was marked complete by mistake',
    String(metaC1.reset_class_request.notes));
  check('status change submit (ResetClass): NO reschedule_request written and NO attendance row changed',
    metaC1.reschedule_request === undefined && metaC1.reschedule_history === undefined &&
    JSON.stringify(tables.attendance_logs) === logsBefore);
  check('status change submit (ResetClass): same confirmation wording as the Reset class flow; modal closed',
    notifies.some(m => m.includes('Reset class request submitted') && m.includes('stays Completed')) &&
    registry.get('modalRescheduleRequest').classList.contains('hidden'));

  // Duplicate, layer 1: the row flag (what the portal computes from
  // the notes) refuses BEFORE any write.
  armStatusChange(metaC1.reset_class_request);
  const notesBeforeDup = tables.students[0].notes;
  await vm.runInContext("submitRescheduleRequest({ preventDefault() {} })", sandbox);
  check('status change submit (ResetClass): a second submit while pending is refused early — nothing written',
    tables.students[0].notes === notesBeforeDup &&
    notifies.some(m => m.includes('already pending with Admin')));

  // Duplicate, layer 2: the notes-level guard inside the shared
  // filing helper refuses even if the row flag was stale.
  armStatusChange(null);
  await vm.runInContext("submitRescheduleRequest({ preventDefault() {} })", sandbox);
  const metaC1b = JSON.parse(tables.students[0].notes);
  check('status change submit (ResetClass): the notes-level duplicate guard also refuses (history stays at one)',
    metaC1b.reset_class_history.length === 1 &&
    notifies.some(m => m.includes('already pending')));

  // Non-sentinel path unchanged: a normal status choice for another
  // student still files a reschedule_request exactly as before.
  sandbox.TODAY_CLASSES = [{
    id: 'SCH-C2', student_id: 'STU-C2', start_time: '11:00:00', end_time: '11:30:00',
    log: { status: 'Completed' }, students: { name: 'Second Child' }, pendingResetClassReq: null,
  }];
  registry.get('reschedScheduleId').value = 'SCH-C2';
  registry.get('reschedNewStatus').value = 'Absent';
  registry.get('reschedReasonSelect').value = 'Marked by mistake';
  registry.get('reschedNotes').value = '';
  notifies.length = 0;
  await vm.runInContext("submitRescheduleRequest({ preventDefault() {} })", sandbox);
  const metaC2 = JSON.parse(tables.students[1].notes);
  check('status change submit (normal status): still files a reschedule_request exactly as before',
    !!metaC2.reschedule_request && metaC2.reschedule_request.requested_status === 'Absent' &&
    metaC2.reset_class_request === undefined &&
    notifies.some(m => m.includes('Reschedule request submitted')));
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
    // Leave Screen Fixes (2026-11-10): the scan and the save handler
    // now call these two shared helpers from the same file — they
    // must be extracted with them or the real handlers throw.
    extractFunction(LEAVES, 'isValidLeaveDateStr'),
    extractFunction(LEAVES, 'classifyLeaveRecord'),
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
  check('admin approve refusal: class no longer in a marked state (Running) → nothing deleted, request stays pending',
    w.tables.attendance_logs.length === 3 && meta.reset_class_request.status === 'pending' &&
    w.notifies.some(m => m.includes('no longer marked') && m.includes('NOT approved')));
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
function seedCompletedResetWorld(role) {
  const w = makeLeavesWorld(role);
  w.tables.students.push({
    id: 'STU-C', name: 'Child C', status: 'Active', assigned_teacher_id: 'TCH-1', family_id: 'FAM-1',
    notes: JSON.stringify({
      reset_class_request: {
        id: 'RESET-C', type: 'reset_class_request', student_id: 'STU-C', student_name: 'Child C',
        schedule_id: 'SCH-C', teacher_id: 'TCH-1', teacher_name: 'Teacher One',
        class_date: '2026-11-10', schedule_label: '09:00 - 09:30 PKT', current_status: 'Completed',
        notes: 'Marked by mistake', status: 'pending', requested_at: '2026-11-10T05:40:00.000Z',
      },
      reset_class_history: [],
    }),
  });
  w.tables.class_schedules.push({ id: 'SCH-C', student_id: 'STU-C', teacher_id: 'TCH-1', day_of_week: 2, start_time: '09:00', end_time: '09:30' });
  w.tables.attendance_logs.push(
    { id: 'LOG-CW', schedule_id: 'SCH-C', student_id: 'STU-C', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Waiting', created_at: '2026-11-10T05:00:00Z' },
    { id: 'LOG-CR', schedule_id: 'SCH-C', student_id: 'STU-C', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Running', created_at: '2026-11-10T05:05:00Z' },
    { id: 'LOG-CC', schedule_id: 'SCH-C', student_id: 'STU-C', teacher_id: 'TCH-1', date: '2026-11-10', status: 'Completed', created_at: '2026-11-10T05:35:00Z', lesson_notes: '{"sabaq":"recorded lesson"}' },
  );
  return w;
}
{
  // Filed from the Status Change modal on a Completed class and
  // approved by the OWNER: the whole day chain (Waiting -> Running
  // -> Completed) is deleted, so the class computes back to
  // Scheduled — the extended approval gate accepts Completed.
  const w = seedCompletedResetWorld('owner');
  await vm.runInContext("handleApproveTeacherRequest('STU-C', 'reset_class')", w.sandbox);
  const meta = JSON.parse(w.tables.students[0].notes);
  check('admin approve (owner, Completed class): the day log chain is deleted — the class is Scheduled again',
    w.tables.attendance_logs.filter(l => l.schedule_id === 'SCH-C').length === 0 &&
    meta.reset_class_request.status === 'approved' && meta.reset_class_request.approved_by === 'owner' &&
    w.notifies.some(m => m.includes('Reset class approved')));
}
{
  // The same Completed-class approval decided by a MANAGER (parity
  // with the Leave/Absent reset path).
  const w = seedCompletedResetWorld('manager');
  await vm.runInContext("handleApproveTeacherRequest('STU-C', 'reset_class')", w.sandbox);
  const meta = JSON.parse(w.tables.students[0].notes);
  check('admin approve (manager, Completed class): chain deleted and decision stamped manager',
    w.tables.attendance_logs.length === 0 &&
    meta.reset_class_request.status === 'approved' && meta.reset_class_request.approved_by === 'manager');
}
{
  // Decline for a Completed-class reset: the Completed log — and
  // the recorded lesson on it — stays exactly as it was.
  const w = seedCompletedResetWorld('owner');
  await vm.runInContext("handleDeclineTeacherRequest('STU-C', 'reset_class')", w.sandbox);
  const meta = JSON.parse(w.tables.students[0].notes);
  const completed = w.tables.attendance_logs.find(l => l.id === 'LOG-CC');
  check('admin decline (Completed class): log chain untouched, lesson notes preserved, decision stamped',
    w.tables.attendance_logs.length === 3 && !!completed && completed.lesson_notes === '{"sabaq":"recorded lesson"}' &&
    meta.reset_class_request.status === 'declined' && meta.reset_class_request.declined_by === 'owner');
}
{
  // REGRESSION: an already-filed legacy Reschedule request still
  // approves through the UNTOUCHED reschedule branch — the day's
  // log is stamped 'Reschedule' verbatim, exactly as before.
  const w = makeLeavesWorld('owner');
  const todayUtc = new Date().toISOString().slice(0, 10);
  w.tables.students.push({
    id: 'STU-R', name: 'Child R', status: 'Active', assigned_teacher_id: 'TCH-1', family_id: 'FAM-1',
    notes: JSON.stringify({
      reschedule_request: {
        id: 'RESCHED-1', type: 'reschedule_request', student_id: 'STU-R', student_name: 'Child R',
        schedule_id: 'SCH-R', teacher_id: 'TCH-1', teacher_name: 'Teacher One',
        current_status: 'Completed', requested_status: 'Reschedule', reason: 'Class was rescheduled with student',
        notes: '', status: 'pending', requested_at: '2026-11-10T05:40:00.000Z',
      },
      reschedule_history: [],
    }),
  });
  w.tables.attendance_logs.push({ id: 'LOG-RC', schedule_id: 'SCH-R', student_id: 'STU-R', teacher_id: 'TCH-1', date: todayUtc, status: 'Completed', created_at: '2026-11-10T05:35:00Z', lesson_notes: '{"sabaq":"recorded lesson"}' });
  await vm.runInContext("handleApproveTeacherRequest('STU-R', 'reschedule')", w.sandbox);
  const log = w.tables.attendance_logs.find(l => l.id === 'LOG-RC');
  const meta = JSON.parse(w.tables.students[0].notes);
  check('regression: a legacy Reschedule request still approves verbatim (status stamped Reschedule)',
    !!log && log.status === 'Reschedule' && String(log.lesson_notes).includes('[Admin Override]') &&
    meta.reschedule_request.status === 'approved');
}
{
  // REGRESSION: a stored 'Reschedule' attendance row is excluded
  // from every attendance-summary count (never double-counted) —
  // removing the dropdown option does not orphan existing rows.
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/attendance-summary.js'), sandbox);
  const sum = sandbox.window.AttendanceSummary.summarize([
    { date: '2026-11-10', status: 'Reschedule' },
    { date: '2026-11-10', status: 'Completed' },
    { date: '2026-11-10', status: 'Absent' },
  ], '2026-11');
  check("regression: a stored 'Reschedule' row counts in NO summary bucket (present/absent/leave all exclude it)",
    sum.present === 1 && sum.absent === 1 && sum.leave === 0 && sum.eligible === 2, JSON.stringify(sum));
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

// ===========================================================================
// Part 5 — REAL teacher.html per-student History (fresh-boot scoping):
// the Today's Classes History button must show ONLY that student's
// history even when the History tab was never visited in the session
// (the student dropdown is empty in the markup until the first
// render, so a direct .value set is discarded by the browser).
// ===========================================================================
{
  const SECURITY = read('js/security.js');
  const registry = makeRegistry();
  // The browser discards a .value set on a <select> whose options do
  // not contain that value yet — the fake select below reproduces
  // that rule, so the fresh-boot bug is loud here instead of hidden.
  const selEl = registry.get('lhTeacherStudentSelect');
  let selOptions = [];
  let selValue = '';
  Object.defineProperty(selEl, 'innerHTML', {
    get: () => selEl._html || '',
    set: (html) => {
      selEl._html = String(html);
      selOptions = [...String(html).matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
      if (!selOptions.includes(selValue)) selValue = '';
    },
  });
  Object.defineProperty(selEl, 'value', {
    get: () => selValue,
    set: (v) => { selValue = selOptions.includes(String(v)) ? String(v) : ''; },
  });
  const tables = {
    attendance_logs: [
      { student_id: 'STU-A', date: '2026-11-09', status: 'Present', teacher_id: 'TCH-1', students: { name: 'Sara' } },
      { student_id: 'STU-A', date: '2026-11-08', status: 'Present', teacher_id: 'TCH-1', students: { name: 'Sara' } },
      { student_id: 'STU-B', date: '2026-11-09', status: 'Present', teacher_id: 'TCH-1', students: { name: 'Uma' } },
    ],
  };
  const sandbox = {
    console,
    document: { getElementById: (id) => registry.get(id), querySelector: () => null },
    db: makeFakeDb(tables),
    CURRENT_TEACHER: { id: 'TCH-1', full_name: 'Teacher One' },
    CURRENT_TEACHER_TAB: 'dashboard',
    ACTIVE_ASSIGNED_STUDENTS: [
      { id: 'STU-A', name: 'Sara' },
      { id: 'STU-B', name: 'Uma' },
    ],
    LEAVE_ASSIGNED_STUDENTS: [],
    ALL_TEACHER_SCHEDULES: [
      { id: 'SCH-A', student_id: 'STU-A', students: { id: 'STU-A', name: 'Sara' } },
      { id: 'SCH-B', student_id: 'STU-B', students: { id: 'STU-B', name: 'Uma' } },
    ],
    syncTeacherSidebarActiveState: () => {},
  };
  sandbox.window = sandbox;
  sandbox.LessonHistory = {
    dedupeLessonRows: (rows) => rows.map(r => ({ studentId: String(r.student_id), date: r.date, status: r.status, teacherName: 'Teacher One' })),
    filterLessonEntries: (entries, date) => entries.filter(e => e.date === date),
    entryTitle: () => '',
    formatActualDuration: () => '30 min',
  };
  vm.createContext(sandbox);
  // Module state as declared in teacher.html (limit / blobs / visible
  // entries / pending per-student request) plus the tab helpers the
  // switch function needs (tab list + hash recording, hash-guarded).
  const lhDecls = TEACHER.slice(TEACHER.indexOf('let _LH_TEACHER_LIMIT'), TEACHER.indexOf('function _lhTeacherRevokeBlobs'));
  const tabHelpers = TEACHER.slice(TEACHER.indexOf('const TEACHER_PORTAL_TABS'), TEACHER.indexOf('function switchTeacherPortalTab'));
  const src = [
    lhDecls,
    tabHelpers,
    extractFunction(SECURITY, 'escapeHtml'),
    extractFunction(TEACHER, '_lhTeacherRevokeBlobs'),
    extractFunction(TEACHER, 'switchTeacherPortalTab'),
    extractFunction(TEACHER, 'openTeacherLessonHistoryForStudent'),
    extractFunction(TEACHER, 'renderTeacherLessonHistory'),
  ].join('\n');
  vm.runInContext(src, sandbox);
  const chipEl = registry.get('lhTeacherScopedChip');
  const listEl = registry.get('lhTeacherHistoryList');
  const visibleIds = () => vm.runInContext('_LH_TEACHER_VISIBLE_ENTRIES.map(e => e.studentId).join(",")', sandbox);
  const flush = () => new Promise(r => setTimeout(r, 0));

  // --- Structural pins for the fix
  check('history fix: pending per-student id is carried in a module variable',
    TEACHER.includes('let _LH_TEACHER_PENDING_STUDENT = null;'));
  check('history fix: the History button handler sets the pending id (no direct .value set on an empty select)',
    extractFunction(TEACHER, 'openTeacherLessonHistoryForStudent').includes('_LH_TEACHER_PENDING_STUDENT = String(studentId'));
  check('history fix: stale "used by the Student List" comment is gone',
    !TEACHER.includes('used by the Student List'));
  check('history fix: scoped chip element exists on the History tab',
    TEACHER.includes('id="lhTeacherScopedChip"'));

  // --- (a) Fresh boot: dropdown has NO options yet (real markup)
  check('history per-student (a): fresh boot starts with an empty student dropdown',
    selEl.innerHTML === '' && selEl.value === '');
  vm.runInContext("openTeacherLessonHistoryForStudent('STU-A')", sandbox);
  await flush();
  check('history per-student (a): fresh-boot History button scopes to that student only',
    selEl.value === 'STU-A' && visibleIds() === 'STU-A,STU-A',
    'sel=' + selEl.value + ' visible=' + visibleIds());
  check('history per-student (a): rendered list shows only that student',
    listEl.innerHTML.includes('>Sara<') && !listEl.innerHTML.includes('>Uma<'));
  check('history per-student (a): scoped chip names the student',
    chipEl.textContent === 'Showing history for Sara' && chipEl.style.display === 'flex',
    JSON.stringify(chipEl.textContent));

  // --- (b) Click after the History tab was already visited
  vm.runInContext("switchTeacherPortalTab('history')", sandbox);
  await flush();
  check('history per-student (b): sidebar visit in between returns to all students',
    selEl.value === 'all' && visibleIds() === 'STU-A,STU-A,STU-B');
  vm.runInContext("openTeacherLessonHistoryForStudent('STU-B')", sandbox);
  await flush();
  check('history per-student (b): History button after a prior visit still scopes to that student',
    selEl.value === 'STU-B' && visibleIds() === 'STU-B',
    'sel=' + selEl.value + ' visible=' + visibleIds());
  check('history per-student (b): chip follows the second student',
    chipEl.textContent === 'Showing history for Uma' && chipEl.style.display === 'flex');

  // --- Refresh preserves the scope (re-render, no new request)
  await vm.runInContext('renderTeacherLessonHistory(true)', sandbox);
  check('history per-student: Refresh keeps the current student scope',
    selEl.value === 'STU-B' && visibleIds() === 'STU-B');

  // --- (c) Sidebar History button returns to all
  vm.runInContext("switchTeacherPortalTab('history')", sandbox);
  await flush();
  check('history per-student (c): sidebar History button shows all students',
    selEl.value === 'all' && visibleIds() === 'STU-A,STU-A,STU-B',
    'sel=' + selEl.value + ' visible=' + visibleIds());
  check('history per-student (c): chip hides when showing all students',
    chipEl.textContent === '' && chipEl.style.display === 'none');

  // --- (d) Dropdown back to "All students" is the way back to all
  vm.runInContext("openTeacherLessonHistoryForStudent('STU-A')", sandbox);
  await flush();
  check('history per-student (d): setup scopes to one student again', selEl.value === 'STU-A');
  selEl.value = 'all';
  await vm.runInContext('renderTeacherLessonHistory(false)', sandbox);
  check('history per-student (d): picking "All students" in the dropdown shows everyone',
    selEl.value === 'all' && visibleIds() === 'STU-A,STU-A,STU-B' && chipEl.style.display === 'none');

  // --- Unknown id never lands on a stale previous selection
  vm.runInContext("openTeacherLessonHistoryForStudent('STU-NOPE')", sandbox);
  await flush();
  check('history per-student: an unknown student id falls back to all students',
    selEl.value === 'all' && visibleIds() === 'STU-A,STU-A,STU-B',
    'sel=' + selEl.value + ' visible=' + visibleIds());
}

const failed = results.filter(r => !r.pass);
console.log(`\nteacher-reset-class: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
