// Teacher class-load retry ladder (teacher.html, fix/teacher-load-retry):
//  A) REAL loadTeacherPortalData + REAL ladder helpers: a degraded load
//     schedules automatic retries at 5 s / 15 s / 30 s and then STOPS
//     (max 3 automatic retries per degraded episode, never a loop).
//  B) A clean live load clears the degraded state and resets the ladder
//     (count 0, no pending timer); a later degraded episode starts the
//     ladder again from 5 s.
//  C) Recovery triggers: 'online' and tab-visible fire an IMMEDIATE load
//     while degraded (cancelling the pending ladder step), do nothing
//     when the last load was clean, and never stack a second load on
//     top of one already in flight.
//  D) Structural guards: the old one-shot retry is gone, the honest
//     banner texts (error / mirror / session-expired) are unchanged.
// Run from the repo root:  node test/teacher-load-retry.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const TEACHER_HTML = read('teacher.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
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
function extractSlice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('slice start not found: ' + startMarker);
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error('slice end not found: ' + endMarker);
  return src.slice(start, endIdx + endMarker.length);
}

const PKT_CODE = extractFunction(TEACHER_HTML, 'getPktNowParts');
const RETRY_CODE = extractSlice(
  TEACHER_HTML,
  'let _teacherClassesDegraded = null;',
  "window.addEventListener('online', recoverTeacherClassesIfDegraded);"
);
const TIMEOUT_CONST = (TEACHER_HTML.match(/const TEACHER_BRANCH_TIMEOUT_MS = \d+;/) || [])[0];
if (!TIMEOUT_CONST) throw new Error('TEACHER_BRANCH_TIMEOUT_MS const not found');
const SETTLE_CODE = TIMEOUT_CONST + '\n' + extractFunction(TEACHER_HTML, 'settleTeacherBranch');
const LOAD_CODE = extractFunction(TEACHER_HTML, 'loadTeacherPortalData');

// ---- controllable environment -------------------------------------------
function makeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout: (cb, delay) => { const id = nextId++; pending.set(id, { delay, cb }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    fire: (id) => { const t = pending.get(id); if (!t) return false; pending.delete(id); t.cb(); return true; },
    has: (id) => pending.has(id),
    delayOf: (id) => (pending.has(id) ? pending.get(id).delay : null),
  };
}

function makeDb(modeRef) {
  const counts = {};
  function tableResult(table) {
    if (modeRef.mode === 'hang') return new Promise(() => {});
    if (modeRef.mode === 'fail') return Promise.resolve({ data: null, error: { message: 'network_down' } });
    if (table === 'teachers') return Promise.resolve({ data: { id: 'TCH-1', zoom_link: '' }, error: null });
    return Promise.resolve({ data: [], error: null });
  }
  function builder(table) {
    const b = {
      select: () => b,
      eq: () => b,
      single: () => tableResult(table),
      then: (res, rej) => tableResult(table).then(res, rej),
    };
    return b;
  }
  return {
    counts,
    from: (table) => { counts[table] = (counts[table] || 0) + 1; return builder(table); },
  };
}

function makeEl() {
  return {
    innerText: '', innerHTML: '', value: '', style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle() {},
    },
  };
}

