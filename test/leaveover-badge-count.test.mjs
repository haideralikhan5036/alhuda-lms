// Leave Over badge count (dashboard top-circle, Issue 2) — the badge
// #badgeTopLeaveOverCount and its two dots must be driven ONLY by
// OVERDUE_LEAVE_STUDENTS (the exact list the Return Alerts modal shows,
// rebuilt by checkLeaveReturnAlertsAndRequests from live student data).
// Previously the badge used Math.max(overdueList, kpiDashLeave) with an
// ALL_LEAVE_RECORDS fallback, so it could show 3 (today's classes marked
// Leave) while the modal listed nobody.
// Run from the repo root:  node test/leaveover-badge-count.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const DASHBOARD_JS = read('js/dashboard.js');
const LEAVES_JS = read('js/leaves.js');

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

const SYNC_SRC = extractFunction(DASHBOARD_JS, 'syncTopCircleNotificationDots');
const MERGE_SRC = extractFunction(DASHBOARD_JS, 'mergeLocalTeacherRequestsIntoGlobal');

// ---- fixture DOM element (browser-faithful: innerText coerces to string)
function fixtureEl(startHidden = false) {
  const classes = new Set(startHidden ? ['hidden'] : []);
  const el = {
    _text: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
  Object.defineProperty(el, 'innerText', {
    get() { return this._text; },
    set(v) { this._text = String(v); },
  });
  return el;
}

const EL_IDS = [
  'dotTopCircleLeaveOver', 'dotTopCircleLeaveOverSolid', 'badgeTopLeaveOverCount',
  'kpiDashLeave',
  'dotTopCircleRequests', 'badgeTopRequestsCount',
  'badgeTopAnnouncementsCount', 'dotTopCircleAnnouncements',
  'dotTopCircleComplaints', 'dotTopCircleComplaintsSolid', 'badgeTopComplaintsCount',
  'adminComplaintsModalCountBadge',
];

// Build a fresh vm context running the REAL sync function. opts.overdue:
// array -> defined global; 'omit' -> global never defined (typeof path).
function makeContext(opts = {}) {
  const els = {};
  for (const id of EL_IDS) els[id] = fixtureEl(opts.dotsStartHidden === true);
  if (opts.kpiText !== undefined) els['kpiDashLeave'].innerText = opts.kpiText;

  const sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null },
    getLocalTeacherCorrectionRequests: () => [],
    getOfficialAnnouncements: () => opts.announcements || [],
    getParentComplaints: () => opts.complaints || [],
    renderPortalAnnouncementBanners: () => {},
    PENDING_TEACHER_REQUESTS: opts.pendingRequests || [],
    ALL_LEAVE_RECORDS: opts.allLeaveRecords || [],
  };
  sandbox.window = sandbox;
  if (opts.overdue !== 'omit') sandbox.OVERDUE_LEAVE_STUDENTS = opts.overdue || [];
  vm.createContext(sandbox);
  vm.runInContext(MERGE_SRC + '\n' + SYNC_SRC, sandbox);
  return { sandbox, els };
}

// ---- Case 1: the reported bug — 0 overdue, KPI says 3, leave records look active
{
  const { sandbox, els } = makeContext({
    overdue: [],
    kpiText: '3',
    allLeaveRecords: [{ status: 'Active' }, { status: 'Completed', isOverdue: true }, { status: 'Active' }],
    dotsStartHidden: false, // dots start visible; the sync must hide them
  });
  sandbox.syncTopCircleNotificationDots();
  check('bug case: badge is 0 when the overdue list is empty (KPI=3, active leave records present)',
    els['badgeTopLeaveOverCount'].innerText === '0', 'got ' + els['badgeTopLeaveOverCount'].innerText);
  check('bug case: both leave dots hidden when the count is 0',
    els['dotTopCircleLeaveOver'].classList.contains('hidden') &&
    els['dotTopCircleLeaveOverSolid'].classList.contains('hidden'));
}

// ---- Case 2: 2 overdue, KPI 0 -> badge 2, dots shown
{
  const { sandbox, els } = makeContext({
    overdue: [{ id: 'STU-1' }, { id: 'STU-2' }],
    kpiText: '0',
    dotsStartHidden: true, // dots start hidden; the sync must show them
  });
  sandbox.syncTopCircleNotificationDots();
  check('2 overdue students -> badge 2', els['badgeTopLeaveOverCount'].innerText === '2',
    'got ' + els['badgeTopLeaveOverCount'].innerText);
  check('2 overdue students -> both leave dots shown',
    !els['dotTopCircleLeaveOver'].classList.contains('hidden') &&
    !els['dotTopCircleLeaveOverSolid'].classList.contains('hidden'));
}

