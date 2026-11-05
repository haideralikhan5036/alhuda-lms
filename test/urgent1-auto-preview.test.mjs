// Urgent Issue 1 test — PKT time correctness + class-ending behaviour
// (teacher.html):
//  A) getPktNowParts (REAL function, extracted) computes the Asia/Karachi
//     date, minutes and weekday — including the UTC-midnight rollover
//     (20:30Z = 01:30 PKT next day).
//  B) OVERDUE-CLASS REMINDER (owner decision 2026-11-05 — auto-end is
//     REMOVED): checkOverdueClassReminder (REAL function, extracted)
//     lists every started-but-unended class (Running / Waiting) past
//     its end time with an END CLASS button wired to the manual flow;
//     it NEVER transitions a class, writes to the db, or opens a modal
//     by itself. Never-started / Scheduled / Completed / not-yet-ended /
//     advance-extra slots are never listed. Snooze hides the banner
//     for 120 s, then it reappears while an overdue class remains;
//     ending the class clears it for good.
//  C) Structural guards: the auto-complete watcher is fully gone (no
//     function, no marker, no "ended automatically" note, no call from
//     the 1 s clock); the reminder element + dedicated 30 s interval
//     exist; renderTeacherClassesTable re-renders the reminder; the
//     manual start/complete paths are unchanged and the start path has
//     no concurrent-running block (a teacher CAN start the next class
//     before ending the previous one).
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
const REMINDER_CODE = extractBlock(
  TEACHER_HTML,
  'const TEACHER_REMINDER_SNOOZE_MS',
  'snoozeOverdueClassReminder'
);

