// Salary Commission #2 Phase 2 (2026-11-05): STOP-ACCRUAL HOOKS
// (audit §3.3 + owner decision D6 — the recorded end date is the LAST
// PAYABLE DAY, inclusive). Proves:
//  A. Assignments.endAssignment (the new ledger helper) closes only
//     the target pair's open rows, with the chosen date + reason, and
//     defaults (reason 'schedule_ended', date = today) work.
//  B. Compile contrast (Part 2B): an assignment ended on Nov 10 pays
//     exactly 10/30 of November 2026 and 0 in December, while the
//     SAME fixture without the end pays the full month — executed
//     through the REAL engine (course-catalogue + assignments +
//     payroll in a vm, the Phase 1 harness pattern).
//  C. The schedule hooks, extracted verbatim from js/schedule.js and
//     executed against the real Assignments module: the delete hook
//     ends the pair's segment only when ZERO rows remain (and
//     materialises a purely derived period first), and the Phase 1
//     re-segment hook now re-opens a fresh segment when an ended pair
//     is booked again (reactivation-after-end).
//  D. Structural: every hooked flow carries its hook; the two
//     deactivation paths (family cascade + 360 fee modal) already
//     route through the canonical config.js helper that closes the
//     assignment; plain mark-leave (js/leaves.js) contains NO
//     endAssignment call (temporary leave stays accrual-neutral);
//     js/payroll.js gained no writer.
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
const localToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// =============================================== A. endAssignment unit
console.log('== A. Assignments.endAssignment (ledger fake-db) ==');
{
  const rows = [];
  const writes = [];
  function fakeQuery() {
    const q = {
      _vals: null,
      select() { return Promise.resolve({ data: rows.slice(), error: null }); },
      insert(row) { writes.push({ op: 'insert', row }); rows.push({ ...row }); return Promise.resolve({ data: [row], error: null }); },
      update(vals) { q._vals = vals; return q; },
      eq(col, val) {
        if (q._vals) {
          writes.push({ op: 'update', vals: q._vals, col, val });
          const r = rows.find(x => x[col] === val);
          if (r) Object.assign(r, q._vals);
          return Promise.resolve({ data: [], error: null });
        }
        return q;
      }
    };
    return q;
  }
  const sb = {
    console, Promise, Date, Math, JSON, Number, String, Array, Object, parseInt, parseFloat, isNaN,
    document: { readyState: 'loading', addEventListener() {} },
    db: { from: () => fakeQuery() }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('js/assignments.js'), sb, { filename: 'js/assignments.js' });
  const A = sb.window.Assignments;

  check('Assignments exports endAssignment', !!A && typeof A.endAssignment === 'function');

  rows.push(
    { id: 'R1', student_id: 'S1', teacher_id: 'T1', course_name: 'Noorani Qaida', start_date: '2026-11-01', end_date: null, end_reason: null },
    { id: 'R2', student_id: 'S1', teacher_id: 'T2', course_name: 'Noorani Qaida', start_date: '2026-11-01', end_date: null, end_reason: null },
    { id: 'R3', student_id: 'S2', teacher_id: 'T1', course_name: 'Noorani Qaida', start_date: '2026-11-01', end_date: null, end_reason: null }
  );
  await A.loadAll();

  const closedScoped = await A.endAssignment('S1', { last_payable_date: '2026-11-10', end_reason: 'schedule_ended', teacher_id: 'T1' });
  const r1 = rows.find(r => r.id === 'R1'), r2 = rows.find(r => r.id === 'R2'), r3 = rows.find(r => r.id === 'R3');
  check('scoped end closes exactly 1 row', closedScoped === 1, 'got ' + closedScoped);
  check('the chosen last payable day + reason are written (D6)',
    r1.end_date === '2026-11-10' && r1.end_reason === 'schedule_ended', JSON.stringify(r1));
  check('the update write carries {end_date, end_reason} for that row id only',
    writes.filter(w => w.op === 'update').length === 1 && writes[0].val === 'R1' &&
    writes[0].vals.end_date === '2026-11-10' && writes[0].vals.end_reason === 'schedule_ended',
    JSON.stringify(writes));
  check("the same student's OTHER teacher row stays open", !r2.end_date);
  check("another student's row is untouched", !r3.end_date);

  const closedDefault = await A.endAssignment('S1', { teacher_id: 'T2' });
  check("defaults: reason 'schedule_ended', date = today",
    closedDefault === 1 && r2.end_date === localToday() && r2.end_reason === 'schedule_ended',
    JSON.stringify(r2) + ' today=' + localToday());

  const closedUnscoped = await A.endAssignment('S2', { last_payable_date: '2026-11-20', end_reason: 'leave_removed' });
  check('unscoped end (no teacher_id) closes the student\'s open rows via closeCurrent semantics',
    closedUnscoped === 1 && r3.end_date === '2026-11-20' && r3.end_reason === 'leave_removed',
    JSON.stringify(r3));

  const writesBefore = writes.length;
  const closedNone = await A.endAssignment('S2', { last_payable_date: '2026-11-21', end_reason: 'schedule_ended', teacher_id: 'T1' });
  check('ending an already-ended pair is a no-op (0 rows, no new writes)',
    closedNone === 0 && writes.length === writesBefore);
}

