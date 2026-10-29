// Employees redesign E3 — Staff Category selector in the employee
// form: canonical values, populated on edit, persisted on save to
// every meta home the classifier reads, manager-role guard.
// Run from the repo root:  node test/employees-category-edit.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHERS = read('js/teachers.js');
const INDEX = read('index.html');
const CONFIG = read('js/config.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

check('form: Staff Category select exists with the 3 canonical values',
  INDEX.includes('id="tStaffCategory"') &&
  INDEX.includes('<option value="teaching">Teaching Staff</option>') &&
  INDEX.includes('<option value="management">Management Staff</option>') &&
  INDEX.includes('<option value="non-teaching">Non-Teaching Staff</option>'));
check('edit: selector populated from the canonical classifier',
  TEACHERS.includes('catSelEdit.value = (typeof StaffCategories') && TEACHERS.includes('StaffCategories.of(teacher)'));
check('add: selector defaults to Teaching', TEACHERS.includes("catSelAdd.value = 'teaching'"));
check('save: selector read once, mapped via StaffCategories.EMPLOYEE_TYPE',
  TEACHERS.includes("document.getElementById('tStaffCategory')?.value || 'teaching'") &&
  TEACHERS.includes('StaffCategories.EMPLOYEE_TYPE[staffCategorySel]'));
check('save: a signed-in manager cannot grant the Management category',
  TEACHERS.includes("staffCategorySel === 'management' && typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager'"));
check('update: employee_type written into the address meta merge',
  TEACHERS.includes('origMeta.employee_type = staffCategoryEmpType;'));
check('update: employee_type also written into notes meta when it lives there',
  TEACHERS.includes("'employee_type' in nMeta") && TEACHERS.includes('notesToSave = JSON.stringify(nMeta)'));
check('update: account map receives employee_type', TEACHERS.includes('employee_type: staffCategoryEmpType'));
// Owner screenshot directive (2026-10-29): the Edit buttons were
// removed from the list rows again; the form + handler remain in code.
check('list: Edit buttons removed from rows (owner directive); edit handler still exists',
  !TEACHERS.slice(TEACHERS.indexOf('EMPLOYEES REDESIGN'), TEACHERS.indexOf('window.setEmployeeCategory')).includes('>Edit</button>') &&
  TEACHERS.includes('function openEditTeacherModal(teacherId)'));
check('config: EMPLOYEE_TYPE vocabulary unchanged (teacher/manager/other_staff)',
  CONFIG.includes("EMPLOYEE_TYPE: { teaching: 'teacher', management: 'manager', 'non-teaching': 'other_staff' }"));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
