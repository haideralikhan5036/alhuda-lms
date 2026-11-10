// Dashboard marks cleanup (owner screenshot marks, 2026-11-10) —
// (1) source pins: the "N Waiting" KPI badge, the Type column and the
// student-ID / teacher-phone sub-lines are gone from index.html +
// js/dashboard.js, while the waitingCount computation stays; (2)
// EXECUTED renders of the real renderDashboardClassesTable (real
// js/dashboard.js in a vm, same harness shape as
// slow-classes-recovery.test.mjs): a Waiting row whose lesson_notes is
// the auto-logged Zoom join note renders ONLY the small join time, the
// Attendance button still receives the FULL stored note, JSON lesson
// notes keep their book/page display, and other plain-text notes keep
// their full text.
// Run from the repo root:  node test/dashboard-marks-cleanup.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const DASH_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/dashboard.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Source pins ------------------------------------------------------
check('pin: waiting badge element gone from index.html', !INDEX_SRC.includes('kpiDashWaitingBadge'));
check('pin: waiting badge paint block gone from dashboard.js', !DASH_SRC.includes('kpiDashWaitingBadge'));
check('pin: waitingCount computation in the log scan stays', DASH_SRC.includes('waitingCount++'));
check('pin: kpiDashCurrent count element stays', INDEX_SRC.includes('id="kpiDashCurrent"'));
check('pin: Type header gone from the dashboard classes table', !INDEX_SRC.includes('<th class="p-3">Type</th>'));
check('pin: typeBadge variable gone from dashboard.js', !DASH_SRC.includes('typeBadge'));
check('pin: dashboard classes loading row is colspan 6', INDEX_SRC.includes('<td colspan="6" class="p-8 text-center text-slate-400">Loading today'));
check('pin: dashboard classes loading row is no longer colspan 7', !INDEX_SRC.includes('<td colspan="7" class="p-8 text-center text-slate-400">Loading today'));

// ---- Executed renderer ------------------------------------------------
class FakeEl {
  constructor() {
    this._cls = new Set(['hidden']);
    this.innerText = ''; this.innerHTML = ''; this.value = '';
    this.classList = { add: (...c) => c.forEach(x => this._cls.add(x)), remove: (...c) => c.forEach(x => this._cls.delete(x)), contains: (c) => this._cls.has(c) };
  }
}
const els = new Map();
const getEl = (id) => { if (!els.has(id)) els.set(id, new FakeEl()); return els.get(id); };
const sandbox = {
  console, setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {},
  CURRENT_ROLE: 'owner',
  document: { getElementById: getEl, addEventListener: () => {}, createElement: () => new FakeEl(), body: new FakeEl(), hidden: false },
  location: { hostname: 'test' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
sandbox.window.innerWidth = 1200; sandbox.addEventListener = () => {}; sandbox.dispatchEvent = () => {};
vm.createContext(sandbox);
vm.runInContext(DASH_SRC, sandbox);

function renderOne(row) {
  vm.runInContext(`DASHBOARD_CLASSES = ${JSON.stringify([row])}; DASH_CLASSES_DEGRADED = null; CURRENT_DASH_FILTER = 'all'; renderDashboardClassesTable();`, sandbox);
  return els.get('dashClassesTableBody').innerHTML;
}
const cellsOf = (html) => [...html.matchAll(/<td[\s\S]*?<\/td>/g)].map(m => m[0]);

const baseRow = {
  id: 'SCH-1', start_time: '22:00', end_time: '22:30', student_id: 'STU-016', teacher_id: 'TCH-003',
  students: { name: 'Musa Jalloh', id: 'STU-016', family_id: 'FAM-011', whatsapp: '03001112223' },
  teachers: { full_name: 'Gulfam Khan', phone: '03109478814', email: 'gulfam@example.com' },
  courses: { name: 'Quran Studies & Tajweed' },
  startMin: 1320, endMin: 1350, isLive: true, isUpcoming: false, isPast: false,
  isCurrentSlot: true, isRunningMarked: false, isTrial: false, isLeaveStudent: false,
  status: 'WAITING', badgeClass: 'bg-amber-100 text-amber-900 border-amber-400', filterCategory: 'waiting',
  meeting_link: 'https://zoom.us/j/123', log: null,
};

// -- Waiting row with the auto-logged join note -------------------------
const AUTO_NOTE = '[Auto-Logged] Teacher joined Zoom at 10:11 PM PKT (Waiting for Student)';
{
  const html = renderOne({ ...baseRow, log: { status: 'Waiting', lesson_notes: AUTO_NOTE } });
  const cells = cellsOf(html);
  check('waiting row: renders exactly 6 cells (Type column gone)', cells.length === 6, `cells=${cells.length}`);
  check('waiting row: notes cell shows ONLY the small join time',
    (cells[4] || '').includes('<span class="text-[11px] text-slate-500 font-medium">10:11 PM</span>'));
  check('waiting row: notes cell has no [Auto-Logged] text', !(cells[4] || '').includes('[Auto-Logged]') && !(cells[4] || '').includes('Teacher joined Zoom'));
  check('waiting row: status pill still shown under the notes', />\s*WAITING\s*<\/span>/.test(cells[4] || ''));
  check('waiting row: Attendance button still receives the FULL stored note',
    html.includes(`'${AUTO_NOTE}'`));
  // The student id legitimately remains inside the name button onclick
  // argument (that button must stay); the VISIBLE sub-line is what the
  // owner marked. Strip the name button, then no id may remain visible.
  const studentCellVisible = (cells[1] || '').replace(/<button[\s\S]*?<\/button>/, '');
  check('waiting row: student name button intact', (cells[1] || '').includes('Musa Jalloh'));
  check('waiting row: no visible STU- / FAM- sub-line in the student cell',
    !studentCellVisible.includes('STU-') && !studentCellVisible.includes('FAM-'), studentCellVisible.slice(0, 120));
  check('waiting row: teacher name intact', (cells[3] || '').includes('Gulfam Khan'));
  check('waiting row: teacher phone nowhere in the row', !html.includes('03109478814'));
  check('waiting row: no Type badge cell (no Regular/Trial badge)', !html.includes('>Regular</span>') && !html.includes('>Trial</span>'));
}

// -- JSON lesson note keeps its book/page display ------------------------
{
  const jsonNote = JSON.stringify({ book_id: 'custom-1790853704135', book_title: 'Qaida Noorania Eng', page: 12, status: 'Pass' });
  const html = renderOne({ ...baseRow, status: 'COMPLETED', filterCategory: 'completed', log: { status: 'Present', lesson_notes: jsonNote } });
  check('json note row: book title still renders', html.includes('Qaida Noorania Eng'));
  check('json note row: page display still renders', html.includes('Pg 12'));
  check('json note row: still 6 cells', cellsOf(html).length === 6);
}

// -- Other plain-text notes keep their full text --------------------------
{
  const html = renderOne({ ...baseRow, status: 'RUNNING', filterCategory: 'running', log: { status: 'Running', lesson_notes: 'Class started by teacher at 09:45 AM' } });
  check('plain note row: full text still renders', html.includes('Class started by teacher at 09:45 AM'));
}

// -- Trial row: no Trial type badge any more ------------------------------
{
  const html = renderOne({ ...baseRow, isTrial: true, filterCategory: 'remaining', log: { status: '', lesson_notes: 'Trial class note' } });
  check('trial row: no Trial type badge', !html.includes('>Trial</span>'));
  check('trial row: still 6 cells', cellsOf(html).length === 6);
}

const failed = results.filter(x => !x.pass).length;
console.log(`\ndashboard-marks-cleanup: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
