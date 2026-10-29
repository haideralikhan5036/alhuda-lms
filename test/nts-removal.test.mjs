// Non-Teaching Staff ADD option removed (owner directive 2026-10-29:
// "ab is option ki zarorat ni reh jati... sirf teacher wala button
// kaafi ha"). The Add New Employee chooser (Teaching vs Non-Teaching
// cards), the Register Non-Teaching Staff form (Manager/Other Staff
// designation toggle), and its manager-success modal are gone from
// the admin/manager portal; "+ Add New Employee" opens the teacher
// form directly, and managers are added via the dedicated owner-only
// Add Manager button (PR #83). Existing non-teaching RECORDS and the
// category tabs/classification are untouched — only the add path was
// removed. Structural suite.
// Run from the repo root:  node test/nts-removal.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const TEACHERS = fs.readFileSync(path.join(REPO_ROOT, 'js/teachers.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

check('chooser modal removed', !INDEX.includes('modalChooseEmployeeType'));
check('NTS registration modal removed', !INDEX.includes('modalAddNonTeachingStaff'));
check('NTS manager-success modal removed', !INDEX.includes('modalManagerRegisteredSuccess'));
check('no NTS form fields remain', !INDEX.includes('ntsFullName') && !INDEX.includes('ntsDesignation') && !INDEX.includes('btnNTSManager'));
check('Add New Employee opens the teacher form directly', INDEX.includes('onclick="prepareAddTeacherModal()"') && !INDEX.includes('openEmployeeTypeChoice()'));
check('NTS JS flow removed from teachers.js', !TEACHERS.includes('function openNonTeachingStaffModal') && !TEACHERS.includes('function submitNonTeachingStaff') && !TEACHERS.includes('function selectNTSDesignation') && !TEACHERS.includes('function openEmployeeTypeChoice'));
check('exactly one getNextManagerId definition survives', (TEACHERS.match(/function getNextManagerId\(\)/g) || []).length === 1);
check('Add Manager flow intact (PR #83)', TEACHERS.includes('function prepareAddManagerModal()') && INDEX.includes('id="btnAddManager"'));
check('teacher add/edit form intact', INDEX.includes('id="modalAddTeacher"') && TEACHERS.includes('function handleSaveTeacher'));
check('existing staff categories untouched (records still classify)', CONFIG.includes('StaffCategories') && CONFIG.includes("'non-teaching'"));
check('deactivation flow untouched', TEACHERS.includes('Deactivated Staff') || INDEX.includes('Deactivated Staff'));

const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
