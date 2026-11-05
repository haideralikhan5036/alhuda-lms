// Manager Profile Redesign, Stage 2 Phase 1 (2026-11-05): FIXED
// SALARY for non-teaching staff. Executes the REAL FixedSalary region
// of js/config.js (extracted verbatim, the employees-categories
// pattern), js/course-catalogue.js, js/assignments.js and
// js/payroll.js in a vm against fixture data and proves:
//  - the resolver rule: the dated history in force for a month wins;
//    NO history at all -> the legacy monthly_salary mirror applies to
//    every month; WITH a history, a month BEFORE the first entry
//    resolves to 0 (owner's live case: salary from Feb 2026 -> Jan
//    2026 pays 0, never the mirror);
//  - appendEntry: same-month replace, mirror re-computed for the
//    current month, the input meta is never mutated;
//  - the compile: a non-teaching record with no assignment lines is
//    paid its fixed salary (Oct 30,000 / Nov 35,000 crossover), net =
//    base + bonus - deduction - advance_deducted from the saved slip;
//    a legacy-mirror record and a no-salary record compile too; an
//    other_staff record is on the same fixed strategy;
//  - the accrual for a fixed record accrues linearly (totalSlots 0);
//  - freeze: appending the November increment afterwards never
//    changes the October compile;
//  - a teaching record compiles exactly as before (slot line, floor,
//    seniority badge, no pay_basis stamp).
// A FakeDate pins "today" so accrual day-boundaries are deterministic.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail ? ':: ' + detail : ''); }
}

// ---------------------------------------------------------------- fakes
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
let ACCOUNTS = {};
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
  db: dbStub,
  getTeacherAccounts() { return ACCOUNTS; },
  lmsNotify() {},
  lmsConfirm() { return Promise.resolve(true); },
  openModal() {}, closeModal() {}
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(`
  var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [], ALL_ASSIGNMENTS = [];
  let ALL_TEACHER_SALARIES = {};
  var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
`, sandbox, { filename: 'prelude.js' });

// The REAL classifier + categories region and the REAL FixedSalary
// region of js/config.js, extracted verbatim (config.js as a whole
// carries portal bootstrap code that does not belong in a vm).
const CONFIG = read('js/config.js');
{
  const a = CONFIG.indexOf('function getEmployeeRoleClassification');
  const b = CONFIG.indexOf('window.StaffCategories = StaffCategories;');
  check('config.js classifier region found', a > -1 && b > a);
  vm.runInContext(CONFIG.slice(a, b + 'window.StaffCategories = StaffCategories;'.length), sandbox, { filename: 'config-classifier.js' });
  const c = CONFIG.indexOf('function fixedSalaryCurrentMonth');
  const d = CONFIG.indexOf('window.FixedSalary = FixedSalary;');
  check('config.js FixedSalary region found', c > -1 && d > c);
  vm.runInContext(CONFIG.slice(c, d + 'window.FixedSalary = FixedSalary;'.length), sandbox, { filename: 'config-fixedsalary.js' });
}
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const run = (code) => vm.runInContext(code, sandbox);

// ------------------------------------------------------------ fixtures
const addr = (obj) => JSON.stringify(obj);
const HIST_SEP = { amount: 30000, effective_from: '2026-09', note: 'Starting salary', set_by: 'owner', set_at: '2026-09-01T00:00:00.000Z' };
function mgrRecord() {
  return {
    id: 'MGR-REC-1', full_name: 'Mgr One', phone: '0300', status: 'Active',
    created_at: '2020-01-15T00:00:00',
    address: addr({ employee_type: 'manager', monthly_salary: 30000, fixed_salary_history: [HIST_SEP] })
  };
}
const TCH = {
  id: 'TCH-REC-1', full_name: 'Teach One', phone: '0301', status: 'Active',
  created_at: '2023-06-01T00:00:00', address: '{}'
};
function resetFixtures() {
  TABLES.teachers = []; TABLES.students = []; TABLES.class_schedules = []; TABLES.student_assignments = [];
  ACCOUNTS = {};
  store.clear();
  FAKE_NOW = '2026-11-30T12:00:00';
}
function setMonth(m) {
  MONTH = m;
  sandbox.document.getElementById('salaryMonthSelect').value = m;
}
function setSavedSlips(obj) {
  store.set('alhuda_teacher_salaries', JSON.stringify(obj));
}
async function compile() {
  sandbox.ALL_TEACHERS = TABLES.teachers;
  sandbox.ALL_STUDENTS = TABLES.students;
  sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;
  await run('calculateMonthlySalaries(true)');
  return run('ALL_TEACHER_SALARIES');
}
const rowOf = (html, name) => (html.split('<tr').find(r => r.includes(name)) || '');

