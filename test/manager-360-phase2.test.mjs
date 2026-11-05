// Manager Profile Redesign — Stage 2 Phase 2 (2026-11-05).
// Executes the REAL config.js classifier + FixedSalary regions, the
// course catalogue, assignments, payroll and profiles360 modules in one
// vm and proves the Manager 360 sections:
//   - tab matrix per StaffCategories class (teaching / manager /
//     other_staff): non-teaching records gain Fixed Salary + Payroll
//     History (managers also Administrative Activity), and lose the
//     Schedule header action, the Students tab and the Earned-So-Far
//     accrual card;
//   - the Fixed Salary tab renders FixedSalary.current + dated history
//     (incl. the owner's live-case shape: single entry 40000 @ 2026-02);
//   - a manager session sees 'Restricted' amounts, no update action and
//     no audit-log query;
//   - the owner Update flow appends/replaces through FixedSalary and
//     writes BOTH meta homes (teachers-row address JSON + account map),
//     shows the saved-slip warning exactly when a slip exists for the
//     chosen month, and changes nothing on a write error;
//   - Payroll History shows only real saved slips (no invented months);
//   - Administrative Activity is attributed EXACTLY: the audit query
//     filters actor_id == the manager's teachers-row id, the value the
//     Worker stores verbatim from the session (auth.sub).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name); }
}

// ------------------------------------------------------------ harness
function makeElement(id) {
  const classes = new Set();
  return {
    id, innerHTML: '', innerText: '', textContent: '', value: '',
    style: {},
    appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    classList: {
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
      toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
      contains(c) { return classes.has(c); }
    }
  };
}
const elements = {};
const store = new Map();
const TABLES = { teachers: [], students: [], class_schedules: [], student_assignments: [] };