// =============================================== B. compile contrast
console.log('== B. compile contrast: ended Nov 10 vs never ended (real engine) ==');
{
  let FAKE_NOW = '2026-11-30T12:00:00';
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
        _set: new Set(id === 'payrollWarnings' ? ['hidden'] : []),
        add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
        toggle(c, force) { if (force === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      }
    };
  }
  const elements = {};
  const store = new Map();
  const TABLES = { teachers: [], students: [], class_schedules: [], courses: [], student_assignments: [] };
  const dbStub = {
    from(table) {
      return {
        select() {
          const p = Promise.resolve({ data: TABLES[table] || [], error: null });
          p.order = () => p;
          return p;
        },
        insert() { return Promise.resolve({ data: null, error: null }); },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        update() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; }
      };
    }
  };
  const sb = {
    console, Set, Map, Promise, Date: FakeDate, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
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
    db: dbStub,
    getTeacherAccounts() { return {}; },
    lmsNotify() {},
    lmsConfirm() { return Promise.resolve(true); },
    openModal() {}, closeModal() {},
    StaffCategories: { of(t) { return (t && t.__cat) || 'teaching'; } }
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(`
    var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [], ALL_ASSIGNMENTS = [];
    let ALL_TEACHER_SALARIES = {};
    var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
  `, sb, { filename: 'prelude.js' });
  for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js']) {
    vm.runInContext(read(f), sb, { filename: f });
  }
  const run = (code) => vm.runInContext(code, sb);

  const notes = (course_name) => JSON.stringify({ course_name });
  TABLES.teachers = [{ id: 'TEX', full_name: 'Teacher EX', phone: '0300', status: 'Active', created_at: '2026-06-01T00:00:00', __cat: 'other_staff' }];
  TABLES.students = [{ id: 'SX', name: 'Stu SX', status: 'Active', assigned_teacher_id: 'TEX', joining_date: '2026-09-01', notes: notes('Noorani Qaida') }];
  TABLES.class_schedules = [{ id: 'SCHX', teacher_id: 'TEX', student_id: 'SX', day_of_week: 2, start_time: '10:00', end_time: '10:30', duration_mins: 30 }];
  const openRow = () => ({ id: 'ASG-X', student_id: 'SX', teacher_id: 'TEX', course_name: 'Noorani Qaida', start_date: '2026-11-01', end_date: null, end_reason: null });
  async function compile() {
    sb.ALL_TEACHERS = TABLES.teachers;
    sb.ALL_STUDENTS = TABLES.students;
    sb.ALL_CLASS_SCHEDULES = TABLES.class_schedules;
    await run('calculateMonthlySalaries(true)');
    return run('ALL_TEACHER_SALARIES');
  }
  const lineOf = (slip, sid) => (slip.assigned_students || []).find(l => l.student_id === sid);
  function setMonth(m, now) {
    MONTH = m;
    sb.document.getElementById('salaryMonthSelect').value = m;
    FAKE_NOW = now;
  }

  // End the assignment through the REAL helper, exactly as the new
  // hooks do, then compile.
  TABLES.student_assignments = [openRow()];
  await run('Assignments.loadAll()');
  const closed = await run(`Assignments.endAssignment('SX', { last_payable_date: '2026-11-10', end_reason: 'schedule_ended', teacher_id: 'TEX' })`);
  check('endAssignment closed the fixture segment', closed === 1 && TABLES.student_assignments[0].end_date === '2026-11-10');

  setMonth('November 2026', '2026-11-30T12:00:00');
  let slips = await compile();
  const endedLine = lineOf(slips.TEX, 'SX');
  check('Part 2B: ended Nov 10 -> November pays exactly 10/30 of 2200 = 733',
    !!endedLine && endedLine.active_days === 10 && endedLine.final_rate === 733 && slips.TEX.students_subtotal === 733,
    JSON.stringify(endedLine || null));

  setMonth('December 2026', '2026-12-31T12:00:00');
  slips = await compile();
  check('Part 2B: December pays 0 for the ended segment (no line, subtotal 0)',
    !lineOf(slips.TEX, 'SX') && slips.TEX.students_subtotal === 0,
    JSON.stringify(slips.TEX && slips.TEX.students_subtotal));

  // Control: the SAME fixture without the end pays the full month.
  TABLES.student_assignments = [openRow()];
  setMonth('November 2026', '2026-11-30T12:00:00');
  slips = await compile();
  const openLine = lineOf(slips.TEX, 'SX');
  check('contrast: without the end, November pays the full 2200 (30 active days)',
    !!openLine && openLine.active_days === 30 && openLine.final_rate === 2200 && slips.TEX.students_subtotal === 2200,
    JSON.stringify(openLine || null));
  setMonth('December 2026', '2026-12-31T12:00:00');
  slips = await compile();
  check('contrast: without the end, December also pays the full 2200',
    !!lineOf(slips.TEX, 'SX') && slips.TEX.students_subtotal === 2200);
}

