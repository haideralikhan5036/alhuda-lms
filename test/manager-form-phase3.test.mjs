// Manager Profile Redesign, Stage 2 Phase 3 (2026-11-05): the employee
// form in Manager mode. Executes the REAL js/teachers.js (whole file)
// plus the REAL StaffCategories classifier and FixedSalary resolver
// from js/config.js in a vm, with an auto-creating DOM mock, an
// in-memory localStorage and a fake db that captures the insert /
// update payloads — the same fixture style as the employees form
// suites. Proves:
//   - Management mode hides the teacher-only blocks (rate per slot,
//     increment tier, hour rate, Zoom block, custom shift times) and
//     shows Role Type / Designation / Fixed Salary Effective From;
//     Teaching mode restores every block.
//   - Role Type drives employee_type on save: 'manager' writes a login
//     account (+ password-endpoint call); 'other_staff' writes NO
//     account and NO password, and persists its meta in the teachers
//     row address JSON instead.
//   - Add Manager flow: category locked (existing) + role locked to
//     'manager'.
//   - Insert with a salary writes the FIRST fixed_salary_history entry
//     with the chosen effective month (+ resolver-exact mirror).
//   - Edit: the salary input is pre-filled from FixedSalary.current;
//     an unchanged salary writes NO history; a changed salary appends
//     one entry and preserves earlier months.
//   - Manager sessions still cannot save a Management record.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CONFIG = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const TEACHERS = readFileSync(new URL('../js/teachers.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

function pktMonth(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  let y = '', m = '';
  for (const p of parts) { if (p.type === 'year') y = p.value; if (p.type === 'month') m = p.value; }
  let yy = parseInt(y, 10), mm = parseInt(m, 10) + offset;
  while (mm < 1) { mm += 12; yy -= 1; }
  while (mm > 12) { mm -= 12; yy += 1; }
  return yy + '-' + String(mm).padStart(2, '0');
}
const CUR = pktMonth(0);
const PREV = pktMonth(-1);

function makeClassList() {
  const s = new Set();
  return {
    add: (...cs) => cs.forEach(c => s.add(c)),
    remove: (...cs) => cs.forEach(c => s.delete(c)),
    toggle: (c, force) => {
      if (force === undefined) { if (s.has(c)) s.delete(c); else s.add(c); }
      else if (force) s.add(c); else s.delete(c);
    },
    contains: (c) => s.has(c),
  };
}

function setup() {
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const el = {
        id, innerText: '', innerHTML: '', textContent: '',
        disabled: false, required: false, checked: false, placeholder: '', title: '',
        style: {}, classList: makeClassList(), dataset: {},
        focus() {}, blur() {}, click() {},
        _option: { disabled: false },
        querySelector: () => el._option,
        querySelectorAll: () => [],
      };
      // A real input's .value is always a string — assignments coerce.
      let stored = '';
      Object.defineProperty(el, 'value', {
        get: () => stored,
        set: (v) => { stored = v == null ? '' : String(v); },
        enumerable: true,
      });
      els.set(id, el);
    }
    return els.get(id);
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const dbCalls = { inserts: [], updates: [] };
  const db = {
    from: (table) => ({
      insert: (rows) => ({
        select: () => { dbCalls.inserts.push({ table, rows }); return Promise.resolve({ data: [{ id: 'REC-NEW-1' }], error: null }); },
      }),
      update: (payload) => ({
        eq: (col, val) => { dbCalls.updates.push({ table, payload, val }); return Promise.resolve({ error: null }); },
      }),
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    }),
  };
  const notify = [];
  const pwCalls = [];
  const ctx = {
    console, JSON, Math, Date, Intl, Promise, Set, Map, Array, Object, String, Number, parseFloat, parseInt, isNaN,
    document: {
      getElementById: getEl,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { classList: makeClassList() },
    },
    localStorage,
    db,
    CURRENT_ROLE: 'owner',
    ALL_TEACHERS: [],
    lmsNotify: (m) => notify.push(m),
    lmsConfirm: async () => true,
    openModal: () => {},
    closeModal: () => {},
    academyName: () => 'Al-Huda Islamic Centre',
    syncGlobalSharedStateToCloud: () => {},
    setAccountPasswordViaWorker: async (role, id, pw) => { pwCalls.push({ role, id, pw }); return { ok: true }; },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Real classifier + FixedSalary from js/config.js.
  const classStart = CONFIG.indexOf('function getEmployeeRoleClassification');
  const classEnd = CONFIG.indexOf('window.StaffCategories = StaffCategories;') + 'window.StaffCategories = StaffCategories;'.length;
  vm.runInContext(CONFIG.slice(classStart, classEnd), ctx);
  const fsStart = CONFIG.indexOf('function fixedSalaryCurrentMonth');
  const fsEnd = CONFIG.indexOf('window.FixedSalary = FixedSalary;') + 'window.FixedSalary = FixedSalary;'.length;
  vm.runInContext(CONFIG.slice(fsStart, fsEnd), ctx);
  // The real form logic, whole file.
  vm.runInContext(TEACHERS, ctx);
  // The list reload after a save is outside this suite's scope.
  ctx.loadTeachers = async () => {};
  const accounts = () => JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}');
  return { ctx, getEl, dbCalls, notify, pwCalls, accounts, store };
}

