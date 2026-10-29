// Student attendance report (Batch C1) tests.
// Root cause fixed: the 360 workspace strip + Progress Report tab counted
// ONLY literal 'present' — but teachers store 'Completed' for a held class
// (see js/lesson-history.js + parent.html: 'Present' is only a legacy
// value) — so attended counts and percentages were wrong, and zero logs
// reported a misleading 100%. The strip was also all-time, not monthly.
// The fix: js/attendance-summary.js (one canonical, pure calculation)
// + a month picker in the 360 workspace (default: current PKT month).
// Run from the repo root:  node test/student-attendance-report.test.mjs
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

// ---- A) the shared helper, loaded for real in a vm ----
const sandbox = { window: {}, console, JSON, Object, Array, String, Number, Math, Date, Intl, parseInt, parseFloat, isFinite };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('js/attendance-summary.js'), sandbox);
const AS = sandbox.window.AttendanceSummary;
check('helper exposes summarize + currentPktMonth + labelOfMonth',
  !!AS && typeof AS.summarize === 'function' && typeof AS.currentPktMonth === 'function' && typeof AS.labelOfMonth === 'function');

const L = (date, status) => ({ date, status });
const oct = '2026-10';

// 1. All classes present (teachers store 'Completed').
{
  const r = AS.summarize([L('2026-10-02', 'Completed'), L('2026-10-05', 'Completed'), L('2026-10-09', 'Completed')], oct);
  check('all present: 3 present / 3 eligible / 100%', r.present === 3 && r.eligible === 3 && r.percentage === 100, JSON.stringify(r));
}
// 2. Mixed present/absent/leave — the brief's illustrative shape as a real case.
{
  const logs = [];
  for (let d = 1; d <= 8; d++) logs.push(L(`2026-10-${String(d).padStart(2, '0')}`, 'Completed'));
  logs.push(L('2026-10-20', 'Absent'), L('2026-10-22', 'Leave'));
  const r = AS.summarize(logs, oct);
  check('mixed: 8 present / 1 absent / 1 leave / 80%', r.present === 8 && r.absent === 1 && r.leave === 1 && r.percentage === 80, JSON.stringify(r));
}
// 3. Legacy 'Present' still counts as attended.
{
  const r = AS.summarize([L('2026-10-02', 'Present'), L('2026-10-05', 'Present'), L('2026-10-09', 'Completed')], oct);
  check("legacy 'Present' counts as attended", r.present === 3 && r.percentage === 100, JSON.stringify(r));
}
// 4. Leave sits in the denominator (established policy, documented in the helper).
{
  const r = AS.summarize([L('2026-10-02', 'Completed'), L('2026-10-05', 'Leave')], oct);
  check('leave in denominator: 1 present / 2 eligible / 50%', r.present === 1 && r.leave === 1 && r.percentage === 50, JSON.stringify(r));
}
// 5. Non-final statuses are excluded, never counted as missed.
{
  const r = AS.summarize([L('2026-10-02', 'Completed'), L('2026-10-05', 'Running'), L('2026-10-06', 'Waiting'), L('2026-10-07', 'Reschedule')], oct);
  check('Running/Waiting/Reschedule excluded from denominator', r.present === 1 && r.eligible === 1 && r.percentage === 100, JSON.stringify(r));
}
// 6. Zero denominator is null — never NaN, Infinity, 0% or 100%.
{
  const r = AS.summarize([L('2026-10-02', 'Running')], oct);
  check('no eligible classes: percentage is null', r.percentage === null && r.eligible === 0, JSON.stringify(r));
  const r2 = AS.summarize([], oct);
  check('no logs at all: percentage is null', r2.percentage === null, JSON.stringify(r2));
}
// 7. Month boundary: Oct 31 vs Nov 1.
{
  const logs = [L('2026-10-31', 'Completed'), L('2026-11-01', 'Completed'), L('2026-11-02', 'Absent')];
  const rOct = AS.summarize(logs, '2026-10');
  const rNov = AS.summarize(logs, '2026-11');
  check('month boundary splits correctly', rOct.present === 1 && rOct.eligible === 1 && rNov.present === 1 && rNov.absent === 1 && rNov.percentage === 50,
    JSON.stringify({ rOct, rNov }));
}
// 8. Same-day multiples count as separate sessions (dedupe is upstream).
{
  const r = AS.summarize([L('2026-10-05', 'Completed'), L('2026-10-05', 'Completed')], oct);
  check('two sessions same day count twice', r.present === 2, JSON.stringify(r));
}
// 9. Other months and years are excluded.
{
  const logs = [L('2026-09-30', 'Completed'), L('2025-10-05', 'Completed'), L('2026-10-05', 'Completed')];
  const r = AS.summarize(logs, oct);
  check('other months/years excluded', r.present === 1 && r.eligible === 1, JSON.stringify(r));
}
// 10. Unknown statuses are ignored, not counted anywhere.
{
  const r = AS.summarize([L('2026-10-02', 'Completed'), L('2026-10-05', 'Foo')], oct);
  check('unknown status ignored', r.present === 1 && r.eligible === 1, JSON.stringify(r));
}
// 11. Month labels, including the January rollover.
{
  check("labelOfMonth('2026-10') is 'October 2026'", AS.labelOfMonth('2026-10') === 'October 2026');
  check("labelOfMonth('2027-01') is 'January 2027'", AS.labelOfMonth('2027-01') === 'January 2027');
  check('currentPktMonth is a YYYY-MM string', /^\d{4}-\d{2}$/.test(AS.currentPktMonth()), AS.currentPktMonth());
}

// ---- B) structural: the 360 workspace actually uses the helper ----
const P360 = read('js/profiles360.js');
check('360 workspace computes the strip from AttendanceSummary.summarize',
  P360.includes('AttendanceSummary.summarize(stuLogs, attReportMonth)'));
check('360 workspace no longer counts literal-present-only in the strip',
  !P360.includes("const presentLogs = stuLogs.filter(l => String(l.status || '').toLowerCase() === 'present')"));
check('360 workspace no longer reports 100% for zero logs',
  !P360.includes("attendancePct = totalLogs > 0 ? Math.round((attendedCount / totalLogs) * 100) : 100"));
check('360 month picker exists in history + report views',
  P360.includes('set360AttendanceReportMonth') && P360.includes('attReportMonthInput') && P360.includes('attReportMonthInput2'));
check('360 report tab shows Present / Absent / Leave + month label',
  P360.includes('Present / ${missedCount} Absent / ${leaveCount} Leave') && P360.includes('Attendance Accuracy — ${_esc360(attReportMonthLabel)}'));
check('360 zero-denominator renders a dash, not a percentage',
  P360.includes("attendancePct == null ? '—'"));
const INDEX = read('index.html');
check('index.html loads attendance-summary.js before profiles360.js',
  INDEX.indexOf('js/attendance-summary.js') > 0 && INDEX.indexOf('js/attendance-summary.js') < INDEX.indexOf('js/profiles360.js'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
