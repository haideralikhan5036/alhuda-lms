// Employees redesign E2 — Management / Non-Teaching separation from
// student-related data in the payroll slip modal and the 360 profile.
// Structural checks on the real files (the render functions need the
// full portal DOM; the data-level gates are asserted at their exact
// positions in the pipeline).
// Run from the repo root:  node test/employees-separation.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const PAYROLL = read('js/payroll.js');
const P360 = read('js/profiles360.js');
const INDEX = read('index.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Payroll slip modal -----------------------------------------------------
check('index: slip students section has an id', INDEX.includes('id="slipStudentsSection"'));
check('index: slip increment cell has an id', INDEX.includes('id="slipIncrementCell"'));
check('payroll: slip category resolved via the canonical classifier',
  PAYROLL.includes('StaffCategories.of(slipTeacherRec)'));
check('payroll: students section hidden for non-teaching slips',
  PAYROLL.includes("studentsSection.classList.toggle('hidden', !slipIsTeaching)"));
check('payroll: per-student increment hidden for non-teaching slips',
  PAYROLL.includes("incCell.classList.toggle('hidden', !slipIsTeaching)"));
check('payroll: students table only renders for teaching slips',
  PAYROLL.includes('if (tbody && slipIsTeaching)'));
check('payroll: "No students assigned" text survives ONLY inside the teaching-gated render',
  PAYROLL.indexOf('No students assigned yet.') > PAYROLL.indexOf('if (tbody && slipIsTeaching)'));
check('payroll: financial snapshot on save is unchanged',
  PAYROLL.includes('student_items_snapshot: slipData.assigned_students'));
check('payroll: manager-slip block for manager sessions unchanged (Batch 2)',
  PAYROLL.includes('_payrollBlockManagerRecord(teacherId)'));

// ---- 360 profile --------------------------------------------------------------
check('360: student aggregates are mutable for the separation gate',
  P360.includes('let allMatchedStudents') && P360.includes('let activeStudents'));
check('360: aggregates emptied at the DATA level for manager/other staff',
  P360.includes('if (isManager || isOtherStaff)') && P360.includes('allMatchedStudents = [];'));
check('360: data gate runs BEFORE the salary engine section',
  P360.indexOf('allMatchedStudents = [];') < P360.indexOf('Authoritative Salary & Payroll Engine'));
check('360: Students nav tab omitted for non-teaching profiles',
  P360.includes("(state.isManager || state.isOtherStaff) ? [] : [{ id: 'students'"));
check('360: a students tab request lands on Bio Data for non-teaching',
  P360.includes("&& resolvedTab === 'students') resolvedTab = 'biodata';"));
check('360: salary tab + restricted-payroll rule for manager viewers unchanged',
  P360.includes('mgrViewingManagerRecord ? restrictedPayrollHtml'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
