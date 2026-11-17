// Fee Upgrade Phase 2 — Bulk Leave (#55).
// Executes the REAL functions from js/fee-phase2.js in a vm sandbox.
// Run from the repo root: node test/fee-phase2-bulk-leave.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE2_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase2.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function loadPhase2() {
  const windowObj = {};
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PHASE2_SRC, sandbox);
  return windowObj.FeePhase2;
}

const F = loadPhase2();
const TODAY = '2026-11-17';

const FAMS = [
  { id: 'FAM-021', parent_name: 'Hajra Waqas', status: 'Active', students: [
    { id: 'STU-027', name: 'Ayesha', status: 'Active', family_id: 'FAM-021', notes: '{}' },
    { id: 'STU-028', name: 'Bilal', status: 'Active', family_id: 'FAM-021', notes: JSON.stringify({ on_leave: true, leave_start_date: '2026-11-01', return_date: '2026-11-30' }) }
  ] },
  { id: 'FAM-004', parent_name: 'Mohib Khan', status: 'Active', students: [
    { id: 'STU-007', name: 'Mohib', status: 'Active', family_id: 'FAM-004', notes: '{}' },
    { id: 'STU-008', name: 'Zara', status: 'Deactivated', family_id: 'FAM-004', notes: '{}' }
  ] },
  { id: 'FAM-009', parent_name: 'Sara Ahmed', status: 'Deactivated', students: [
    { id: 'STU-009', name: 'Sara', status: 'Active', family_id: 'FAM-009', notes: '{}' }
  ] },
  { id: 'FAM-010', parent_name: 'No Students', status: 'Active', students: [] }
];

// ---- student state ------------------------------------------------------------
check('studentLeaveState ok for an active student', F.studentLeaveState({ status: 'Active', notes: '{}' }, TODAY) === 'ok');
check('studentLeaveState deactivated by status', F.studentLeaveState({ status: 'Deactivated', notes: '{}' }, TODAY) === 'deactivated');
check('studentLeaveState deactivated by is_active false', F.studentLeaveState({ status: 'Active', is_active: false, notes: '{}' }, TODAY) === 'deactivated');
check('studentLeaveState deactivated for left status', F.studentLeaveState({ status: 'Left', notes: '{}' }, TODAY) === 'deactivated');
check('studentLeaveState on-leave from notes meta', F.studentLeaveState({ status: 'Active', notes: JSON.stringify({ on_leave: true, return_date: '2026-11-30' }) }, TODAY) === 'on-leave');
check('studentLeaveState tolerates broken notes JSON', F.studentLeaveState({ status: 'Active', notes: '{broken' }, TODAY) === 'ok');
check('studentLeaveState null student is deactivated', F.studentLeaveState(null, TODAY) === 'deactivated');

// ---- family picker --------------------------------------------------------------
{
  const picked = F.bulkLeaveFamilies(FAMS, TODAY);
  check('bulkLeaveFamilies keeps Active families only', picked.length === 2 && picked.every(f => f.status === 'Active'));
  check('bulkLeaveFamilies excludes the deactivated family', picked.every(f => f.id !== 'FAM-009'));
  check('bulkLeaveFamilies excludes a family with no students', picked.every(f => f.id !== 'FAM-010'));
  check('bulkLeaveFamilies classifies each student state', picked[0].students[0].state === 'ok' && picked[0].students[1].state === 'on-leave' && picked[1].students[1].state === 'deactivated');
  check('bulkLeaveFamilies treats a missing status as Active', F.bulkLeaveFamilies([{ id: 'FAM-100', parent_name: 'No Status', students: [{ id: 'STU-100', name: 'Kid', status: 'Active', notes: '' }] }], TODAY).length === 1);
  check('bulkLeaveFamilies on empty input is []', F.bulkLeaveFamilies([], TODAY).length === 0 && F.bulkLeaveFamilies(null, TODAY).length === 0);
}

