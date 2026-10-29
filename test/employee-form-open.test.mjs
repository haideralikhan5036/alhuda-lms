// Regression suite for the dead add buttons (owner report 2026-10-29:
// "+ Add New Employee" and "+ Add Manager" did nothing). Root cause:
// the PR #85 cut that removed the Non-Teaching Staff block also removed
// the TEACHER_EXTRA_FIELD_IDS const defined inside that region, so
// clearTeacherExtraFields() threw a ReferenceError and
// prepareAddTeacherModal died BEFORE openModal — both buttons share
// that path. The structural suites could not see it (every string was
// still present). This suite EXECUTES the real open functions from
// js/teachers.js in a vm with DOM mocks and asserts the modal opens.
// Run from the repo root:  node test/employee-form-open.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHERS = fs.readFileSync(path.join(REPO_ROOT, 'js/teachers.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Extract the real region: const + helpers + both prepare fns ----
const start = TEACHERS.indexOf('const TEACHER_EXTRA_FIELD_IDS');
const end = TEACHERS.indexOf('function openEditTeacherModal');
check('region anchors found', start > -1 && end > start);
const region = TEACHERS.slice(start, end);

// ---- DOM mocks ------------------------------------------------------------
function makeEl(id) {
  return {
    id, value: '', innerText: '', innerHTML: '', disabled: false, checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => ({ disabled: false }),
    style: {},
  };
}
const els = new Map();
const opened = [];
const ctx = {
  console,
  document: {
    getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  openModal: (id) => { opened.push(id); },
  closeModal: () => {},
  lmsNotify: () => {},
  getTeacherAccounts: () => ({}),
  getNextTeacherId: () => 'TCH-999',
  CURRENT_ROLE: 'owner',
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(region, ctx);

// A top-level const lives in the context's lexical scope, not on the
// global object — read it by evaluating the name inside the context.
const FIELD_IDS = vm.runInContext('TEACHER_EXTRA_FIELD_IDS', ctx);
check('TEACHER_EXTRA_FIELD_IDS defined with the 11 field ids',
  Array.isArray(FIELD_IDS) && FIELD_IDS.length === 11 && FIELD_IDS.includes('tEmail') && FIELD_IDS.includes('tAccountNumber'));

// ---- Execute: Add New Employee -------------------------------------------
let err = null;
try { ctx.prepareAddTeacherModal(); } catch (e) { err = e; }
check('prepareAddTeacherModal runs without throwing', err === null, err && err.message);
check('Add New Employee opens modalAddTeacher', opened.includes('modalAddTeacher'), 'opened: ' + opened.join(','));
check('teacher mode: category defaults to teaching + enabled',
  els.get('tStaffCategory').value === 'teaching' && els.get('tStaffCategory').disabled === false);
check('teacher mode: generated id badge shows the TCH- code', els.get('tGeneratedIdBadge').innerText === 'TCH-999');
check('extra fields were cleared (no throw, values blank)', els.get('tEmail').value === '' && els.get('tAccountNumber').value === '');

// ---- Execute: Add Manager ---------------------------------------------------
opened.length = 0;
err = null;
try { ctx.prepareAddManagerModal(); } catch (e) { err = e; }
check('prepareAddManagerModal runs without throwing', err === null, err && err.message);
check('Add Manager opens modalAddTeacher', opened.includes('modalAddTeacher'), 'opened: ' + opened.join(','));
check('manager mode: category locked to management',
  els.get('tStaffCategory').value === 'management' && els.get('tStaffCategory').disabled === true);
check('manager mode: generated id is the next MGR- code', els.get('tGeneratedIdBadge').innerText === 'MGR-001');
check('manager mode: save button text switches', String(els.get('btnSaveTeacherText').innerText || '').includes('Save Manager'));

// ---- Manager session cannot open the manager flow ---------------------------
ctx.CURRENT_ROLE = 'manager';
opened.length = 0;
err = null;
try { ctx.prepareAddManagerModal(); } catch (e) { err = e; }
check('manager session: Add Manager refused without opening', err === null && opened.length === 0);

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