const evt = { preventDefault() {} };
const hidden = (el) => el.classList.contains('hidden');

// ---------- structural: modal markup ----------
console.log('manager-form-phase3: modal markup');
for (const id of ['tRoleType', 'tDesignation', 'tSalaryEffectiveFrom', 'tMgmtRoleWrap', 'tLoginBlock', 'tZoomBlock', 'tRateSlotWrap', 'tIncrementTierWrap', 'tHourRateWrap', 'tSalaryEffectiveWrap']) {
  check('index.html defines #' + id, INDEX.includes('id="' + id + '"'));
}
check('category select binds the mode function', INDEX.includes('id="tStaffCategory" onchange="applyStaffCategoryFormMode()"'));
check('role select binds the mode function', INDEX.includes('id="tRoleType" onchange="applyStaffCategoryFormMode()"'));
check('role options carry the two role values', INDEX.includes('value="manager"') && INDEX.includes('value="other_staff"'));

// ---------- mode switching ----------
{
  console.log('manager-form-phase3: mode switching');
  const { ctx, getEl } = setup();
  ctx.prepareAddTeacherModal();
  check('add form starts in teaching mode: teacher blocks visible',
    !hidden(getEl('tRateSlotWrap')) && !hidden(getEl('tIncrementTierWrap')) && !hidden(getEl('tHourRateWrap')) && !hidden(getEl('tZoomBlock')));
  check('add form starts in teaching mode: management blocks hidden',
    hidden(getEl('tMgmtRoleWrap')) && hidden(getEl('tSalaryEffectiveWrap')));
  check('teaching mode: login visible, username + rate required',
    !hidden(getEl('tLoginBlock')) && getEl('tUsername').required === true && getEl('tRateSlot').required === true);
  check('add form resets role type to manager, enabled',
    getEl('tRoleType').value === 'manager' && getEl('tRoleType').disabled === false);
  check('add form defaults effective month to the current month', getEl('tSalaryEffectiveFrom').value === CUR);

  getEl('tStaffCategory').value = 'management';
  ctx.applyStaffCategoryFormMode();
  check('management mode hides the five teacher blocks',
    hidden(getEl('tRateSlotWrap')) && hidden(getEl('tIncrementTierWrap')) && hidden(getEl('tHourRateWrap')) && hidden(getEl('tZoomBlock')) && hidden(getEl('customShiftTimesBox')));
  check('management mode shows role/designation + effective-from blocks',
    !hidden(getEl('tMgmtRoleWrap')) && getEl('tMgmtRoleWrap').classList.contains('grid') && !hidden(getEl('tSalaryEffectiveWrap')));
  check('management + manager role: login visible, username required, rate not required',
    !hidden(getEl('tLoginBlock')) && getEl('tUsername').required === true && getEl('tRateSlot').required === false);

  getEl('tRoleType').value = 'other_staff';
  ctx.applyStaffCategoryFormMode();
  check('other_staff role hides the login block and un-requires the username',
    hidden(getEl('tLoginBlock')) && getEl('tUsername').required === false);

  getEl('tStaffCategory').value = 'teaching';
  ctx.applyStaffCategoryFormMode();
  check('switching back to teaching restores every block',
    !hidden(getEl('tRateSlotWrap')) && !hidden(getEl('tIncrementTierWrap')) && !hidden(getEl('tHourRateWrap')) && !hidden(getEl('tZoomBlock'))
    && hidden(getEl('tMgmtRoleWrap')) && hidden(getEl('tSalaryEffectiveWrap')) && !hidden(getEl('tLoginBlock'))
    && getEl('tUsername').required === true && getEl('tRateSlot').required === true);
}