const MGR_ID = 'TCH-MVTEST01-MGR1';
const STF_ID = 'TCH-MVTEST02-STF1';
const AUDIT_ROWS = [
  { id: 11, actor_id: MGR_ID, actor_role: 'manager', action: 'update', table_name: 'students', record_id: 'STU-001', created_at: '2026-11-04T10:15:00.000Z' },
  { id: 12, actor_id: MGR_ID, actor_role: 'manager', action: 'insert', table_name: 'teachers', record_id: 'TCH-XYZ', created_at: '2026-11-03T09:00:00.000Z' },
  { id: 13, actor_id: 'TCH-OTHER-9999', actor_role: 'manager', action: 'delete', table_name: 'students', record_id: 'STU-999', created_at: '2026-11-02T09:00:00.000Z' }
];
const dbCalls = { teachersUpdates: [], auditQueries: [] };
let dbTeachersUpdateError = null;
const dbStub = {
  from(table) {
    return {
      select() {
        if (table === 'audit_log') {
          const q = { filters: {}, orderCol: null, limitN: null };
          const builder = {
            eq(col, val) { q.filters[col] = val; return builder; },
            order(col) { q.orderCol = col; return builder; },
            limit(n) { q.limitN = n; return builder; },
            then(resolve, reject) {
              dbCalls.auditQueries.push({ filters: { ...q.filters }, orderCol: q.orderCol, limitN: q.limitN });
              const rows = AUDIT_ROWS.filter(r => String(r.actor_id) === String(q.filters.actor_id));
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            }
          };
          return builder;
        }
        const p = Promise.resolve({ data: TABLES[table] || [], error: null });
        p.order = () => p; p.eq = () => p;
        p.maybeSingle = () => Promise.resolve({ data: null, error: null });
        return p;
      },
      insert() { return Promise.resolve({ data: null, error: null }); },
      upsert() { return Promise.resolve({ data: null, error: null }); },
      update(payload) {
        if (table === 'teachers') dbCalls.teachersUpdates.push(payload);
        return { eq() { return dbTeachersUpdateError
          ? Promise.resolve({ data: null, error: dbTeachersUpdateError })
          : Promise.resolve({ data: null, error: null }); } };
      },
      delete() { return { eq() { return Promise.resolve({ data: null, error: null }); } }; }
    };
  }
};
const notifyLog = [];
const sandbox = {
  console, Set, Map, Promise, Date, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, URLSearchParams,
  setTimeout, clearTimeout,
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
  getTeacherAccounts() { try { return JSON.parse(store.get('alhuda_teacher_accounts') || '{}'); } catch (e) { return {}; } },
  saveTeacherAccount(id, meta) {
    const all = (() => { try { return JSON.parse(store.get('alhuda_teacher_accounts') || '{}'); } catch (e) { return {}; } })();
    const copy = { ...(meta || {}) };
    delete copy.password;
    all[id] = { ...(all[id] || {}), ...copy };
    store.set('alhuda_teacher_accounts', JSON.stringify(all));
  },
  lmsNotify(msg, opts) { notifyLog.push({ msg: String(msg), opts: opts || null }); },
  lmsConfirm() { return Promise.resolve(true); },
  openModal() {}, closeModal() {}
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

// The REAL classifier + StaffCategories region and the REAL FixedSalary
// region of js/config.js, extracted verbatim (same technique as
// test/manager-fixed-salary-payroll.test.mjs).
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
for (const f of ['js/course-catalogue.js', 'js/assignments.js', 'js/payroll.js', 'js/profiles360.js']) {
  vm.runInContext(read(f), sandbox, { filename: f });
}
const run = (code) => vm.runInContext(code, sandbox);
const tick = () => new Promise(r => setTimeout(r, 5));

// ------------------------------------------------------------ fixtures
const TCH = { id: 'T1', full_name: 'Teacher One', phone: '0300', status: 'Active', created_at: '2026-06-01T00:00:00' };
const MGR = {
  id: MGR_ID, full_name: 'Test Manager', emp_id: 'MGR-001', username: 'testmgr',
  phone: '0301', status: 'Active', created_at: '2026-02-16T00:00:00',
  address: JSON.stringify({
    employee_type: 'manager', designation: 'Academy Manager',
    monthly_salary: 40000,
    fixed_salary_history: [
      { amount: 40000, effective_from: '2026-02', note: 'Initial', set_by: 'Owner', set_at: '2026-02-16T00:00:00.000Z' }
    ]
  })
};
const STF = {
  id: STF_ID, full_name: 'Test Clerk', emp_id: 'STF-001',
  phone: '0302', status: 'Active', created_at: '2026-03-01T00:00:00',
  address: JSON.stringify({ employee_type: 'other_staff', monthly_salary: 25000 })
};
TABLES.teachers = [TCH, MGR, STF];
const notes = (course_name) => JSON.stringify({ course_name });
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

// The manager's ONE real saved slip: September 2026 (base = the fixed
// salary, paid in full). No other months exist — Payroll History must
// show September only, never an invented current-cycle row.
store.set('alhuda_teacher_salaries', JSON.stringify({
  [`${MGR_ID}_September_2026`]: {
    teacher_id: MGR_ID, month: 'September 2026',
    base_subtotal: 40000, bonus: 0, deduction: 0, advance_deducted: 0,
    net_payable: 40000, status: 'Paid', saved_at: '2026-09-28T00:00:00.000Z',
    pay_basis: 'fixed'
  }
}));

// Align the salary month selector with the vm's current month so the
// Earned-So-Far accrual card is in its current-month state.
const CUR_LABEL = run(`(() => { const M = ['January','February','March','April','May','June','July','August','September','October','November','December']; const d = new Date(); return M[d.getMonth()] + ' ' + d.getFullYear(); })()`);
sandbox.document.getElementById('salaryMonthSelect').value = CUR_LABEL;
// The current month key the module itself computes (Asia/Karachi). The
// update-flow tests use it as the effective month: FixedSalary mirrors
// `monthly_salary` to the amount in force for the CURRENT month, so a
// future-dated entry would (correctly) leave the mirror untouched.
const CUR_KEY = run(`_fsCurrentMonthKey()`);

const render360 = (teacher, tab) => {
  run(`_renderTeacher360WorkspaceDOM(ALL_TEACHERS.find(t => t.id === ${JSON.stringify(teacher.id)}), ALL_CLASS_SCHEDULES, [], ${JSON.stringify(tab)})`);
  return elements['unified360PageWorkspace'].innerHTML;
};
const navHas = (html, id) => html.includes(`switchTeacher360Tab('${id}')`);

console.log('== classification sanity (real StaffCategories) ==');
check('teaching fixture classifies teaching', run(`StaffCategories.of(ALL_TEACHERS[0])`) === 'teaching');
check('manager fixture classifies management', run(`StaffCategories.of(ALL_TEACHERS[1])`) === 'management');
check('other_staff fixture classifies non-teaching', run(`StaffCategories.of(ALL_TEACHERS[2])`) === 'non-teaching');

console.log('== tab matrix: teaching record (owner session) ==');
{
  const html = render360(TCH, 'biodata');
  check('teaching keeps the Students tab', navHas(html, 'students'));
  check('teaching keeps Deductions & Leaves', navHas(html, 'deductions_leaves'));
  check('teaching keeps Documents', navHas(html, 'documents'));
  check('teaching gains NO Fixed Salary tab', !navHas(html, 'fixed_salary'));
  check('teaching gains NO Payroll History tab', !navHas(html, 'payroll_history'));
  check('teaching gains NO Activity tab', !navHas(html, 'activity'));
  check('teaching keeps the header Schedule button', html.includes('openTeacherDedicatedScheduleFrom360'));
  const forced = render360(TCH, 'fixed_salary');
  check('teaching record asked for fixed_salary lands on Bio Data (no Fixed Salary content)', !forced.includes('Current Fixed Salary'));
}

console.log('== tab matrix: manager record (owner session) ==');
{
  const html = render360(MGR, 'biodata');
  check('manager gains the Fixed Salary tab', navHas(html, 'fixed_salary'));
  check('manager gains the Payroll History tab', navHas(html, 'payroll_history'));
  check('manager gains the Administrative Activity tab', navHas(html, 'activity'));
  check('manager has NO Students tab', !navHas(html, 'students'));
  check('manager loses the header Schedule button', !html.includes('openTeacherDedicatedScheduleFrom360'));
  check('manager header shows the designation meta', html.includes('Academy Manager'));
}

console.log('== tab matrix: other_staff record (owner session) ==');
{
  const html = render360(STF, 'biodata');
  check('other_staff gains the Fixed Salary tab', navHas(html, 'fixed_salary'));
  check('other_staff gains the Payroll History tab', navHas(html, 'payroll_history'));
  check('other_staff gains NO Activity tab', !navHas(html, 'activity'));
  check('other_staff has NO Students tab', !navHas(html, 'students'));
  check('other_staff loses the header Schedule button', !html.includes('openTeacherDedicatedScheduleFrom360'));
  const forced = render360(STF, 'activity');
  check('other_staff asked for activity lands on Bio Data (no Activity content)', !forced.includes('t360ActivityBody') && !forced.includes('Administrative Activity'));
}

console.log('== Fixed Salary tab: owner live-case shape (40000 @ 2026-02) ==');
{
  const html = render360(MGR, 'fixed_salary');
  check('current amount renders 40,000', html.includes('40,000'));
  check('effective-since renders February 2026', html.includes('February 2026'));
  check('history row renders the entry note', html.includes('Initial'));
  check('history row renders set-by Owner', html.includes('>Owner<'));
  check('owner sees the Update Fixed Salary action', html.includes('openFixedSalaryUpdateModal360'));
}

console.log('== Fixed Salary tab: legacy-mirror-only record ==');
{
  const html = render360(STF, 'fixed_salary');
  check('legacy mirror amount renders 25,000', html.includes('25,000'));
  check('no dated history: the no-history notice renders', html.includes('No dated salary history yet'));
  check('empty history table state renders', html.includes('No fixed salary history recorded yet'));
}

console.log('== Payroll History: real saved slips only ==');
{
  run(`window.__mgrState = _compileTeacher360AggregatedState(ALL_TEACHERS[1], ALL_CLASS_SCHEDULES, [])`);
  const html = run(`_buildTeacherPayrollHistoryTabHtml(window.__mgrState)`);
  check('renders the saved September 2026 slip', html.includes('September 2026'));
  check('renders the slip base as the fixed salary 40,000', html.includes('40,000'));
  check('renders a View Slip action wired to the existing slip modal', html.includes('openTeacherSalaryRowDetailsModal'));
  check('does NOT invent the current month (' + CUR_LABEL + ')', !html.includes(CUR_LABEL));
  check('does NOT invent October 2026', !html.includes('October 2026'));
  const stfHtml = run(`_buildTeacherPayrollHistoryTabHtml(_compileTeacher360AggregatedState(ALL_TEACHERS[2], ALL_CLASS_SCHEDULES, []))`);
  check('record with no slips renders the honest empty state', stfHtml.includes('No saved salary slips yet'));
}

console.log('== Earned-So-Far accrual card ==');
{
  run(`window.__tchState = _compileTeacher360AggregatedState(ALL_TEACHERS[0], ALL_CLASS_SCHEDULES, [])`);
  const tchState = run(`window.__tchState`);
  check('teaching fixture carries a current accrual (harness validity)', !!tchState.currentAccrual);
  const tchHtml = run(`_buildTeacherSalaryDetailsTabHtml(window.__tchState)`);
  check('teaching salary view SHOWS the Earned So Far card', tchHtml.includes('Earned So Far'));
  run(`window.__mgrState2 = _compileTeacher360AggregatedState(ALL_TEACHERS[1], ALL_CLASS_SCHEDULES, [])`);
  const mgrState = run(`window.__mgrState2`);
  console.log('  INFO manager currentAccrual present:', !!mgrState.currentAccrual);
  const mgrHtml = run(`_buildTeacherSalaryDetailsTabHtml(window.__mgrState2)`);
  check('manager salary view does NOT show the Earned So Far card', !mgrHtml.includes('Earned So Far'));
}

console.log('== Administrative Activity: owner session, exact attribution ==');
{
  dbCalls.auditQueries.length = 0;
  const html = render360(MGR, 'activity');
  check('activity tab renders its loading body for the owner', html.includes('t360ActivityBody'));
  await tick(); await tick();
  const body = elements['t360ActivityBody'].innerHTML;
  check('exactly one audit query was made', dbCalls.auditQueries.length === 1);
  check('the query filters actor_id == the manager record id (exact)', dbCalls.auditQueries.length === 1 && dbCalls.auditQueries[0].filters.actor_id === MGR_ID);
  check('the query asks for the newest 50 rows', dbCalls.auditQueries.length === 1 && dbCalls.auditQueries[0].limitN === 50);
  check('the manager rows render (STU-001 update)', body.includes('STU-001') && body.includes('update'));
  check('another actor row never renders (STU-999 absent)', !body.includes('STU-999'));
}

console.log('== manager session: Restricted amounts, no update action, no audit reads ==');
{
  sandbox.CURRENT_ROLE = 'manager';
  const fsHtml = render360(MGR, 'fixed_salary');
  check('fixed salary amounts render Restricted', fsHtml.includes('Restricted'));
  check('no amount leaks to a manager session', !fsHtml.includes('40,000'));
  check('update action is ABSENT for a manager session', !fsHtml.includes('openFixedSalaryUpdateModal360'));
  run(`window.__mgrState3 = _compileTeacher360AggregatedState(ALL_TEACHERS[1], ALL_CLASS_SCHEDULES, [])`);
  const phHtml = run(`_buildTeacherPayrollHistoryTabHtml(window.__mgrState3)`);
  check('payroll history amounts render Restricted', phHtml.includes('Restricted') && !phHtml.includes('40,000'));
  const before = dbCalls.auditQueries.length;
  const actHtml = render360(MGR, 'activity');
  check('activity content is owner-only for a manager session', actHtml.includes('Owner Only'));
  await tick();
  check('a manager session makes ZERO audit queries', dbCalls.auditQueries.length === before);
  sandbox.CURRENT_ROLE = 'owner';
}

console.log('== Update flow: saved-slip warning ==');
{
  run(`openFixedSalaryUpdateModal360(${JSON.stringify(MGR_ID)})`);
  const effEl = sandbox.document.getElementById('fsUpdEffective');
  const warnEl = sandbox.document.getElementById('fsUpdSlipWarning');
  effEl.value = '2026-09';
  run(`_fixedSalaryUpdateWarning360(${JSON.stringify(MGR_ID)})`);
  check('warning SHOWS for September 2026 (a saved slip exists)', !warnEl.classList.contains('hidden') && warnEl.innerHTML.includes('saved salary slip') && warnEl.innerHTML.includes('September 2026'));
  check('warning states the slip itself will not change', warnEl.innerHTML.includes('will <u>not</u> change') || warnEl.innerHTML.includes('not</u> change'));
  effEl.value = '2026-08';
  run(`_fixedSalaryUpdateWarning360(${JSON.stringify(MGR_ID)})`);
  check('warning HIDES for August 2026 (no saved slip)', warnEl.classList.contains('hidden'));
}

console.log('== Update flow: append writes BOTH homes ==');
{
  notifyLog.length = 0;
  dbCalls.teachersUpdates.length = 0;
  sandbox.document.getElementById('fsUpdAmount').value = '45000';
  sandbox.document.getElementById('fsUpdEffective').value = CUR_KEY;
  sandbox.document.getElementById('fsUpdNote').value = 'Raise';
  await run(`submitFixedSalaryUpdate360(null, ${JSON.stringify(MGR_ID)})`);
  const addrMeta = JSON.parse(MGR.address);
  check('teachers-row meta: history grew to 2 entries', Array.isArray(addrMeta.fixed_salary_history) && addrMeta.fixed_salary_history.length === 2);
  check('teachers-row meta: mirror updated to 45000', addrMeta.monthly_salary === 45000);
  check('teachers-row meta: new entry is 45000 @ current month', addrMeta.fixed_salary_history.some(e => e.amount === 45000 && e.effective_from === CUR_KEY));
  check('the /api/db teachers update carried the new history', dbCalls.teachersUpdates.length === 1 && JSON.parse(dbCalls.teachersUpdates[0].address).fixed_salary_history.length === 2);
  const accounts = JSON.parse(store.get('alhuda_teacher_accounts') || '{}');
  check('account map: entry written for the manager', !!accounts[MGR_ID]);
  check('account map: history grew to 2 entries', accounts[MGR_ID] && Array.isArray(accounts[MGR_ID].fixed_salary_history) && accounts[MGR_ID].fixed_salary_history.length === 2);
  check('account map: mirror updated to 45000', accounts[MGR_ID] && accounts[MGR_ID].monthly_salary === 45000);
  check('success notify fired', notifyLog.some(n => n.msg.includes('Fixed salary updated')));
  const html = render360(MGR, 'fixed_salary');
  check('re-rendered tab shows the new current amount 45,000', html.includes('45,000'));
  check('re-rendered tab shows effective-since = current month', html.includes(CUR_LABEL));
}

console.log('== Update flow: same-month replace keeps history length ==');
{
  sandbox.document.getElementById('fsUpdAmount').value = '46000';
  sandbox.document.getElementById('fsUpdEffective').value = CUR_KEY;
  sandbox.document.getElementById('fsUpdNote').value = 'Corrected';
  await run(`submitFixedSalaryUpdate360(null, ${JSON.stringify(MGR_ID)})`);
  const addrMeta = JSON.parse(MGR.address);
  check('history length stays 2 after same-month replace', addrMeta.fixed_salary_history.length === 2);
  check('the current-month entry now reads 46000', addrMeta.fixed_salary_history.some(e => e.amount === 46000 && e.effective_from === CUR_KEY));
  check('mirror follows the replace: 46000', addrMeta.monthly_salary === 46000);
}

console.log('== Update flow: write error changes nothing ==');
{
  notifyLog.length = 0;
  const addrBefore = MGR.address;
  const accountsBefore = store.get('alhuda_teacher_accounts');
  dbTeachersUpdateError = { message: 'simulated write failure' };
  sandbox.document.getElementById('fsUpdAmount').value = '47000';
  sandbox.document.getElementById('fsUpdEffective').value = '2027-01';
  sandbox.document.getElementById('fsUpdNote').value = 'Should not persist';
  await run(`submitFixedSalaryUpdate360(null, ${JSON.stringify(MGR_ID)})`);
  dbTeachersUpdateError = null;
  check('error notify fired', notifyLog.some(n => n.msg.includes('was not applied')));
  check('teachers-row meta unchanged after the failed write', MGR.address === addrBefore);
  check('account map unchanged after the failed write', store.get('alhuda_teacher_accounts') === accountsBefore);
}

console.log(`\nMANAGER 360 PHASE 2 SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