// ---- Case 3: 1 overdue, KPI 5 -> the list wins, never the max
{
  const { sandbox, els } = makeContext({ overdue: [{ id: 'STU-1' }], kpiText: '5' });
  sandbox.syncTopCircleNotificationDots();
  check('1 overdue + KPI 5 -> badge 1 (list wins, no Math.max)',
    els['badgeTopLeaveOverCount'].innerText === '1', 'got ' + els['badgeTopLeaveOverCount'].innerText);
}

// ---- Case 4: OVERDUE_LEAVE_STUDENTS undefined -> badge 0, dots hidden, no throw
{
  const { sandbox, els } = makeContext({ overdue: 'omit', kpiText: '3', dotsStartHidden: false });
  let threw = null;
  try { sandbox.syncTopCircleNotificationDots(); } catch (e) { threw = e; }
  check('OVERDUE_LEAVE_STUDENTS undefined -> no throw', !threw, threw && threw.message);
  check('OVERDUE_LEAVE_STUDENTS undefined -> badge 0', els['badgeTopLeaveOverCount'].innerText === '0',
    'got ' + els['badgeTopLeaveOverCount'].innerText);
  check('OVERDUE_LEAVE_STUDENTS undefined -> dots hidden',
    els['dotTopCircleLeaveOver'].classList.contains('hidden') &&
    els['dotTopCircleLeaveOverSolid'].classList.contains('hidden'));
}

// ---- Case 5: the other three badges in the same function still behave
{
  const { sandbox, els } = makeContext({
    overdue: [{ id: 'STU-9' }],
    pendingRequests: [{}, {}, {}],
    announcements: [{ id: 'a1' }, { id: 'a2' }],
    complaints: [{ status: 'Open' }, { status: 'Resolved' }, { status: 'Pending' }],
  });
  sandbox.syncTopCircleNotificationDots();
  check('requests badge still counts PENDING_TEACHER_REQUESTS',
    els['badgeTopRequestsCount'].innerText === '3' && !els['dotTopCircleRequests'].classList.contains('hidden'),
    'got ' + els['badgeTopRequestsCount'].innerText);
  check('announcements badge still counts official announcements',
    els['badgeTopAnnouncementsCount'].innerText === '2' && !els['dotTopCircleAnnouncements'].classList.contains('hidden'),
    'got ' + els['badgeTopAnnouncementsCount'].innerText);
  check('complaints badge still counts unresolved complaints only',
    els['badgeTopComplaintsCount'].innerText === '2' &&
    !els['dotTopCircleComplaints'].classList.contains('hidden') &&
    els['adminComplaintsModalCountBadge'].innerText === '2 Pending',
    'got ' + els['badgeTopComplaintsCount'].innerText);
}

// ---- Structural: the removed inputs stay removed from the sync function
check('sync function no longer reads the kpiDashLeave element', !SYNC_SRC.includes("getElementById('kpiDashLeave')"));
check('sync function no longer falls back to ALL_LEAVE_RECORDS', !SYNC_SRC.includes('ALL_LEAVE_RECORDS'));
check('sync function no longer Math.max-es the leave count', !/Math\.max\([^)]*overdue/i.test(SYNC_SRC));
check('sync function drives the badge from OVERDUE_LEAVE_STUDENTS',
  SYNC_SRC.includes("leaveBadge.innerText = overdueLeaves") && SYNC_SRC.includes('OVERDUE_LEAVE_STUDENTS'));

// ---- Structural: leaves.js scan re-syncs the top badge after rebuilding the list
{
  const scanSrc = extractFunction(LEAVES_JS, 'checkLeaveReturnAlertsAndRequests');
  const rebuildIdx = scanSrc.indexOf('OVERDUE_LEAVE_STUDENTS = []');
  const syncIdx = scanSrc.indexOf('syncTopCircleNotificationDots();');
  check('leave scan contains the guarded top-badge re-sync',
    scanSrc.includes("if (typeof syncTopCircleNotificationDots === 'function')") && syncIdx > -1);
  check('the re-sync runs after OVERDUE_LEAVE_STUDENTS is rebuilt',
    rebuildIdx > -1 && syncIdx > rebuildIdx);
  check('the re-sync appears exactly once in the scan',
    (scanSrc.match(/syncTopCircleNotificationDots\(\);/g) || []).length === 1);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