// ---------- Add Manager flow locks ----------
{
  console.log('manager-form-phase3: add manager flow');
  const { ctx, getEl } = setup();
  ctx.prepareAddManagerModal();
  check('add manager: category locked to management',
    getEl('tStaffCategory').value === 'management' && getEl('tStaffCategory').disabled === true);
  check('add manager: role type locked to manager',
    getEl('tRoleType').value === 'manager' && getEl('tRoleType').disabled === true);
  check('add manager: management blocks shown, teacher blocks hidden',
    !hidden(getEl('tMgmtRoleWrap')) && hidden(getEl('tRateSlotWrap')));
  check('add manager: generated MGR code kept', /^MGR-/.test(getEl('tGeneratedIdVal').value || getEl('tPortalId').value));
}

// ---------- insert: manager with login + salary ----------
{
  console.log('manager-form-phase3: insert manager with salary');
  const { ctx, getEl, dbCalls, pwCalls, accounts } = setup();
  ctx.prepareAddTeacherModal();
  getEl('tStaffCategory').value = 'management';
  ctx.applyStaffCategoryFormMode();
  getEl('tFullName').value = 'Test Manager';
  getEl('tPhone').value = '+923001234567';
  getEl('tUsername').value = 'testmgr';
  getEl('tPassword').value = 'longpassword1';
  getEl('tMonthlySalary').value = '40000';
  getEl('tDesignation').value = 'Academy Manager';
  await ctx.handleSaveTeacher(evt);
  check('manager insert: one row inserted with a plain address', dbCalls.inserts.length === 1 && !String(dbCalls.inserts[0].rows[0].address).startsWith('{'));
  const acc = accounts()['REC-NEW-1'];
  check('manager insert: account written with employee_type manager', !!acc && acc.employee_type === 'manager' && acc.username === 'testmgr');
  check('manager insert: designation stored in the account meta', !!acc && acc.designation === 'Academy Manager');
  check('manager insert: first history entry with the default (current) month',
    !!acc && Array.isArray(acc.fixed_salary_history) && acc.fixed_salary_history.length === 1
    && acc.fixed_salary_history[0].amount === 40000 && acc.fixed_salary_history[0].effective_from === CUR
    && acc.fixed_salary_history[0].note === 'Initial fixed salary');
  check('manager insert: mirror matches the resolver', !!acc && ctx.FixedSalary.amountForMonth(acc, CUR) === 40000 && ctx.FixedSalary.current(acc) === 40000);
  check('manager insert: password endpoint called once with the manager role',
    pwCalls.length === 1 && pwCalls[0].role === 'manager' && pwCalls[0].id === 'REC-NEW-1');
}

