// Teacher button-delay build (2026-11-20) — teacher portal perceived
// performance + the end-class popup rule:
//   * Complete opens the lesson popup immediately from memory; NOTHING is
//     written until Submit in the popup upserts Completed (exactly once);
//     Cancel writes nothing and the Complete button stays.
//   * Instant feedback on Start Zoom / Start Class / self-reset; the Zoom
//     gate itself is unchanged (upsert must succeed before Zoom opens).
//   * Optimistic single-row patch + background reload after Start / End /
//     Absent-Leave / lesson-save.
//   * History: server-side student/date filters, 100-row cap, images in
//     parallel (max 4) + lazy, Loading state before the await.
//   * Salary: parallel teacher/families/slips/advance reads, cached slips
//     painted immediately with the stale note.
//   * Trials: no duplicate students fetch (reuses the portal-load rows).
//   * Reader Save Pages: bounded parallel uploads (max 4 in flight).
//   * Advance-class save: success toast no longer awaits the email POST;
//     a failed email is surfaced afterwards, never silently dropped.
// Everything below executes the REAL functions in vm harnesses in the
// style of the existing suites (fixtures only — no live data).
// Run from the repo root:  node test/teacher-button-delay.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS | ' + name); }
  else { failed++; console.log('FAIL | ' + name + (detail ? ' :: ' + detail : '')); }
}
function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = [^;]+;`));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}
const NL = String.fromCharCode(10);

// ===========================================================================
// A) Scope B — structural: Complete writes nothing, Submit writes once
// ===========================================================================
{
  const complete = extractFunction(TEACHER, 'handleTeacherCompleteClass');
  check('complete: handler opens the lesson popup from memory',
    complete.includes('openAttendanceModal(scheduleId'));
  check('complete: handler performs no completion write (no transition, no upsert)',
    !complete.includes('transitionClassSessionState') && !complete.includes('upsert')
    && !complete.includes("db.from('attendance_logs')"));
  check('complete: handler performs no reload before opening the popup',
    !complete.includes('loadTeacherPortalData'));
  check('complete: handler is synchronous (no await before the popup opens)',
    !/^async function/.test(complete.trim()) && !complete.includes('await '));
  const save = extractFunction(TEACHER, 'saveAttendanceAndLessonNotes');
  check('submit: the popup Submit handler still upserts Completed',
    save.includes("db.from('attendance_logs').upsert")
    && save.includes("selectedStatus === 'Present' ? 'Completed'"));
  check('submit: popup has Submit + Cancel buttons',
    TEACHER.includes('id="btnSaveAttendance"') && TEACHER.includes('</i> Submit')
    && TEACHER.includes('onclick="closeAttendanceModal()"') && TEACHER.includes('>\n          Cancel\n'));
}

// ===========================================================================
// B) Scope B — behavioural: REAL handleTeacherCompleteClass in a vm
// ===========================================================================
{
  const upserts = [];
  const modalOpens = [];
  const row = { id: 'SCH-1', student_id: 'STU-1', students: { name: 'Test Student' }, log: { status: 'Running' } };
  const sandbox = {
    console,
    TODAY_CLASSES: [row],
    lmsNotify: () => {},
    openAttendanceModal: (...args) => modalOpens.push(args),
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(TEACHER, 'handleTeacherCompleteClass'), sandbox);
  vm.runInContext(`handleTeacherCompleteClass('SCH-1', 'STU-1', 'TCH-1', 'Test Student')`, sandbox);
  check('complete (vm): popup opens for the clicked class',
    modalOpens.length === 1 && modalOpens[0][0] === 'SCH-1' && modalOpens[0][4] === 'Completed',
    JSON.stringify(modalOpens));
  check('complete (vm): NO completion write happens on the Complete click',
    upserts.length === 0, 'upserts=' + upserts.length);
  check('complete (vm): the class row is exactly as before (still Running, Complete stays)',
    row.log.status === 'Running', row.log.status);
  check('complete (vm): unknown schedule notifies instead of opening/writing',
    (() => {
      const notes = [];
      sandbox.lmsNotify = (m) => notes.push(m);
      vm.runInContext(`handleTeacherCompleteClass('SCH-NOPE', 'STU-1', 'TCH-1', 'Ghost')`, sandbox);
      return modalOpens.length === 1 && upserts.length === 0 && notes.length === 1;
    })());
}

// ===========================================================================
// C) Submit writes exactly once — REAL saveAttendanceAndLessonNotes in a vm
// ===========================================================================
{
  const upserts = [];
  const patchCalls = [];
  let bgReloads = 0;
  const el = (value = '') => ({ value, innerHTML: '', disabled: false });
  const els = {
    attScheduleId: el('SCH-1'), attStudentId: el('STU-1'), attSelectedStatus: el('Present'),
    attAdvanceTargetDate: el(''), attCourseBookSelect: el('qaida-flat'),
    attAdditionalCourseName: el(''), attAdditionalCourseReference: el(''),
    attAdditionalLesson: el(''), attCoursePageSelect: el('3'), attLineRange: el(''),
    attLineBox: el(''), attSabaqResult: el('Pass'), attSabaqRating: el('5'),
    attLessonNotes: el('Good work'), attTafseerLanguageSelect: el('ur'),
    attQuranParaSelect: el('1'), attLessonImageKey: el(''), btnSaveAttendance: el(''),
  };
  const sandbox = {
    console, lmsNotify: () => {},
    document: { getElementById: (id) => els[id] || null },
    CURRENT_TEACHER: { id: 'TCH-1' },
    _ATT_PRIOR_NOTES: null,
    window: { LessonHistory: { origPageFor: () => null } },
    getTeacherAllBooks: () => [{ id: 'qaida-flat', title: 'Qaida Book', category: 'qaida', total_pages: 33 }],
    db: { from: () => ({ upsert: async (rows) => { upserts.push(rows); return { error: null }; } }) },
    notifyClassSessionSync: () => {}, closeAttendanceModal: () => {},
    loadTeacherPortalData: async () => { bgReloads++; },
    patchTodayClassLocally: (...args) => patchCalls.push(args),
    refreshTeacherPortalInBackground: () => { bgReloads++; },
  };
  const code = extractConst(TEACHER, 'ADDITIONAL_COURSE_ID') + NL
    + extractFunction(TEACHER, 'getPktNowParts') + NL
    + extractFunction(TEACHER, 'saveAttendanceAndLessonNotes');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await vm.runInContext('saveAttendanceAndLessonNotes()', sandbox);
  check('submit (vm): exactly ONE completion upsert on Submit',
    upserts.length === 1, 'upserts=' + upserts.length);
  check('submit (vm): the upsert marks the class Completed',
    upserts.length === 1 && upserts[0][0].status === 'Completed'
    && upserts[0][0].schedule_id === 'SCH-1' && !!upserts[0][0].completed_at);
  check('submit (vm): the row is patched locally and the reload runs in the background',
    patchCalls.length === 1 && patchCalls[0][0] === 'SCH-1' && patchCalls[0][1] === 'Completed'
    && bgReloads === 1, JSON.stringify(patchCalls) + ' bg=' + bgReloads);
}

// ===========================================================================
// D) Optimistic patch — REAL patchTodayClassLocally in a vm
// ===========================================================================
{
  let renders = 0;
  const els = { statCompleted: { innerText: '' }, statRemaining: { innerText: '' } };
  const sandbox = {
    console,
    TODAY_CLASSES: [
      { id: 'SCH-1', student_id: 'STU-1', log: { status: 'Running' }, isMarked: false, status: 'RUNNING', badgeClass: '' },
      { id: 'SCH-2', student_id: 'STU-2', log: null, isMarked: false, status: 'SCHEDULED', badgeClass: '' },
    ],
    CURRENT_TEACHER: { id: 'TCH-1' },
    document: { getElementById: (id) => els[id] || null },
    renderTeacherClassesTable: () => { renders++; },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(TEACHER, 'patchTodayClassLocally'), sandbox);
  vm.runInContext(`patchTodayClassLocally('SCH-1', 'Completed', '{"book_id":"qaida-flat"}')`, sandbox);
  const c1 = sandbox.TODAY_CLASSES[0];
  check('patch (vm): Running -> Completed flips status, mark and KPI counts, then re-renders',
    c1.log.status === 'Completed' && c1.isMarked === true && c1.status === 'COMPLETED'
    && els.statCompleted.innerText === 1 && els.statRemaining.innerText === 1 && renders === 1,
    JSON.stringify({ st: c1.status, done: els.statCompleted.innerText, left: els.statRemaining.innerText, renders }));
  check('patch (vm): saved lesson notes land on the row so a reopen shows them',
    c1.log.lesson_notes === '{"book_id":"qaida-flat"}');
  vm.runInContext(`patchTodayClassLocally('SCH-2', 'Running')`, sandbox);
  const c2 = sandbox.TODAY_CLASSES[1];
  check('patch (vm): Scheduled -> Running creates the log and marks nothing complete',
    c2.log.status === 'Running' && c2.isMarked === false && c2.status === 'RUNNING');
  vm.runInContext(`patchTodayClassLocally('SCH-1', 'Scheduled')`, sandbox);
  check('patch (vm): self-reset clears the log and unmarks the class',
    sandbox.TODAY_CLASSES[0].log === null && sandbox.TODAY_CLASSES[0].isMarked === false
    && sandbox.TODAY_CLASSES[0].status === 'SCHEDULED');
  check('patch (vm): unknown schedule returns false and renders nothing',
    vm.runInContext(`patchTodayClassLocally('SCH-NOPE', 'Running')`, sandbox) === false && renders === 3);
}

// ===========================================================================
// E) Instant feedback + optimistic wiring (structural)
// ===========================================================================
{
  check('zoom: instant "Opening Zoom..." feedback before the Waiting upsert',
    extractFunction(TEACHER, 'launchTeacherZoomClass').includes("setTeacherRowButtonsBusy(scheduleId, 'launchTeacherZoomClassById', 'Opening Zoom...')"));
  check('zoom: the Waiting-before-Zoom gate is unchanged',
    extractFunction(TEACHER, 'launchTeacherZoomClassLocked').includes("if (!waitingRes || !waitingRes.success)") &&
    extractFunction(TEACHER, 'launchTeacherZoomClassLocked').includes('window.open(rawMeetingLink'));
  check('start class: instant "Starting..." + patch + background reload (no awaited reload)',
    extractFunction(TEACHER, 'handleTeacherStartClass').includes("'Starting...'")
    && extractFunction(TEACHER, 'handleTeacherStartClass').includes("patchTodayClassLocally(scheduleId, 'Running'")
    && !extractFunction(TEACHER, 'handleTeacherStartClass').includes('await loadTeacherPortalData()'));
  check('self-reset: instant "Resetting..." + patch to Scheduled + background reload',
    extractFunction(TEACHER, 'handleTeacherSelfResetClass').includes("'Resetting...'")
    && extractFunction(TEACHER, 'handleTeacherSelfResetClass').includes("patchTodayClassLocally(scheduleId, 'Scheduled')")
    && extractFunction(TEACHER, 'handleTeacherSelfResetClass').includes('refreshTeacherPortalInBackground()'));
  check('absent/leave: existing Saving... feedback kept; patch + background reload',
    extractFunction(TEACHER, 'submitLeaveAbsentModal').includes('Saving...')
    && extractFunction(TEACHER, 'submitLeaveAbsentModal').includes('patchTodayClassLocally(scheduleId, outcome')
    && !extractFunction(TEACHER, 'submitLeaveAbsentModal').includes('await loadTeacherPortalData()'));
  check('lesson save: existing Saving... feedback kept; no awaited reload after save',
    extractFunction(TEACHER, 'saveAttendanceAndLessonNotes').includes('Saving...')
    && !extractFunction(TEACHER, 'saveAttendanceAndLessonNotes').includes('await loadTeacherPortalData()'));
}

// ===========================================================================
// F) History tab
// ===========================================================================
{
  const hist = extractFunction(TEACHER, 'renderTeacherLessonHistory');
  check('history: Loading state is set before the await',
    hist.indexOf('Loading lesson history...') < hist.indexOf('await _lhQuery'));
  check('history: server-side student + date filters, capped at 100 rows',
    hist.includes(".eq('student_id', _lhServerStudent)") && hist.includes(".eq('date', _lhServerDate)")
    && hist.includes('.limit(_LH_TEACHER_LIMIT)') && !hist.includes('_LH_TEACHER_LIMIT < 1000'));
  check('history: no teacher_id filter (UNION-scope shifted-student history kept)',
    !hist.includes(".eq('teacher_id'"));
  check('history: client-side filtering still applies after the fetch',
    hist.includes("visible.filter(e => String(e.studentId) === String(studentFilter))")
    && hist.includes('filterLessonEntries(visible, dateFilter)'));
  check('history: images load in parallel (max 4) with lazy loading, after cards paint',
    hist.includes('Math.min(4, _lhImgJobs.length)') && hist.includes('loading="lazy"')
    && !hist.includes('await window.LessonHistory.loadLessonImageBlobUrl(e.imageKey)'));
  check('history: Load More no longer escalates to 300/1000 rows',
    !extractFunction(TEACHER, 'lhTeacherLoadMore').includes('? 300 : 1000')
    && extractFunction(TEACHER, 'lhTeacherLoadMore').includes('_LH_TEACHER_LIMIT = 100'));
}

// ===========================================================================
// G) Salary tab + advance requests
// ===========================================================================
{
  const sal = extractFunction(TEACHER, 'loadTeacherPreviousSalaries');
  check('salary: teacher row + carrier families run in parallel (Promise.allSettled)',
    sal.includes('Promise.allSettled([_salTeacherRowP, _salCarrierP])'));
  check('salary: salary_slips table read starts in parallel (not after the others)',
    sal.includes('const _salTableSlipsPromise') && sal.includes('await _salTableSlipsPromise'));
  check('salary: cached slips paint immediately with the stale note shown',
    sal.includes('renderTeacherSalarySlips(savedSalaries, false)'));
  check('salary: live rows swap in at the end via the extracted render',
    sal.includes('renderTeacherSalarySlips(savedSalaries, _salLiveOk || _salCloudOk)')
    && extractFunction(TEACHER, 'renderTeacherSalarySlips').includes("classList.toggle('hidden', !!liveOk)"));
  check('salary: advance-request list starts in parallel with the slip reads',
    sal.includes('loadTeacherAdvanceRequests()'));
  const adv = extractFunction(TEACHER, 'loadTeacherAdvanceRequests');
  check('salary advances: requests + adjustments reads run in parallel',
    adv.includes('_tAdvAdjPromise') && adv.includes("Promise.resolve(db.from('salary_adjustments')")
    && adv.includes('const adjRes = await _tAdvAdjPromise;'));
}

// ===========================================================================
// H) Trials, reader uploads, advance email, skeletons
// ===========================================================================
{
  const trials = extractFunction(TEACHER, 'loadTeacherTrialsData');
  check('trials: duplicate students fetch removed (reuses portal-load rows)',
    !trials.includes("db.from('students')") && trials.includes('ALL_TEACHER_STUDENTS_RAW'));
  const reader = extractFunction(TEACHER, 'saveAnnotatedPages');
  check('reader: page uploads run with a bounded pool (max 4 in flight), order kept per key',
    reader.includes('Math.min(4, pageKeys.length)') && reader.includes('Promise.all(_annWorkers)')
    && !reader.includes('for (const pageKey of pageKeys)'));
  const advSubmit = extractFunction(TEACHER, 'handleAdvanceClassSubmit');
  check('advance save: success toast/close no longer await the email POST',
    advSubmit.includes('sendTeacherAdvanceClassEmail({') && !advSubmit.includes('await fetch(')
    && advSubmit.includes('refreshTeacherPortalInBackground()'));
  const advMail = extractFunction(TEACHER, 'sendTeacherAdvanceClassEmail');
  check('advance email: helper still POSTs to the Worker and surfaces a failed send (never silent)',
    advMail.includes("fetch(getTeacherWorkerBase() + '/api/email/advance-class'")
    && advMail.includes('The completion email could NOT be sent')
    && advMail.includes("lmsNotify('📧 Automated completion email has been dispatched"));
  check('advance email: dedupe registry is written only on a confirmed send',
    advMail.indexOf("sentEmailRegistry[dedupeKey] = {") > advMail.indexOf('if (emailDispatched)'));
  check('skeletons: History/Salary/Trials set loading rows synchronously on tab entry',
    extractFunction(TEACHER, 'showTeacherTabSkeleton').includes('Loading lesson history...')
    && extractFunction(TEACHER, 'showTeacherTabSkeleton').includes('Loading salary statements...')
    && extractFunction(TEACHER, 'showTeacherTabSkeleton').includes('Loading trials...')
    && extractFunction(TEACHER, 'switchTeacherPortalTab').includes("showTeacherTabSkeleton('history')")
    && extractFunction(TEACHER, 'switchTeacherPortalTab').includes("showTeacherTabSkeleton('salaries')")
    && extractFunction(TEACHER, 'switchTeacherPortalTab').includes("showTeacherTabSkeleton('trials')"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