// ---- month options / window ------------------------------------------------------
{
  const opts = F.bulkLeaveMonthOptions(TODAY, 6);
  check('bulkLeaveMonthOptions starts at the current month', opts.length === 6 && opts[0].label === 'November 2026' && opts[0].monthIdx === 10 && opts[0].year === 2026);
  check('bulkLeaveMonthOptions rolls over the year', opts[2].label === 'January 2027' && opts[5].label === 'April 2027');
  const win = F.leaveWindowForMonths([{ year: 2026, monthIdx: 10 }, { year: 2026, monthIdx: 11 }]);
  check('leaveWindowForMonths Nov+Dec 2026 is Nov 1 to Dec 31', win.startDate === '2026-11-01' && win.returnDate === '2026-12-31');
  const feb = F.leaveWindowForMonths([{ year: 2027, monthIdx: 1 }]);
  check('leaveWindowForMonths Feb 2027 ends Feb 28 (not a leap year)', feb.startDate === '2027-02-01' && feb.returnDate === '2027-02-28');
  const leap = F.leaveWindowForMonths([{ year: 2028, monthIdx: 1 }]);
  check('leaveWindowForMonths Feb 2028 ends Feb 29 (leap year)', leap.returnDate === '2028-02-29');
  const unsorted = F.leaveWindowForMonths([{ year: 2026, monthIdx: 11 }, { year: 2026, monthIdx: 10 }]);
  check('leaveWindowForMonths sorts an unsorted selection', unsorted.startDate === '2026-11-01' && unsorted.returnDate === '2026-12-31');
  check('leaveWindowForMonths empty is null', F.leaveWindowForMonths([]) === null && F.leaveWindowForMonths(null) === null);
}

// ---- validation -------------------------------------------------------------------
{
  const fams = F.bulkLeaveFamilies(FAMS, TODAY);
  const months = [{ year: 2026, monthIdx: 10 }, { year: 2026, monthIdx: 11 }];
  const good = F.validateBulkLeave({ families: fams, months, reason: 'Family Vacation / Traveling Abroad' }, TODAY);
  check('validateBulkLeave happy path is ok with window + summary', good.ok === true && good.window.startDate === '2026-11-01' && good.window.returnDate === '2026-12-31' && good.summary.families === 2 && good.summary.months === 2 && good.summary.students === 2 && good.summary.familyMonths === 4);
  check('validateBulkLeave refuses no families', F.validateBulkLeave({ families: [], months, reason: 'x' }, TODAY).ok === false);
  check('validateBulkLeave refuses no months', F.validateBulkLeave({ families: fams, months: [], reason: 'x' }, TODAY).ok === false);
  check('validateBulkLeave refuses an empty reason', F.validateBulkLeave({ families: fams, months, reason: '   ' }, TODAY).ok === false);
  check('validateBulkLeave refuses a reason over 160 chars', F.validateBulkLeave({ families: fams, months, reason: 'x'.repeat(161) }, TODAY).ok === false);
  check('validateBulkLeave refuses all-past months', F.validateBulkLeave({ families: fams, months: [{ year: 2026, monthIdx: 8 }], reason: 'x' }, TODAY).ok === false);
  check('validateBulkLeave accepts a month that started in the past but ends in the future', F.validateBulkLeave({ families: fams, months: [{ year: 2026, monthIdx: 10 }], reason: 'x' }, TODAY).ok === true);
  const allOnLeave = [{ id: 'FAM-021', parentName: 'Hajra Waqas', status: 'Active', students: [{ id: 'STU-028', name: 'Bilal', status: 'Active', notes: '', state: 'on-leave' }] }];
  check('validateBulkLeave refuses when nothing can go on leave', F.validateBulkLeave({ families: allOnLeave, months, reason: 'x' }, TODAY).ok === false);
}

