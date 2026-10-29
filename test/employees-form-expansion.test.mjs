// Employee form expansion (owner directive 2026-10-29): the Add/Edit
// Teacher form gains the bio-data fields that previously existed only
// in the 360 edit form (all optional), an owner-only Add Manager flow,
// a manager-session Teaching-only restriction, an honest bio-data tab,
// and a scoped font/design polish for the form.
import fs from 'node:fs';

const HTML = fs.readFileSync('index.html', 'utf8');
const TEACHERS = fs.readFileSync('js/teachers.js', 'utf8');
const P360 = fs.readFileSync('js/profiles360.js', 'utf8');

const results = [];
function check(name, cond) { results.push({ name, pass: !!cond }); }

// ---- New optional fields exist in the form ----
for (const id of ['tEmail', 'tNationality', 'tQualification2', 'tQualification3', 'tExperience',
  'tTimezone', 'tMonthlySalary', 'tHourRate', 'tBankName', 'tAccountTitle', 'tAccountNumber']) {
  check('form field present: ' + id, HTML.includes('id="' + id + '"'));
}
check('sections labelled optional', HTML.includes('6. Additional Bio Data') && HTML.includes('7. Bank &amp; Fixed Salary'));

// ---- Fields are read, saved (both branches) and refilled ----
check('save reads the extra fields', TEACHERS.includes('function readTeacherExtraFields()'));
check('both save payloads carry the extras', (TEACHERS.split('...extraFields').length - 1) === 2);
check('edit form refills the extras', TEACHERS.includes('fillTeacherExtraFields(acc)'));
check('add form clears the extras', TEACHERS.includes('clearTeacherExtraFields()'));
check('canonical meta keys used', TEACHERS.includes("qualification_02: v('tQualification2')") && TEACHERS.includes("account_number: v('tAccountNumber')") && TEACHERS.includes("monthly_salary: n('tMonthlySalary')"));

// ---- Add Manager flow ----
check('header has the Add Manager button', HTML.includes('id="btnAddManager"') && HTML.includes('onclick="prepareAddManagerModal()"'));
check('button starts hidden (JS reveals for owner)', HTML.includes('id="btnAddManager"') && HTML.includes('style="display:none"'));
check('prepareAddManagerModal exists + owner guard', TEACHERS.includes('function prepareAddManagerModal()') && TEACHERS.includes('Managers cannot add Management staff'));
check('manager mode locks the category to Management', TEACHERS.includes("catSel.value = 'management'; catSel.disabled = true;"));
check('MGR- employee codes generated', TEACHERS.includes('function getNextManagerId()') && TEACHERS.includes("'MGR-' + String(max + 1).padStart(3, '0')"));
check('button revealed only for non-managers on load', TEACHERS.includes("getElementById('btnAddManager')") && TEACHERS.includes("CURRENT_ROLE === 'manager') ? 'none' : ''"));
check('new-record password role follows the category', TEACHERS.includes("setAccountPasswordViaWorker(staffCategorySel === 'management' ? 'manager' : 'teacher', insertedId, password)"));

// ---- Manager sessions: Teaching-only adds ----
check('management option disabled for manager sessions', TEACHERS.includes("mgrOpt.disabled = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager')"));
check('category availability synced on add + edit', (TEACHERS.split('syncStaffCategoryAvailability();').length - 1) >= 2);
check('save-time hard block kept (defence in depth)', TEACHERS.includes('Managers cannot assign the Management Staff category'));

// ---- Bio-data tab honesty: no fabricated personal values ----
check('bio: no invented qualification', !P360.includes("meta.qualification || 'Alimiyah"));
check('bio: no invented experience', !P360.includes("meta.experience || 'Certified Quran Instructor'"));
check('bio: no generated email', !P360.includes('@alhudaislamic.com` }'));
check('bio: monthly salary prefers the fixed-salary field', P360.includes('meta.monthly_salary || meta.salary'));

// ---- Form design polish ----
check('scoped form style present', HTML.includes('#modalAddTeacher input:not([type="checkbox"]):not([type="hidden"])') && HTML.includes('#modalTeacherTitle { font-size: 17px; }'));

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + ' | ' + r.name);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