// ------------------------------------------------- resolver unit checks
console.log('== FixedSalary.amountForMonth: the resolution rule ==');
{
  const AM = (meta, m) => run(`FixedSalary.amountForMonth(${JSON.stringify(meta)}, '${m}')`);
  const crossover = {
    monthly_salary: 35000,
    fixed_salary_history: [
      { amount: 30000, effective_from: '2026-09', note: '', set_by: 'owner', set_at: '' },
      { amount: 35000, effective_from: '2026-11', note: '', set_by: 'owner', set_at: '' }
    ]
  };
  check('month before the first entry resolves to 0, NOT the mirror', AM(crossover, '2026-08') === 0);
  check('first entry month pays the first amount', AM(crossover, '2026-09') === 30000);
  check('between entries the earlier amount stays in force', AM(crossover, '2026-10') === 30000);
  check('increment month pays the new amount', AM(crossover, '2026-11') === 35000);
  check('after the last entry it stays in force', AM(crossover, '2027-03') === 35000);

  const liveCase = { monthly_salary: 40000, fixed_salary_history: [{ amount: 40000, effective_from: '2026-02', note: '', set_by: 'owner', set_at: '' }] };
  check("owner's live case: history from Feb 2026 -> Jan 2026 pays 0", AM(liveCase, '2026-01') === 0);
  check("owner's live case: Feb 2026 pays 40000", AM(liveCase, '2026-02') === 40000);

  const mirrorOnly = { monthly_salary: 28000 };
  check('no history at all: the mirror applies to a past month', AM(mirrorOnly, '2025-01') === 28000);
  check('no history at all: the mirror applies to a future month', AM(mirrorOnly, '2027-06') === 28000);
  check('empty meta resolves to 0', AM({}, '2026-10') === 0);
  check('null meta resolves to 0', AM(null, '2026-10') === 0);
  check('a non-array history is ignored (mirror rule)', AM({ monthly_salary: 5000, fixed_salary_history: 'garbage' }, '2026-10') === 5000);

  const hist = run(`JSON.stringify(FixedSalary.historyOf(${JSON.stringify({
    fixed_salary_history: [
      { amount: 35000, effective_from: '2026-11' },
      { amount: 'x', effective_from: '2026-10' },
      { amount: 30000, effective_from: 'Sep 2026' },
      null,
      { amount: 30000, effective_from: '2026-09' }
    ]
  })}))`);
  const parsed = JSON.parse(hist);
  check('historyOf drops malformed entries and sorts by month',
    parsed.length === 2 && parsed[0].effective_from === '2026-09' && parsed[1].effective_from === '2026-11');

  check('current() resolves the pinned current month (Nov 2026)',
    run(`FixedSalary.current(${JSON.stringify(crossover)})`) === 35000);
}

