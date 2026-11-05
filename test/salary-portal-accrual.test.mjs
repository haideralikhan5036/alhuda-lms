// Salary Commission #2 Phase 3 (2026-11-05): ACCRUAL DISPLAYS +
// CROSS-PORTAL CONSISTENCY. Executes the REAL js/course-catalogue.js,
// js/assignments.js and js/payroll.js in a vm, plus the teacher
// portal's own live-accrual block extracted verbatim from
// teacher.html, and proves:
//  (0) the consistency stamp: Assignments.endAssignment mirrors the
//      end onto the student record (notes.assignment_end_date); the
//      engine honours it in BOTH the Admin compile (derived segment)
//      and the teacher-path compile; Assignments.open clears it.
//  (b) consistency: one fixture compiled through the Admin compile
//      and through compileOwnCurrentMonthAccrual yields identical
//      potential + gross earned — incl. a 60-minute (2-slot) student
//      and the stamped-end case.
//  (1) the Admin row earned/remaining sub-lines + the KPI earned
//      sub-line render for the current month and are gated off for a
//      past month; the settings gate (CourseCatalogue.fromServer)
//      blocks teacher figures until a server fetch lands.
//  (d) js/payroll.js is side-effect-free at load (runs with NO
//      document/db present) — the fact the teacher portal's script
//      loading route rests on.
// A FakeDate pins "today" to 2026-11-15 so accrual is deterministic.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail ? ':: ' + detail : ''); }
}
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
function seg(src, from, to) {
  const a = src.indexOf(from);
  const b = to ? src.indexOf(to, a + 1) : -1;
  return a < 0 ? '' : src.slice(a, b < 0 ? undefined : b);
}
const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ (d) load safety
console.log('== (d) payroll.js load-time side effects ==');
{
  const bare = {};
  bare.window = bare;
  bare.console = console;
  bare.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  // NO document, NO db, NO other globals: any load-time touch throws.
  vm.createContext(bare);
  let loadErr = null;
  try { vm.runInContext(read('js/payroll.js'), bare, { filename: 'js/payroll.js' }); } catch (e) { loadErr = e; }
  check('payroll.js executes with no document/db present', !loadErr, loadErr && loadErr.message);
  check('only declarations + window.PayrollSlots happen at load',
    !!bare.window.PayrollSlots && typeof bare.window.PayrollSlots.compute === 'function' &&
    typeof bare.resolveAssignmentRate === 'function' && typeof bare.assignmentSegmentProration === 'function');
}

// ---------------------------------------------------------------- fakes
let FAKE_NOW = '2026-11-15T12:00:00';
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FAKE_NOW])); }
  static now() { return new Date(FAKE_NOW).getTime(); }
}
let MONTH = 'November 2026';
function makeElement(id) {
  return {
    id, innerHTML: '', innerText: '', value: id === 'salaryMonthSelect' ? MONTH : '',
    appendChild() {}, remove() {}, setAttribute() {}, querySelectorAll() { return []; },
    classList: {
      _set: new Set(['hidden']),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, force) { if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    }
  };
}
const elements = {};
const store = new Map();
const TABLES = { teachers: [], students: [], class_schedules: [], student_assignments: [], system_settings: [] };
const WRITES = [];
let ACCOUNTS = {};
function qb(table) {
  const state = { filters: {}, vals: null };
  const run = () => {
    let rows = (TABLES[table] || []).slice();
    for (const [k, v] of Object.entries(state.filters)) rows = rows.filter(r => String(r[k]) === String(v));
    return rows;
  };
  const q = {
    select() { return q; },
    eq(col, val) { state.filters[col] = val; return q; },
    limit() { return q; },
    order() { return q; },
    single() { return Promise.resolve({ data: run()[0] || null, error: null }); },
    maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }); },
    insert(row) { (TABLES[table] = TABLES[table] || []).push({ ...row }); WRITES.push({ table, op: 'insert', row }); return Promise.resolve({ data: [row], error: null }); },
    upsert(row) { WRITES.push({ table, op: 'upsert', row }); return Promise.resolve({ data: [row], error: null }); },
    update(vals) { state.vals = vals; return q; },
    then(resolve, reject) {
      try {
        if (state.vals) {
          const rows = run();
          rows.forEach(r => Object.assign(r, state.vals));
          WRITES.push({ table, op: 'update', vals: state.vals, filters: { ...state.filters }, count: rows.length });
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
      } catch (e) { return Promise.reject(e).then(resolve, reject); }
    }
  };
  return q;
}
const sandbox = {
  console, Set, Map, Promise, Date: FakeDate, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, Intl, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
  document: {
    readyState: 'loading',
    getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement() { return makeElement('x'); },
    body: makeElement('body')
  },
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  },
  db: { from: (t) => qb(t) },
  getTeacherAccounts() { return ACCOUNTS; },
  lmsNotify() {},
  lmsConfirm() { return Promise.resolve(true); },
  StaffCategories: { of(t) { return (t && t.__cat) || 'teaching'; } }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`
  var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [], ALL_ASSIGNMENTS = [];
  let ALL_TEACHER_SALARIES = {};
  var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
  var CURRENT_TEACHER = null, ACTIVE_ASSIGNED_STUDENTS = [], LEAVE_ASSIGNED_STUDENTS = [], ALL_TEACHER_SCHEDULES = [];
`, sandbox, { filename: 'prelude.js' });
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
// The teacher portal's own code, extracted verbatim from teacher.html.
const teacherHtml = read('teacher.html');
vm.runInContext(seg(teacherHtml, 'function parseEmployeeMeta(', 'function classifyEmployeeRole('), sandbox, { filename: 'teacher.html#parseEmployeeMeta' });
vm.runInContext(seg(teacherHtml, 'function _teacherAccrualAccount(', '// ================= LIVE SALARY ACCRUAL — END'), sandbox, { filename: 'teacher.html#live-accrual' });
const run = (code) => vm.runInContext(code, sandbox);