// =============================================== C. schedule hooks, executed
console.log('== C. schedule hooks executed (extracted verbatim from js/schedule.js) ==');
{
  const schedSrc = read('js/schedule.js');
  const hStart = schedSrc.indexOf('function maybeReSegmentAssignmentSlots(');
  const hEnd = schedSrc.indexOf('function refreshOpen360ViewsAfterTeacherShift', hStart);
  check('hook region located in js/schedule.js', hStart > 0 && hEnd > hStart);
  const hookSrc = schedSrc.slice(hStart, hEnd);
  check('hook region contains BOTH hooks', hookSrc.includes('function maybeEndAssignmentAfterScheduleDelete('));

  let ASG_SEED = [];
  let SCHED_REMAINING = [];
  const notifies = [];
  const fakeDb = {
    from(table) {
      if (table === 'student_assignments') {
        return {
          select() { return Promise.resolve({ data: ASG_SEED.slice(), error: null }); },
          insert(row) { ASG_SEED.push({ ...row }); return Promise.resolve({ data: [row], error: null }); },
          update(vals) {
            return { eq(col, val) { const r = ASG_SEED.find(x => x[col] === val); if (r) Object.assign(r, vals); return Promise.resolve({ data: [], error: null }); } };
          },
          upsert() { return Promise.resolve({ data: null, error: null }); }
        };
      }
      const q = {
        _rows: SCHED_REMAINING.slice(),
        select() { return q; },
        eq(col, val) { q._rows = q._rows.filter(r => String(r[col]) === String(val)); return q; },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        then(res, rej) { return Promise.resolve({ data: q._rows, error: null }).then(res, rej); }
      };
      return q;
    }
  };
  function makeElement(id) {
    return {
      id, innerHTML: '', innerText: '', value: '',
      appendChild() {}, remove() {}, setAttribute() {}, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    };
  }
  const elements = {};
  const store = new Map();
  const sb = {
    console, Set, Map, Promise, Date, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, parseInt, parseFloat, isNaN,
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
    db: fakeDb,
    getTeacherAccounts() { return {}; },
    lmsNotify(msg, opts) { notifies.push([msg, opts]); },
    lmsConfirm() { return Promise.resolve(true); },
    openModal() {}, closeModal() {},
    StaffCategories: { of(t) { return (t && t.__cat) || 'teaching'; } }
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(`
    var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [], ALL_ASSIGNMENTS = [];
    let ALL_TEACHER_SALARIES = {};
    var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
  `, sb, { filename: 'prelude.js' });
  vm.runInContext(read('js/assignments.js'), sb, { filename: 'js/assignments.js' });
  vm.runInContext(read('js/payroll.js'), sb, { filename: 'js/payroll.js' });
  vm.runInContext(hookSrc + '\n;window.__reseg = maybeReSegmentAssignmentSlots; window.__delhook = maybeEndAssignmentAfterScheduleDelete;', sb, { filename: 'schedule-hooks.js' });
  const reseg = sb.__reseg;
  const delhook = sb.__delhook;
  check('both hooks extracted + callable', typeof reseg === 'function' && typeof delhook === 'function');

  const A = sb.window.Assignments;
  const calls = { open: [], end: [], transition: [] };
  for (const m of ['open', 'transition']) {
    const orig = A[m].bind(A);
    A[m] = (...args) => { calls[m].push(args); return orig(...args); };
  }
  const origEnd = A.endAssignment.bind(A);
  A.endAssignment = (...args) => { calls.end.push(args); return origEnd(...args); };

  const notes = (course_name) => JSON.stringify({ course_name });
  const STU = (id, teacher_id, extra = {}) => ({ id, name: 'Stu ' + id, status: 'Active', assigned_teacher_id: teacher_id, joining_date: '2026-09-01', notes: notes('Noorani Qaida'), ...extra });
  const ROW30 = { day_of_week: 2, start_time: '10:00', end_time: '10:30' };
  const ROW60 = { day_of_week: 2, start_time: '10:00', end_time: '11:00' };
  async function seed({ asg = [], schedRemaining = [], students = [] }) {
    ASG_SEED = asg;
    SCHED_REMAINING = schedRemaining;
    sb.ALL_STUDENTS = students;
    calls.open.length = 0; calls.end.length = 0; calls.transition.length = 0;
    notifies.length = 0;
    await A.loadAll();
  }

  // -- re-open (deliverable 4) --
  await seed({
    asg: [{ id: 'OLD1', student_id: 'S1', teacher_id: 'TOLD', course_name: 'Noorani Qaida', start_date: '2026-09-01', end_date: '2026-11-10', end_reason: 'schedule_ended' }],
    students: [STU('S1', 'T2')]
  });
  reseg('S1', 'T2', [], [ROW30]);
  await tick();
  check('re-open: an ended pair booked again opens a fresh segment from today (slots 1, this teacher)',
    calls.open.length === 1 && calls.open[0][0].teacher_id === 'T2' && calls.open[0][0].slots === 1 &&
    calls.open[0][0].start_date === A.todayStr() && calls.transition.length === 0,
    JSON.stringify(calls.open.map(a => a[0])));

  await seed({
    asg: [{ id: 'OLD2', student_id: 'S2', teacher_id: 'TOLD', course_name: 'Noorani Qaida', start_date: '2026-09-01', end_date: '2026-11-10', end_reason: 'deactivated' }],
    students: [STU('S2', 'T2', { status: 'Inactive', deactivation_date: '2026-11-10' })]
  });
  reseg('S2', 'T2', [], [ROW30]);
  await tick();
  check('re-open: a DEACTIVATED student is never re-opened by a schedule save',
    calls.open.length === 0 && calls.transition.length === 0);

  await seed({
    asg: [{ id: 'OLD3', student_id: 'S3', teacher_id: 'TOLD', course_name: 'Noorani Qaida', start_date: '2026-09-01', end_date: '2026-11-10', end_reason: 'schedule_ended' }],
    students: [STU('S3', 'T2')]
  });
  reseg('S3', 'T2', [ROW30], []);
  await tick();
  check('re-open: a save that leaves NO rows for the teacher opens nothing',
    calls.open.length === 0 && calls.transition.length === 0);

  await seed({ asg: [], students: [STU('S4', 'T2')] });
  reseg('S4', 'T2', [ROW30], [ROW30]);
  await tick();
  check('unchanged derived student (Phase 1 behaviour preserved): no writes when slots do not change',
    calls.open.length === 0 && calls.transition.length === 0);

  await seed({
    asg: [{ id: 'OP5', student_id: 'S5', teacher_id: 'T2', course_name: 'Noorani Qaida', slots: 1, start_date: '2026-11-01', end_date: null, end_reason: null }],
    students: [STU('S5', 'T2')]
  });
  reseg('S5', 'T2', [ROW30], [ROW30]);
  await tick();
  check('open segment + unchanged slots: no writes',
    calls.open.length === 0 && calls.transition.length === 0);

  // -- delete hook (deliverable 3) --
  await seed({
    asg: [{ id: 'OP6', student_id: 'S6', teacher_id: 'T6', course_name: 'Noorani Qaida', start_date: '2026-11-01', end_date: null, end_reason: null }],
    schedRemaining: [],
    students: [STU('S6', 'T6')]
  });
  delhook('S6', 'T6', [ROW30]);
  await tick();
  const r6 = ASG_SEED.find(r => r.id === 'OP6');
  check('delete hook: last row deleted -> segment ended today as schedule_ended + admin notified',
    calls.end.length === 1 && calls.end[0][1].end_reason === 'schedule_ended' && calls.end[0][1].teacher_id === 'T6' &&
    r6.end_date === localToday() && r6.end_reason === 'schedule_ended' &&
    notifies.some(n => /Salary assignment ended for Stu S6/.test(n[0])),
    JSON.stringify({ end: calls.end, r6, notifies }));

  await seed({
    asg: [{ id: 'OP7', student_id: 'S7', teacher_id: 'T7', course_name: 'Noorani Qaida', start_date: '2026-11-01', end_date: null, end_reason: null }],
    schedRemaining: [{ id: 'LEFT1', student_id: 'S7', teacher_id: 'T7', day_of_week: 3, start_time: '10:00', end_time: '10:30' }],
    students: [STU('S7', 'T7')]
  });
  delhook('S7', 'T7', [ROW30, ROW30]);
  await tick();
  check('delete hook: deleting ONE of several rows closes nothing',
    calls.end.length === 0 && !ASG_SEED.find(r => r.id === 'OP7').end_date && notifies.length === 0);

  await seed({ asg: [], schedRemaining: [], students: [STU('S8', 'T8')] });
  delhook('S8', 'T8', [ROW60]);
  await tick();
  const r8 = ASG_SEED.find(r => r.student_id === 'S8');
  check('delete hook: purely derived student is materialised (joining-date start, clock slots 2) and then ended',
    calls.open.length === 1 && calls.open[0][0].start_date === '2026-09-01' && calls.open[0][0].slots === 2 &&
    calls.end.length === 1 && !!r8 && r8.end_date === localToday() && r8.end_reason === 'schedule_ended',
    JSON.stringify({ open: calls.open.map(a => a[0]), r8 }));

  await seed({
    asg: [{ id: 'OLD9', student_id: 'S9', teacher_id: 'T9', course_name: 'Noorani Qaida', start_date: '2026-09-01', end_date: '2026-11-01', end_reason: 'schedule_ended' }],
    schedRemaining: [],
    students: [STU('S9', 'T9')]
  });
  delhook('S9', 'T9', [ROW30]);
  await tick();
  check('delete hook: real history but nothing open for the pair -> nothing happens',
    calls.end.length === 0 && calls.open.length === 0 && notifies.length === 0);
}

// =============================================== D. structural
console.log('== D. structural: hooks wired, deactivation paths proven, leave untouched ==');
{
  const asg = read('js/assignments.js');
  check('assignments.js: endAssignment exists, defaults wired, exported',
    asg.includes('function endAssignment(studentId, opts)') &&
    asg.includes("opts.end_reason || 'schedule_ended'") &&
    asg.includes('endAssignment: endAssignment,'));
  check('assignments.js: closeCurrent itself is untouched (original signature + body markers)',
    asg.includes('function closeCurrent(studentId, opts)') &&
    asg.includes("var end = opts.end_date || todayStr();") &&
    asg.includes("r.end_reason = opts.end_reason || 'closed'"));

  const sched = read('js/schedule.js');
  check('schedule.js: delete-single-day flow calls the end hook',
    seg(sched, 'async function executeDeleteSingleDayClass()', 'async function executeDeleteAllClassesForStudent()').includes('maybeEndAssignmentAfterScheduleDelete('));
  check('schedule.js: delete-all flow calls the end hook',
    seg(sched, 'async function executeDeleteAllClassesForStudent()', 'async function handleDeleteSlot(').includes('maybeEndAssignmentAfterScheduleDelete('));
  const delHookSeg = seg(sched, 'function maybeEndAssignmentAfterScheduleDelete(', 'function refreshOpen360ViewsAfterTeacherShift');
  check("schedule.js: the delete hook ends via endAssignment with 'schedule_ended' and notifies",
    delHookSeg.includes('Assignments.endAssignment(') && delHookSeg.includes("end_reason: 'schedule_ended'") &&
    delHookSeg.includes('no scheduled classes remain'));
  check('schedule.js: the Phase 1 hook carries the reactivation-after-end re-open branch',
    seg(sched, 'function maybeReSegmentAssignmentSlots(', 'function maybeEndAssignmentAfterScheduleDelete(').includes('reactivation-after-end'));

  const p360 = read('js/profiles360.js');
  check('360: open-assignment helper + modal + execute exist',
    p360.includes('function _studentOpenAssignmentInfo360(') &&
    p360.includes('function openEndSalaryAssignmentModal(') &&
    p360.includes('function executeEndSalaryAssignment('));
  check('360: the confirm calls Assignments.endAssignment with the picker values',
    seg(p360, 'async function executeEndSalaryAssignment(', 'async function executeConfirmSingleStudentDeactivation(')
      .includes('Assignments.endAssignment(student.id, {') &&
    seg(p360, 'async function executeEndSalaryAssignment(', 'async function executeConfirmSingleStudentDeactivation(')
      .includes('last_payable_date: lastPayable'));
  check('360: modal carries the D6 picker (Last payable day), both reasons, and the not-changed note',
    p360.includes('Last payable day') &&
    p360.includes('<option value="schedule_ended">Schedule ended</option>') &&
    p360.includes('<option value="leave_removed">Student on leave — removed from schedule</option>') &&
    p360.includes('Classes/schedule are NOT changed by this action.'));
  check('360: the row action renders only while an assignment is open',
    p360.includes('openAsgInfo.open && !isDeactivated') &&
    p360.includes("openEndSalaryAssignmentModal('${_esc360(family.id)}', '${_esc360(stu.id)}')"));

  const cfg = read('js/config.js');
  check('canonical deactivation helper closes the assignment (config.js)',
    cfg.includes("Assignments.closeCurrent(studentId, { end_date:") && cfg.includes("end_reason: 'deactivated'"));
  check('6d PROOF: the 360 fee-modal confirm routes through the canonical helper (already hooked)',
    p360.includes('await deactivateStudentScheduleAndTeacherBackend(student.id, stuMeta)'));
  check('6c PROOF: the family cascade routes EVERY student through the canonical helper (already hooked)',
    p360.includes('await deactivateStudentScheduleAndTeacherBackend(stu.id, stuMeta)'));

  const leaves = read('js/leaves.js');
  check('5 PROOF: js/leaves.js contains NO endAssignment call and NO schedule deletion (plain leave stays accrual-neutral)',
    !leaves.includes('endAssignment') && !leaves.includes("class_schedules').delete") &&
    !seg(leaves, 'async function handleSaveStudentLeave(e)', 'async function loadLeaveManagementData()').includes('class_schedules'));

  const payroll = read('js/payroll.js');
  check('payroll.js gained no writer: endAssignment is not called from the engine',
    !payroll.includes('endAssignment'));
  check('the ONLY endAssignment call sites are the schedule hooks and the 360 action',
    ['js/schedule.js', 'js/profiles360.js'].every(f => read(f).includes('Assignments.endAssignment(')) &&
    !read('js/families.js').includes('Assignments.endAssignment(') &&
    !read('js/config.js').includes('Assignments.endAssignment('));
}

console.log(`\nSALARY STOP-ACCRUAL SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