// ---------- insert: other_staff, no login ----------
{
  console.log('manager-form-phase3: insert other_staff (no login)');
  const { ctx, getEl, dbCalls, pwCalls, accounts } = setup();
  ctx.prepareAddTeacherModal();
  getEl('tStaffCategory').value = 'management';
  getEl('tRoleType').value = 'other_staff';
  ctx.applyStaffCategoryFormMode();
  getEl('tFullName').value = 'Office Person';
  getEl('tPhone').value = '+923009876543';
  // Typed credentials must be discarded for a no-login record.
  getEl('tUsername').value = 'shouldnotbesaved';
  getEl('tPassword').value = 'longpassword1';
  getEl('tMonthlySalary').value = '25000';
  getEl('tSalaryEffectiveFrom').value = PREV;
  getEl('tDesignation').value = 'Office Coordinator';
  await ctx.handleSaveTeacher(evt);
  check('other_staff insert: one row inserted', dbCalls.inserts.length === 1);
  let meta = null;
  try { meta = JSON.parse(dbCalls.inserts[0].rows[0].address); } catch (e) {}
  check('other_staff insert: record address carries meta JSON with employee_type other_staff',
    !!meta && meta.employee_type === 'other_staff');
  check('other_staff insert: designation + salary persisted in the record meta',
    !!meta && meta.designation === 'Office Coordinator' && meta.monthly_salary === 25000);
  check('other_staff insert: first history entry with the CHOSEN effective month',
    !!meta && Array.isArray(meta.fixed_salary_history) && meta.fixed_salary_history.length === 1
    && meta.fixed_salary_history[0].amount === 25000 && meta.fixed_salary_history[0].effective_from === PREV);
  check('other_staff insert: resolver reads the salary from the record meta',
    !!meta && ctx.FixedSalary.amountForMonth(meta, PREV) === 25000 && ctx.FixedSalary.amountForMonth(meta, CUR) === 25000);
  check('other_staff insert: NO account written', !accounts()['REC-NEW-1'] && Object.keys(accounts()).length === 0);
  check('other_staff insert: NO password-endpoint call', pwCalls.length === 0);
  const fakeRecord = { id: 'REC-NEW-1', address: dbCalls.inserts[0].rows[0].address, notes: '', witness_name: '' };
  check('other_staff insert: classifier still reads the record as non-teaching staff',
    ctx.getEmployeeRoleClassification(fakeRecord) === 'other_staff' && ctx.StaffCategories.of(fakeRecord) === 'non-teaching');
}

// ---------- insert: teaching regression ----------
{
  console.log('manager-form-phase3: teaching insert unchanged');
  const { ctx, getEl, dbCalls, pwCalls, accounts } = setup();
  ctx.prepareAddTeacherModal();
  getEl('tFullName').value = 'Plain Teacher';
  getEl('tPhone').value = '+923005555555';
  getEl('tUsername').value = 'tchr1';
  getEl('tPassword').value = 'longpassword1';
  await ctx.handleSaveTeacher(evt);
  const acc = accounts()['REC-NEW-1'];
  check('teaching insert: account written as teacher, no salary history key',
    !!acc && acc.employee_type === 'teacher' && !('fixed_salary_history' in acc));
  check('teaching insert: password endpoint called with the teacher role',
    pwCalls.length === 1 && pwCalls[0].role === 'teacher');
  check('teaching insert: row inserted once', dbCalls.inserts.length === 1);
}

// ---------- edit: manager record ----------
function editSetup() {
  const s = setup();
  const history = [{ amount: 30000, effective_from: '2026-01', note: 'Initial fixed salary', set_by: 'Owner', set_at: '2026-01-05T00:00:00.000Z' }];
  const record = {
    id: 'REC-MGR', full_name: 'Mgr One', father_name: '', phone: '+923001112222', alt_phone: '',
    address: JSON.stringify({ employee_type: 'manager', monthly_salary: 30000, fixed_salary_history: history, residential_address: 'Lahore', designation: 'Academy Manager' }),
    witness_name: '', witness_phone: '', notes: '',
    rate_per_slot: 0, working_shift: 'Office Hours', qualification: '', cnic: '', gender: 'Male',
    zoom_link: '', created_at: '2026-01-10T00:00:00.000Z', status: 'Active',
  };
  s.ctx.ALL_TEACHERS = [record];
  s.store.set('alhuda_teacher_accounts', JSON.stringify({
    'REC-MGR': { teacher_id: 'MGR-001', username: 'mgrone', employee_type: 'manager', monthly_salary: 30000, fixed_salary_history: history, designation: 'Academy Manager' },
  }));
  return { ...s, record, history };
}

