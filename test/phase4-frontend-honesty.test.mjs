// Phase 4 Batch 4.1 — teacher/parent frontend honesty (audit P3 items).
// x:  reschedule default maps stored Completed -> Absent (was: never).
// y:  no invented 'TCH-001' teacher id; session guard fails honestly.
// aa: auto-complete once-a-day marker consumed only AFTER verification.
// cc: "Total Earnings" counts PAID vouchers only.
// dd: dead legacy auth helpers removed from teacher.html.
// ee: parent timetable shows EVERY slot per weekday (was: first only).
// ff: parent local fee-cache fallback requires a family-id match.
// gg: parent leave form says Return Date (matches stored semantics).
// hh: parent lesson-image failure shows a visible placeholder.
// ii: dead auth helper removed from parent.html.
// Run from the repo root:  node test/phase4-frontend-honesty.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER = read('teacher.html');
const PARENT = read('parent.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// x — reschedule opposite mapping
check('x: delivered (Completed/Present) defaults the request to Absent',
  TEACHER.includes("(c.log.status === 'Completed' || c.log.status === 'Present') ? 'Absent' : 'Present'"));
check('x: old never-Absent mapping removed',
  !TEACHER.includes("c.log.status === 'Present' ? 'Absent' : 'Present'"));

// y — no invented teacher id
check('y: no TCH-001 fallback anywhere in teacher.html', !TEACHER.includes('TCH-001'));
check('y: leave submit guards on a live session first',
  TEACHER.includes("if (!CURRENT_TEACHER?.id) throw new Error('Teacher session not found. Please log in again.');"));

// aa — marker consumed after verification only
const markerSets = TEACHER.split('localStorage.setItem(markerKey').length - 1;
check('aa: marker written exactly once', markerSets === 1, 'count=' + markerSets);
check('aa: the single marker write happens after the verified check',
  TEACHER.indexOf('localStorage.setItem(markerKey') > TEACHER.indexOf('if (!verified)'));

// cc — earnings are paid-only
check('cc: effectiveEarnings is the paid total',
  TEACHER.includes('const effectiveEarnings = totalPaid;'));
check('cc: unpaid-sum fallback removed',
  !TEACHER.includes('fallback to total net of available vouchers'));

// dd — dead teacher helpers gone
check('dd: fetchTeachersAndAccountsFromBackend removed', !TEACHER.includes('fetchTeachersAndAccountsFromBackend'));
check('dd: resolveTeacherCreds removed', !TEACHER.includes('resolveTeacherCreds'));

// ee — timetable shows all slots per day
check('ee: timetable filters all slots for the day (no first-match find)',
  PARENT.includes('.filter(sc => sc.day_of_week === d.num)') &&
  !PARENT.includes('schedules.find(sc => sc.day_of_week === d.num)'));
check('ee: multi-slot day gets a count badge + per-slot Zoom links',
  PARENT.includes('${matches.length} classes') && PARENT.includes('slotsHtml'));

// ff — fee-cache fallback family-id only
check('ff: name-based fallback removed',
  !PARENT.includes('rStuNames.includes'));
check('ff: family-id match is required and non-empty',
  PARENT.includes("return famIdStr !== '' && rFamId === famIdStr;"));

// gg — return-date wording matches the stored semantics
check('gg: leave form label says Return Date', PARENT.includes('>Return Date:</label>'));
check('gg: old End Date label gone from the leave form', !PARENT.includes('>End Date:</label>'));
check('gg: submit prompt aligned', PARENT.includes('Please select both a start date and a return date.'));
check('gg: helper sentence explains first-day-back', PARENT.includes('The return date is the first day your child is back in class.'));

// hh — image failure is visible
check('hh: placeholder text present', PARENT.includes('Lesson image could not be loaded.'));
check('hh: placeholder replaces the img element', PARENT.includes('img.replaceWith(ph)'));

// ii — dead parent helper gone
check('ii: fetchFamiliesAndStudentsForAuth removed', !PARENT.includes('fetchFamiliesAndStudentsForAuth'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