console.log('== FixedSalary.appendEntry ==');
{
  const baseMeta = { monthly_salary: 30000, fixed_salary_history: [HIST_SEP], other_key: 'keep-me' };
  const snapshot = JSON.stringify(baseMeta);
  const next = JSON.parse(run(`JSON.stringify(FixedSalary.appendEntry(${snapshot}, { amount: 35000, effective_from: '2026-11', note: 'Increment', by: 'owner' }))`));
  check('append grows the history', Array.isArray(next.fixed_salary_history) && next.fixed_salary_history.length === 2);
  check('the appended entry carries note + set_by + set_at',
    next.fixed_salary_history[1].note === 'Increment' && next.fixed_salary_history[1].set_by === 'owner' && typeof next.fixed_salary_history[1].set_at === 'string' && next.fixed_salary_history[1].set_at.length > 0);
  check('resolution after append: Oct 30000, Nov 35000',
    run(`FixedSalary.amountForMonth(${JSON.stringify(next)}, '2026-10')`) === 30000 &&
    run(`FixedSalary.amountForMonth(${JSON.stringify(next)}, '2026-11')`) === 35000);
  check('the mirror is re-computed to the current month amount', next.monthly_salary === 35000);
  check('unrelated meta keys survive the append', next.other_key === 'keep-me');
  check('the input meta is never mutated', JSON.stringify(baseMeta) === snapshot);

  const replaced = JSON.parse(run(`JSON.stringify(FixedSalary.appendEntry(${JSON.stringify(next)}, { amount: 32000, effective_from: '2026-09', note: 'Correction', by: 'owner' }))`));
  check('same effective month REPLACES instead of duplicating',
    replaced.fixed_salary_history.length === 2 &&
    run(`FixedSalary.amountForMonth(${JSON.stringify(replaced)}, '2026-10')`) === 32000 &&
    run(`FixedSalary.amountForMonth(${JSON.stringify(replaced)}, '2026-11')`) === 35000);

  const badAmount = JSON.parse(run(`JSON.stringify(FixedSalary.appendEntry(${snapshot}, { amount: -5, effective_from: '2026-12', by: 'owner' }))`));
  const badMonth = JSON.parse(run(`JSON.stringify(FixedSalary.appendEntry(${snapshot}, { amount: 1000, effective_from: 'Dec 2026', by: 'owner' }))`));
  check('an invalid entry leaves the meta unchanged',
    JSON.stringify(badAmount) === snapshot && JSON.stringify(badMonth) === snapshot);
}

// ------------------------------------------------------------- compile
console.log('== compile: fixed-salary crossover, net math, freeze ==');
{
  resetFixtures();
  TABLES.teachers = [mgrRecord(), TCH];
  TABLES.students = [
    { id: 'STU-1', name: 'Stu One', status: 'Active', assigned_teacher_id: 'TCH-REC-1', joining_date: '2026-09-01', notes: JSON.stringify({ course_name: 'Noorani Qaida' }) }
  ];
  TABLES.class_schedules = [
    { id: 'SCH-1', teacher_id: 'TCH-REC-1', student_id: 'STU-1', day_of_week: 2, start_time: '10:00', end_time: '10:30', duration_mins: 30 }
  ];
  setSavedSlips({
    'MGR-REC-1_October_2026': { teacher_id: 'MGR-REC-1', month: 'October 2026', bonus: 2000, deduction: 500, advance_deducted: 1000, status: 'Pending', students: {}, student_items_snapshot: [] }
  });

  setMonth('October 2026');
  let slips = await compile();
  const oct = slips['MGR-REC-1'];
  check('Oct: manager base is the fixed salary in force (30000)', oct && oct.base_subtotal === 30000, oct && ('base=' + oct.base_subtotal));
  check('Oct: net = 30000 + 2000 bonus - 500 deduction - 1000 advance', oct && oct.net_payable === 30500, oct && ('net=' + oct.net_payable));
  check("Oct: the slip is stamped pay_basis 'fixed'", oct && oct.pay_basis === 'fixed');
  check('Oct: no student lines, no students subtotal, no protection',
    oct && oct.assigned_students.length === 0 && oct.students_subtotal === 0 && oct.basic_protection === 0 && oct.floor_amount === 0);
  check('Oct: seniority increment is 0 for a fixed record (never per-student)', oct && oct.seniority_increment === 0);
  check('Oct: month-end accrual equals the base, totalSlots 0',
    oct && oct.accrual.grossEarned === 30000 && oct.accrual.remaining === 0 && oct.accrual.totalSlots === 0 && oct.accrual.daysElapsed === 31);

  // The November increment is appended AFTER the October slip exists.
  const rec = TABLES.teachers[0];
  const meta = JSON.parse(rec.address);
  const appended = JSON.parse(run(`JSON.stringify(FixedSalary.appendEntry(${JSON.stringify(meta)}, { amount: 35000, effective_from: '2026-11', note: 'Increment', by: 'owner' }))`));
  rec.address = JSON.stringify(appended);

  slips = await compile();
  check('freeze: October still compiles 30000 / net 30500 after the Nov increment was appended',
    slips['MGR-REC-1'].base_subtotal === 30000 && slips['MGR-REC-1'].net_payable === 30500);

  setMonth('November 2026');
  slips = await compile();
  const nov = slips['MGR-REC-1'];
  check('Nov: manager base is the incremented fixed salary (35000)', nov && nov.base_subtotal === 35000 && nov.net_payable === 35000);

  // Teaching control in the same compile: completely unchanged shape.
  const tch = slips['TCH-REC-1'];
  check('teaching record still compiles its slot line ((2200 + 600 increment) x 1 slot = 2800)',
    tch && tch.students_subtotal === 2800 && tch.assigned_students.length === 1 && tch.assigned_students[0].final_rate === 2800 && tch.accrual.totalSlots === 1,
    tch && ('sub=' + tch.students_subtotal + ' line=' + (tch.assigned_students[0] || {}).final_rate));
  check('teaching record keeps the prorated Basic Salary floor (base 20000, protection 20000 - 2800)',
    tch && tch.base_subtotal === 20000 && tch.basic_protection === 17200, tch && ('base=' + tch.base_subtotal + ' prot=' + tch.basic_protection));
  check('teaching slip has NO pay_basis stamp', tch && tch.pay_basis === undefined);
  check('teaching seniority increment still applies (600)', tch && tch.seniority_increment === 600, tch && ('inc=' + tch.seniority_increment));

  // Row rendering: the basis labels land where the plan requires.
  const html = sandbox.document.getElementById('salariesTableBody').innerHTML;
  const mgrRow = rowOf(html, 'Mgr One');
  const tchRow = rowOf(html, 'Teach One');
  check("manager row shows the 'Fixed Salary' basis (sub-line + total caption)",
    mgrRow.includes('Fixed Salary · Daily') && mgrRow.includes('>Fixed Salary</span>'));
  check('manager row shows the fixed amount as its base total (35,000)', mgrRow.includes('PKR 35,000'));
  check('manager row has no Slots line and no per-student increment badge',
    !mgrRow.includes('Slots:') && !mgrRow.includes('PKR/stu'));
  check("teaching row still shows 'Slots: 1', 'From Course Rates' and its increment badge",
    tchRow.includes('Slots: 1') && tchRow.includes('From Course Rates') && tchRow.includes('PKR/stu'));
}

