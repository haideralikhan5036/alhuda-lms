// Phase 2 PR-B (2026-11-03): the payroll compile is driven by the
// assignment ledger and the Course Payment Settings catalogue.
// Executes the REAL js/course-catalogue.js, js/assignments.js and
// js/payroll.js in a vm against fixture data and checks the money:
// catalogue rates, mid-month transfer split, weekend programme rate,
// pre-flight exclusion (no silent default), the prorated Basic Salary
// floor, freeze-on-first-save, and the Recalculate escape hatch.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// ---------------------------------------------------------------- fakes
function makeElement(id) {
  return {
    id, innerHTML: '', innerText: '', value: id === 'salaryMonthSelect' ? 'October 2026' : '',
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

const sandbox = {
  console, Set, Map, Promise, Date, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent,
  document: {
    readyState: 'loading',
    getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return makeElement('x'); }
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
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const prelude = `
  var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [];
  let ALL_TEACHER_SALARIES = {};
  var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
  window.ALL_COURSES_CACHE = [{}];
`;
vm.runInContext(prelude, sandbox, { filename: 'prelude.js' });
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js']) {
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), sandbox, { filename: f });
}

// ------------------------------------------------------------ fixtures
const T = (id) => ({ id, full_name: 'Teacher ' + id, phone: '0300', status: 'Active', created_at: '2026-06-01T00:00:00' });
const notes = (course_name) => JSON.stringify({ course_name });
TABLES.teachers = [T('T1'), T('T2'), T('T3')];
TABLES.students = [
  { id: 'S1', name: 'Stu Qaida', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-09-01', notes: notes('Noorani Qaida') },
  { id: 'S2', name: 'Stu Transfer', status: 'Active', assigned_teacher_id: 'T2', joining_date: '2026-08-01', notes: notes('Quran Reading with Tajweed') },
  { id: 'S3', name: 'Stu Islamic', status: 'Active', assigned_teacher_id: 'T2', joining_date: '2026-08-01', notes: notes('Islamic Studies & Tarbiyah') },
  { id: 'S4', name: 'Stu Unknown', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-08-01', notes: notes('Rocket Science') },
  { id: 'S5', name: 'Stu Weekend', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-08-01', notes: notes('Noorani Qaida') }
];
TABLES.class_schedules = [
  { id: 'SCH5A', teacher_id: 'T1', student_id: 'S5', day_of_week: 6 },
  { id: 'SCH5B', teacher_id: 'T1', student_id: 'S5', day_of_week: 7 }
];
TABLES.student_assignments = [
  { id: 'A1', student_id: 'S2', teacher_id: 'T1', course_name: 'Quran Reading with Tajweed', start_date: '2026-10-01', end_date: '2026-10-10', end_reason: 'transferred' },
  { id: 'A2', student_id: 'S2', teacher_id: 'T2', course_name: 'Quran Reading with Tajweed', start_date: '2026-10-11', end_date: null, end_reason: null }
];
sandbox.ALL_TEACHERS = TABLES.teachers;
sandbox.ALL_STUDENTS = TABLES.students;
sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;

const run = (code) => vm.runInContext(code, sandbox);
async function compile() {
  await run('calculateMonthlySalaries(true)');
  return run('ALL_TEACHER_SALARIES');
}

// ------------------------------------------------------------- units
console.log('== rate resolution (real catalogue + payroll helpers) ==');
{
  const settings = run('payrollSettings()');
  check('settings carry the owner floor 20000 + weekend 3200', settings.basic_salary_pkr === 20000 && settings.weekend_rate === 3200);
  const wkIslamic = run(`resolveAssignmentRate({ course_name: 'Islamic Studies & Tarbiyah' }, { notes: '' }, [{ day_of_week: 6 }, { day_of_week: 7 }], payrollSettings())`);
  check('weekend does NOT override Islamic Studies (legacy precedence)', wkIslamic.ok && wkIslamic.baseRate === 3500);
  const wkQaida = run(`resolveAssignmentRate({ course_name: 'Noorani Qaida' }, { notes: '' }, [{ day_of_week: 6 }, { day_of_week: 7 }], payrollSettings())`);
  check('weekend-only Qaida pays the weekend programme rate 3200', wkQaida.ok && wkQaida.baseRate === 3200 && wkQaida.isWeekend === true);
  const unknown = run(`resolveAssignmentRate({ course_name: 'Rocket Science' }, { notes: '' }, [], payrollSettings())`);
  check('unknown course is NOT priced (no silent default)', unknown.ok === false && /not in the Course Payment Settings/.test(unknown.reason));
  const tajweed = run(`resolveAssignmentRate({ course_name: 'Tajweed' }, { notes: '' }, [], payrollSettings())`);
  check('Tajweed alias resolves to the owner-set 2500', tajweed.ok && tajweed.baseRate === 2500);
}

console.log('== segment proration ==');
{
  const seg = run(`assignmentSegmentProration({ status: 'Active', joining_date: '2026-08-01', notes: '' }, { start_date: '2026-10-11', end_date: null }, 2200, 'October 2026')`);
  check('Oct 11..31 = 21 days, 2200 x 21/31 = 1490', seg.activeDays === 21 && seg.proratedRate === 1490);
  const full = run(`assignmentSegmentProration({ status: 'Active', joining_date: '2026-08-01', notes: '' }, { start_date: '2026-08-01', end_date: null }, 2200, 'October 2026')`);
  check('full-month segment pays the full rate', full.activeDays === 31 && full.proratedRate === 2200 && full.isProrated === false);
}

console.log('== prorated floor (owner decision 2026-11-03) ==');
{
  const bounds = run(`parsePayrollMonthBounds('October 2026')`);
  const full = run(`teacherFloorAmount({ status: 'Active', created_at: '2026-06-01' }, {}, payrollSettings(), parsePayrollMonthBounds('October 2026'), null)`);
  check('full-month teacher floor = 20000', full.floorAmount === 20000 && full.eligibleDays === 31);
  const joined = run(`teacherFloorAmount({ status: 'Active', created_at: '2026-06-01' }, { joining_date: '2026-10-11' }, payrollSettings(), parsePayrollMonthBounds('October 2026'), null)`);
  check('joined Oct 11 floor prorates to 20000 x 21/31 = 13548', joined.floorAmount === 13548 && joined.eligibleDays === 21);
  const left = run(`teacherFloorAmount({ status: 'Deactivated', created_at: '2026-06-01' }, {}, payrollSettings(), parsePayrollMonthBounds('October 2026'), '2026-10-20')`);
  check('left after Oct 20 floor prorates to 20000 x 20/31 = 12903', left.floorAmount === 12903 && left.eligibleDays === 20);
  const gone = run(`teacherFloorAmount({ status: 'Deactivated', created_at: '2026-06-01' }, {}, payrollSettings(), parsePayrollMonthBounds('October 2026'), null)`);
  check('deactivated teacher with no payable day gets no floor', gone.floorAmount === 0);
}

// ------------------------------------------------------------ compile
console.log('== compile: October 2026 ==');
const slips = await compile();
{
  const t1 = slips['T1'], t2 = slips['T2'], t3 = slips['T3'];
  check('T1 lines: Qaida 2200 + transfer segment 710 + weekend 3200 = 6110',
    t1 && t1.students_subtotal === 6110 && t1.assigned_students.length === 3);
  check('T1 floor tops 6110 up to 20000 (protection 13890)',
    t1.basic_protection === 13890 && t1.base_subtotal === 20000 && t1.net_payable === 20000 && t1.floor_amount === 20000);
  check('transfer split: T2 segment pays 1490 for Oct 11..31',
    t2 && t2.assigned_students.some(l => l.student_id === 'S2' && l.final_rate === 1490));
  check('T2 subtotal 1490 + Islamic 3500 = 4990, floored to 20000',
    t2.students_subtotal === 4990 && t2.net_payable === 20000);
  check('T3 (no students, active) is guaranteed the floor: net 20000',
    t3 && t3.students_subtotal === 0 && t3.basic_protection === 20000 && t3.net_payable === 20000);
  const warnHtml = elements['payrollWarnings'].innerHTML;
  check('pre-flight warning names the unpriced student + course',
    /Stu Unknown/.test(warnHtml) && /Rocket Science/.test(warnHtml) && !elements['payrollWarnings'].classList.contains('hidden'));
  check('salaries table shows the Basic Salary Protection line',
    /Basic Salary Protection/.test(elements['salariesTableBody'].innerHTML));
}

console.log('== freeze on first save (Pending slip with snapshot) ==');
{
  store.set('alhuda_teacher_salaries', JSON.stringify({
    'T3_October_2026': {
      teacher_id: 'T3', month: 'October 2026', students: { SX: 5000 },
      student_items_snapshot: [{ student_id: 'SX', student_name: 'Frozen Stu', course_label: 'Noorani Qaida', final_rate: 5000, base_rate: 2200, increment: 0, full_monthly_rate: 2200, calculated_rate: 5000 }],
      base_subtotal: 5000, bonus: 0, deduction: 0, advance_deducted: 0,
      net_payable: 5000, status: 'Pending', saved_at: '2026-10-15T00:00:00.000Z'
    }
  }));
  const frozen = await compile();
  const t3 = frozen['T3'];
  check('saved Pending slip is FROZEN at 5000 (floor does not rewrite it)',
    t3 && t3.frozen === true && t3.base_subtotal === 5000 && t3.net_payable === 5000);
  check('frozen slip keeps its real status Pending (not forced Paid)', t3.status === 'Pending');

  console.log('== Recalculate escape hatch ==');
  run('window.__PAYROLL_RECALC_KEYS = new Set(["T3_October_2026"])');
  const recalced = await compile();
  const t3b = recalced['T3'];
  check('Recalculate recompiles live: T3 back to the 20000 floor',
    t3b && t3b.frozen === false && t3b.net_payable === 20000);
}

console.log(`\nPAYROLL ENGINE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
