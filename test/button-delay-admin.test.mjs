// Button-delay build (2026-11-20) — admin portal.
// Behavioural tests for the bounded-concurrency Bulk Collect and the
// cached Assignments.loadAll, plus source-structure checks for the
// cache-reuse / parallel / debounce / skeleton changes that live in
// files too big to execute in a vm (dashboard, trials, leaves,
// payroll, schedule, profiles360, navigation, config, fees).
// Run from the repo root: node test/button-delay-admin.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
const fnBody = (src, startMarker, endMarkers) => {
  const s = src.indexOf(startMarker);
  if (s < 0) return '';
  let e = src.length;
  for (const m of endMarkers) {
    const i = src.indexOf(m, s + startMarker.length);
    if (i >= 0 && i < e) e = i;
  }
  return src.slice(s, e);
};

// ---- Assignments.loadAll caching (behavioural, vm) -------------------------
async function testAssignmentsCache() {
  const src = read('js/assignments.js');
  let fakeNow = 1_000_000;
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [fakeNow])); }
    static now() { return fakeNow; }
  }
  let dbCalls = 0;
  let resolveGate = null;
  const fakeDb = {
    from(table) {
      return {
        select() {
          dbCalls++;
          return new Promise((resolve) => { resolveGate = () => resolve({ data: [{ id: 'ASG-1', student_id: 'STU-1', teacher_id: 'TCH-1', course_name: 'Qaida', start_date: '2026-11-01', end_date: null }] }); });
        }
      };
    }
  };
  const windowObj = {};
  const sandbox = { window: windowObj, document: { readyState: 'loading', addEventListener() {} }, console, db: fakeDb, Date: FakeDate, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox);
  const A = windowObj.Assignments;
  check('Assignments module loads', !!A && typeof A.loadAll === 'function');

  // Two concurrent calls share one in-flight fetch.
  const p1 = A.loadAll();
  const p2 = A.loadAll();
  check('concurrent loadAll calls share one fetch (no call yet resolved)', dbCalls === 1);
  resolveGate();
  const r1 = await p1;
  const r2 = await p2;
  check('concurrent loadAll calls resolve to the same rows', r1.length === 1 && r2 === r1 && dbCalls === 1);

  // Warm cache: no fresh fetch.
  await A.loadAll();
  check('warm-cache loadAll does not refetch the ledger', dbCalls === 1);

  // After the 60 s TTL the next call refetches once.
  fakeNow += 61_000;
  const p3 = A.loadAll();
  check('expired-cache loadAll refetches', dbCalls === 2);
  resolveGate();
  await p3;
  await A.loadAll();
  check('refreshed cache is warm again', dbCalls === 2);

  // Force reload bypasses the warm cache.
  const p4 = A.loadAll({ force: true });
  check('force loadAll refetches even when warm', dbCalls === 3);
  resolveGate();
  await p4;
}
await testAssignmentsCache();

// ---- Bulk Collect bounded concurrency (behavioural, vm) --------------------
async function testBulkCollect() {
  const src = read('js/fee-phase2.js');
  const windowObj = {};
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox);
  const F = windowObj.FeePhase2;
  check('Bulk Collect concurrency is bounded at 5', F.bulkCollectConcurrency === 5);

  const rows = [];
  for (let i = 1; i <= 12; i++) {
    rows.push({ familyId: 'FAM-' + String(i).padStart(3, '0'), parentName: 'Parent ' + i, studentsNames: 'Kid ' + i, country: 'Pakistan', whatsapp: '', email: '', currency: 'PKR', dueAmount: 1000 + i, selectedMonth: 'November', selectedYear: 2026, isPartial: false, status: 'Pending', family: { id: 'FAM-' + String(i).padStart(3, '0'), monthly_fee: 1000 + i } });
  }
  const list = F.bulkCollectRows(rows);
  let inFlight = 0;
  let maxInFlight = 0;
  let lastSaveEnd = 0;
  let firstEmailStart = Infinity;
  const emailOrder = [];
  const saveOrder = [];
  const deps = {
    generateReceiptNo: (() => { let n = 0; return () => 'AH-REC-20261120-R' + String(++n).padStart(2, '0'); })(),
    saveRecord: async (rec) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      saveOrder.push(rec.familyId);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      lastSaveEnd = Date.now();
      return { ok: true, receiptNo: rec.receiptNo };
    },
    sendEmail: async (rec) => {
      if (firstEmailStart === Infinity) firstEmailStart = Date.now();
      emailOrder.push(rec.familyId);
      await new Promise((r) => setTimeout(r, 2));
    },
    emailReceipts: true,
    monthlyFeeForRow: (row) => row.dueAmount,
    priorPaidForRow: () => 0,
    onRow: () => {}
  };
  const res = await F.runBulkCollect(list, deps);
  check('bounded Bulk Collect still pays every row', res.paid === 12 && res.failed === 0 && res.results.length === 12);
  check('Bulk Collect results stay in input order', res.results.every((r, i) => r.row.familyId === list[i].familyId));
  check('Bulk Collect runs families in parallel (max in flight > 1)', maxInFlight > 1);
  check('Bulk Collect never exceeds 5 families in flight', maxInFlight <= 5, 'max=' + maxInFlight);
  check('Bulk Collect sends receipt emails only after all saves finish', firstEmailStart >= lastSaveEnd && emailOrder.length === 12);
  check('Bulk Collect emails go in input order', emailOrder.every((id, i) => id === list[i].familyId));

  // A failing email still never fails its row.
  const emailFail = await F.runBulkCollect(list.slice(0, 1), {
    ...deps,
    emailReceipts: true,
    sendEmail: async () => { throw new Error('relay down'); }
  });
  check('Bulk Collect email failure is reported, row still paid', emailFail.paid === 1 && emailFail.results[0].emailError === 'Receipt email could not be sent.');
}
await testBulkCollect();