function makeCtx(mode) {
  const modeRef = { mode };
  const timers = makeTimers();
  const db = makeDb(modeRef);
  const els = new Map();
  const docListeners = {};
  const winListeners = {};
  const documentStub = {
    visibilityState: 'visible',
    activeElement: null,
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
  };
  const windowStub = {
    addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); },
  };
  const sandbox = {
    console,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    document: documentStub,
    window: windowStub,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    db,
    DAY_NAMES: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    CURRENT_TEACHER: { id: 'TCH-1', zoom_link: '' },
    TODAY_CLASSES: [],
    normalizeTeacherSession: (t) => t,
    isPortalRegularStudent: () => true,
    isPortalStudentDeactivated: () => false,
    isPortalStudentOnLeave: () => false,
    escapeHtml: (s) => String(s),
    escapeJsAttr: (s) => String(s),
    renderTeacherClassesTable: () => {},
    renderTeacherStudentListTable: () => {},
    loadTeacherTrialsData: () => {},
    loadTeacherPreviousSalaries: () => {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(PKT_CODE + '\n' + RETRY_CODE + '\n' + SETTLE_CODE + '\n' + LOAD_CODE, ctx);
  return { ctx, timers, db, modeRef, docListeners, winListeners, documentStub };
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}
const loadCount = (db) => db.counts.class_schedules || 0;
const get = (ctx, expr) => vm.runInContext(expr, ctx);

// ===========================================================================
// A) Degraded episode: ladder fires at 5 s / 15 s / 30 s, then stops
// ===========================================================================
{
  const { ctx, timers, db } = makeCtx('fail');
  await vm.runInContext('loadTeacherPortalData()', ctx);
  check('A: degraded load marks the episode degraded (error kind)', get(ctx, "_teacherClassesDegraded && _teacherClassesDegraded.kind") === 'error');
  check('A: first ladder step scheduled at 5000 ms', timers.delayOf(get(ctx, '_teacherClassesRetryTimer')) === 5000, 'delay=' + timers.delayOf(get(ctx, '_teacherClassesRetryTimer')));
  check('A: retry count is 1 after scheduling', get(ctx, '_teacherClassesRetryCount') === 1);

  check('A: firing step 1 runs a load', timers.fire(get(ctx, '_teacherClassesRetryTimer')));
  await flush();
  check('A: retry 1 executed (2 loads total)', loadCount(db) === 2, 'loads=' + loadCount(db));
  check('A: second ladder step scheduled at 15000 ms', timers.delayOf(get(ctx, '_teacherClassesRetryTimer')) === 15000, 'delay=' + timers.delayOf(get(ctx, '_teacherClassesRetryTimer')));

  check('A: firing step 2 runs a load', timers.fire(get(ctx, '_teacherClassesRetryTimer')));
  await flush();
  check('A: retry 2 executed (3 loads total)', loadCount(db) === 3, 'loads=' + loadCount(db));
  check('A: third ladder step scheduled at 30000 ms', timers.delayOf(get(ctx, '_teacherClassesRetryTimer')) === 30000, 'delay=' + timers.delayOf(get(ctx, '_teacherClassesRetryTimer')));

  check('A: firing step 3 runs a load', timers.fire(get(ctx, '_teacherClassesRetryTimer')));
  await flush();
  check('A: retry 3 executed (4 loads total)', loadCount(db) === 4, 'loads=' + loadCount(db));
  check('A: ladder exhausted — retry count is 3', get(ctx, '_teacherClassesRetryCount') === 3);
  check('A: ladder exhausted — NO further timer pending', get(ctx, '_teacherClassesRetryTimer') === null);
  await flush();
  check('A: no loop — load count stays 4', loadCount(db) === 4, 'loads=' + loadCount(db));
  check('A: still degraded (banner state preserved)', get(ctx, '_teacherClassesDegraded !== null') === true);
}

// ===========================================================================
// B) Clean load resets the ladder; a new episode restarts it at 5 s
// ===========================================================================
{
  const { ctx, timers, db, modeRef } = makeCtx('fail');
  await vm.runInContext('loadTeacherPortalData()', ctx);
  timers.fire(get(ctx, '_teacherClassesRetryTimer'));
  await flush();
  check('B: mid-ladder state (count 2, timer at 15000)', get(ctx, '_teacherClassesRetryCount') === 2 && timers.delayOf(get(ctx, '_teacherClassesRetryTimer')) === 15000);

  modeRef.mode = 'ok';
  await vm.runInContext('loadTeacherPortalData()', ctx);
  check('B: clean load clears degraded state', get(ctx, '_teacherClassesDegraded') === null);
  check('B: clean load resets retry count to 0', get(ctx, '_teacherClassesRetryCount') === 0);
  check('B: clean load cancels the pending ladder timer', get(ctx, '_teacherClassesRetryTimer') === null);

  modeRef.mode = 'fail';
  await vm.runInContext('loadTeacherPortalData()', ctx);
  check('B: new degraded episode restarts ladder at 5000 ms', timers.delayOf(get(ctx, '_teacherClassesRetryTimer')) === 5000, 'delay=' + timers.delayOf(get(ctx, '_teacherClassesRetryTimer')));
  check('B: new episode retry count is 1', get(ctx, '_teacherClassesRetryCount') === 1);
}

// ===========================================================================
// C) Recovery triggers: immediate load while degraded; no-ops otherwise
// ===========================================================================
{
  const { ctx, timers, db, winListeners } = makeCtx('fail');
  await vm.runInContext('loadTeacherPortalData()', ctx);
  check('C: one load so far', loadCount(db) === 1);
  const pendingTimer = get(ctx, '_teacherClassesRetryTimer');
  check('C: ladder timer pending before online event', pendingTimer !== null && timers.has(pendingTimer));

  (winListeners.online || []).forEach((fn) => fn());
  await flush();
  check('C: online event fires an immediate load (no timer wait)', loadCount(db) === 2, 'loads=' + loadCount(db));
  check('C: online event cancelled the pending ladder timer', !timers.has(pendingTimer));
  check('C: fresh ladder after recovery load (step at 5000 ms)', timers.delayOf(get(ctx, '_teacherClassesRetryTimer')) === 5000, 'delay=' + timers.delayOf(get(ctx, '_teacherClassesRetryTimer')));
}
{
  const { ctx, db, docListeners, documentStub } = makeCtx('fail');
  await vm.runInContext('loadTeacherPortalData()', ctx);
  documentStub.visibilityState = 'hidden';
  (docListeners.visibilitychange || []).forEach((fn) => fn());
  await flush();
  check('C: visibilitychange to HIDDEN does not load', loadCount(db) === 1, 'loads=' + loadCount(db));
  documentStub.visibilityState = 'visible';
  (docListeners.visibilitychange || []).forEach((fn) => fn());
  await flush();
  check('C: visibilitychange to VISIBLE fires an immediate load while degraded', loadCount(db) === 2, 'loads=' + loadCount(db));
}
{
  const { ctx, db, winListeners, docListeners, documentStub } = makeCtx('ok');
  await vm.runInContext('loadTeacherPortalData()', ctx);
  check('C: clean load — not degraded', get(ctx, '_teacherClassesDegraded') === null);
  (winListeners.online || []).forEach((fn) => fn());
  documentStub.visibilityState = 'visible';
  (docListeners.visibilitychange || []).forEach((fn) => fn());
  await flush();
  check('C: online/visible do NOTHING when the last load was clean', loadCount(db) === 1, 'loads=' + loadCount(db));
}
{
  const { ctx, db, winListeners } = makeCtx('hang');
  const inflight = vm.runInContext('loadTeacherPortalData()', ctx); // never settles: db hangs
  await flush();
  check('C: hanging load started (1 schedules query)', loadCount(db) === 1, 'loads=' + loadCount(db));
  check('C: load marked in flight', get(ctx, '_teacherLoadInFlight') === true);
  (winListeners.online || []).forEach((fn) => fn());
  await flush();
  check('C: online event does NOT stack a second load while one is in flight', loadCount(db) === 1, 'loads=' + loadCount(db));
  void inflight;
}

// ===========================================================================
// D) Structural guards
// ===========================================================================
check('D: old one-shot retry state is gone', !TEACHER_HTML.includes('_teacherClassesAutoRetried'));
check('D: old 5500 ms one-shot timer is gone', !TEACHER_HTML.includes('5500'));
check('D: ladder delays are 5000/15000/30000', TEACHER_HTML.includes('TEACHER_RETRY_LADDER_MS = [5000, 15000, 30000]'));
check('D: visibility + online recovery listeners registered',
  TEACHER_HTML.includes("document.addEventListener('visibilitychange'") && TEACHER_HTML.includes("window.addEventListener('online', recoverTeacherClassesIfDegraded)"));
check('D: error banner text unchanged', TEACHER_HTML.includes("Could not load today\\'s classes from the server."));
check('D: mirror banner text unchanged', TEACHER_HTML.includes('Showing an offline / incomplete copy.'));
check('D: session-expired banner text unchanged', TEACHER_HTML.includes('Session expired — please log in again.'));
check('D: manual Retry buttons still call loadTeacherPortalData', (TEACHER_HTML.match(/onclick="loadTeacherPortalData\(\)"/g) || []).length >= 2);

const failed = results.filter((r) => !r.pass).length;
console.log(`---\nteacher-load-retry: ${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
