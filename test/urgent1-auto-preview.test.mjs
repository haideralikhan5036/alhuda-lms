// Urgent Issue 1 test — automatic post-class preview (teacher.html):
//  A) getPktNowParts (REAL function, extracted) computes the Asia/Karachi
//     date, minutes and weekday — including the UTC-midnight rollover
//     (20:30Z = 01:30 PKT next day).
//  B) maybeAutoCompleteExpiredClasses (REAL function, extracted) fires the
//     canonical transition + preview for Running/Waiting slots past endMin,
//     and NEVER for never-started / Scheduled / Completed / not-yet-ended /
//     advance-extra slots; one-shot marker, modal-open, typing and hidden
//     tab all suppress it; a failed write shows an error and opens NO
//     preview; only the first eligible class fires per check.
//  C) Structural guards: the 1s clock tick calls the watcher, and the
//     transition date comes from getPktNowParts.
// Run from the repo root:  node test/urgent1-auto-preview.test.mjs
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
function extractBlock(src, startMarker, endFnName) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('block start not found: ' + startMarker);
  const fn = extractFunction(src.slice(start), endFnName);
  return src.slice(start, start + src.slice(start).indexOf(fn) + fn.length);
}

const PKT_CODE = extractFunction(TEACHER_HTML, 'getPktNowParts');
const AUTO_CODE = extractBlock(
  TEACHER_HTML,
  'const AUTO_PREVIEW_KEY_PREFIX',
  'maybeAutoCompleteExpiredClasses'
);