// ---- Trials / Leaves derive from the core cache (source checks) ------------
{
  const trials = read('js/trials.js');
  const loadTrials = fnBody(trials, 'async function loadTrialClassesData()', ['\n    function populateTrialTeacherDropdown']);
  check('Trials loader derives students from the core cache', loadTrials.includes('ensureCoreLmsDataLoaded') && loadTrials.includes('RAW_ALL_FAMILIES') && loadTrials.includes('Object.values(_byId)'));
  check('Trials loader fetches students directly only when the core cache is empty', loadTrials.includes('if (supaStudents.length === 0)') && loadTrials.indexOf("db.from('students')") > loadTrials.indexOf('if (supaStudents.length === 0)'));
  check('Trials core-cache derivation merges raw-family students (trial rows survive the regular filter)', loadTrials.includes('_rawFams.forEach(f => (Array.isArray(f.students)'));

  const leaves = read('js/leaves.js');
  const loadLeaves = fnBody(leaves, 'async function loadLeaveManagementData()', ['\n    // Leave KPI Cards']);
  check('Leaves loader derives students from the core cache', loadLeaves.includes('ensureCoreLmsDataLoaded') && loadLeaves.includes('RAW_ALL_FAMILIES') && loadLeaves.includes('Object.values(_byId)'));
  check('Leaves loader fetches students directly only when the core cache is empty', loadLeaves.includes('if (students.length === 0)') && loadLeaves.indexOf("db.from('students')") > loadLeaves.indexOf('if (students.length === 0)'));
  const checkLeaves = fnBody(leaves, 'async function checkLeaveReturnAlertsAndRequests', ['\n    function renderPendingTimeChangeBanners']);
  check('Leave-check derives students from the core cache', checkLeaves.includes('ensureCoreLmsDataLoaded') && checkLeaves.includes('Object.values(_byId)'));
  check('Leave-check fetches students directly only when the core cache is empty', checkLeaves.includes('if (students.length === 0)'));
  check('Leave-check teacher names come from the core cache first, db only when core is empty', checkLeaves.includes('ALL_TEACHERS') && checkLeaves.includes("if (Object.keys(teacherNames).length === 0)"));
  check('Leave-check automatic pass runs once per session', leaves.includes('_LEAVE_ALERTS_RAN_THIS_SESSION') && checkLeaves.includes('if (autoPopup && _LEAVE_ALERTS_RAN_THIS_SESSION) return;'));
  check('Leaves tab refreshes the leave-check itself (fire-and-forget)', loadLeaves.includes("checkLeaveReturnAlertsAndRequests(false)"));
}

// ---- Salaries stages run in parallel (source checks) -----------------------
{
  const payroll = read('js/payroll.js');
  const calc = fnBody(payroll, 'async function calculateMonthlySalaries', ['\n    window.calculateMonthlySalaries', '\n    async function renderPayrollTable']);
  check('Salaries compiles the three ledger loads with Promise.all', calc.includes('Promise.all') && calc.includes('Assignments.loadAll(') && calc.includes('loadAdvanceLedgerForCompile()') && calc.includes('loadCoverRowsForCompile(monthBounds)'));
  check('Salaries no longer awaits the ledger loads one by one', !calc.includes('assignmentRows = await Assignments.loadAll()') && !calc.includes('const advanceLedgerByTeacher = await loadAdvanceLedgerForCompile()') && !calc.includes('const coverRowsForMonth = await loadCoverRowsForCompile'));
  check('Salaries spinner shows always, not only on an empty teacher cache', calc.includes("tbody.innerHTML = '<tr><td colspan=\"7\"") && !calc.includes("if (!Array.isArray(ALL_TEACHERS) || ALL_TEACHERS.length === 0) {\n        tbody.innerHTML"));
  const ledger = fnBody(payroll, 'async function loadAdvanceLedgerForCompile', ['\n    // Pure planner']);
  check('Advance ledger reads adjustments + manual requests in parallel', ledger.includes('Promise.all') && ledger.includes("db.from('advance_manual_requests')") && !ledger.includes("const mRes = await db.from('advance_manual_requests')"));
}