console.log('== compile: legacy mirror, no salary, other_staff ==');
{
  resetFixtures();
  TABLES.teachers = [
    { id: 'MGR-REC-2', full_name: 'Mgr Mirror', phone: '0302', status: 'Active', created_at: '2024-01-01T00:00:00', address: addr({ employee_type: 'manager', monthly_salary: 28000 }) },
    { id: 'MGR-REC-3', full_name: 'Mgr Empty', phone: '0303', status: 'Active', created_at: '2024-01-01T00:00:00', address: addr({ employee_type: 'manager' }) },
    { id: 'STF-REC-1', full_name: 'Staff One', phone: '0304', status: 'Active', created_at: '2024-01-01T00:00:00', address: addr({ employee_type: 'other_staff', monthly_salary: 18000, fixed_salary_history: [{ amount: 18000, effective_from: '2026-10', note: '', set_by: 'owner', set_at: '' }] }) }
  ];
  setMonth('October 2026');
  let slips = await compile();
  check('legacy mirror record compiles its mirror (28000)', slips['MGR-REC-2'] && slips['MGR-REC-2'].base_subtotal === 28000);
  check('no-salary record compiles 0 and still appears for the owner',
    !!slips['MGR-REC-3'] && slips['MGR-REC-3'].base_subtotal === 0 && slips['MGR-REC-3'].pay_basis === 'fixed');
  check('other_staff is on the same fixed strategy (18000 from Oct)', slips['STF-REC-1'] && slips['STF-REC-1'].base_subtotal === 18000);

  setMonth('September 2026');
  slips = await compile();
  check('Sep: other_staff pays 0 before its first history entry (mirror does NOT leak back)',
    slips['STF-REC-1'] && slips['STF-REC-1'].base_subtotal === 0);
  check('Sep: the no-history mirror record still pays its mirror (28000)',
    slips['MGR-REC-2'] && slips['MGR-REC-2'].base_subtotal === 28000);
}

