// Salary Commission #2 Phase 1 (2026-11-05): SLOT-BASED PRICING +
// DAILY ACCRUAL. Executes the REAL js/course-catalogue.js,
// js/assignments.js, js/payroll.js and js/profiles360.js in a vm
// against fixture data and proves the owner decisions D1-D8:
//  D1 slots from schedule CLOCK times (duplicates once, most-common
//     length, tie -> longer, fractional allowed, no rows -> 1);
//  D2 seniority increment is PER SLOT: (rate + increment) x slots;
//  D3 weekend rate FLAT per student (never x slots), weekend day set
//     {Mon, Fri, Sat, Sun} under the new pricing;
//  D8 English Translation & Tafseer exempt from the increment;
//  D5 months >= 2026-11 use the new rules, months <= 2026-10
//     reproduce the legacy formula exactly;
//  D4 accrual: earned-so-far from the same engine clamped at today,
//     floor compared ONCE on the accrued aggregates.
// A FakeDate pins "today" so accrual day-boundaries are deterministic.
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
  getTeacherAccounts() { return ACCOUNTS; },
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
  var ALL_TEACHERS = [], ALL_STUDENTS = [], ALL_CLASS_SCHEDULES = [], ALL_ASSIGNMENTS = [];
  let ALL_TEACHER_SALARIES = {};
  var CURRENT_SLIP_DATA = null, CURRENT_SLIP_TEACHER_ID = null, CURRENT_ROLE = 'owner';