// PKT minutes/date of "now", computed the same way the portal does.
function pktNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
function expectedLabel(mins) {
  const total = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix} PKT`;
}

// ===========================================================================
// A) PKT time correctness
// ===========================================================================
function makePktCtx(fixedMs) {
  const RealDate = Date;
  const sandbox = {
    console,
    Date: class extends RealDate {
      constructor(...args) { super(...args.length ? args : [fixedMs]); }
      static now() { return fixedMs; }
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(PKT_CODE, ctx);
  return ctx;
}
{
  // 2026-10-27T20:30:00Z = 2026-10-28 01:30 PKT (Wednesday).
  const ctx = makePktCtx(Date.parse('2026-10-27T20:30:00Z'));
  const p = vm.runInContext('getPktNowParts()', ctx);
  check('PKT date rolls over at midnight (20:30Z -> next-day PKT date)', p.date === '2026-10-28', JSON.stringify(p));
  check('PKT minutes are 01:30 (90)', p.minutes === 90, JSON.stringify(p));
  check('PKT weekday is Wednesday (3)', p.day === 3, JSON.stringify(p));
}
{
  // 2026-10-27T18:00:00Z = 2026-10-27 23:00 PKT (Tuesday).
  const ctx = makePktCtx(Date.parse('2026-10-27T18:00:00Z'));
  const p = vm.runInContext('getPktNowParts()', ctx);
  check('PKT date same day before midnight (18:00Z -> 23:00 PKT)', p.date === '2026-10-27', JSON.stringify(p));
  check('PKT minutes are 23:00 (1380)', p.minutes === 1380, JSON.stringify(p));
  check('PKT weekday is Tuesday (2)', p.day === 2, JSON.stringify(p));
}

// ===========================================================================
// B) Overdue-class reminder behaviour (current PKT time from the test host)
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

function makeReminderCtx(todayClasses) {
  // Virtual clock for Date.now() (snooze timing) while `new Date()`
  // stays on real time so getPktNowParts computes the real PKT time.
  const clock = { nowMs: Date.now() };
  const RealDate = Date;
  const bannerEl = {
    innerHTML: '',
    _cls: new Set(['hidden']),
    classList: {
      add(c) { bannerEl._cls.add(c); },
      remove(c) { bannerEl._cls.delete(c); },
      contains(c) { return bannerEl._cls.has(c); },
    },
  };
  const calls = { transitions: [], completions: [], modals: [] };
  const sandbox = {
    console,
    Date: class extends RealDate {
      static now() { return clock.nowMs; }
    },
    document: {
      getElementById: (id) => (id === 'teacherOverdueClassReminder' ? bannerEl : null),
    },
    TODAY_CLASSES: todayClasses,
    CURRENT_TEACHER: { id: 'TCH-1' },
    escapeHtml: (s) => String(s),
    escapeJsAttr: (s) => String(s),
    transitionClassSessionState: async (args) => { calls.transitions.push(args); return { success: true }; },
    handleTeacherCompleteClass: (...args) => { calls.completions.push(args); },
    openAttendanceModal: (...args) => { calls.modals.push(args); },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(PKT_CODE + '\n' + REMINDER_CODE, ctx);
  return { ctx, calls, bannerEl, clock };
}
const runCheck = (ctx) => vm.runInContext('checkOverdueClassReminder()', ctx);
const isShown = (bannerEl) => !bannerEl._cls.has('hidden');

{
  const { ctx, calls, bannerEl } = makeReminderCtx([slot()]);
  runCheck(ctx);
  check('expired Running class -> reminder SHOWN', isShown(bannerEl));
  check('reminder lists the student name', bannerEl.innerHTML.includes('Test Student'));
  check('reminder shows the scheduled end time in PKT', bannerEl.innerHTML.includes(expectedLabel(pkt.minutes - 5)), bannerEl.innerHTML);
  check('reminder has an END CLASS button wired to the manual complete flow',
    bannerEl.innerHTML.includes('END CLASS') && bannerEl.innerHTML.includes("handleTeacherCompleteClass('SCH-1', 'STU-1', 'TCH-1'"), bannerEl.innerHTML);
  check('reminder itself performs NO transition / completion / modal', calls.transitions.length === 0 && calls.completions.length === 0 && calls.modals.length === 0);
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot({ log: { status: 'Waiting' } })]);
  runCheck(ctx);
  check('expired Waiting class -> reminder SHOWN (teacher joined Zoom)', isShown(bannerEl) && bannerEl.innerHTML.includes('Test Student'));
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot({ log: undefined })]);
  runCheck(ctx);
  check('never-started slot (no log) past end -> NO reminder', !isShown(bannerEl) && bannerEl.innerHTML === '');
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot({ log: { status: 'Scheduled' } })]);
  runCheck(ctx);
  check('Scheduled log past end -> NO reminder', !isShown(bannerEl));
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot({ log: { status: 'Completed' } })]);
  runCheck(ctx);
  check('already Completed slot -> NO reminder', !isShown(bannerEl));
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot({ endMin: pkt.minutes + 30 })]);
  runCheck(ctx);
  check('Running slot not yet ended -> NO reminder', !isShown(bannerEl));
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot({ isAdvanceExtra: true })]);
  runCheck(ctx);
  check('advance-extra row -> NO reminder', !isShown(bannerEl));
}
{
  const { ctx, bannerEl } = makeReminderCtx([slot(), slot({ id: 'SCH-2', student_id: 'STU-2', students: { name: 'Second Student' } })]);
  runCheck(ctx);
  check('two overdue classes -> BOTH listed with their own END CLASS buttons',
    isShown(bannerEl) && bannerEl.innerHTML.includes('Test Student') && bannerEl.innerHTML.includes('Second Student')
    && (bannerEl.innerHTML.match(/END CLASS/g) || []).length === 2, bannerEl.innerHTML);
}
{
  // Snooze: hides now, still hidden at +119 s, back at +121 s.
  const { ctx, bannerEl, clock } = makeReminderCtx([slot()]);
  runCheck(ctx);
  check('snooze setup: reminder shown', isShown(bannerEl));
  vm.runInContext('snoozeOverdueClassReminder()', ctx);
  check('snooze hides the banner immediately', !isShown(bannerEl));
  runCheck(ctx);
  check('check during snooze keeps it hidden', !isShown(bannerEl));
  clock.nowMs += 119000;
  runCheck(ctx);
  check('still hidden at +119 s', !isShown(bannerEl));
  clock.nowMs += 2000;
  runCheck(ctx);
  check('reappears at +121 s while the class is still un-ended', isShown(bannerEl) && bannerEl.innerHTML.includes('Test Student'));
}
{
  // Ending the class clears the reminder for good (and resets snooze).
  const classes = [slot()];
  const { ctx, bannerEl } = makeReminderCtx(classes);
  runCheck(ctx);
  vm.runInContext('snoozeOverdueClassReminder()', ctx);
  classes[0].log.status = 'Completed';
  runCheck(ctx);
  check('class ended -> reminder hidden and emptied', !isShown(bannerEl) && bannerEl.innerHTML === '');
  classes[0].log.status = 'Running';
  runCheck(ctx);
  check('a later overdue class shows immediately (snooze was reset when the list emptied)', isShown(bannerEl));
}

// ===========================================================================
// C) Structural guards
// ===========================================================================
check('auto-complete watcher function is GONE', !TEACHER_HTML.includes('maybeAutoCompleteExpiredClasses'));
check('auto-preview marker machinery is GONE', !TEACHER_HTML.includes('AUTO_PREVIEW') && !TEACHER_HTML.includes('alhuda_auto_preview_shown') && !TEACHER_HTML.includes('_autoPreviewInFlight'));
check('the "ended automatically" completion note is GONE', !TEACHER_HTML.includes('Class ended automatically'));
check('1s clock kept, with no completion watcher call', TEACHER_HTML.includes('Live PKT clock') && TEACHER_HTML.includes('}, 1000);'));
check('reminder element exists in the Today\'s Classes markup', TEACHER_HTML.includes('id="teacherOverdueClassReminder"'));
check('reminder re-checks on a dedicated 30 s interval', TEACHER_HTML.includes('TEACHER_REMINDER_CHECK_MS = 30000') && TEACHER_HTML.includes('}, TEACHER_REMINDER_CHECK_MS);'));
check('reminder snooze is 120 s', TEACHER_HTML.includes('TEACHER_REMINDER_SNOOZE_MS = 120000'));
check('renderTeacherClassesTable re-renders the reminder', extractFunction(TEACHER_HTML, 'renderTeacherClassesTable').includes('checkOverdueClassReminder()'));
check('transition date comes from getPktNowParts', TEACHER_HTML.includes('const todayDate = getPktNowParts().date;'));
check('manual complete handler unchanged (transition + modal call intact)', TEACHER_HTML.includes("openAttendanceModal(scheduleId, studentName, '', studentId, 'Completed', '');"));
check('start path has NO concurrent-running block (next class can start first)',
  !/another class is (still )?(running|in progress)/i.test(extractFunction(TEACHER_HTML, 'transitionClassSessionState'))
  && !/another class is (still )?(running|in progress)/i.test(extractFunction(TEACHER_HTML, 'handleTeacherStartClass')));
check('row START CLASS buttons render per-row from status only', (TEACHER_HTML.match(/handleTeacherStartClass\('\$\{escapeJsAttr\(c\.id\)\}'/g) || []).length >= 2);

const failed = results.filter((r) => !r.pass).length;
console.log(`---\nurgent1-auto-preview: ${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