// ---- Dashboard: heartbeat, progressive paint, date filter, search ----------
{
  const dash = read('js/dashboard.js');
  const load = fnBody(dash, 'async function loadDashboardData', ['\n    async function _runDashboardLoad']);
  check('Heartbeat passes are marked background and skip when a click is recent/queued', load.includes('opts.background') && load.includes('_dashLastUserClickAt') && load.includes('if (_dashLoadInflight || _dashRerunRequested) return;'));
  check('A fresh click stamps its time so the heartbeat backs off', load.includes('_dashLastUserClickAt = Date.now();'));
  check('Heartbeat calls the dashboard load as a background pass', dash.includes('loadDashboardData({ background: true })'));
  check('Dashboard paints KPIs + class table as branches land (two-stage paint)', dash.includes('paintDashClassesFromBranches(schedRes, logsRes, null)') && dash.includes('paintDashClassesFromBranches(schedRes, logsRes, advRes)'));
  check('Dashboard leave-check no longer gates the paint (fire-and-forget)', dash.includes("const _lp = checkLeaveReturnAlertsAndRequests();") && !dash.includes('await checkLeaveReturnAlertsAndRequests();'));
  check('Dashboard Advance logs query is date-bounded (30-day window)', dash.includes(".gte('date', advWindowStart)") && dash.includes('advWindowStart'));
  check('Universal search is debounced (~300 ms)', dash.includes('function debouncedDashboardGlobalSearch') && dash.includes('setTimeout(() => { _dashSearchDebounceTimer = null; handleDashboardGlobalSearch(rawQuery); }, 300)'));
  check('Universal search shows "Searching…" before the await', dash.includes('Searching&hellip;'));
  const index = read('index.html');
  check('Search input calls the debounced handler', index.includes('oninput="debouncedDashboardGlobalSearch(this.value)"'));
}

// ---- Core cache post-steps run in parallel ----------------------------------
{
  const cfg = read('js/config.js');
  check('Core load runs fee ingest + shared-state hydrate in parallel', cfg.includes('Promise.all') && cfg.includes('ingestFeeDataFromFamilies(rawFamilies)') && cfg.includes('hydrateGlobalSharedStateFromCloud(rawFamilies, ALL_TEACHERS)'));
}

// ---- Navigation skeletons ----------------------------------------------------
{
  const nav = read('js/navigation.js');
  const sw = fnBody(nav, 'function switchTab(tabId)', ['\n    // OFFLINE-COPY SELF-HEAL']);
  check('switchTab paints a skeleton synchronously before any loader runs', sw.indexOf('paintTabSkeleton(targetId)') >= 0 && sw.indexOf('paintTabSkeleton(targetId)') < sw.indexOf('loadDashboardData()'));
  check('Skeleton covers Dashboard, Salaries, Attendance, Trials and Leaves', nav.includes("tabId === 'tab-salaries'") && nav.includes("tabId === 'tab-trials'") && nav.includes("tabId === 'tab-leaves'") && nav.includes("tabId === 'tab-attendance'"));
}

// ---- Attendance list parallel + button feedback ------------------------------
{
  const sch = read('js/schedule.js');
  const list = fnBody(sch, 'async function loadAttendanceList()', ['\n    async function requestTimeChangeFromIndex']);
  check('Attendance list fetches schedules + logs in parallel', list.includes('Promise.all') && list.includes("db.from('class_schedules')") && list.includes("db.from('attendance_logs')"));
  check('Attendance list shows a spinner before the first await', list.indexOf('Loading attendance...') < list.indexOf('Promise.all'));
  const save = fnBody(sch, 'async function saveAttendance(', ['\n    async function openShiftStudentFromSlotAction', '\n    window.openShiftStudentFromSlotAction']);
  check('Attendance mark gives immediate button feedback', save.includes('Saving...') && save.includes('_clickedBtn'));
  check('Attendance mark reloads stay fire-and-forget (row update is not blocked on both)', save.includes('loadAttendanceList();') && save.includes('loadLiveMonitorData();') && !save.includes('await loadAttendanceList()') && !save.includes('await loadLiveMonitorData()'));
}

// ---- 360 save: optimistic patch + fire-and-forget refresh --------------------
{
  const p360 = read('js/profiles360.js');
  const sub = fnBody(p360, 'async function submitEditSingleStudentForm', ['\n/**\n * CORE BACKEND LIFECYCLE SYNCHRONIZER']);
  check('360 save disables its submit button during the save', sub.includes("_saveBtn.disabled = true") && sub.includes('Saving...'));
  check('360 save restores the button when validation/save fails', sub.includes('_restoreSaveBtn()'));
  check('360 save no longer awaits the family-status sync before updating the UI', !sub.includes('await syncFamilyStatusFromStudentsBackend(familyId);') && sub.includes('const _sync = syncFamilyStatusFromStudentsBackend(familyId);'));
  check('360 save no longer awaits the 360 reopen (log refetch is fire-and-forget)', !sub.includes('await openFamily360Profile(familyId,') && sub.includes('const _reopen = openFamily360Profile(familyId,'));
}

// ---- Fee-ingest mirror-write trim --------------------------------------------
{
  const fees = read('js/fees.js');
  check('Fee ingest skips the localStorage write when nothing changed', fees.includes('_prevFeeRecordsJson !== _nextFeeRecordsJson') && fees.includes('_prevFeeOverridesJson !== _nextFeeOverridesJson'));
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