{
  console.log('manager-form-phase3: edit pre-fill + unchanged salary');
  const { ctx, getEl, dbCalls, accounts } = editSetup();
  ctx.openEditTeacherModal('REC-MGR');
  check('edit: category initialised to management', getEl('tStaffCategory').value === 'management');
  check('edit: role type initialised from employee_type', getEl('tRoleType').value === 'manager' && getEl('tRoleType').disabled === false);
  check('edit: designation pre-filled', getEl('tDesignation').value === 'Academy Manager');
  check('edit: salary input pre-filled from the resolved current amount', String(getEl('tMonthlySalary').value) === '30000');
  check('edit: management blocks shown, teacher blocks hidden', !hidden(getEl('tMgmtRoleWrap')) && hidden(getEl('tZoomBlock')));
  getEl('tPassword').value = '';
  await ctx.handleSaveTeacher(evt);
  const acc = accounts()['REC-MGR'];
  check('edit unchanged: history NOT appended', !!acc && Array.isArray(acc.fixed_salary_history) && acc.fixed_salary_history.length === 1);
  check('edit unchanged: mirror stays 30000', !!acc && acc.monthly_salary === 30000);
  check('edit unchanged: row updated with employee_type manager in the address meta', (() => {
    if (!dbCalls.updates.length) return false;
    try { const m = JSON.parse(dbCalls.updates[0].payload.address); return m.employee_type === 'manager'; } catch (e) { return false; }
  })());
}

{
  console.log('manager-form-phase3: edit changed salary appends');
  const { ctx, getEl, accounts } = editSetup();
  ctx.openEditTeacherModal('REC-MGR');
  getEl('tMonthlySalary').value = '35000';
  getEl('tSalaryEffectiveFrom').value = CUR;
  getEl('tPassword').value = '';
  await ctx.handleSaveTeacher(evt);
  const acc = accounts()['REC-MGR'];
  check('edit changed: one entry appended', !!acc && Array.isArray(acc.fixed_salary_history) && acc.fixed_salary_history.length === 2);
  check('edit changed: new entry carries the amount + chosen month',
    !!acc && acc.fixed_salary_history[1].amount === 35000 && acc.fixed_salary_history[1].effective_from === CUR);
  check('edit changed: earlier months keep the old amount',
    !!acc && ctx.FixedSalary.amountForMonth(acc, '2026-01') === 30000 && ctx.FixedSalary.amountForMonth(acc, PREV) === 30000);
  check('edit changed: current month resolves the new amount + mirror follows',
    !!acc && ctx.FixedSalary.amountForMonth(acc, CUR) === 35000 && acc.monthly_salary === 35000);
}

{
  console.log('manager-form-phase3: edit role switch to other_staff');
  const { ctx, getEl, dbCalls, pwCalls, store } = editSetup();
  ctx.openEditTeacherModal('REC-MGR');
  getEl('tRoleType').value = 'other_staff';
  ctx.applyStaffCategoryFormMode();
  check('role switch: login block hidden', hidden(getEl('tLoginBlock')));
  const accountsBefore = store.get('alhuda_teacher_accounts');
  getEl('tPassword').value = 'longpassword1';
  await ctx.handleSaveTeacher(evt);
  check('role switch: record meta now employee_type other_staff', (() => {
    if (!dbCalls.updates.length) return false;
    try { const m = JSON.parse(dbCalls.updates[0].payload.address); return m.employee_type === 'other_staff' && m.fixed_salary_history.length === 1; } catch (e) { return false; }
  })());
  check('role switch: account map untouched (no account write)', store.get('alhuda_teacher_accounts') === accountsBefore);
  check('role switch: no password-endpoint call', pwCalls.length === 0);
}

// ---------- manager session: locks intact ----------
{
  console.log('manager-form-phase3: manager session locks');
  const { ctx, getEl, dbCalls, notify } = setup();
  ctx.CURRENT_ROLE = 'manager';
  ctx.prepareAddTeacherModal();
  check('manager session: management option disabled', getEl('tStaffCategory')._option.disabled === true);
  getEl('tStaffCategory').value = 'management';
  ctx.applyStaffCategoryFormMode();
  check('mode function does not re-enable the management option', getEl('tStaffCategory')._option.disabled === true);
  getEl('tFullName').value = 'Sneaky';
  getEl('tPhone').value = '+923000000000';
  getEl('tUsername').value = 'sneaky';
  await ctx.handleSaveTeacher(evt);
  check('manager session: saving a management record is blocked, nothing inserted',
    dbCalls.inserts.length === 0 && notify.some(m => m.includes('Managers cannot assign the Management Staff category')));
}

console.log('');
if (failed) { console.error(`MANAGER FORM PHASE 3 SUITE: ${passed} passed, ${failed} FAILED`); process.exit(1); }
console.log(`MANAGER FORM PHASE 3 SUITE: ${passed} passed, 0 failed`);
