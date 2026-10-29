// Employees deactivation (owner directive 2026-10-29) — a Deactivated
// Staff view on the same Employees screen; staff of every category land
// there after deactivation; NOTHING is hard-deleted (status change
// only), and Reactivate restores the record to its category.
// Run from the repo root:  node test/employees-deactivation.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHERS = read('js/teachers.js');
const INDEX = read('index.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

check('Deactivated Staff tab exists on the Employees screen with its own count',
  INDEX.includes('id="empTab-deactivated"') && INDEX.includes('id="empCount-deactivated"') &&
  INDEX.includes("setEmployeeCategory('deactivated')") && INDEX.includes('Deactivated Staff'));
check('tab switch accepts the deactivated view',
  TEACHERS.includes("['teaching', 'management', 'non-teaching', 'deactivated'].includes(cat)"));
check('deactivated flag derives from the backend inactive statuses',
  TEACHERS.includes("['inactive', 'deactivated', 'terminated'].includes(statusNorm)"));
check('category counts exclude deactivated; deactivated count spans all categories',
  TEACHERS.includes('if (r.isDeactivated) catCounts.deactivated += 1;'));
check('category tabs hide deactivated; the Deactivated view shows only them',
  TEACHERS.includes("activeCat === 'deactivated' ? r.isDeactivated : (r.category === activeCat && !r.isDeactivated)"));
check('deactivation handler exists and is owner-side (managers blocked)',
  TEACHERS.includes('async function setStaffDeactivated(teacherId, deactivate)') &&
  TEACHERS.includes("Managers cannot deactivate or reactivate staff records."));
check('deactivation is a STATUS-ONLY update (Deactivated / Active)',
  TEACHERS.includes("db.from('teachers').update({ status: deactivate ? 'Deactivated' : 'Active' })"));
check('confirm dialog promises data preservation in plain words',
  TEACHERS.includes('No data will be deleted.'));
check('NO hard-delete path for staff remains in teachers.js',
  !TEACHERS.includes('deleteTeacher') && !TEACHERS.includes("db.from('teachers').delete()") && !TEACHERS.includes("db.from('class_schedules').delete()"));
check('active rows offer Deactivate; deactivated rows offer Reactivate only',
  TEACHERS.includes("setStaffDeactivated('${t.id}', true)") && TEACHERS.includes("setStaffDeactivated('${t.id}', false)") &&
  TEACHERS.includes('>Reactivate</button>') && TEACHERS.includes('if (isDeactivated)'));
check('reactivation returns the person to their own category tab',
  TEACHERS.includes('if (!deactivate) window.EMP_CATEGORY_TAB = category;'));
check('status badge in the list reads Deactivated',
  TEACHERS.includes('>Deactivated</span>'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
