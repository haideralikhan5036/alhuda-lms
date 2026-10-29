// Employees redesign E1 — canonical staff categories + category tabs +
// clean list view (replacing the employee cards).
// Behavioral: the REAL classifier region of js/config.js is extracted
// and evaluated in a vm; structural: tabs/table/actions in the page.
// Run from the repo root:  node test/employees-categories.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CONFIG = read('js/config.js');
const TEACHERS = read('js/teachers.js');
const INDEX = read('index.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Behavioral: canonical classifier -------------------------------------
{
  const start = CONFIG.indexOf('function getEmployeeRoleClassification');
  const end = CONFIG.indexOf('window.StaffCategories = StaffCategories;');
  check('classifier region found in config.js', start > -1 && end > start);
  const src = CONFIG.slice(start, end + 'window.StaffCategories = StaffCategories;'.length);
  const ctx = {
    window: {},
    localStorage: { getItem: () => '{}' },
    getTeacherAccounts: () => ({}),
    console,
  };
  ctx.window = ctx; // config code assigns window.X and reads bare names
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const SC = ctx.window.StaffCategories || ctx.StaffCategories;
  check('StaffCategories is exposed', !!SC && typeof SC.of === 'function');

  const mgrByType = { id: 'TCH-AAA', full_name: 'Mgr By Type', address: JSON.stringify({ employee_type: 'manager', designation: 'Manager' }) };
  check('employee_type manager wins over a TCH- id prefix', SC.of(mgrByType) === 'management');
  const plainTeacher = { id: 'TCH-BBB', full_name: 'Plain Teacher', address: '{}' };
  check('no signals -> teaching (legacy teacher records)', SC.of(plainTeacher) === 'teaching');
  const staffByCode = { id: 'STF-100', full_name: 'Staff By Code', address: '{}' };
  check('STF- code -> non-teaching', SC.of(staffByCode) === 'non-teaching');
  const mgrByWitness = { id: 'TCH-CCC', full_name: 'Mgr By Witness', witness_name: 'MGR-001', address: '{}' };
  check('MGR- witness code -> management', SC.of(mgrByWitness) === 'management');
  const conflict = { id: 'X-1', witness_name: 'STF-100', address: JSON.stringify({ employee_type: 'manager' }) };
  check('conflicting signals are flagged, not guessed', SC.hasConflict(conflict) === true && SC.hasConflict(plainTeacher) === false);
  check('canonical values + labels', SC.TEACHING === 'teaching' && SC.MANAGEMENT === 'management' && SC.NON_TEACHING === 'non-teaching' && SC.LABELS.management === 'Management Staff');
  check('stored employee_type mapping is canonical', SC.EMPLOYEE_TYPE.teaching === 'teacher' && SC.EMPLOYEE_TYPE.management === 'manager' && SC.EMPLOYEE_TYPE['non-teaching'] === 'other_staff');
}

// ---- Structural: landing, tabs, list ---------------------------------------
check('sidebar keeps ONE Employees section', (INDEX.match(/id="tab-teachers"/g) || []).length === 1);
check('three category tabs exist with counts',
  ['empTab-teaching', 'empTab-management', 'empTab-non-teaching', 'empCount-teaching', 'empCount-management', 'empCount-non-teaching'].every(id => INDEX.includes(`id="${id}"`)));
check('tabs call the canonical setter', INDEX.includes("setEmployeeCategory('teaching')") && INDEX.includes("setEmployeeCategory('management')") && INDEX.includes("setEmployeeCategory('non-teaching')"));
// Owner screenshot directive (2026-10-29): the in-category search box
// was removed again — the global search covers it.
check('in-category search box removed (owner directive)', !INDEX.includes('id="empSearchInput"'));
check('default category is Teaching', TEACHERS.includes("window.EMP_CATEGORY_TAB || 'teaching'"));
check('old card templates are gone', !TEACHERS.includes('CARD: TEACHING STAFF') && !TEACHERS.includes('CARD: MANAGER') && !TEACHERS.includes('CARD: OTHER STAFF'));
check('list renders a table with the agreed columns (Designation removed by owner directive)',
  TEACHERS.includes('class="emp-table"') && ['Employee', 'Category', 'Contact', 'Students', 'Compensation', 'Status', 'Actions'].every(h => TEACHERS.includes(`<th>${h}</th>`)) && !TEACHERS.includes('<th>Designation</th>'));
check('mobile stacking CSS present (no horizontal scroll)', INDEX.includes('.emp-table td[data-label]::before') && INDEX.includes('@media (max-width: 767px)'));
check('grid container no longer forces card columns', !INDEX.includes('id="teachersGrid" class="grid'));

// ---- Actions (owner-trimmed 2026-10-29) ---------------------------------------
// Kept: name -> 360 profile, Schedule Matrix (now a text button),
// Quick Zoom, trials link, Delete. Removed by the owner's screenshot
// crosses: 360 button, Edit button, credential copy, WhatsApp send,
// copy Zoom link, Zoom sync.
for (const fn of ['openTeacher360Profile', 'open2DMatrixForTeacher', 'openQuickZoomModal', 'viewTeacherTrialsHistory', 'setStaffDeactivated']) {
  check(`action preserved in list: ${fn}`, TEACHERS.includes(`onclick="${fn}(`) || TEACHERS.includes(`onclick="${fn}`));
}
check('Schedule Matrix is a labelled button now', TEACHERS.includes('>Schedule Matrix</button>'));
check('crossed actions are gone from the list render block',
  (() => { const blk = TEACHERS.slice(TEACHERS.indexOf('EMPLOYEES REDESIGN'), TEACHERS.indexOf('window.setEmployeeCategory'));
    return !blk.includes('>360° Profile</button>') && !blk.includes('>Edit</button>') && !blk.includes('copyTeacherCredentials(') && !blk.includes('copyManagerCredentials(') && !blk.includes('wa.me/') && !blk.includes('triggerTeacherZoomSync('); })());
check('Quick Zoom stays inside the teaching branch only',
  (() => { const blk = TEACHERS.slice(TEACHERS.indexOf('EMPLOYEES REDESIGN')); const t0 = blk.indexOf("if (category === 'teaching')"); const m0 = blk.indexOf("} else if (category === 'management')"); const z = blk.indexOf('openQuickZoomModal'); return t0 > -1 && z > t0 && z < m0; })());
check('manager-session plain row rule preserved', TEACHERS.includes('Manager account — owner only'));
check('needs-review badge wired to the conflict flag', TEACHERS.includes('Needs review') && TEACHERS.includes('StaffCategories.hasConflict'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