console.log('== compile: mid-month accrual for a fixed record ==');
{
  resetFixtures();
  const rec = mgrRecord();
  const meta = JSON.parse(rec.address);
  meta.fixed_salary_history = [HIST_SEP, { amount: 35000, effective_from: '2026-11', note: 'Increment', set_by: 'owner', set_at: '2026-11-01T00:00:00.000Z' }];
  meta.monthly_salary = 35000;
  rec.address = JSON.stringify(meta);
  TABLES.teachers = [rec];
  FAKE_NOW = '2026-11-15T12:00:00';
  setMonth('November 2026');
  const slips = await compile();
  const a = slips['MGR-REC-1'] && slips['MGR-REC-1'].accrual;
  check('accrual as-of is today (15 Nov), 15 of 30 days elapsed',
    a && a.asOf === '2026-11-15' && a.daysElapsed === 15 && a.daysInMonth === 30);
  check('gross earned accrues linearly: 35000 x 15/30 = 17500',
    a && a.grossEarned === 17500 && a.earnedStudents === 17500 && a.remaining === 17500, a && ('gross=' + a.grossEarned));
  check('daily accrual is base / days in month (1166.67), totalSlots 0, no floor/protection accrual',
    a && a.dailyAccrual === 1166.67 && a.totalSlots === 0 && a.floorAccrued === 0 && a.protectionAccrued === 0);
}

console.log('== slip editor: a fixed slip keeps its base ==');
{
  resetFixtures();
  TABLES.teachers = [mgrRecord(), TCH];
  TABLES.students = [
    { id: 'STU-1', name: 'Stu One', status: 'Active', assigned_teacher_id: 'TCH-REC-1', joining_date: '2026-09-01', notes: JSON.stringify({ course_name: 'Noorani Qaida' }) }
  ];
  TABLES.class_schedules = [
    { id: 'SCH-1', teacher_id: 'TCH-REC-1', student_id: 'STU-1', day_of_week: 2, start_time: '10:00', end_time: '10:30', duration_mins: 30 }
  ];
  setSavedSlips({
    'MGR-REC-1_October_2026': { teacher_id: 'MGR-REC-1', month: 'October 2026', bonus: 2000, deduction: 500, advance_deducted: 1000, status: 'Pending', students: {}, student_items_snapshot: [] }
  });
  setMonth('October 2026');
  const slips = await compile();

  run(`CURRENT_SLIP_DATA = ALL_TEACHER_SALARIES['MGR-REC-1']; CURRENT_SLIP_TEACHER_ID = 'MGR-REC-1';`);
  sandbox.document.getElementById('slipBonus').value = '2000';
  sandbox.document.getElementById('slipDeduction').value = '500';
  const totals = JSON.parse(run('JSON.stringify(recalculateSlipNetTotal())'));
  check('editor: the fixed base survives (studentsSubtotal = 30000, not 0)', totals.studentsSubtotal === 30000, 'sub=' + totals.studentsSubtotal);
  check('editor: net = 30000 + 2000 - 500 - 1000 = 30500', totals.netPayable === 30500, 'net=' + totals.netPayable);
  check("editor: the totals line is labelled 'Fixed Salary'",
    sandbox.document.getElementById('slipTotalStudentsCount').innerText.startsWith('Fixed Salary'));
  check('editor: the base input carries the fixed base',
    Number(sandbox.document.getElementById('slipBaseSubtotal').value) === 30000);

  run(`CURRENT_SLIP_DATA = ALL_TEACHER_SALARIES['TCH-REC-1']; CURRENT_SLIP_TEACHER_ID = 'TCH-REC-1';`);
  sandbox.document.getElementById('slipBonus').value = '';
  sandbox.document.getElementById('slipDeduction').value = '';
  run('recalculateSlipNetTotal()');
  check("editor: a teaching slip's totals line keeps the 'For N Assigned Students' label",
    sandbox.document.getElementById('slipTotalStudentsCount').innerText.startsWith('For '));
}

console.log('== structural pins ==');
{
  const PAYROLL = read('js/payroll.js');
  check('config.js exposes window.FixedSalary', CONFIG.includes('window.FixedSalary = FixedSalary;'));
  check("payroll stamps pay_basis 'fixed' only on the fixed branch",
    PAYROLL.includes("pay_basis: 'fixed'") && PAYROLL.includes('_payrollFixedSalaryMeta'));
  check('the Basic Salary floor stays teaching-only (no floor call on the fixed path)',
    PAYROLL.includes('const baseSubtotal = isFixedBasis ? fixedBase'));
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
