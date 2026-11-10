// Leave Screen Fixes (2026-11-10) — executed coverage for the
// Leave-tab audit fixes F1–F8 (report:
// files/LEAVE-SCREEN-AUDIT-2026-11-10.md):
//   F1  overdue is derived from ONE shared classification
//       (classifyLeaveRecord) — a lapsed, un-reactivated window is
//       OVERDUE in the KPI, the filter, Return Alerts and the
//       top-bar badge population, even though isStudentOnLeaveNow
//       (batch4-pinned, untouched) no longer counts it as on leave.
//   F2  Mark Leave validates dates BEFORE any write; deactivated
//       students are excluded from the picker and refused on save.
//   F3  "Previously Reactivated" lists only reactivated records;
//       the countdown badge follows the classification and can
//       never render NaN.
//   F4  Extend uses a dedicated modal with a real date input,
//       validates the new date, and reads the write result.
//   F5  Reactivate refuses a deactivated student.
//   F6  The teacher cell shows the snapshotted previous teacher
//       (marked "(previous)") and search matches that name.
//   F7  endStudentScheduleForLeave reports partial failures; the
//       save shows an honest error instead of the success toast.
//   F8  "Reactivated / Total" renders both numbers; modal/tab copy
//       no longer promises what the system does not do.
// Plus the manager-role leave cycle (audit row #23 parity gap).
// All dates are computed relative to the real today so the suite
// passes on any run date. All records are SYNTHETIC.
// Run from the repo root:  node test/leave-screen-fixes.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const LEAVES = read('js/leaves.js');
const INDEX = read('index.html');
const ASSIGNMENTS_SRC = read('js/assignments.js');

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

// ---- dates relative to the real today -------------------------------
const DAY = 24 * 60 * 60 * 1000;
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
const TODAY = fmt(Date.now());
const plus = (n) => fmt(Date.now() + n * DAY);