// ------------------------------------------------------------ fixtures
const RATES = {
  version: 1, weekend_rate: 3200, basic_salary_pkr: 20000,
  courses: [
    { id: 'crs-noorani-qaida', name: 'Noorani Qaida', monthly_rate: 2200, active: true, aliases: [] },
    { id: 'crs-quran-reading', name: 'Quran Reading with Tajweed', monthly_rate: 2200, active: true, aliases: [] },
    { id: 'crs-tafseer-english', name: 'English Translation & Tafseer', monthly_rate: 4500, active: true, weekend_eligible: false, aliases: ['Tafseer-ul-Quran'] }
  ]
};
TABLES.system_settings = [{ id: 'SYS-COURSE-RATES', key: 'course_rates_v1', value: JSON.stringify(RATES) }];

const T1 = { id: 'T1', full_name: 'Teacher One', phone: '0300', status: 'Active', created_at: '2024-06-01T00:00:00' };
const S1 = { id: 'S1', name: 'Stu Sixty', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-09-01', notes: JSON.stringify({ course_name: 'Noorani Qaida' }) };
const S2 = { id: 'S2', name: 'Stu Thirty', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-09-01', notes: JSON.stringify({ course_name: 'Noorani Qaida' }) };
TABLES.teachers = [T1];
TABLES.students = [S1, S2];
let schSeq = 0;
const SCH = (student_id, day, start, end, dm) => ({ id: 'SCH' + (++schSeq), teacher_id: 'T1', student_id, day_of_week: day, start_time: start, end_time: end, duration_mins: dm != null ? dm : 30 });
// S1: STU-007 shape — every session is really 03:30-04:30 (60 min by
// the clock), duration_mins lies on some rows, several days duplicated.
TABLES.class_schedules = [
  SCH('S1', 1, '03:30', '04:30', 60), SCH('S1', 2, '03:30', '04:30', 30), SCH('S1', 2, '03:30', '04:30', 30),
  SCH('S1', 3, '03:30', '04:30', 30), SCH('S1', 3, '03:30', '04:30', 30), SCH('S1', 4, '03:30', '04:30', 60),
  SCH('S1', 4, '03:30', '04:30', 30), SCH('S1', 5, '03:30', '04:30', 60), SCH('S1', 5, '03:30', '04:30', 30),
  SCH('S1', 6, '03:30', '04:30', 30),
  SCH('S2', 1, '05:00', '05:30'), SCH('S2', 2, '05:00', '05:30'), SCH('S2', 3, '05:00', '05:30'),
  SCH('S2', 4, '05:00', '05:30'), SCH('S2', 5, '05:00', '05:30')
];
ACCOUNTS = { T1: { joining_date: '2024-06-01' } }; // -> seniority 2 yrs x 200 = 400 in Nov 2026
store.set('alhuda_teacher_accounts', JSON.stringify(ACCOUNTS));

sandbox.CURRENT_TEACHER = T1;
sandbox.ACTIVE_ASSIGNED_STUDENTS = [S1, S2];
sandbox.LEAVE_ASSIGNED_STUDENTS = [];
sandbox.ALL_TEACHER_SCHEDULES = TABLES.class_schedules;

async function compileAdmin() {
  sandbox.ALL_TEACHERS = TABLES.teachers;
  sandbox.ALL_STUDENTS = TABLES.students;
  sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;
  await run('calculateMonthlySalaries(true)');
  return run('ALL_TEACHER_SALARIES');
}
function setMonth(m) {
  MONTH = m;
  sandbox.document.getElementById('salaryMonthSelect').value = m;
}
const lineOf = (fig, sid) => (fig.lines || fig.assigned_students || []).find(l => l.student_id === sid);

// ------------------------------------------------- settings gate (before load)
console.log('== settings gate: no figures before a server fetch ==');
{
  check('CourseCatalogue.fromServer exists and starts false',
    typeof sandbox.CourseCatalogue.fromServer === 'function' && sandbox.CourseCatalogue.fromServer() === false);
  const gated = run(`_teacherLiveAccrualHtml('November 2026')`);
  check('gate shows the notice line and NO figures',
    gated.figures === false && gated.html.includes('will appear here after the next system update') &&
    !gated.html.includes('earned so far'), JSON.stringify(gated).slice(0, 200));
  run('CourseCatalogue.load()');
  await tick(40);
  check('fromServer true once the stored row is fetched + applied', sandbox.CourseCatalogue.fromServer() === true);
}

// ------------------------------------------------------------ (b) consistency
console.log('== (b) Admin compile vs teacher-path compile (Nov 2026, today = 15th) ==');
let adminSlip, teacherFig;
{
  adminSlip = (await compileAdmin()).T1;
  // S1: (2200 + 400) x 2 slots = 5200; S2: (2200 + 400) x 1 = 2600.
  check('admin potential: subtotal 7800, floor tops up to base 20000',
    adminSlip.students_subtotal === 7800 && adminSlip.base_subtotal === 20000,
    `subtotal=${adminSlip.students_subtotal} base=${adminSlip.base_subtotal}`);
  check('admin accrual: grossEarned 10000 (floor-accrued), totalSlots 3, 15 of 30 days',
    adminSlip.accrual.grossEarned === 10000 && adminSlip.accrual.earnedStudents === 3900 &&
    adminSlip.accrual.totalSlots === 3 && adminSlip.accrual.daysElapsed === 15 && adminSlip.accrual.daysInMonth === 30,
    JSON.stringify(adminSlip.accrual));

  teacherFig = run(`compileOwnCurrentMonthAccrual('November 2026')`);
  check('teacher path returns figures', !!teacherFig && !!teacherFig.accrual);
  check('CONSISTENT potential: teacher baseSubtotal === admin baseSubtotal',
    teacherFig.baseSubtotal === adminSlip.base_subtotal, `${teacherFig.baseSubtotal} vs ${adminSlip.base_subtotal}`);
  check('CONSISTENT earned: teacher grossEarned === admin grossEarned (10000)',
    teacherFig.accrual.grossEarned === adminSlip.accrual.grossEarned && teacherFig.accrual.grossEarned === 10000,
    `${teacherFig.accrual.grossEarned} vs ${adminSlip.accrual.grossEarned}`);
  check('CONSISTENT slots + per-slot rate line (2 slots on the 60-min student)',
    teacherFig.accrual.totalSlots === 3 && lineOf(teacherFig, 'S1').slots === 2 &&
    teacherFig.rateLines.some(r => r.includes('PKR 2,200 / slot')), JSON.stringify(teacherFig.rateLines));

  const live = run(`_teacherLiveAccrualHtml('November 2026')`);
  check('live card renders the prominent earned figure',
    live.figures === true && live.html.includes('Your salary earned so far this month: PKR 10,000') &&
    live.html.includes('Eligible Days') && live.html.includes('15 of 30'), live.html.slice(0, 160));
}

// ------------------------------------------------- (1) Admin row + KPI display
console.log('== (1) Admin accrual sub-lines + KPI (current month only) ==');
{
  const tbodyHtml = sandbox.document.getElementById('salariesTableBody').innerHTML;
  check('row shows Earned till 15 Nov + Remaining, bound to accrual',
    tbodyHtml.includes('Earned till 15 Nov: PKR 10,000') && tbodyHtml.includes('Remaining: PKR 10,000'),
    tbodyHtml.slice(0, 300));
  check('row shows Slots + daily accrual near the teacher cell',
    tbodyHtml.includes('Slots: 3 · Daily ≈ PKR 666.67'), tbodyHtml.slice(0, 300));
  const kpi = sandbox.document.getElementById('payrollKpiEarned');
  check('KPI earned sub-line set + visible for the current month',
    kpi.innerText === 'Earned to date: 10,000 PKR' && !kpi.classList.contains('hidden'), kpi.innerText);

  setMonth('October 2026');
  await compileAdmin();
  const octHtml = sandbox.document.getElementById('salariesTableBody').innerHTML;
  check('past month: earned sub-lines gated OFF (accrual == potential is noise)',
    !octHtml.includes('Earned till'), octHtml.slice(0, 200));
  const kpiOct = sandbox.document.getElementById('payrollKpiEarned');
  check('past month: KPI earned sub-line hidden + emptied',
    kpiOct.innerText === '' && kpiOct.classList.contains('hidden'), kpiOct.innerText);
  setMonth('November 2026');
}

// ------------------------------------------------------------ (0) the stamp
console.log('== (0) consistency stamp: end -> both compiles stop; open -> stamp cleared ==');
{
  const closed = await run(`Assignments.endAssignment('S2', { last_payable_date: '2026-11-10', end_reason: 'schedule_ended', teacher_id: 'T1' })`);
  check('endAssignment on a derived-only student closes 0 ledger rows (nothing to close)', closed === 0, 'closed=' + closed);
  const s2Notes = JSON.parse(S2.notes);
  check('the stamp landed on the student record (notes.assignment_end_date)',
    s2Notes.assignment_end_date === '2026-11-10' && s2Notes.assignment_end_reason === 'schedule_ended', S2.notes);
  check('the stamp was written through the db shim (students update)',
    WRITES.some(w => w.table === 'students' && w.op === 'update' && (w.vals.notes || '').includes('assignment_end_date')));
  check('the merge preserved the existing notes (course_name intact)', s2Notes.course_name === 'Noorani Qaida');

  const afterEnd = (await compileAdmin()).T1;
  check('ADMIN compile honours the stamp: S2 pays 10/30 days (867), subtotal 6067',
    lineOf(afterEnd, 'S2').final_rate === 867 && afterEnd.students_subtotal === 6067,
    `S2=${lineOf(afterEnd, 'S2') && lineOf(afterEnd, 'S2').final_rate} subtotal=${afterEnd.students_subtotal}`);
  const teacherAfterEnd = run(`compileOwnCurrentMonthAccrual('November 2026')`);
  check('TEACHER compile honours the stamp identically (S2 867, subtotal 6067)',
    lineOf(teacherAfterEnd, 'S2').final_rate === 867 && teacherAfterEnd.studentsSubtotal === 6067,
    `S2=${lineOf(teacherAfterEnd, 'S2') && lineOf(teacherAfterEnd, 'S2').final_rate} subtotal=${teacherAfterEnd.studentsSubtotal}`);
  check('CONSISTENT earned under the stamp (both 10000, earnedStudents both 3467)',
    teacherAfterEnd.accrual.grossEarned === afterEnd.accrual.grossEarned &&
    teacherAfterEnd.accrual.earnedStudents === 3467 && afterEnd.accrual.earnedStudents === 3467,
    `t=${JSON.stringify(teacherAfterEnd.accrual)} a=${JSON.stringify(afterEnd.accrual)}`);

  const opened = await run(`Assignments.open({ student_id: 'S2', teacher_id: 'T1', course_name: 'Noorani Qaida', start_date: '2026-11-15' })`);
  check('open() creates the fresh segment', opened === true);
  const s2NotesAfter = JSON.parse(S2.notes);
  check('open() CLEARED the stamp from the student record',
    !('assignment_end_date' in s2NotesAfter) && !('assignment_end_reason' in s2NotesAfter), S2.notes);
  await run('Assignments.loadAll()');
  const afterOpen = (await compileAdmin()).T1;
  check('ADMIN compile after re-open: the real segment prices Nov 15-30 (1387)',
    lineOf(afterOpen, 'S2').final_rate === 1387, `S2=${lineOf(afterOpen, 'S2') && lineOf(afterOpen, 'S2').final_rate}`);
  const teacherAfterOpen = run(`compileOwnCurrentMonthAccrual('November 2026')`);
  check('TEACHER compile after re-open: stamp no longer bounds the derived segment (full 2600)',
    lineOf(teacherAfterOpen, 'S2').final_rate === 2600, `S2=${lineOf(teacherAfterOpen, 'S2') && lineOf(teacherAfterOpen, 'S2').final_rate}`);
}

// ------------------------------------------------------------ (c) structural
console.log('== (c) structural wiring ==');
{
  const payroll = read('js/payroll.js');
  check('engine: assignmentSegmentProration bounds by assignmentEndDate',
    seg(payroll, 'function assignmentSegmentProration', 'function teacherFloorAmount').includes('assignmentEndDate'));
  const asg = read('js/assignments.js');
  check('ledger: endAssignment stamps; open clears the stamp',
    seg(asg, 'function endAssignment', 'function transition').includes('stampStudentAssignmentEnd') &&
    seg(asg, 'function open(opts)', 'function closeCurrent').includes('clearStudentAssignmentEndStamp'));
  const cat = read('js/course-catalogue.js');
  check('catalogue: fromServer signal set only on a fetched stored row',
    cat.includes('_fromServer = true') && cat.includes('fromServer'));
  const idx = read('index.html');
  check('admin: KPI earned element exists', idx.includes('id="payrollKpiEarned"'));
  check('admin: row + KPI read compiledSlip.accrual',
    payroll.includes('payrollKpiEarned') && payroll.includes('Earned till') && payroll.includes('totalEarnedToDate'));
  const p360 = read('js/profiles360.js');
  check('360: state carries currentAccrual; tab renders Earned So Far',
    p360.includes('currentAccrual: engineFigures') &&
    seg(p360, 'function _buildTeacherSalaryDetailsTabHtml', 'function _buildTeacherStudentsListTabHtml').includes('Earned So Far'));
  const tIdx = [teacherHtml.indexOf('js/payroll.js'), teacherHtml.indexOf('js/course-catalogue.js'), teacherHtml.indexOf('js/assignments.js')];
  check('teacher.html loads payroll -> catalogue -> assignments (admin relative order)',
    tIdx[0] > 0 && tIdx[0] < tIdx[1] && tIdx[1] < tIdx[2], JSON.stringify(tIdx));
  check('teacher.html: live block gated on fromServer inside renderTeacherSalarySummary',
    seg(teacherHtml, 'function renderTeacherSalarySummary', 'function selectAdvanceType').includes('_teacherLiveAccrualHtml') &&
    seg(teacherHtml, 'function _teacherLiveAccrualHtml', '// ================= LIVE SALARY ACCRUAL — END').includes('CourseCatalogue.fromServer'));
  check('teacher.html: current-month slip suppresses the live block',
    seg(teacherHtml, 'function renderTeacherSalarySummary', 'function selectAdvanceType').includes('_hasCurrentSlip'));
}

// --------------------------------------- (0b) plain-text notes survive a stamp
console.log('== (0b) stamp merge preserves legacy free-text notes (parent-review fix) ==');
{
  await run(`(window.ALL_STUDENTS = window.ALL_STUDENTS || []).push({ id: 'S9', name: 'Stu Legacy', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-09-01', notes: 'Legacy free-text note from an old record' })`);
  const s9 = () => run(`(window.ALL_STUDENTS || []).find(s => s.id === 'S9')`);
  await run(`Assignments.endAssignment('S9', { last_payable_date: '2026-11-12', end_reason: 'schedule_ended', teacher_id: 'T1' })`);
  let parsed = null;
  try { parsed = JSON.parse(s9().notes); } catch (e) {}
  check('free-text notes survive as {text} alongside the stamp (never dropped)',
    !!parsed && parsed.text === 'Legacy free-text note from an old record' &&
    parsed.assignment_end_date === '2026-11-12' && parsed.assignment_end_reason === 'schedule_ended',
    s9() && s9().notes);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