function makeLocalStorageStub(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

// PKT minutes/date of "now", computed the same way the portal does.
function pktNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function makeCtx(opts = {}) {
  const localStorage = makeLocalStorageStub(opts.seedLocalStorage || {});
  const modalHidden = opts.modalHidden !== false;
  const modalEl = { classList: { contains: (c) => (c === 'hidden' ? modalHidden : !modalHidden) } };
  const calls = { transitions: [], modals: [], reloads: 0, alerts: [], dbReads: [] };
  const readBackRows = opts.readBackRows !== undefined ? opts.readBackRows : [{ status: 'Completed' }];
  const sandbox = {
    console,
    localStorage,
    document: {
      visibilityState: opts.visibilityState || 'visible',
      activeElement: opts.activeElement || null,
      getElementById: (id) => (id === 'modalTeacherAttendance' ? modalEl : null),
    },
    TODAY_CLASSES: opts.todayClasses || [],
    CURRENT_TEACHER: { id: 'TCH-1' },
    transitionClassSessionState: async (args) => { calls.transitions.push(args); return { success: true }; },
    db: {
      from: () => ({
        select: () => ({
          eq: function () { return this; },
          then: (res) => { calls.dbReads.push(1); res({ data: readBackRows, error: null }); },
        }),
      }),
    },
    loadTeacherPortalData: async () => { calls.reloads++; },
    openAttendanceModal: (...args) => { calls.modals.push(args); },
    alert: (msg) => { calls.alerts.push(msg); },
  };
  if (opts.fixedMs !== undefined) {
    const RealDate = Date;
    const ms = opts.fixedMs;
    sandbox.Date = class extends RealDate {
      constructor(...args) { super(...args.length ? args : [ms]); }
      static now() { return ms; }
    };
  }
  const ctx = vm.createContext(sandbox);
  vm.runInContext(PKT_CODE + '\n' + AUTO_CODE, ctx);
  return { ctx, calls, localStorage };
}

// ===========================================================================
// A) PKT time correctness
// ===========================================================================
{
  // 2026-10-27T20:30:00Z = 2026-10-28 01:30 PKT (Wednesday).
  const { ctx } = makeCtx({ fixedMs: Date.parse('2026-10-27T20:30:00Z') });
  const p = vm.runInContext('getPktNowParts()', ctx);
  check('PKT date rolls over at midnight (20:30Z -> next-day PKT date)', p.date === '2026-10-28', JSON.stringify(p));
  check('PKT minutes are 01:30 (90)', p.minutes === 90, JSON.stringify(p));
  check('PKT weekday is Wednesday (3)', p.day === 3, JSON.stringify(p));
}
{
  // 2026-10-27T18:00:00Z = 2026-10-27 23:00 PKT (Tuesday).
  const { ctx } = makeCtx({ fixedMs: Date.parse('2026-10-27T18:00:00Z') });
  const p = vm.runInContext('getPktNowParts()', ctx);
  check('PKT date same day before midnight (18:00Z -> 23:00 PKT)', p.date === '2026-10-27', JSON.stringify(p));
  check('PKT minutes are 23:00 (1380)', p.minutes === 1380, JSON.stringify(p));
  check('PKT weekday is Tuesday (2)', p.day === 2, JSON.stringify(p));
}

// ===========================================================================
// B) Auto-trigger behaviour (current PKT time from the test host)
// ===========================================================================
const pkt = pktNow();
function slot(over = {}) {
  return {
    id: 'SCH-1', student_id: 'STU-1',
    students: { name: 'Test Student' },
    endMin: pkt.minutes - 5, log: { status: 'Running' },
    isAdvanceExtra: false, ...over,
  };
}
async function runWatcher(ctx) {
  await vm.runInContext('maybeAutoCompleteExpiredClasses()', ctx);
}

{
  const { ctx, calls, localStorage } = makeCtx({ todayClasses: [slot()] });
  await runWatcher(ctx);
  check('Running slot past end -> transition to Completed', calls.transitions.length === 1 && calls.transitions[0].targetStatus === 'Completed', JSON.stringify(calls.transitions));
  check('auto transition notes say automatically', calls.transitions.length === 1 && String(calls.transitions[0].notes || '').includes('automatically'));
  check('portal reloads after verified transition', calls.reloads === 1);
  check('preview opens with schedule, student name, Completed', calls.modals.length === 1 && calls.modals[0][0] === 'SCH-1' && calls.modals[0][1] === 'Test Student' && calls.modals[0][4] === 'Completed', JSON.stringify(calls.modals));
  check('one-shot marker set for schedule:date', [...localStorage._data.keys()].some((k) => k.startsWith('alhuda_auto_preview_shown:SCH-1:')));
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot({ log: { status: 'Waiting' } })] });
  await runWatcher(ctx);
  check('Waiting slot past end -> also fires (teacher joined Zoom)', calls.transitions.length === 1 && calls.modals.length === 1);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot({ log: undefined })] });
  await runWatcher(ctx);
  check('never-started slot (no log) past end -> NO auto-complete', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot({ log: { status: 'Scheduled' } })] });
  await runWatcher(ctx);
  check('Scheduled log past end -> NO auto-complete', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot({ log: { status: 'Completed' } })] });
  await runWatcher(ctx);
  check('already Completed slot -> NO repeat preview', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot({ endMin: pkt.minutes + 30 })] });
  await runWatcher(ctx);
  check('slot not yet ended -> NO fire', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot({ isAdvanceExtra: true, endMin: pkt.minutes - 5 })] });
  await runWatcher(ctx);
  check('advance-extra row -> NO fire', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const seed = {};
  seed['alhuda_auto_preview_shown:SCH-1:' + pkt.date] = '1';
  const { ctx, calls } = makeCtx({ todayClasses: [slot()], seedLocalStorage: seed });
  await runWatcher(ctx);
  check('one-shot marker already set -> NO repeat preview', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot()], modalHidden: false });
  await runWatcher(ctx);
  check('modal already open -> NO steal', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot()], activeElement: { tagName: 'TEXTAREA' } });
  await runWatcher(ctx);
  check('teacher typing -> NO fire', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot()], visibilityState: 'hidden' });
  await runWatcher(ctx);
  check('hidden tab -> NO fire', calls.transitions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot()], readBackRows: [] });
  await runWatcher(ctx);
  check('failed write (no Completed row on read-back) -> alert, NO preview', calls.alerts.length === 1 && calls.modals.length === 0, JSON.stringify(calls.alerts));
}
{
  const { ctx, calls } = makeCtx({ todayClasses: [slot(), slot({ id: 'SCH-2', student_id: 'STU-2' })] });
  await runWatcher(ctx);
  check('two eligible classes -> only the FIRST fires per check', calls.transitions.length === 1 && calls.transitions[0].scheduleId === 'SCH-1' && calls.modals.length === 1);
}

// ===========================================================================
// C) Structural guards
// ===========================================================================
check('1s clock tick calls the watcher', TEACHER_HTML.includes('maybeAutoCompleteExpiredClasses();') && TEACHER_HTML.includes('Live PKT clock'));
check('transition date comes from getPktNowParts', TEACHER_HTML.includes('const todayDate = getPktNowParts().date;'));
check('manual complete handler unchanged (transition + modal call intact)', TEACHER_HTML.includes("openAttendanceModal(scheduleId, studentName, '', studentId, 'Completed', '');"));

const failed = results.filter((r) => !r.pass).length;
console.log(`---\nurgent1-auto-preview: ${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