// ---- vm fixtures (mirrors test/teacher-reset-class.test.mjs) --------
function fixtureEl() {
  const classes = new Set();
  const el = {
    value: '', innerHTML: '', textContent: '', className: '', disabled: false,
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    style: {},
  };
  let text = '';
  Object.defineProperty(el, 'innerText', {
    get() { return text; },
    set(v) { text = String(v); },
  });
  return el;
}
function makeRegistry(seedHidden = []) {
  const map = new Map();
  return {
    get(id) {
      if (!map.has(id)) {
        const el = fixtureEl();
        if (seedHidden.includes(id)) el.classList.add('hidden');
        map.set(id, el);
      }
      return map.get(id);
    },
  };
}
// Supabase-shaped fake db with per-table failure injection:
// fail.updateErrorFor / fail.deleteErrorFor hold table names whose
// update/delete resolve an { error } WITHOUT applying the change —
// the real cloudflare-db contract for a failed write.
function makeFakeDb(tables, fail = {}) {
  const updErr = fail.updateErrorFor || new Set();
  const delErr = fail.deleteErrorFor || new Set();
  function builder(table) {
    const state = { action: 'select', filters: [], values: null, single: false };
    const matches = (row) => state.filters.every(f => {
      if (f.op === 'eq') return String(row[f.column]) === String(f.value);
      if (f.op === 'in') return (f.value || []).map(String).includes(String(row[f.column]));
      return true;
    });
    const run = () => {
      const rows = tables[table] || (tables[table] = []);
      if (state.action === 'select') {
        const out = rows.filter(matches).map(r => ({ ...r }));
        return { data: state.single ? (out[0] || null) : out, error: null };
      }
      if (state.action === 'update') {
        if (updErr.has(table)) return { data: [], error: { message: 'simulated update failure' } };
        rows.forEach(r => { if (matches(r)) Object.assign(r, state.values); });
        return { data: [], error: null };
      }
      if (state.action === 'insert' || state.action === 'upsert') {
        const vals = Array.isArray(state.values) ? state.values : [state.values];
        vals.forEach(v => rows.push({ ...v }));
        return { data: vals, error: null };
      }
      if (state.action === 'delete') {
        if (delErr.has(table)) return { data: [], error: { message: 'simulated delete failure' }, deleted: 0 };
        const kept = rows.filter(r => !matches(r));
        tables[table] = kept;
        return { data: [], error: null, deleted: rows.length - kept.length };
      }
      return { data: null, error: { message: 'unsupported action' } };
    };
    const b = {
      select: () => b,
      insert: (v) => { state.action = 'insert'; state.values = v; return b; },
      upsert: (v) => { state.action = 'upsert'; state.values = v; return b; },
      update: (v) => { state.action = 'update'; state.values = v; return b; },
      delete: () => { state.action = 'delete'; return b; },
      eq: (c, v) => { state.filters.push({ column: c, op: 'eq', value: v }); return b; },
      in: (c, v) => { state.filters.push({ column: c, op: 'in', value: v }); return b; },
      order: () => b,
      limit: () => b,
      single: () => { state.single = true; return b; },
      maybeSingle: () => { state.single = true; return b; },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return b;
  }
  return { from: (t) => builder(t) };
}

const LEAVE_FNS = [
  'isStudentOnLeaveNow', 'isValidLeaveDateStr', 'classifyLeaveRecord',
  'checkLeaveReturnAlertsAndRequests', 'openReturnAlertsModal',
  'loadLeaveManagementData', 'filterLeavesTable', 'openMarkLeaveModal',
  'leaveDayBeforeStr', 'endStudentScheduleForLeave', 'handleSaveStudentLeave',
  'reactivateStudentFromLeave', 'extendStudentLeave', 'handleExtendLeaveSave',
  'setLeaveKpiFilter', 'syncLeaveKpiCardsUI',
];

function makeWorld(role, opts = {}) {
  const registry = makeRegistry(opts.seedHidden || []);
  const notifies = [];
  const opened = [];
  const closed = [];
  const promptCalls = [];
  const tables = { students: [], class_schedules: [], attendance_logs: [], student_assignments: [], advance_requests: [], teachers: [], families: [] };
  const sandbox = {
    console,
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: (id) => registry.get(id),
    },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    db: makeFakeDb(tables, opts.fail || {}),
    CURRENT_ROLE: role,
    lmsNotify: (msg, o) => { notifies.push({ msg: String(msg), opts: o || {} }); },
    lmsConfirm: async () => true,
    lmsPrompt: async (...a) => { promptCalls.push(a); return null; },
    openModal: (id) => { opened.push(id); },
    closeModal: (id) => { closed.push(id); },
    loadDashboardData: async () => {},
    syncTopCircleNotificationDots: () => {},
    renderPendingTimeChangeBanners: () => {},
  };
  if (opts.withSelfDeactivatedHelper) {
    // The real js/config.js rule, for the typeof-helper branch.
    sandbox.isStudentSelfDeactivated = (s) => {
      if (!s) return true;
      if (s.is_active === false) return true;
      const st = String(s.status || 'Active').trim().toLowerCase();
      return st === 'inactive' || st === 'deactivated' || st === 'deleted' || st === 'left';
    };
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('var PENDING_TEACHER_REQUESTS = []; var OVERDUE_LEAVE_STUDENTS = []; var ALL_LEAVE_RECORDS = []; var ALL_CLASS_SCHEDULES = []; var ALL_TEACHERS = []; var ALL_STUDENTS = []; var ALL_FAMILIES = []; var RAW_ALL_FAMILIES = [];', sandbox);
  vm.runInContext(ASSIGNMENTS_SRC, sandbox);
  // Extract the real functions; a name missing from the tree under
  // test (e.g. a helper this fix adds) becomes a no-op stub so the
  // sanity run against the pre-fix tree fails per-assertion instead
  // of dying at load time.
  const srcParts = [];
  for (const n of LEAVE_FNS) {
    try { srcParts.push(extractFunction(LEAVES, n)); }
    catch (e) { srcParts.push(`function ${n}() { return undefined; }`); }
  }
  vm.runInContext(srcParts.join('\n'), sandbox);
  const msgs = () => notifies.map(n => n.msg);
  return { sandbox, tables, notifies, msgs, registry, opened, closed, promptCalls };
}

const meta = (o) => JSON.stringify(o);
function seedTabWorld(role = 'owner') {
  const w = makeWorld(role);
  const T = { full_name: 'Teacher One' };
  const F = { father_name: 'Father One' };
  w.tables.students.push(
    { id: 'STU-INWIN', name: 'Inwin Child', status: 'Active', family_id: 'FAM-1', assigned_teacher_id: null, teachers: null, families: F,
      notes: meta({ on_leave: true, leave_start_date: plus(-3), return_date: plus(4), leave_reason: 'Trip', leave_previous_teacher_id: 'TCH-1', leave_previous_teacher_name: 'Prev Teacher' }) },
    { id: 'STU-LAPSED', name: 'Lapsed Child', status: 'Active', family_id: 'FAM-1', assigned_teacher_id: null, teachers: null, families: F,
      notes: meta({ on_leave: true, leave_start_date: plus(-20), return_date: plus(-2), leave_reason: 'Trip', leave_previous_teacher_id: 'TCH-1', leave_previous_teacher_name: 'Prev Teacher' }) },
    { id: 'STU-DUETODAY', name: 'Due Today Child', status: 'Active', family_id: 'FAM-1', assigned_teacher_id: null, teachers: null, families: F,
      notes: meta({ on_leave: true, leave_start_date: plus(-10), return_date: TODAY, leave_reason: 'Trip' }) },
    { id: 'STU-REACT', name: 'Returned Child', status: 'Active', family_id: 'FAM-1', assigned_teacher_id: 'TCH-1', teachers: T, families: F,
      notes: meta({ on_leave: false, leave_start_date: plus(-30), return_date: plus(-16), leave_reason: 'Trip', reactivated_at: new Date(Date.now() - 15 * DAY).toISOString(), reactivated_by: 'owner' }) },
    { id: 'STU-UPCOMING', name: 'Upcoming Child', status: 'Active', family_id: 'FAM-1', assigned_teacher_id: null, teachers: null, families: F,
      notes: meta({ on_leave: true, leave_start_date: plus(5), return_date: plus(19), leave_reason: 'Trip' }) },
    { id: 'STU-LEGACY', name: 'Legacy Child', status: 'Leave', family_id: 'FAM-1', assigned_teacher_id: 'TCH-1', teachers: T, families: F, notes: '{}' },
    { id: 'STU-LEGACYPAST', name: 'Legacy Past Child', status: 'Leave', family_id: 'FAM-1', assigned_teacher_id: 'TCH-1', teachers: T, families: F,
      notes: meta({ return_date: plus(-5) }) },
    { id: 'STU-PLAIN', name: 'Plain Child', status: 'Active', family_id: 'FAM-1', assigned_teacher_id: 'TCH-1', teachers: T, families: F, notes: '{}' },
  );
  return w;
}
const rowCount = (html) => (String(html).match(/<tr/g) || []).length;

// ===========================================================================
// Part 1 — classification unit checks (the shared rule itself)
// ===========================================================================
{
  const w = makeWorld('owner');
  const cls = (st, m) => vm.runInContext(`classifyLeaveRecord(${JSON.stringify(st)}, ${JSON.stringify(m)}, ${JSON.stringify(TODAY)})`, w.sandbox);
  check('classify: inside window = ACTIVE',
    cls({ status: 'Active' }, { on_leave: true, leave_start_date: plus(-3), return_date: plus(4) }) === 'ACTIVE');
  check('classify: return day itself = OVERDUE (the alert must fire that day)',
    cls({ status: 'Active' }, { on_leave: true, leave_start_date: plus(-10), return_date: TODAY }) === 'OVERDUE');
  check('classify: lapsed window, never reactivated = OVERDUE',
    cls({ status: 'Active' }, { on_leave: true, leave_start_date: plus(-20), return_date: plus(-2) }) === 'OVERDUE');
  check('classify: future window = UPCOMING',
    cls({ status: 'Active' }, { on_leave: true, leave_start_date: plus(5), return_date: plus(19) }) === 'UPCOMING');
  check('classify: reactivated lifecycle (on_leave false + stamp) = REACTIVATED',
    cls({ status: 'Active' }, { on_leave: false, leave_start_date: plus(-30), return_date: plus(-16), reactivated_at: 'x' }) === 'REACTIVATED');
  check('classify: a stale reactivated_at under a NEW lapsed window does NOT mask OVERDUE',
    cls({ status: 'Active' }, { on_leave: true, leave_start_date: plus(-9), return_date: plus(-1), reactivated_at: 'x' }) === 'OVERDUE');
  check('classify: legacy status Leave, no dates = LEGACY-NO-DATE',
    cls({ status: 'Leave' }, {}) === 'LEGACY-NO-DATE');
  check('classify: legacy status Leave with a past return date = OVERDUE',
    cls({ status: 'Leave' }, { return_date: plus(-5) }) === 'OVERDUE');
  check('classify: legacy status Leave with a future return date = ACTIVE',
    cls({ status: 'Leave' }, { return_date: plus(6) }) === 'ACTIVE');
  check('classify: 360-style dateless leave (status Leave + on_leave, no dates) = ACTIVE',
    cls({ status: 'Leave' }, { on_leave: true }) === 'ACTIVE');
  check('classify: isStudentOnLeaveNow itself is unchanged (lapsed window is NOT on leave — batch4 rule)',
    vm.runInContext(`isStudentOnLeaveNow({ status: 'Active' }, ${JSON.stringify({ on_leave: true, leave_start_date: plus(-20), return_date: plus(-2) })}, ${JSON.stringify(TODAY)})`, w.sandbox) === false);
}

// ===========================================================================
// Part 2 — loader KPIs, filters, badges, teacher cell + search (F1/F3/F6/F8a)
// ===========================================================================
{
  const w = seedTabWorld('owner');
  await vm.runInContext('loadLeaveManagementData()', w.sandbox);
  const kpi = (id) => w.registry.get(id).innerText;
  // The batch4 predicate counts a legacy status-'Leave' row as on
  // leave regardless of dates, so LEGACYPAST is in BOTH the Active
  // count (predicate, unchanged by design) and Overdue
  // (classification) — the pre-existing legacy behaviour.
  check('loader: Active KPI = batch4 predicate count (in-window + both legacy rows)',
    kpi('kpiLeavesActive') === '3', 'got ' + kpi('kpiLeavesActive'));
  check('loader: Returning This Week counts only the in-window return within 7 days',
    kpi('kpiLeavesReturningSoon') === '1', 'got ' + kpi('kpiLeavesReturningSoon'));
  check('loader: Overdue KPI counts lapsed window + due-today + legacy past (F1 — was unreachable)',
    kpi('kpiLeavesOverdue') === '3', 'got ' + kpi('kpiLeavesOverdue'));
  check('loader: "Reactivated / Total" renders BOTH numbers as "R / T" (F8a)',
    kpi('kpiLeavesTotal') === '1 / 7', 'got ' + kpi('kpiLeavesTotal'));
  check('loader: records carry the shared classification',
    vm.runInContext("ALL_LEAVE_RECORDS.map(r => r.student.id + ':' + r.leaveClass).join(',')", w.sandbox) ===
    'STU-INWIN:ACTIVE,STU-LAPSED:OVERDUE,STU-DUETODAY:OVERDUE,STU-REACT:REACTIVATED,STU-UPCOMING:UPCOMING,STU-LEGACY:LEGACY-NO-DATE,STU-LEGACYPAST:OVERDUE');

  const tbody = () => w.registry.get('leavesTableBody').innerHTML;
  const setFilter = async (val, search = '') => {
    w.registry.get('filterLeavesStatus').value = val;
    w.registry.get('searchLeavesInput').value = search;
    await vm.runInContext('filterLeavesTable()', w.sandbox);
    return tbody();
  };

  let html = await setFilter('all');
  check('filter all: every leave-history record renders (plain student excluded)',
    rowCount(html) === 7 && !html.includes('Plain Child'), 'rows=' + rowCount(html));
  check('badge: lapsed window shows "Overdue — Awaiting Reactivation" (F3)',
    html.includes('Overdue — Awaiting Reactivation'));
  check('badge: due-today shows "Return Due Today" (F3)',
    html.includes('⚠️ Return Due Today'));
  check('badge: upcoming shows "Starts in 5d"',
    html.includes('Starts in 5d'));
  check('badge: reactivated shows "Reactivated / Resumed" and NOTHING wears the old "✅ Active / Resumed" (F3)',
    html.includes('✅ Reactivated / Resumed') && !html.includes('✅ Active / Resumed'));
  check('badge: in-window shows "Returns in 4d"; legacy no-date shows "No Return Set"',
    html.includes('Returns in 4d') && html.includes('No Return Set'));
  check('badge: no NaN anywhere in the rendered table',
    !html.includes('NaN'));
  check('teacher cell: unassigned leave rows show the snapshotted previous teacher, marked (previous) (F6)',
    html.includes('Prev Teacher') && html.includes('(previous)'));

  html = await setFilter('overdue');
  check('filter overdue: exactly the 3 classification-overdue rows',
    rowCount(html) === 3 && html.includes('Lapsed Child') && html.includes('Due Today Child') && html.includes('Legacy Past Child'),
    'rows=' + rowCount(html));
  html = await setFilter('reactivated');
  check('filter "Previously Reactivated": ONLY the truly reactivated record (F3 — lapsed/upcoming excluded)',
    rowCount(html) === 1 && html.includes('Returned Child'), 'rows=' + rowCount(html));
  html = await setFilter('active');
  check('filter active: every predicate-on-leave row (in-window + both legacy rows)',
    rowCount(html) === 3 && html.includes('Inwin Child') && html.includes('Legacy Child') && html.includes('Legacy Past Child'), 'rows=' + rowCount(html));
  html = await setFilter('returning_soon');
  check('filter returning_soon: only the in-window return within 7 days',
    rowCount(html) === 1 && html.includes('Inwin Child'), 'rows=' + rowCount(html));
  html = await setFilter('all', 'prev teacher');
  check('search: the snapshotted previous-teacher name is searchable (F6)',
    html.includes('Lapsed Child') && html.includes('Inwin Child') && !html.includes('Legacy Past Child'));
  html = await setFilter('all', 'no-such-person');
  check('search: a nonsense term renders the empty state',
    html.includes('No matching student leave records found'));
}

// ===========================================================================
// Part 3 — Return Alerts population + auto pop-up follow the classification (F1)
// ===========================================================================
{
  const w = seedTabWorld('owner');
  await vm.runInContext('checkLeaveReturnAlertsAndRequests(false)', w.sandbox);
  check('alerts: OVERDUE population = the 3 classification-overdue students (badge == list invariant source)',
    vm.runInContext("OVERDUE_LEAVE_STUDENTS.map(s => s.id).join(',')", w.sandbox) === 'STU-LAPSED,STU-DUETODAY,STU-LEGACYPAST',
    vm.runInContext("OVERDUE_LEAVE_STUDENTS.map(s => s.id).join(',')", w.sandbox));
  check('alerts: due-today entry is flagged isDueToday, the lapsed one isOverdue',
    vm.runInContext("OVERDUE_LEAVE_STUDENTS.find(s => s.id === 'STU-DUETODAY')?.isDueToday === true && OVERDUE_LEAVE_STUDENTS.find(s => s.id === 'STU-LAPSED')?.isOverdue === true", w.sandbox));
  check('alerts: sidebar badge still counts predicate-on-leave only (unchanged rule)',
    w.registry.get('navLeaveCountBadge').innerText === '3', 'got ' + w.registry.get('navLeaveCountBadge').innerText);
  check('alerts: bell badge shows the overdue count',
    w.registry.get('badgeReturnAlertsCount').innerText === '3' &&
    !w.registry.get('btnReturnAlertsBell').classList.contains('hidden'));
  vm.runInContext('openReturnAlertsModal()', w.sandbox);
  const list = w.registry.get('returnAlertsListContainer').innerHTML;
  check('alerts modal: lists the lapsed + due-today students with their timing badges',
    list.includes('Lapsed Child') && list.includes('Due Today Child') && list.includes('Returns Today') &&
    w.registry.get('modalReturnAlertsBadge').innerText === '3 Due');
}
{
  // The Mark Leave modal's printed promise: the pop-up fires when a
  // scheduled return date arrives.
  const w = seedTabWorld('owner');
  await vm.runInContext('checkLeaveReturnAlertsAndRequests(true)', w.sandbox);
  check('alerts: auto pop-up opens on the return date (modal promise is now true)',
    !w.registry.get('modalReturnAlerts').classList.contains('hidden'));
}

// ===========================================================================
// Part 4 — Mark Leave validation + picker (F2/F8): refusals write NOTHING
// ===========================================================================
function seedSaveWorld(role = 'owner', fail) {
  const w = makeWorld(role, { fail });
  w.tables.teachers.push({ id: 'TCH-1', full_name: 'Teacher One' });
  w.tables.students.push({ id: 'STU-V', name: 'Valid Child', status: 'Active', assigned_teacher_id: 'TCH-1', family_id: 'FAM-1', notes: '{}' });
  w.tables.class_schedules.push(
    { id: 'SCH-V1', student_id: 'STU-V', teacher_id: 'TCH-1', day_of_week: 1, start_time: '10:00', end_time: '10:30' },
    { id: 'SCH-V2', student_id: 'STU-V', teacher_id: 'TCH-1', day_of_week: 3, start_time: '10:00', end_time: '10:30' });
  w.tables.student_assignments.push({ id: 'ASG-V', student_id: 'STU-V', teacher_id: 'TCH-1', course_name: 'Quran', start_date: plus(-60), end_date: null, end_reason: null });
  vm.runInContext("ALL_TEACHERS = [{ id: 'TCH-1', full_name: 'Teacher One' }];", w.sandbox);
  return w;
}
async function attemptSave(w, start, ret) {
  w.registry.get('leaveStudentSelect').value = 'STU-V';
  w.registry.get('leaveStartDate').value = start;
  w.registry.get('leaveReturnDate').value = ret;
  w.registry.get('leaveReasonSelect').value = 'Family travel';
  w.notifies.length = 0;
  await vm.runInContext('handleSaveStudentLeave({ preventDefault() {} })', w.sandbox);
}
function assertNothingWritten(w, label) {
  const stu = w.tables.students[0];
  check(label + ': notes untouched, teacher still assigned',
    stu.notes === '{}' && stu.assigned_teacher_id === 'TCH-1');
  check(label + ': schedule rows intact, assignment still open',
    w.tables.class_schedules.length === 2 && w.tables.student_assignments[0].end_date === null);
  check(label + ': no success toast',
    !w.msgs().some(m => m.includes('🏖️ Leave recorded')));
}
{
  const w = seedSaveWorld();
  await attemptSave(w, plus(5), plus(5));
  check('mark leave: return == start refused with a clear message',
    w.msgs().some(m => m.includes('return date must be after the leave start date')));
  assertNothingWritten(w, 'mark leave (return == start)');
}
{
  const w = seedSaveWorld();
  await attemptSave(w, plus(5), plus(2));
  check('mark leave: return before start refused',
    w.msgs().some(m => m.includes('return date must be after the leave start date')));
  assertNothingWritten(w, 'mark leave (return < start)');
}
{
  const w = seedSaveWorld();
  await attemptSave(w, plus(-10), plus(-1));
  check('mark leave: return date already past refused',
    w.msgs().some(m => m.includes('return date has already passed')));
  assertNothingWritten(w, 'mark leave (return in past)');
}
{
  const w = seedSaveWorld();
  await attemptSave(w, plus(2), 'not-a-date');
  check('mark leave: garbage date refused as invalid',
    w.msgs().some(m => m.includes('valid leave dates')));
  assertNothingWritten(w, 'mark leave (garbage date)');
}
{
  const w = seedSaveWorld();
  w.tables.students[0].status = 'Inactive';
  await attemptSave(w, plus(2), plus(16));
  check('mark leave: a deactivated student is refused on save (F8 guard)',
    w.msgs().some(m => m.includes('deactivated and cannot be marked on leave')));
  assertNothingWritten(w, 'mark leave (deactivated student)');
}
{
  const w = seedSaveWorld();
  await attemptSave(w, plus(2), plus(16));
  const stu = w.tables.students[0];
  const m = JSON.parse(stu.notes);
  check('mark leave: a valid save still runs the full decision-3 mechanics (control)',
    w.msgs().some(x => x.includes('🏖️ Leave recorded')) && stu.assigned_teacher_id === null &&
    w.tables.class_schedules.length === 0 && m.on_leave === true &&
    w.tables.student_assignments[0].end_date === plus(1) && w.tables.student_assignments[0].end_reason === 'leave');
}
{
  // Picker: deactivated students are not offered (both the status
  // fallback path and the config-helper path).
  const w = makeWorld('owner');
  vm.runInContext("ALL_STUDENTS = [{ id: 'STU-A', name: 'Able', status: 'Active' }, { id: 'STU-I', name: 'Ina', status: 'Inactive' }, { id: 'STU-L', name: 'Lea', status: 'Leave' }];", w.sandbox);
  await vm.runInContext('openMarkLeaveModal()', w.sandbox);
  const pickerHtml = w.registry.get('leaveStudentSelect').innerHTML;
  check('picker: Inactive student is not offered; Active and on-leave students are',
    pickerHtml.includes('STU-A') && pickerHtml.includes('STU-L') && !pickerHtml.includes('STU-I'));

  const w2 = makeWorld('owner', { withSelfDeactivatedHelper: true });
  vm.runInContext("ALL_STUDENTS = [{ id: 'STU-A', name: 'Able', status: 'Active' }, { id: 'STU-X', name: 'Ina', status: 'Active', is_active: false }];", w2.sandbox);
  await vm.runInContext('openMarkLeaveModal()', w2.sandbox);
  const pickerHtml2 = w2.registry.get('leaveStudentSelect').innerHTML;
  check('picker: is_active=false student excluded via the config helper when present',
    pickerHtml2.includes('STU-A') && !pickerHtml2.includes('STU-X'));
}

// ===========================================================================
// Part 5 — Extend (F4): modal, validation, error-checked write
// ===========================================================================
function seedExtendWorld(role = 'owner', fail) {
  const w = makeWorld(role, { fail });
  w.tables.students.push({ id: 'STU-E', name: 'Extend Child', status: 'Active', assigned_teacher_id: null, family_id: 'FAM-1',
    notes: meta({ on_leave: true, leave_start_date: plus(-5), return_date: plus(5), leave_reason: 'Trip' }) });
  w.tables.students.push({ id: 'STU-E2', name: 'Lapsed Extend Child', status: 'Active', assigned_teacher_id: null, family_id: 'FAM-1',
    notes: meta({ on_leave: true, leave_start_date: plus(-12), return_date: plus(-3), leave_reason: 'Trip' }) });
  return w;
}
{
  const w = seedExtendWorld();
  await vm.runInContext("extendStudentLeave('STU-E')", w.sandbox);
  check('extend: opens the dedicated modal (no free-text prompt anymore)',
    w.opened.includes('modalExtendLeave') && w.promptCalls.length === 0);
  check('extend: modal is prefilled with the student name and the current return date',
    w.registry.get('extendLeaveStudentName').innerText === 'Extend Child' &&
    w.registry.get('extendLeaveCurrentReturn').innerText === plus(5) &&
    w.registry.get('extendLeaveNewReturnDate').value === plus(5));

  w.registry.get('extendLeaveNewReturnDate').value = plus(3);
  w.notifies.length = 0;
  await vm.runInContext('handleExtendLeaveSave({ preventDefault() {} })', w.sandbox);
  check('extend: a date not after the current return is refused; nothing written; modal stays open',
    w.msgs().some(m => m.includes('must be after the current return date')) &&
    JSON.parse(w.tables.students[0].notes).return_date === plus(5) &&
    !w.closed.includes('modalExtendLeave'));

  w.registry.get('extendLeaveNewReturnDate').value = 'garbage';
  w.notifies.length = 0;
  await vm.runInContext('handleExtendLeaveSave({ preventDefault() {} })', w.sandbox);
  check('extend: a garbage date is refused as invalid (no NaN can be stored)',
    w.msgs().some(m => m.includes('valid return date')) &&
    JSON.parse(w.tables.students[0].notes).return_date === plus(5));

  w.registry.get('extendLeaveNewReturnDate').value = plus(12);
  w.notifies.length = 0;
  await vm.runInContext('handleExtendLeaveSave({ preventDefault() {} })', w.sandbox);
  const m = JSON.parse(w.tables.students[0].notes);
  check('extend: a valid later date saves, stamps the extension and toasts success',
    m.return_date === plus(12) && !!m.extended_at && m.extended_by === 'owner' &&
    w.msgs().some(x => x.includes('Leave extended until ' + plus(12))) &&
    w.closed.includes('modalExtendLeave'));
}
{
  const w = seedExtendWorld();
  await vm.runInContext("extendStudentLeave('STU-E2')", w.sandbox);
  w.registry.get('extendLeaveNewReturnDate').value = plus(-1);
  await vm.runInContext('handleExtendLeaveSave({ preventDefault() {} })', w.sandbox);
  check('extend: once the return has passed, a still-past new date is refused',
    w.msgs().some(m => m.includes('already passed')) &&
    JSON.parse(w.tables.students[1].notes).return_date === plus(-3));
  w.registry.get('extendLeaveNewReturnDate').value = TODAY;
  w.notifies.length = 0;
  await vm.runInContext('handleExtendLeaveSave({ preventDefault() {} })', w.sandbox);
  check('extend: extending a lapsed leave to today is accepted (>= today)',
    JSON.parse(w.tables.students[1].notes).return_date === TODAY &&
    w.msgs().some(m => m.includes('Leave extended until ' + TODAY)));
}
{
  const w = seedExtendWorld('owner', { updateErrorFor: new Set(['students']) });
  await vm.runInContext("extendStudentLeave('STU-E')", w.sandbox);
  w.registry.get('extendLeaveNewReturnDate').value = plus(9);
  w.notifies.length = 0;
  await vm.runInContext('handleExtendLeaveSave({ preventDefault() {} })', w.sandbox);
  check('extend: a failed write shows an error and NO success toast; stored date unchanged (F4)',
    w.msgs().some(m => m.includes('Error extending leave')) &&
    !w.msgs().some(m => m.includes('Leave extended until')) &&
    JSON.parse(w.tables.students[0].notes).return_date === plus(5));
}

// ===========================================================================
// Part 6 — Reactivate guard (F5)
// ===========================================================================
{
  const w = makeWorld('owner');
  w.tables.students.push({ id: 'STU-D', name: 'Deact Child', status: 'Inactive', assigned_teacher_id: null, family_id: 'FAM-1',
    notes: meta({ on_leave: true, leave_start_date: plus(-9), return_date: plus(-1), leave_previous_teacher_id: 'TCH-1', leave_previous_teacher_name: 'Teacher One' }) });
  const before = w.tables.students[0].notes;
  await vm.runInContext("reactivateStudentFromLeave('STU-D')", w.sandbox);
  const stu = w.tables.students[0];
  check('reactivate: a deactivated student is refused — no status write, no reassignment, notes untouched',
    w.msgs().some(m => m.includes('student is deactivated')) &&
    stu.status === 'Inactive' && stu.assigned_teacher_id === null && stu.notes === before);
}
{
  const w = makeWorld('owner');
  w.tables.teachers.push({ id: 'TCH-1', full_name: 'Teacher One' });
  w.tables.students.push({ id: 'STU-R', name: 'Return Child', status: 'Active', assigned_teacher_id: null, family_id: 'FAM-1',
    notes: meta({ on_leave: true, leave_start_date: plus(-9), return_date: plus(-1), leave_previous_teacher_id: 'TCH-1', leave_previous_teacher_name: 'Teacher One' }) });
  await vm.runInContext("reactivateStudentFromLeave('STU-R')", w.sandbox);
  const stu = w.tables.students[0];
  const m = JSON.parse(stu.notes);
  check('reactivate: a lapsed leave reactivates normally (control) — previous teacher restored',
    stu.status === 'Active' && stu.assigned_teacher_id === 'TCH-1' && m.on_leave === false && !!m.reactivated_at &&
    w.msgs().some(x => x.includes('returned from leave')));
}

// ===========================================================================
// Part 7 — partial-failure honesty (F7)
// ===========================================================================
{
  const w = seedSaveWorld('owner', { deleteErrorFor: new Set(['class_schedules']) });
  await attemptSave(w, plus(2), plus(16));
  check('partial failure (schedule delete): honest error names what did NOT happen; no full-success toast',
    w.msgs().some(m => m.includes('timetable rows could not be removed')) &&
    !w.msgs().some(m => m.includes('🏖️')));
  check('partial failure (schedule delete): the leave itself is saved and the rows really are still there',
    JSON.parse(w.tables.students[0].notes).on_leave === true && w.tables.class_schedules.length === 2);
}
{
  const w = seedSaveWorld('owner', { updateErrorFor: new Set(['student_assignments']) });
  await attemptSave(w, plus(2), plus(16));
  check('partial failure (assignment close): the swallowed closeCurrent failure is caught by the read-back and named',
    w.msgs().some(m => m.includes('salary assignment could not be closed')) &&
    !w.msgs().some(m => m.includes('🏖️')));
  check('partial failure (assignment close): the assignment row is indeed still open',
    w.tables.student_assignments[0].end_date === null);
}

// ===========================================================================
// Part 8 — manager-role leave cycle (audit row #23)
// ===========================================================================
{
  const w = seedSaveWorld('manager');
  await attemptSave(w, plus(1), plus(10));
  const stu = w.tables.students[0];
  const m1 = JSON.parse(stu.notes);
  check('manager cycle: mark leave succeeds and is stamped manager',
    w.msgs().some(x => x.includes('🏖️ Leave recorded')) && m1.leave_marked_by === 'manager' &&
    stu.assigned_teacher_id === null && w.tables.class_schedules.length === 0);
  await vm.runInContext("reactivateStudentFromLeave('STU-V')", w.sandbox);
  const stu2 = w.tables.students[0];
  const m2 = JSON.parse(stu2.notes);
  check('manager cycle: reactivate restores the previous teacher and is stamped manager',
    stu2.assigned_teacher_id === 'TCH-1' && stu2.status === 'Active' && m2.on_leave === false && m2.reactivated_by === 'manager');
}

// ===========================================================================
// Part 9 — structural pins: copy tells the truth (F8), extend is modal-based
// ===========================================================================
check('copy: tab header no longer claims a Family leave engine',
  INDEX.includes('Student Leave Management') && !INDEX.includes('Student & Family Leave Management Engine'));
check('copy: Return Alerts modal no longer promises slot restoration',
  !INDEX.includes('restore slots or extend') &&
  !INDEX.includes("restores student's active status and weekly class schedule") &&
  INDEX.includes('Not Scheduled — timetable slots are not restored'));
check('copy: the Mark Leave alert promise stays (Fix 1 makes it true)',
  INDEX.includes('trigger an alert pop-up when the scheduled return date arrives'));
check('extend modal: exists in index.html with a real date input wired to the save handler',
  INDEX.includes('id="modalExtendLeave"') && INDEX.includes('type="date" id="extendLeaveNewReturnDate"') &&
  INDEX.includes('onsubmit="handleExtendLeaveSave(event)"'));
check('extend: the free-text prompt path is gone from leaves.js',
  !LEAVES.includes('Enter new Return Date'));
check('classification: one shared helper exists and drives loader, filter and alerts',
  LEAVES.includes('function classifyLeaveRecord') &&
  (() => { try {
    return extractFunction(LEAVES, 'loadLeaveManagementData').includes('classifyLeaveRecord') &&
      extractFunction(LEAVES, 'checkLeaveReturnAlertsAndRequests').includes('classifyLeaveRecord');
  } catch (e) { return false; } })());

// ===========================================================================
// Part 10 — clickable KPI cards: click → dropdown → filter → highlight
// (owner request, 2026-11-10: same behaviour as the Families KPI
// cards — the card handler only sets #filterLeavesStatus and
// re-enters filterLeavesTable; the ring is re-synced inside
// filterLeavesTable so manual dropdown changes agree too.)
// ===========================================================================
{
  const w = seedTabWorld('owner');
  // The real dropdown defaults to "active" (the selected option in
  // index.html); mirror that before the loader runs.
  w.registry.get('filterLeavesStatus').value = 'active';
  await vm.runInContext('loadLeaveManagementData()', w.sandbox);
  const selVal = () => w.registry.get('filterLeavesStatus').value;
  const tbody = () => w.registry.get('leavesTableBody').innerHTML;
  const ringed = (id) => (w.registry.get(id).className || '').includes('ring-2');
  const CARDS = ['leaveKpiActiveCard', 'leaveKpiReturningCard', 'leaveKpiOverdueCard', 'leaveKpiReactivatedCard'];
  const onlyRinged = (id) => CARDS.every(c => ringed(c) === (c === id));

  check('kpi cards: tab load leaves the dropdown on active and rings ONLY the Active card',
    selVal() === 'active' && onlyRinged('leaveKpiActiveCard'));
  check('kpi cards: initial render is the active bucket',
    rowCount(tbody()) === 3 && tbody().includes('Inwin Child'));

  await vm.runInContext("setLeaveKpiFilter('returning_soon')", w.sandbox);
  check('kpi cards: Returning click sets the dropdown, filters to the returning bucket, moves the ring',
    selVal() === 'returning_soon' && rowCount(tbody()) === 1 && tbody().includes('Inwin Child') && onlyRinged('leaveKpiReturningCard'));

  await vm.runInContext("setLeaveKpiFilter('overdue')", w.sandbox);
  check('kpi cards: Overdue click sets the dropdown, filters to the overdue bucket, moves the ring',
    selVal() === 'overdue' && rowCount(tbody()) === 3 && tbody().includes('Lapsed Child') && tbody().includes('Due Today Child') && onlyRinged('leaveKpiOverdueCard'));

  await vm.runInContext("setLeaveKpiFilter('reactivated')", w.sandbox);
  check('kpi cards: Reactivated click sets the dropdown, filters to the reactivated bucket, moves the ring',
    selVal() === 'reactivated' && rowCount(tbody()) === 1 && tbody().includes('Returned Child') && onlyRinged('leaveKpiReactivatedCard'));

  // Manual dropdown changes move the highlight too (the onchange path).
  w.registry.get('filterLeavesStatus').value = 'all';
  await vm.runInContext('filterLeavesTable()', w.sandbox);
  check('kpi cards: manual dropdown to All Records rings NO card and shows every record',
    rowCount(tbody()) === 7 && CARDS.every(c => !ringed(c)));
  w.registry.get('filterLeavesStatus').value = 'overdue';
  await vm.runInContext('filterLeavesTable()', w.sandbox);
  check('kpi cards: manual dropdown to Overdue rings the Overdue card',
    onlyRinged('leaveKpiOverdueCard') && rowCount(tbody()) === 3);

  // A data refresh re-renders through filterLeavesTable; the
  // dropdown keeps its value and the ring must still agree with it.
  await vm.runInContext('loadLeaveManagementData()', w.sandbox);
  check('kpi cards: after a data refresh the dropdown value, rows and ring still agree (overdue)',
    selVal() === 'overdue' && rowCount(tbody()) === 3 && onlyRinged('leaveKpiOverdueCard'));

  await vm.runInContext("setLeaveKpiFilter('active')", w.sandbox);
  check('kpi cards: Active click returns to the active bucket with the ring back on Active',
    selVal() === 'active' && rowCount(tbody()) === 3 && onlyRinged('leaveKpiActiveCard'));
}
check('kpi cards: index.html wires all four cards to setLeaveKpiFilter with the dropdown values',
  INDEX.includes('id="leaveKpiActiveCard" onclick="setLeaveKpiFilter(\'active\')"') &&
  INDEX.includes('id="leaveKpiReturningCard" onclick="setLeaveKpiFilter(\'returning_soon\')"') &&
  INDEX.includes('id="leaveKpiOverdueCard" onclick="setLeaveKpiFilter(\'overdue\')"') &&
  INDEX.includes('id="leaveKpiReactivatedCard" onclick="setLeaveKpiFilter(\'reactivated\')"'));
check('kpi cards: the handler + sync exist and filterLeavesTable re-syncs the highlight',
  LEAVES.includes('function setLeaveKpiFilter') && LEAVES.includes('function syncLeaveKpiCardsUI') &&
  (() => { try { return extractFunction(LEAVES, 'filterLeavesTable').includes('syncLeaveKpiCardsUI'); } catch (e) { return false; } })());

const failed = results.filter(r => !r.pass);
console.log(`\nleave-screen-fixes: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