// ---- runner -----------------------------------------------------------------------
{
  const fams = F.bulkLeaveFamilies(FAMS, TODAY);
  const win = F.leaveWindowForMonths([{ year: 2026, monthIdx: 10 }, { year: 2026, monthIdx: 11 }]);
  const calls = [];
  const deps = {
    applyLeave: async (studentId, input) => {
      calls.push({ studentId, input });
      if (studentId === 'STU-007') return { ok: false, error: 'Could not save the leave.' };
      return { ok: true, studentName: studentId };
    }
  };
  const seen = [];
  const res = await F.runBulkLeave(fams, win, 'Family Vacation / Traveling Abroad', { ...deps, onFamily: (i, total, famResult) => seen.push(famResult) });
  check('runBulkLeave calls applyLeave only for ok students', calls.length === 2 && calls.every(c => ['STU-027', 'STU-007'].includes(c.studentId)));
  check('runBulkLeave passes the window + reason to every call', calls.every(c => c.input.startDate === '2026-11-01' && c.input.returnDate === '2026-12-31' && c.input.reason === 'Family Vacation / Traveling Abroad'));
  check('runBulkLeave skips on-leave + deactivated students and reports them', res.studentsSkipped === 2 && res.results[0].skipped.length === 1 && res.results[1].skipped.length === 1);
  check('runBulkLeave continues past a failed student', res.studentsOnLeave === 1 && res.studentsFailed === 1 && res.results.length === 2);
  check('runBulkLeave marks the family with the failure as failed', res.results[0].ok === true && res.results[1].ok === false && res.familiesDone === 1 && res.familiesFailed === 1);
  check('runBulkLeave calls onFamily for every family', seen.length === 2);

  // applyLeave warnings (schedule clean-up partial failure) are kept, not lost.
  const warnRes = await F.runBulkLeave([fams[0]], win, 'x', {
    applyLeave: async (id) => ({ ok: true, failures: ['the salary assignment could not be closed'] })
  });
  check('runBulkLeave keeps applyLeave partial-failure warnings', warnRes.results[0].warnings.length === 1 && warnRes.results[0].ok === true && warnRes.studentsOnLeave === 1);

  let threw = false;
  try { await F.runBulkLeave(fams, null, 'x', deps); } catch (e) { threw = true; }
  check('runBulkLeave throws without a leave window', threw);
  let threw2 = false;
  try { await F.runBulkLeave(fams, win, 'x', {}); } catch (e) { threw2 = true; }
  check('runBulkLeave throws without a leave function', threw2);
  const emptyRes = await F.runBulkLeave([], win, 'x', deps);
  check('runBulkLeave on empty families is all zeros', emptyRes.familiesDone === 0 && emptyRes.studentsOnLeave === 0 && emptyRes.results.length === 0);
}

// ---- modal / confirm / summary HTML -------------------------------------------------
{
  const fams = F.bulkLeaveFamilies(FAMS, TODAY);
  const months = F.bulkLeaveMonthOptions(TODAY, 3);
  const html = F.bulkLeaveModalHtml(fams, months);
  check('bulkLeaveModalHtml lists families + months + reason select', html.includes('FAM-021') && html.includes('Hajra Waqas') && html.includes('November 2026') && html.includes('bulkLeaveReasonSelect') && html.includes('Review &amp; Apply'));
  check('bulkLeaveModalHtml notes already-on-leave students', html.includes('1 already on leave'));
  check('bulkLeaveModalHtml has pick/confirm/progress areas + buttons', html.includes('bulkLeavePickArea') && html.includes('bulkLeaveConfirmArea') && html.includes('bulkLeaveProgressArea') && html.includes('btnBulkLeaveReview') && html.includes('btnBulkLeaveApply') && html.includes('btnBulkLeaveBack'));
  const conf = F.bulkLeaveConfirmHtml({ families: 2, months: 2, students: 2 }, { startDate: '2026-11-01', returnDate: '2026-12-31' }, 'Family Vacation / Traveling Abroad');
  check('bulkLeaveConfirmHtml shows counts, dates, reason + billing note', conf.includes('2 families') && conf.includes('2026-11-01') && conf.includes('2026-12-31') && conf.includes('Family Vacation') && conf.includes('excluded from billing'));
  const famHtml = F.bulkLeaveFamilyResultHtml({ familyId: 'FAM-021', parentName: 'Hajra Waqas', applied: ['Ayesha'], failed: [], skipped: [{ name: 'Bilal', reason: 'Already on leave — skipped' }], warnings: [], ok: true });
  check('bulkLeaveFamilyResultHtml shows applied + skipped', famHtml.includes('Ayesha') && famHtml.includes('Already on leave'));
  const sumHtml = F.bulkLeaveSummaryHtml({ familiesDone: 1, familiesFailed: 1, studentsOnLeave: 1, studentsSkipped: 2, studentsFailed: 1 });
  check('bulkLeaveSummaryHtml shows counts + Done button', sumHtml.includes('1 families done, 1 with errors') && sumHtml.includes('Students on leave: <strong>1</strong>') && sumHtml.includes('modalBulkLeave'));
  check('bulkLeaveModalHtml escapes family names', F.bulkLeaveModalHtml([{ id: 'FAM-1', parentName: '<b>X</b>', status: 'Active', students: [{ id: 'S1', name: 'Kid', state: 'ok' }] }], months).includes('&lt;b&gt;X&lt;/b&gt;'));
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