`, sandbox, { filename: 'prelude.js' });
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js', 'js/profiles360.js']) {
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'), sandbox, { filename: f });
}
const run = (code) => vm.runInContext(code, sandbox);

// ------------------------------------------------------------ fixtures
const notes = (course_name) => JSON.stringify({ course_name });
const T = (id, extra = {}) => ({ id, full_name: 'Teacher ' + id, phone: '0300', status: 'Active', created_at: '2026-06-01T00:00:00', ...extra });
const STU = (id, teacher_id, course, extra = {}) => ({ id, name: 'Stu ' + id, status: 'Active', assigned_teacher_id: teacher_id, joining_date: '2026-09-01', notes: notes(course), ...extra });
let schSeq = 0;
const SCH = (teacher_id, student_id, day_of_week, start_time, end_time, duration_mins) => ({
  id: 'SCH' + (++schSeq), teacher_id, student_id, day_of_week, start_time, end_time,
  duration_mins: duration_mins != null ? duration_mins : 30
});
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
async function compile() {
  sandbox.ALL_TEACHERS = TABLES.teachers;
  sandbox.ALL_STUDENTS = TABLES.students;
  sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;
  await run('calculateMonthlySalaries(true)');
  return run('ALL_TEACHER_SALARIES');
}
const lineOf = (slip, sid) => (slip.assigned_students || []).find(l => l.student_id === sid);

// ------------------------------------------------------------- units
console.log('== D5 gate ==');
{
  check("payrollPricingVersion('October 2026') is v1", run(`payrollPricingVersion('October 2026')`) === 'v1');
  check("payrollPricingVersion('November 2026') is v2", run(`payrollPricingVersion('November 2026')`) === 'v2');
  check("payrollPricingVersion('2026-11') is v2", run(`payrollPricingVersion('2026-11')`) === 'v2');
  check("payrollPricingVersion('December 2025') is v1", run(`payrollPricingVersion('December 2025')`) === 'v1');
  check("payrollPricingVersion('January 2027') is v2", run(`payrollPricingVersion('January 2027')`) === 'v2');
}

console.log('== D1 slot computation (PayrollSlots.compute) ==');
{
  const C = (rows) => run(`PayrollSlots.compute(${JSON.stringify(rows)})`);
  check('no schedule rows -> 1 slot', C([]) === 1);
  check('one 30-min session -> 1 slot', C([{ day_of_week: 2, start_time: '10:00', end_time: '10:30' }]) === 1);
  check('one 60-min session -> 2 slots', C([{ day_of_week: 2, start_time: '10:00', end_time: '11:00' }]) === 2);
  check('weekly frequency is irrelevant: 5 x 30-min days -> still 1 slot',
    C([1, 2, 3, 4, 5].map(d => ({ day_of_week: d, start_time: '10:00', end_time: '10:30' }))) === 1);
  check('fractional slots: 45 min -> 1.5', C([{ day_of_week: 2, start_time: '10:00', end_time: '10:45' }]) === 1.5);
  check('duplicate rows (same day + start) count once',
    C([0, 1, 2].map(() => ({ day_of_week: 2, start_time: '10:00', end_time: '11:00' }))) === 2);
  check('most common length wins: 30,30,60 -> 1 slot',
    C([{ day_of_week: 1, start_time: '10:00', end_time: '10:30' }, { day_of_week: 2, start_time: '10:00', end_time: '10:30' }, { day_of_week: 3, start_time: '10:00', end_time: '11:00' }]) === 1);
  check('tie -> the longer length: 30,60 -> 2 slots',
    C([{ day_of_week: 1, start_time: '10:00', end_time: '10:30' }, { day_of_week: 2, start_time: '10:00', end_time: '11:00' }]) === 2);
  check('overnight session 23:00 -> 00:30 = 90 min -> 3 slots',
    C([{ day_of_week: 2, start_time: '23:00', end_time: '00:30' }]) === 3);
  check('duration_mins is only a fallback when clock times are missing',
    C([{ day_of_week: 2, duration_mins: 60 }]) === 2);
  // STU-007's real live shape: 10 rows, duration_mins lying (7 say 30),
  // every session actually 03:30-04:30, several days duplicated.
  const stu007 = [
    { day_of_week: 1, start_time: '03:30', end_time: '04:30', duration_mins: 60 },
    { day_of_week: 2, start_time: '03:30', end_time: '04:30', duration_mins: 30 },
    { day_of_week: 2, start_time: '03:30', end_time: '04:30', duration_mins: 30 },
    { day_of_week: 3, start_time: '03:30', end_time: '04:30', duration_mins: 30 },
    { day_of_week: 3, start_time: '03:30', end_time: '04:30', duration_mins: 30 },
    { day_of_week: 4, start_time: '03:30', end_time: '04:30', duration_mins: 60 },
    { day_of_week: 4, start_time: '03:30', end_time: '04:30', duration_mins: 30 },
    { day_of_week: 5, start_time: '03:30', end_time: '04:30', duration_mins: 60 },
    { day_of_week: 5, start_time: '03:30', end_time: '04:30', duration_mins: 30 },
    { day_of_week: 6, start_time: '03:30', end_time: '04:30', duration_mins: 30 }
  ];
  check('STU-007 shape (duplicates + lying duration_mins, clock 60 Mon-Sat) -> exactly 2 slots', C(stu007) === 2);
}

console.log('== D3 weekend resolution under both gates ==');
{
  const R = (days, version) => run(`resolveAssignmentRate({ course_name: 'Noorani Qaida' }, { notes: '' }, ${JSON.stringify(days.map(d => ({ day_of_week: d })))}, payrollSettings()${version ? `, '${version}'` : ''})`);
  check('v2: Fri+Sat+Sun is weekend, flat 3200', (() => { const r = R([5, 6, 7], 'v2'); return r.ok && r.isWeekend && r.weekendFlat && r.baseRate === 3200; })());
  check('v2: Sat+Sun+Mon is weekend', (() => { const r = R([6, 7, 1], 'v2'); return r.ok && r.isWeekend && r.baseRate === 3200; })());
  check('v2: Monday-only is weekend', (() => { const r = R([1], 'v2'); return r.ok && r.isWeekend && r.baseRate === 3200; })());
  check('v2: Sat+Tue is NOT weekend (Tue disqualifies)', (() => { const r = R([6, 2], 'v2'); return r.ok && !r.isWeekend && r.baseRate === 2200; })());
  check('v2: Tue/Wed/Thu is NOT weekend', (() => { const r = R([2, 3, 4], 'v2'); return r.ok && !r.isWeekend && r.baseRate === 2200; })());
  check('v1: Monday-only is NOT weekend (legacy {6,7})', (() => { const r = R([1], 'v1'); return r.ok && !r.isWeekend && r.baseRate === 2200; })());
  check('v1: Fri+Sat+Sun is NOT weekend (Fri disqualifies in legacy)', (() => { const r = R([5, 6, 7], 'v1'); return r.ok && !r.isWeekend && r.baseRate === 2200; })());
  check('v1: Sat+Sun stays weekend at 3200', (() => { const r = R([6, 7], 'v1'); return r.ok && r.isWeekend && r.baseRate === 3200; })());
  check('omitted version defaults to the legacy behaviour', (() => { const r = R([6, 7]); return r.ok && r.isWeekend && r.baseRate === 3200; })());
  check('v2: weekend label names the expanded day set', (() => { const r = R([5, 6, 7], 'v2'); return r.courseLabel === 'Weekend Quran (Fri - Mon)'; })());
  check('v1: weekend label unchanged', (() => { const r = R([6, 7], 'v1'); return r.courseLabel === 'Weekend Quran (Saturday & Sunday)'; })());
}

// ------------------------------------------------------------ compile
console.log("== compile Nov 2026: the owner's five examples ==");
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = ['E1', 'E2', 'E3', 'E4', 'E5'].map(id => T(id, { __cat: 'other_staff' }));
  TABLES.students = [
    STU('A1', 'E1', 'Noorani Qaida'),
    STU('A2', 'E2', 'Noorani Qaida'),
    STU('A3', 'E3', 'Noorani Qaida'), STU('A4', 'E3', 'Noorani Qaida'),
    STU('A5', 'E4', 'Noorani Qaida'), STU('A6', 'E4', 'Noorani Qaida'), STU('A7', 'E4', 'Noorani Qaida'),
    STU('A8', 'E5', 'Noorani Qaida'), STU('A9', 'E5', 'Noorani Qaida')
  ];
  TABLES.class_schedules = [
    SCH('E1', 'A1', 2, '10:00', '10:30'),
    SCH('E2', 'A2', 2, '10:00', '11:00'),
    SCH('E3', 'A3', 2, '10:00', '10:30'), SCH('E3', 'A4', 3, '10:00', '10:30'),
    SCH('E4', 'A5', 2, '10:00', '10:30'), SCH('E4', 'A6', 3, '10:00', '10:30'), SCH('E4', 'A7', 4, '10:00', '10:30'),
    SCH('E5', 'A8', 2, '10:00', '11:00'), SCH('E5', 'A9', 3, '10:00', '11:00')
  ];
  const slips = await compile();
  check('ex1: one student, 30-min class -> 1 slot -> 2200',
    slips.E1.students_subtotal === 2200 && lineOf(slips.E1, 'A1').slots === 1 && lineOf(slips.E1, 'A1').final_rate === 2200);
  check('ex2: one student, 60-min class -> 2 slots -> 4400',
    slips.E2.students_subtotal === 4400 && lineOf(slips.E2, 'A2').slots === 2 && lineOf(slips.E2, 'A2').final_rate === 4400);
  check('ex3: two students x 30 min -> 2 slots -> 4400', slips.E3.students_subtotal === 4400 && slips.E3.accrual.totalSlots === 2);
  check('ex4: three students x 30 min -> 3 slots -> 6600', slips.E4.students_subtotal === 6600 && slips.E4.accrual.totalSlots === 3);
  check('ex5: two students x 60 min -> 4 slots -> 8800', slips.E5.students_subtotal === 8800 && slips.E5.accrual.totalSlots === 4);
  check("line schedule_text carries the slot count ('2 Slots • ...')",
    /2 Slots •/.test(lineOf(slips.E2, 'A2').schedule_text) && /1 Slot •/.test(lineOf(slips.E1, 'A1').schedule_text));
  check('slips are stamped pricing_version v2', slips.E1.pricing_version === 'v2' && slips.E5.pricing_version === 'v2');
  check('at month end (FakeDate = Nov 30) accrual equals potential',
    slips.E2.accrual.grossEarned === slips.E2.base_subtotal && slips.E2.accrual.remaining === 0 && slips.E2.accrual.asOf === '2026-11-30');
}

console.log('== compile Nov 2026: STU-007 shape pays 2 slots = 4400 ==');
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = [T('D7T', { __cat: 'other_staff' })];
  TABLES.students = [STU('STU-007', 'D7T', 'Quran Reading with Tajweed')];
  TABLES.class_schedules = [
    SCH('D7T', 'STU-007', 1, '03:30', '04:30', 60),
    SCH('D7T', 'STU-007', 2, '03:30', '04:30', 30), SCH('D7T', 'STU-007', 2, '03:30', '04:30', 30),
    SCH('D7T', 'STU-007', 3, '03:30', '04:30', 30), SCH('D7T', 'STU-007', 3, '03:30', '04:30', 30),
    SCH('D7T', 'STU-007', 4, '03:30', '04:30', 60), SCH('D7T', 'STU-007', 4, '03:30', '04:30', 30),
    SCH('D7T', 'STU-007', 5, '03:30', '04:30', 60), SCH('D7T', 'STU-007', 5, '03:30', '04:30', 30),
    SCH('D7T', 'STU-007', 6, '03:30', '04:30', 30)
  ];
  const slips = await compile();
  const line = lineOf(slips.D7T, 'STU-007');
  check('the one real 60-min student: 2200 -> 4400, slots = 2, no double count from duplicate rows',
    !!line && line.final_rate === 4400 && line.slots === 2 && slips.D7T.students_subtotal === 4400);
}

console.log('== D2: seniority increment is PER SLOT ==');
{
  resetFixtures();
  setMonth('November 2026');
  ACCOUNTS = { TD2: { increment_tier: '200' } };
  TABLES.teachers = [T('TD2', { __cat: 'other_staff' })];
  TABLES.students = [STU('B1', 'TD2', 'Noorani Qaida'), STU('B2', 'TD2', 'Noorani Qaida')];
  TABLES.class_schedules = [SCH('TD2', 'B1', 2, '10:00', '11:00'), SCH('TD2', 'B2', 3, '10:00', '10:30')];
  const slips = await compile();
  check('60-min line: (2200 + 200) x 2 slots = 4800',
    lineOf(slips.TD2, 'B1').final_rate === 4800 && lineOf(slips.TD2, 'B1').full_monthly_rate === 4800 && lineOf(slips.TD2, 'B1').increment === 200);
  check('30-min line: (2200 + 200) x 1 slot = 2400', lineOf(slips.TD2, 'B2').final_rate === 2400);
  check('teacher subtotal 4800 + 2400 = 7200', slips.TD2.students_subtotal === 7200);
}

console.log('== D3: weekend stays FLAT per student (compile, Nov 2026) ==');
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = [T('TWK', { __cat: 'other_staff' }), T('TWK2', { __cat: 'other_staff' })];
  ACCOUNTS = { TWK2: { increment_tier: '200' } };
  TABLES.students = [
    STU('W1', 'TWK', 'Noorani Qaida'), STU('W2', 'TWK', 'Noorani Qaida'),
    STU('W3', 'TWK', 'Noorani Qaida'), STU('W4', 'TWK', 'Noorani Qaida'),
    STU('W5', 'TWK2', 'Noorani Qaida')
  ];
  TABLES.class_schedules = [
    SCH('TWK', 'W1', 5, '10:00', '11:00'), SCH('TWK', 'W1', 6, '10:00', '11:00'), SCH('TWK', 'W1', 7, '10:00', '11:00'),
    SCH('TWK', 'W2', 6, '10:00', '10:30'), SCH('TWK', 'W2', 7, '10:00', '10:30'), SCH('TWK', 'W2', 1, '10:00', '10:30'),
    SCH('TWK', 'W3', 1, '10:00', '10:30'),
    SCH('TWK', 'W4', 6, '10:00', '10:30'), SCH('TWK', 'W4', 2, '10:00', '10:30'),
    SCH('TWK2', 'W5', 5, '09:00', '10:00'), SCH('TWK2', 'W5', 6, '09:00', '10:00'), SCH('TWK2', 'W5', 7, '09:00', '10:00')
  ];
  const slips = await compile();
  check('Fri+Sat+Sun 60-min student pays FLAT 3200 (never 3200 x 2 slots)',
    lineOf(slips.TWK, 'W1').final_rate === 3200 && lineOf(slips.TWK, 'W1').course_label === 'Weekend Quran (Fri - Mon)');
  check('Sat+Sun+Mon student is a weekend student: 3200', lineOf(slips.TWK, 'W2').final_rate === 3200);
  check('Monday-only student is a weekend student: 3200', lineOf(slips.TWK, 'W3').final_rate === 3200);
  check('Sat+Tue student is NOT weekend: course rate 2200', lineOf(slips.TWK, 'W4').final_rate === 2200);
  check('weekend subtotal 3200 x 3 + 2200 = 11800', slips.TWK.students_subtotal === 11800);
  check('weekend line with increment: 3200 + 200 added ONCE = 3400 (not per slot)',
    lineOf(slips.TWK2, 'W5').final_rate === 3400 && lineOf(slips.TWK2, 'W5').increment === 200);
}

console.log('== D8: English Tafseer exempt from the increment ==');
{
  resetFixtures();
  setMonth('November 2026');
  ACCOUNTS = { TD8: { increment_tier: '400' } };
  TABLES.teachers = [T('TD8', { __cat: 'other_staff' })];
  TABLES.students = [
    STU('F1', 'TD8', 'English Translation & Tafseer'),
    STU('F2', 'TD8', 'Tafseer-ul-Quran'),
    STU('F3', 'TD8', 'Urdu Translation & Tafseer')
  ];
  TABLES.class_schedules = [
    SCH('TD8', 'F1', 2, '10:00', '11:00'),
    SCH('TD8', 'F2', 3, '10:00', '10:30'),
    SCH('TD8', 'F3', 4, '10:00', '10:30')
  ];
  const slips = await compile();
  check('English Tafseer 60-min with increment 400: (4500 + 0) x 2 = 9000, line increment 0',
    lineOf(slips.TD8, 'F1').final_rate === 9000 && lineOf(slips.TD8, 'F1').increment === 0 && lineOf(slips.TD8, 'F1').slots === 2);
  check('the exemption follows the catalogue entry: alias Tafseer-ul-Quran 30-min = 4500 (no increment)',
    lineOf(slips.TD8, 'F2').final_rate === 4500 && lineOf(slips.TD8, 'F2').increment === 0);
  check('Urdu Tafseer is NOT exempt: (3500 + 400) x 1 = 3900',
    lineOf(slips.TD8, 'F3').final_rate === 3900 && lineOf(slips.TD8, 'F3').increment === 400);
  check('subtotal 9000 + 4500 + 3900 = 17400', slips.TD8.students_subtotal === 17400);
}

console.log('== D5: October 2026 reproduces the legacy formula EXACTLY ==');
{
  resetFixtures();
  setMonth('October 2026');
  ACCOUNTS = { TO1: { increment_tier: '200' }, TO3: { increment_tier: '400' } };
  TABLES.teachers = [T('TO1', { __cat: 'other_staff' }), T('TO2', { __cat: 'other_staff' }), T('TO3', { __cat: 'other_staff' })];
  TABLES.students = [
    STU('L1', 'TO1', 'Noorani Qaida'),
    STU('L2', 'TO2', 'Noorani Qaida'), STU('L3', 'TO2', 'Noorani Qaida'), STU('L4', 'TO2', 'Noorani Qaida'),
    STU('L5', 'TO3', 'English Translation & Tafseer')
  ];
  TABLES.class_schedules = [
    SCH('TO1', 'L1', 2, '10:00', '11:00'), SCH('TO1', 'L1', 3, '10:00', '11:00'),
    SCH('TO2', 'L2', 1, '10:00', '10:30'),
    SCH('TO2', 'L3', 5, '10:00', '10:30'), SCH('TO2', 'L3', 6, '10:00', '10:30'), SCH('TO2', 'L3', 7, '10:00', '10:30'),
    SCH('TO2', 'L4', 6, '10:00', '10:30'), SCH('TO2', 'L4', 7, '10:00', '10:30'),
    SCH('TO3', 'L5', 2, '10:00', '11:00')
  ];
  const slips = await compile();
  check('legacy: 60-min line pays base + increment FLAT (2200 + 200 = 2400), slots field = 1, no slot text',
    lineOf(slips.TO1, 'L1').final_rate === 2400 && lineOf(slips.TO1, 'L1').slots === 1 && !/Slots? •/.test(lineOf(slips.TO1, 'L1').schedule_text));
  check('legacy: Monday-only student is NOT weekend-priced in Oct (2200)', lineOf(slips.TO2, 'L2').final_rate === 2200);
  check('legacy: Fri+Sat+Sun student is NOT weekend-priced in Oct (2200)', lineOf(slips.TO2, 'L3').final_rate === 2200);
  check('legacy: Sat+Sun student stays weekend 3200 with the legacy label',
    lineOf(slips.TO2, 'L4').final_rate === 3200 && lineOf(slips.TO2, 'L4').course_label === 'Weekend Quran (Saturday & Sunday)');
  check('legacy: NO D8 exemption in Oct — English Tafseer 60-min = 4500 + 400 = 4900',
    lineOf(slips.TO3, 'L5').final_rate === 4900 && lineOf(slips.TO3, 'L5').increment === 400);
  check('legacy slips are stamped pricing_version v1', slips.TO1.pricing_version === 'v1');
}

console.log('== duration-change split: stored segment slots win ==');
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = [T('TDC', { __cat: 'other_staff' })];
  TABLES.students = [STU('SDC', 'TDC', 'Noorani Qaida')];
  // The student's CURRENT schedule is already 60-min (post-change);
  // segment A must still price at its STORED 1 slot.
  TABLES.class_schedules = [SCH('TDC', 'SDC', 2, '10:00', '11:00'), SCH('TDC', 'SDC', 4, '10:00', '11:00')];
  TABLES.student_assignments = [
    { id: 'ASG-A', student_id: 'SDC', teacher_id: 'TDC', course_name: 'Noorani Qaida', slots: 1, start_date: '2026-11-01', end_date: '2026-11-10', end_reason: 'duration_change' },
    { id: 'ASG-B', student_id: 'SDC', teacher_id: 'TDC', course_name: 'Noorani Qaida', slots: 2, start_date: '2026-11-11', end_date: null, end_reason: null }
  ];
  const slips = await compile();
  const lines = (slips.TDC.assigned_students || []).slice().sort((a, b) => String(a.joining_date).localeCompare(String(b.joining_date)));
  check('two segments price independently: 10 days x 1 slot = 733, 20 days x 2 slots = 2933',
    lines.length === 2 && lines[0].slots === 1 && lines[0].final_rate === 733 && lines[1].slots === 2 && lines[1].final_rate === 2933,
    JSON.stringify(lines.map(l => [l.slots, l.final_rate])));
  check('split subtotal 733 + 2933 = 3666', slips.TDC.students_subtotal === 3666);
}

console.log("== D4 accrual: the owner's worked example (2 slots, 30-day month) ==");
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = [T('TAC', { __cat: 'other_staff' })];
  TABLES.students = [STU('AC1', 'TAC', 'Quran Reading with Tajweed')];
  TABLES.class_schedules = [SCH('TAC', 'AC1', 2, '10:00', '11:00')];
  const expect = { '2026-11-01': 147, '2026-11-10': 1467, '2026-11-15': 2200, '2026-11-30': 4400 };
  for (const [day, earned] of Object.entries(expect)) {
    FAKE_NOW = day + 'T12:00:00';
    const slips = await compile();
    const a = slips.TAC.accrual;
    check(`day ${day.slice(8)}: earned = ${earned}`,
      a.grossEarned === earned && a.earnedStudents === earned && lineOf(slips.TAC, 'AC1').accrued_rate === earned,
      JSON.stringify(a));
    if (day === '2026-11-01') {
      check('accrual shape: asOf today, 1/30 days elapsed, daily 146.67, remaining 4253, totalSlots 2',
        a.asOf === '2026-11-01' && a.daysElapsed === 1 && a.daysInMonth === 30 && a.dailyAccrual === 146.67 && a.remaining === 4253 && a.totalSlots === 2);
    }
    if (day === '2026-11-30') {
      check('month-end accrual == potential (slip will match the displayed earned figure)',
        a.grossEarned === slips.TAC.base_subtotal && a.remaining === 0);
    }
  }
}

console.log('== D4 accrual: floor compared ONCE on the accrued aggregates ==');
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = [T('TFL')]; // teaching category (no __cat) -> floor applies
  TABLES.students = [STU('FL1', 'TFL', 'Noorani Qaida', { joining_date: '2026-11-16' })];
  let slips = await compile();
  check('potential: student 1100 (15/30 days) + protection 18900 = floor 20000',
    slips.TFL.students_subtotal === 1100 && slips.TFL.basic_protection === 18900 && slips.TFL.base_subtotal === 20000);
  FAKE_NOW = '2026-11-10T12:00:00';
  slips = await compile();
  const a = slips.TFL.accrual;
  check('Nov 10 (student not started): earnedStudents 0, floorAccrued 6667, protectionAccrued 6667, gross 6667',
    a.earnedStudents === 0 && a.floorAccrued === 6667 && a.protectionAccrued === 6667 && a.grossEarned === 6667 && a.remaining === 13333,
    JSON.stringify(a));
  FAKE_NOW = '2026-11-30T12:00:00';
  slips = await compile();
  check('Nov 30: accrued protection converges to the potential protection 18900',
    slips.TFL.accrual.protectionAccrued === 18900 && slips.TFL.accrual.grossEarned === slips.TFL.base_subtotal);
}

console.log('== leave / attendance neutrality ==');
{
  resetFixtures();
  setMonth('November 2026');
  FAKE_NOW = '2026-11-10T12:00:00';
  TABLES.teachers = [T('TAC', { __cat: 'other_staff' })];
  TABLES.students = [STU('AC1', 'TAC', 'Quran Reading with Tajweed')];
  TABLES.class_schedules = [SCH('TAC', 'AC1', 2, '10:00', '11:00')];
  const before = await compile();
  const snap = JSON.stringify({ s: before.TAC.students_subtotal, b: before.TAC.base_subtotal, g: before.TAC.accrual.grossEarned });
  // Teacher leave records and attendance logs exist in the app, but
  // they are NOT inputs to the salary primitives: adding them to the
  // environment must not move any figure by a single rupee.
  sandbox.LEAVE_REQUESTS = [{ id: 'LV1', teacher_id: 'TAC', leave_date: '2026-11-03', end_date: '2026-11-06', status: 'Approved' }];
  sandbox.ALL_ATTENDANCE_LOGS = [{ id: 'AT1', teacher_id: 'TAC', student_id: 'AC1', date: '2026-11-04', status: 'Absent' }];
  const after = await compile();
  check('figures identical with leave_requests + attendance data present',
    JSON.stringify({ s: after.TAC.students_subtotal, b: after.TAC.base_subtotal, g: after.TAC.accrual.grossEarned }) === snap);
  delete sandbox.LEAVE_REQUESTS;
  delete sandbox.ALL_ATTENDANCE_LOGS;
}

console.log('== frozen slip in a v2 month: maths untouched, accrual mirrors month end ==');
{
  resetFixtures();
  setMonth('November 2026');
  TABLES.teachers = [T('TFR', { __cat: 'other_staff' })];
  TABLES.students = [STU('FR1', 'TFR', 'Noorani Qaida')];
  TABLES.class_schedules = [SCH('TFR', 'FR1', 2, '10:00', '11:00')];
  store.set('alhuda_teacher_salaries', JSON.stringify({
    'TFR_November_2026': {
      teacher_id: 'TFR', month: 'November 2026', students: { SX: 5000 },
      student_items_snapshot: [{ student_id: 'SX', student_name: 'Frozen Stu', course_label: 'Noorani Qaida', final_rate: 5000, base_rate: 2200, increment: 0, full_monthly_rate: 2200, calculated_rate: 5000 }],
      base_subtotal: 5000, students_subtotal: 5000, basic_protection: 0, floor_amount: 0,
      bonus: 0, deduction: 0, advance_deducted: 0, net_payable: 5000, status: 'Pending', saved_at: '2026-11-15T00:00:00.000Z'
    }
  }));
  const slips = await compile();
  check('frozen Nov slip stays 5000 even though the live compile would price 4400',
    slips.TFR.frozen === true && slips.TFR.base_subtotal === 5000 && slips.TFR.net_payable === 5000);
  check('frozen accrual mirrors the saved totals at month end (remaining 0)',
    slips.TFR.accrual.grossEarned === 5000 && slips.TFR.accrual.remaining === 0 && slips.TFR.accrual.asOf === '2026-11-30');
}

console.log('== Teacher 360 mirror compile agrees with the Admin compile ==');
{
  resetFixtures();
  setMonth('November 2026');
  FAKE_NOW = '2026-11-10T12:00:00';
  ACCOUNTS = { TM: { increment_tier: '200' } };
  TABLES.teachers = [T('TM', { __cat: 'other_staff' })];
  TABLES.students = [STU('M1', 'TM', 'Noorani Qaida'), STU('M2', 'TM', 'Noorani Qaida')];
  TABLES.class_schedules = [
    SCH('TM', 'M1', 2, '10:00', '11:00'),
    SCH('TM', 'M2', 5, '09:00', '10:00'), SCH('TM', 'M2', 6, '09:00', '10:00'), SCH('TM', 'M2', 7, '09:00', '10:00')
  ];
  const slips = await compile();
  check('admin compile: (2200+200)x2 slots = 4800 + weekend flat 3400 = 8200', slips.TM.students_subtotal === 8200);
  sandbox.ALL_STUDENTS = TABLES.students;
  sandbox.ALL_CLASS_SCHEDULES = TABLES.class_schedules;
  const figs = run(`_payrollFiguresForTeacher360(ALL_TEACHERS.find(t => t.id === 'TM'), 'November 2026', ALL_CLASS_SCHEDULES, false)`);
  check('360 mirror: same students subtotal as the Admin compile', !!figs && figs.studentsSubtotal === slips.TM.students_subtotal);
  check('360 mirror: same line amounts and slots',
    !!figs && figs.lines.length === 2 && figs.lines.some(l => l.student_id === 'M1' && l.final_rate === 4800 && l.slots === 2) && figs.lines.some(l => l.student_id === 'M2' && l.final_rate === 3400));
  check('360 mirror: accrual matches the Admin accrual (gross earned + total slots)',
    !!figs && !!figs.accrual && figs.accrual.grossEarned === slips.TM.accrual.grossEarned && figs.accrual.totalSlots === slips.TM.accrual.totalSlots,
    JSON.stringify(figs && figs.accrual) + ' vs ' + JSON.stringify(slips.TM.accrual));
}

console.log('== assignments ledger: slots write + pre-v5 retry ==');
{
  // A db shim that behaves like the LIVE (pre-schema-v5) Worker: an
  // insert carrying the unknown `slots` column is rejected; anything
  // else succeeds. open() must retry without the field so ledger
  // writes never start failing before the v5 deploy lands.
  const attempts = [];
  const fakeDb = {
    from() {
      const q = {
        select() { return Promise.resolve({ data: [], error: null }); },
        insert(row) {
          attempts.push({ ...row });
          if (Object.prototype.hasOwnProperty.call(row, 'slots')) {
            return Promise.resolve({ data: null, error: { message: 'no such column: slots' } });
          }
          return Promise.resolve({ data: [row], error: null });
        },
        update() { return q; },
        eq() { return Promise.resolve({ data: [], error: null }); }
      };
      return q;
    }
  };
  const sb2 = {
    console, Promise, Date: FakeDate, Math, JSON, Number, String, Array, Object, parseInt, parseFloat, isNaN,
    document: { readyState: 'complete', addEventListener() {} },
    db: fakeDb
  };
  sb2.window = sb2;
  vm.createContext(sb2);
  vm.runInContext(fs.readFileSync(path.join(REPO_ROOT, 'js/assignments.js'), 'utf8'), sb2, { filename: 'js/assignments.js' });
  const A = sb2.window.Assignments;
  await A.loadAll();

  const okWithSlots = await A.open({ student_id: 'S1', teacher_id: 'T1', course_name: 'Noorani Qaida', slots: 2, start_date: '2026-11-05' });
  check('open() with slots succeeds via the retry (2 attempts: with, then without the column)',
    okWithSlots === true && attempts.length === 2 && attempts[0].slots === 2 && !Object.prototype.hasOwnProperty.call(attempts[1], 'slots'),
    JSON.stringify(attempts.map(a => Object.keys(a))));
  const before = attempts.length;
  const okPlain = await A.open({ student_id: 'S2', teacher_id: 'T1', course_name: 'Noorani Qaida', start_date: '2026-11-05' });
  check('open() without slots is byte-identical to before (1 attempt, no slots key)',
    okPlain === true && attempts.length === before + 1 && !Object.prototype.hasOwnProperty.call(attempts[before], 'slots'));
  await A.transition({ student_id: 'S3', teacher_id: 'T9', course_name: 'Noorani Qaida', slots: 1.5, start_date: '2026-11-20', end_reason: 'duration_change' });
  const s3Attempt = attempts.find(a => a.student_id === 'S3');
  check('transition() passes slots through to open() (first attempt carries 1.5)',
    !!s3Attempt && s3Attempt.slots === 1.5, JSON.stringify(s3Attempt || {}));
}

console.log('== structural: schema, release, hook, labels ==');
{
  const dbjs = fs.readFileSync(path.join(REPO_ROOT, 'functions/api/db.js'), 'utf8');
  check('schema bumped to v5 with the slots column (CREATE + ALTER patch)',
    dbjs.includes("const SCHEMA_VERSION = '2026-11-07-v6'") &&
    dbjs.includes('slots REAL') &&
    dbjs.includes('ALTER TABLE student_assignments ADD COLUMN slots REAL'));
  const worker = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');
  check('worker release + health schema bumped in sync',
    worker.includes("const WORKER_RELEASE = '2026-11-07-salary-plan-capture'") && worker.includes("const HEALTH_SCHEMA_VERSION = '2026-11-07-v6'"));
  const sched = fs.readFileSync(path.join(REPO_ROOT, 'js/schedule.js'), 'utf8');
  check("duration-change hook: re-segment helper exists and both schedule save paths call it",
    sched.includes('function maybeReSegmentAssignmentSlots(') &&
    (sched.match(/maybeReSegmentAssignmentSlots\(/g) || []).length >= 3 &&
    sched.includes("end_reason: 'duration_change'"));
  const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  check('settings labels: per-slot course rate + per-student weekend rate',
    html.includes('Monthly Rate per Slot (PKR)') && html.includes('Weekend Programme Rate (PKR / month, per student)'));
  const payroll = fs.readFileSync(path.join(REPO_ROOT, 'js/payroll.js'), 'utf8');
  check('payroll exposes PayrollSlots + the cutover gate',
    payroll.includes('window.PayrollSlots') && payroll.includes('payrollPricingVersion'));
}

console.log(`\nSALARY SLOTS + ACCRUAL SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
