// Phase 3 (2026-11-03): Teacher 360 salary convergence.
// Executes the REAL course-catalogue + assignments + payroll +
// profiles360 modules in one vm and proves the 360 salary view now
// shows the payroll engine's numbers (not its old divergent second
// calculation), and that the salary history contains only real saved
// slips plus the live current cycle — no fabricated 'Paid' months.
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

function makeElement(id) {
  return {
    id, innerHTML: '', innerText: '', value: id === 'salaryMonthSelect' ? 'October 2026' : '',
    appendChild() {}, remove() {}, setAttribute() {}, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
}
const elements = {};
const store = new Map();
const TABLES = { teachers: [], students: [], class_schedules: [], student_assignments: [] };
const dbStub = {
  from(table) {
    return {
      select() { const p = Promise.resolve({ data: TABLES[table] || [], error: null }); p.order = () => p; return p; },
      insert() { return Promise.resolve({ data: null, error: null }); },
      upsert() { return Promise.resolve({ data: null, error: null }); },
      update() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; },
      delete() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; }
    };
  }
};
const sandbox = {
  console, Set, Map, Promise, Date, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
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
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(`
  var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [];
  let ALL_TEACHER_SALARIES = {};
  var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
`, sandbox, { filename: 'prelude.js' });
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js', 'js/profiles360.js']) {
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), sandbox, { filename: f });
}

// ------------------------------------------------------------ fixtures
const notes = (course_name) => JSON.stringify({ course_name });
const T1 = { id: 'T1', full_name: 'Teacher One', phone: '0300', status: 'Active', created_at: '2026-06-01T00:00:00' };
TABLES.teachers = [T1];
TABLES.students = [
  { id: 'S1', name: 'Stu Qaida', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-09-01', notes: notes('Noorani Qaida') },
  { id: 'S5', name: 'Stu Weekend', status: 'Active', assigned_teacher_id: 'T1', joining_date: '2026-08-01', notes: notes('Noorani Qaida') }
];
TABLES.class_schedules = [
  { id: 'SCH5A', teacher_id: 'T1', student_id: 'S5', day_of_week: 6 },
  { id: 'SCH5B', teacher_id: 'T1', student_id: 'S5', day_of_week: 7 }
];
sandbox.ALL_TEACHERS = TABLES.teachers;
sandbox.ALL_STUDENTS = TABLES.students;
sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;

// One REAL saved slip: September 2026, Paid, 2200.
store.set('alhuda_teacher_salaries', JSON.stringify({
  'T1_September_2026': {
    teacher_id: 'T1', month: 'September 2026',
    students: { S1: 2200 },
    student_items_snapshot: [{ student_id: 'S1', student_name: 'Stu Qaida', course_label: 'Noorani Qaida', final_rate: 2200 }],
    base_subtotal: 2200, bonus: 0, deduction: 0, advance_deducted: 0,
    net_payable: 2200, status: 'Paid', saved_at: '2026-09-25T00:00:00.000Z'
  }
}));

const run = (code) => vm.runInContext(code, sandbox);

console.log('== structural: the divergent engine is gone ==');
{
  const p360 = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');
  const payroll = fs.readFileSync(path.join(REPO_ROOT, 'js/payroll.js'), 'utf8');
  check('no fabricated knownMonths list in profiles360', !p360.includes('knownMonths'));
  check('profiles360 no longer calls the legacy rate function', !p360.includes('getStudentCourseSalaryRate'));
  check('payroll no longer defines the legacy rate function', !payroll.includes('getStudentCourseSalaryRate'));
  check('payroll no longer fetches the dead courses cache', !payroll.includes('ALL_COURSES_CACHE'));
  check('360 salary adjustments no longer invent a 2500 base', !p360.includes('base_subtotal: Number(teacher.rate_per_slot || meta.salary || 2500)') && !p360.includes('(parseFloat(existingSlip.base_subtotal) || 2500)') && !p360.includes('(parseFloat(savedSalaries[slipKey].base_subtotal) || 2500)'));
  const sched = fs.readFileSync(path.join(REPO_ROOT, 'js/schedule.js'), 'utf8');
  const trials = fs.readFileSync(path.join(REPO_ROOT, 'js/trials.js'), 'utf8');
  check('schedule booking writes course_name', /course_name: _schedCourseName/.test(sched));
  check('trial + conversion schedule rows write course_name', (trials.match(/course_name:/g) || []).length >= 2);
}

console.log('== convergence: helper path (compile not run yet) ==');
{
  const state = run(`_compileTeacher360AggregatedState(ALL_TEACHERS[0], ALL_CLASS_SCHEDULES, [])`);
  check('360 base = engine subtotal 2200 + weekend 3200 = 5400', state.currentBaseSubtotal === 5400);
  check('360 protection = 20000 - 5400 = 14600', state.currentBasicProtection === 14600);
  check('360 net = floor 20000 (same as the payroll engine)', state.currentNetSalary === 20000);
  check('breakdown has the 2 engine lines', state.studentRateBreakdown.length === 2);
  const months = state.salaryRows.map(r => r.monthRaw);
  check('history = September (real) + October (live cycle) only', months.length === 2 && months.includes('September 2026') && months.includes('October 2026'));
  const sept = state.salaryRows.find(r => r.monthRaw === 'September 2026');
  check('September row is the real slip: 2200 Paid', sept && sept.paidAmount === 2200 && sept.status === 'Paid' && sept.studentsCount === 1);
  const oct = state.salaryRows.find(r => r.monthRaw === 'October 2026');
  check('October row is the live cycle: 20000 Pending', oct && oct.paidAmount === 20000 && oct.status === 'Pending');
  check('no fabricated Paid months (Oct 2025 etc.)', !state.salaryRows.some(r => r.monthRaw !== 'September 2026' && r.monthRaw !== 'October 2026'));
}

console.log('== convergence: compiled-slip path ==');
{
  await run('calculateMonthlySalaries(true)');
  const compiled = run('ALL_TEACHER_SALARIES["T1"]');
  check('payroll compile net for T1 = 20000', compiled && compiled.net_payable === 20000);
  const state = run(`_compileTeacher360AggregatedState(ALL_TEACHERS[0], ALL_CLASS_SCHEDULES, [])`);
  check('360 net equals the compiled slip net exactly', state.currentNetSalary === compiled.net_payable);
  check('360 base equals the compiled students subtotal', state.currentBaseSubtotal === compiled.students_subtotal);
}

console.log(`\nPROFILES360 CONVERGENCE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
