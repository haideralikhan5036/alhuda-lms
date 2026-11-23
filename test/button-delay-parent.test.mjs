// Button-delay build (2026-11-20) — parent portal + login + shared
// transport. Proves, against the REAL parent.html / js files:
//   A. the parent render starts its independent reads in parallel and
//      paints the hero immediately, then each section as its own data
//      lands (no all-or-nothing single shot), with a bounded
//      attendance fetch and a background-only student refresh;
//   B. the book catalog hydrate fetches only the two index keys, once
//      per session, and per-book pages load lazily on demand;
//   C. the parent login fetch has a per-attempt timeout (5s, same cap
//      as the logout calls) with the [700, 1500] retries and the
//      3-attempt cap untouched, and the dashboard load starts during
//      the 1700ms login animation;
//   D. the owner login already starts its dashboard load during the
//      1700ms circle animation (verified, not changed);
//   E. the local-mirror write stringifies only the changed table, and
//      the stored mirror keeps the same key, shape and contents;
//   F. the reader shows a loading state immediately while retries run,
//      with the 700ms retries and the 1200ms error grace unchanged.
// Run from the repo root:  node test/button-delay-parent.test.mjs
// All values below are SYNTHETIC.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PARENT = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
const AUTH = fs.readFileSync(path.join(REPO_ROOT, 'js/auth.js'), 'utf8');
const DBJS = fs.readFileSync(path.join(REPO_ROOT, 'js/cloudflare-db.js'), 'utf8');
const LHJS = fs.readFileSync(path.join(REPO_ROOT, 'js/lesson-history.js'), 'utf8');
const CURR = fs.readFileSync(path.join(REPO_ROOT, 'js/curriculum.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS | ' + name); }
  else { failed++; console.log('FAIL | ' + name + (detail ? ' :: ' + detail : '')); }
}

// Extract one function (or one `let` block + function) from a source
// string by brace matching, starting at the first match of `re`.
function extract(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + re);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  const start = m.index;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated: ' + re);
}

const flush = () => new Promise(r => setTimeout(r, 0));

// ===========================================================================
// A. Static checks on the real parent render
// ===========================================================================
const renderFn = extract(PARENT, /async function renderCurrentStudentData\(/);
check('A1 render starts all five reads before awaiting any paint',
  renderFn.indexOf('const teacherP = fetchParentTeacherRow(s);') !== -1 &&
  renderFn.indexOf('const coverP = fetchParentCoverRows(s);') !== -1 &&
  renderFn.indexOf('const schedulesP = fetchParentSchedules(s);') !== -1 &&
  renderFn.indexOf('const attendanceP = fetchParentAttendance(s);') !== -1 &&
  renderFn.indexOf('const feeP = fetchParentFeeHistory(s);') !== -1 &&
  // every fetch is started before the single join at the end
  ['teacherP', 'coverP', 'schedulesP', 'attendanceP', 'feeP'].every(
    v => renderFn.indexOf('const ' + v + ' =') < renderFn.indexOf('await Promise.all([paintTeacher')));
check('A2 hero paints before the first await (cached row, no refetch gate)',
  renderFn.indexOf("if (nameEl) nameEl.innerText = s.name;") !== -1 &&
  renderFn.indexOf("if (nameEl) nameEl.innerText = s.name;") < renderFn.indexOf('await Promise.all') &&
  renderFn.indexOf('await db.from') === -1);
check('A3 sections paint independently as their data lands',
  renderFn.indexOf('const paintTeacher = teacherP.then') !== -1 &&
  renderFn.indexOf('const paintCover = Promise.all([teacherP, coverP])') !== -1 &&
  renderFn.indexOf('const paintSchedules = Promise.all([teacherP, schedulesP])') !== -1 &&
  renderFn.indexOf('const paintAttendance = Promise.all([teacherP, schedulesP, attendanceP])') !== -1 &&
  renderFn.indexOf('const paintFee = feeP.then') !== -1);
check('A4 attendance fetch is bounded (limit 500, newest first)',
  /fetchParentAttendance[\s\S]*?\.order\('date', \{ ascending: false \}\)[\s\S]*?\.limit\(500\)/.test(PARENT));
check('A5 student row refreshes in the background, never gates paint',
  PARENT.indexOf('function refreshParentStudentRowInBackground(student, seq)') !== -1 &&
  renderFn.indexOf('refreshParentStudentRowInBackground(s, mySeq);') !== -1 &&
  renderFn.indexOf('refreshParentStudentRowInBackground(s, mySeq);') < renderFn.indexOf('const teacherP ='));
check('A6 in-flight guard: background tick waits, user render wins',
  renderFn.indexOf('if (opts.background && _parentRenderInFlight) { _parentLiveSyncPending = true; return; }') !== -1 &&
  renderFn.indexOf('_parentLiveSyncPending') !== -1 &&
  PARENT.indexOf('switchStudentAccount(CURRENT_STUDENT.id, { background: true })') !== -1);
check('A7 immediate feedback: loading placeholders + refresh button state',
  PARENT.indexOf('function showParentSectionLoading()') !== -1 &&
  renderFn.indexOf('showParentSectionLoading();') !== -1 &&
  PARENT.indexOf('function refreshParentStudentData(btn)') !== -1 &&
  PARENT.indexOf("btn.innerHTML = '<i class=\"fa-solid fa-circle-notch fa-spin\"></i> Refreshing...'") !== -1);
check('A8 fee reads run in parallel (family + fee_collections)',
  /const \[famRes, fcRes\] = await Promise\.all\(\[famP, fcP\]\)/.test(PARENT));

// ===========================================================================
// B. Static checks: book catalog hydrate (index keys only, once/session)
// ===========================================================================
const hydrateFn = extract(PARENT, /async function hydrateParentCustomBooksFromD1\(\)/);
check('B1 hydrate fetches only the two index keys, in parallel',
  hydrateFn.indexOf("db.from('system_settings').select('*')") === -1 &&
  hydrateFn.indexOf(".eq('key', 'alhuda_custom_books_index')") !== -1 &&
  hydrateFn.indexOf(".eq('key', 'alhuda_deleted_books')") !== -1 &&
  hydrateFn.indexOf('await Promise.all(') !== -1);
check('B2 hydrate runs once per session and shares one in-flight fetch',
  PARENT.indexOf('let _parentBooksHydrated = false;') !== -1 &&
  PARENT.indexOf('let _parentBooksHydratePromise = null;') !== -1 &&
  hydrateFn.indexOf('if (_parentBooksHydrated) return;') !== -1 &&
  hydrateFn.indexOf('if (_parentBooksHydratePromise) return _parentBooksHydratePromise;') !== -1);
check('B3 no duplicate startup hydration (announcements + books, once each)',
  (PARENT.match(/setTimeout\(hydrateParentCustomBooksFromD1, 500\)/g) || []).length === 0 &&
  (PARENT.match(/setTimeout\(loadParentAnnouncements, 2500\)/g) || []).length === 0 &&
  (PARENT.match(/hydrateParentCustomBooksFromD1\(\);/g) || []).length >= 1);
check('B4 per-book pages load lazily via one LIKE query, holes preserved',
  PARENT.indexOf('async function hydrateParentBookPagesFromD1(bookId)') !== -1 &&
  PARENT.indexOf(".like('key', `BOOK_PAGE_${bookId}_%`)") !== -1 &&
  PARENT.indexOf('const hydratedPages = new Array(total);') !== -1);
check('B5 reader miss path hydrates catalog + that book’s pages',
  PARENT.indexOf('const hydrateForResolve = async () => {') !== -1 &&
  PARENT.indexOf('await hydrateParentBookPagesFromD1(bookId);') !== -1);

// ===========================================================================
// C. Static checks: parent login (timeout, retries, animation overlap)
// ===========================================================================
const loginFn = extract(PARENT, /async function parentServerLogin\(/);
check('C1 parent login fetch has a 5s per-attempt AbortController timeout',
  loginFn.indexOf('new AbortController()') !== -1 &&
  loginFn.indexOf('parentLoginFetchTimeoutMs = 5000') !== -1 &&
  loginFn.indexOf('signal: controller ? controller.signal : undefined') !== -1);
check('C2 parent login keeps [700, 1500] retries and the 3-attempt cap',
  loginFn.indexOf('const parentLoginRetryDelays = [700, 1500];') !== -1 &&
  loginFn.indexOf('for (let attempt = 0; attempt < 3; attempt++)') !== -1);
check('C3 sign-in preloads families + students in parallel',
  /const \[famRes, stuRes\] = await Promise\.all\(\[/.test(PARENT));
check('C4 dashboard load starts during the 1700ms animation, not after',
  PARENT.indexOf('_parentLoginDataPromise = renderCurrentStudentData();') !== -1 &&
  PARENT.indexOf('_parentLoginDataPromise = renderCurrentStudentData();') <
    PARENT.indexOf('showParentDashboardView(famRes.data, authorizedStudents, authorizedStudents[0]') &&
  PARENT.indexOf("typeof _parentLoginDataPromise !== 'undefined' && _parentLoginDataPromise") !== -1 &&
  PARENT.indexOf('}, 1700);') !== -1);
check('C5 boot preloads families + students in parallel',
  PARENT.indexOf('const _famP = db.from') !== -1 &&
  PARENT.indexOf('const _stuP = db.from') !== -1);

// ===========================================================================
// D. Owner login (js/auth.js): load genuinely overlaps the animation
// ===========================================================================
{
  const tIdx = AUTH.indexOf('}, 1700);');
  const loadIdx = AUTH.indexOf('if (typeof ensureCoreLmsDataLoaded === \'function\') {');
  const cbStart = AUTH.indexOf('setTimeout(function () {', AUTH.indexOf('if (circleShown)'));
  const cbEnd = AUTH.indexOf('}, 1700);', cbStart);
  const cbBody = AUTH.slice(cbStart, cbEnd);
  check('D1 owner dashboard load starts during the circle animation',
    tIdx !== -1 && loadIdx !== -1 && loadIdx > tIdx &&
    cbBody.indexOf('showMainAppView()') !== -1 &&
    cbBody.indexOf('ensureCoreLmsDataLoaded') === -1 &&
    cbBody.indexOf('loadDashboardData') === -1);
  check('D2 owner login keeps [700, 1500] retries and 3 attempts',
    AUTH.indexOf('const loginRetryDelays = [700, 1500];') !== -1 &&
    AUTH.indexOf('for (let attempt = 0; attempt < 3 && !reached; attempt++)') !== -1);
}

// ===========================================================================
// E. Static checks: mirror trim + reader feedback
// ===========================================================================
const saveFn = extract(DBJS, /function saveLocalDbStore\(/);
check('E1 mirror save never stringifies the whole store anymore',
  saveFn.indexOf('JSON.stringify(store)') === -1 &&
  saveFn.indexOf('_mirrorTableJson') !== -1);
check('E2 mirror callers name the changed table',
  DBJS.indexOf('saveLocalDbStore(store, [table]);') !== -1 &&
  DBJS.indexOf('saveLocalDbStore(store, [payload.table]);') !== -1);
check('F1 parent reader shows a loading state immediately',
  PARENT.indexOf('id="parentReaderPageLoading"') !== -1 &&
  PARENT.indexOf('function showParentReaderPageLoading()') !== -1 &&
  PARENT.indexOf('showParentReaderPageLoading();') !== -1 &&
  PARENT.indexOf('hideParentReaderPageLoading();') !== -1);
check('F2 reader retry semantics unchanged (2×700ms, 1200ms grace)',
  (PARENT.match(/loadParentReaderPageImage\(img, pageUrl, onFetchError, attempt \+ 1, seq\); \}, 700\)/g) || []).length === 1 &&
  PARENT.indexOf('}, 1200);') !== -1 &&
  (CURR.match(/loadReaderPageImage\(img, pageUrl, onFetchError, attempt \+ 1, seq\); \}, 700\)/g) || []).length === 1 &&
  CURR.indexOf('}, 1200);') !== -1);
check('F3 admin/teacher reader spinner shows before load, hides on load',
  CURR.indexOf('if (spinner) spinner.classList.remove(\'hidden\');') !== -1 &&
  CURR.indexOf('if (spinner) spinner.classList.remove(\'hidden\');') < CURR.indexOf('loadReaderPageImage(img, pageUrl, function (status) {'));
check('F4 bounded image batch helper exported from lesson-history',
  LHJS.indexOf('async function loadLessonImageBlobUrls(keys, cap)') !== -1 &&
  LHJS.indexOf('loadLessonImageBlobUrls: loadLessonImageBlobUrls,') !== -1 &&
  PARENT.indexOf('window.LessonHistory.loadLessonImageBlobUrls(keys, 4)') !== -1);

// ===========================================================================
// Dynamic helpers: fake DOM + fake db builder for the parent functions
// ===========================================================================
class FakeEl {
  constructor(id) {
    this.id = id;
    this._innerText = '';
    this._innerHTML = '';
    this.style = {};
    this.classList = { _s: new Set(), add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); }, contains: function (c) { return this._s.has(c); }, toggle: function (c, f) { if (f) this._s.add(c); else this._s.delete(c); } };
    this.calls = [];
  }
  set innerText(v) { this._innerText = String(v); this.calls.push(['text', String(v)]); }
  get innerText() { return this._innerText; }
  set innerHTML(v) { this._innerHTML = String(v); this.calls.push(['html', String(v)]); }
  get innerHTML() { return this._innerHTML; }
  setAttribute() {}
  removeAttribute() {}
  appendChild() {}
  remove() {}
}
function makeDocument(ids) {
  const els = {};
  ids.forEach(id => { els[id] = new FakeEl(id); });
  return {
    _els: els,
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
    createElement: () => new FakeEl('dyn'),
    addEventListener: () => {},
    hidden: false,
    body: { prepend: () => {} },
    activeElement: null
  };
}
function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m
  };
}
// Thenable query builder recording every call; each table resolves from
// a deferred the test controls.
class FakeBuilder {
  constructor(db, table) { this._db = db; this.table = table; this.filters = []; this.orders = []; this.limitCount = null; this.isSingle = false; }
  select() { return this; }
  eq(c, v) { this.filters.push(['eq', c, v]); return this; }
  like(c, v) { this.filters.push(['like', c, v]); return this; }
  order(c, o) { this.orders.push([c, o]); return this; }
  limit(n) { this.limitCount = n; return this; }
  single() { this.isSingle = true; return this; }
  then(onF, onR) {
    this._db.calls.push({ table: this.table, filters: this.filters.slice(), orders: this.orders.slice(), limit: this.limitCount, single: this.isSingle });
    const d = this._db.deferredFor(this.table, this.filters);
    return d.promise.then(onF, onR);
  }
}
class FakeDb {
  constructor() { this.calls = []; this._defs = new Map(); }
  deferredFor(table, filters) {
    const key = table + '|' + JSON.stringify(filters);
    if (!this._defs.has(key)) {
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      this._defs.set(key, { promise, resolve, resolved: false });
    }
    return this._defs.get(key);
  }
  resolve(table, data, filters = []) {
    const d = this.deferredFor(table, filters);
    d.resolved = true;
    d.resolve({ data, error: null });
  }
  resolveAll(table, data) {
    for (const [k, d] of this._defs) {
      if (k.startsWith(table + '|') && !d.resolved) { d.resolved = true; d.resolve({ data, error: null }); }
    }
  }
  from(table) { return new FakeBuilder(this, table); }
}

// ===========================================================================
// G. Dynamic: parent render — parallel, progressive, bounded, guarded
// ===========================================================================
{
  // The contiguous render block: guards + helpers + renderCurrentStudentData.
  const start = PARENT.indexOf('let _parentRenderSeq = 0;');
  const renderSrc = extract(PARENT.slice(start), /async function renderCurrentStudentData\(/);
  const block = PARENT.slice(start, start + PARENT.slice(start).indexOf(renderSrc) + renderSrc.length);

  const docIds = ['heroWelcomeName', 'studentCourseBadge', 'parentLessonNotesContainer',
    'attendanceTableBody', 'feeInvoicesTableBody', 'liveClassSubject', 'liveClassTeacher',
    'liveClassTime', 'btnJoinLiveMeeting', 'teacherCoverBanner', 'parentAttRate',
    'parentAttCount', 'parentFeeStat', 'parentFeeMonth', 'weeklyScheduleGrid'];
  const documentStub = makeDocument(docIds);
  const localStorageStub = makeStorage({ alhuda_fee_records: '[]' });
  const db = new FakeDb();
  const paints = { lessons: 0, attendance: 0, timetable: 0, fees: 0 };
  let syncCalls = 0;
  const sandbox = {
    console, setTimeout: (fn) => 0, clearTimeout: () => {},
    document: documentStub, localStorage: localStorageStub,
    db, window: {},
    CURRENT_AUTH_FAMILY: { id: 'FAM-1', parent_name: 'Test Parent', notes: null },
    ALL_STUDENTS: [{ id: 'STU-1', family_id: 'FAM-1', name: 'Test Student', course: 'Qaida', assigned_teacher_id: 'TCH-1', notes: null }],
    CURRENT_STUDENT: null, CURRENT_TEACHER: null, CURRENT_SCHEDULES: [],
    CURRENT_ATTENDANCE: [], CURRENT_FEE_HISTORY: [], PARENT_SCHEDULE_MAP: {},
    PARENT_LESSON_DATE: '',
    escapeHtml: (s) => String(s == null ? '' : s),
    parentIsAttendedStatus: (st) => st === 'Completed' || st === 'Present',
    renderRecentSabaqLogs: () => { paints.lessons++; },
    renderWeeklyTimetable: () => { paints.timetable++; },
    renderAttendanceTable: () => { paints.attendance++; },
    renderFeeInvoicesTable: () => { paints.fees++; },
    hydrateParentLessonImages: () => {},
    scheduleParentPortalLiveSync: () => { syncCalls++; },
  };
  sandbox.CURRENT_STUDENT = sandbox.ALL_STUDENTS[0];
  sandbox.window.LessonHistory = { dedupeLessonRows: (rows) => rows.map(r => ({ raw: r })) };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.__render = renderCurrentStudentData;', sandbox);

  const render = sandbox.__render;
  const attLogs = [
    { id: 'A1', student_id: 'STU-1', date: '2026-11-19', status: 'Completed', lesson_notes: null },
    { id: 'A2', student_id: 'STU-1', date: '2026-11-18', status: 'Completed', lesson_notes: null }
  ];

  // G1: hero paints synchronously; all reads start before any resolves.
  const p1 = render();
  check('G1 hero paints immediately from the cached row',
    documentStub._els.heroWelcomeName.innerText === 'Test Student' &&
    documentStub._els.studentCourseBadge.innerText === 'Qaida');
  // The query builder is a thenable: awaiting it defers its .then call
  // to a microtask, so the reads start one flush after render() — still
  // before any of them resolves.
  await flush();
  const started = db.calls.map(c => c.table);
  check('G2 all independent reads start in parallel, before any resolve',
    ['teachers', 'cover_assignments', 'class_schedules', 'attendance_logs', 'families', 'fee_collections', 'students'].every(t => started.includes(t)) &&
    db.calls.filter(c => c.table === 'students').length === 1,
    'started: ' + started.join(','));
  check('G3 attendance fetch carries the bound (limit 500)',
    db.calls.some(c => c.table === 'attendance_logs' && c.limit === 500));
  // G4: background tick while the render is in flight is remembered, not run.
  const callsBefore = db.calls.length;
  const pBg = render({ background: true });
  check('G4 background tick mid-render runs no new fetches',
    db.calls.length === callsBefore);
  // G5: progressive — attendance paints while the fee read is still pending.
  db.resolveAll('teachers', { id: 'TCH-1', full_name: 'Teacher One', zoom_link: '' });
  db.resolveAll('cover_assignments', []);
  db.resolveAll('class_schedules', [{ id: 'SCH-1', student_id: 'STU-1', day_of_week: 1, start_time: '10:00', end_time: '10:30' }]);
  db.resolveAll('attendance_logs', attLogs);
  await flush(); await flush(); await flush();
  check('G5 lesson + attendance sections paint before the fee read lands',
    paints.lessons === 1 && paints.attendance === 1 && paints.fees === 0 &&
    documentStub._els.parentAttRate.innerText === '100%');
  check('G6 fee section paints only after its own read lands',
    paints.fees === 0);
  db.resolveAll('families', { id: 'FAM-1', parent_name: 'Test Parent', notes: null });
  db.resolveAll('fee_collections', []);
  await flush(); await flush(); await flush();
  check('G7 fee section paints after the fee read lands',
    paints.fees === 1 && documentStub._els.parentFeeMonth.innerText === 'No data available yet.');
  // G8: the render resolves even though the background student refresh never answered.
  let renderDone = false;
  p1.then(() => { renderDone = true; });
  await flush(); await flush();
  check('G8 render completes without waiting for the background student refresh',
    renderDone === true);
  await p1; await pBg;
  check('G9 remembered background tick re-runs once after the render',
    syncCalls === 1);
}

// ===========================================================================
// H. Dynamic: catalog hydrate — index keys only, once per session
// ===========================================================================
{
  const hStart = PARENT.indexOf('let _parentBooksHydrated = false;');
  const hFn = extract(PARENT.slice(hStart), /async function hydrateParentCustomBooksFromD1\(\)/);
  const pagesFn = extract(PARENT.slice(hStart), /async function hydrateParentBookPagesFromD1\(/);
  const block = PARENT.slice(hStart, hStart + PARENT.slice(hStart).indexOf(pagesFn) + pagesFn.length);
  const hydrateBlock = block.slice(0, block.indexOf(pagesFn)) + pagesFn;

  const db = new FakeDb();
  const localStorageStub = makeStorage({
    alhuda_custom_books: JSON.stringify([{ id: 'B1', title: 'Book One', total_pages: 3, pages: [] }]),
    alhuda_deleted_books: '[]'
  });
  let libraryRenders = 0;
  const sandbox = {
    console, setTimeout, clearTimeout,
    db, localStorage: localStorageStub,
    renderPortalLibrary: () => { libraryRenders++; }
  };
  vm.createContext(sandbox);
  vm.runInContext(hydrateBlock + '\nthis.__hydrate = hydrateParentCustomBooksFromD1;\nthis.__pages = hydrateParentBookPagesFromD1;', sandbox);

  const indexVal = JSON.stringify([{ id: 'B1', title: 'Book One', total_pages: 3, pages: [] }]);
  // Resolve the two index-key queries (eq filters distinguish them).
  const hydrateP = sandbox.__hydrate();
  await flush(); await flush();
  db.resolve('system_settings', [{ value: indexVal }], [['eq', 'key', 'alhuda_custom_books_index']]);
  db.resolve('system_settings', [{ value: '[]' }], [['eq', 'key', 'alhuda_deleted_books']]);
  await hydrateP;
  check('H1 hydrate fetches only the two index keys (no whole-table read)',
    db.calls.length === 2 &&
    db.calls.every(c => c.table === 'system_settings' && c.filters.some(f => f[0] === 'eq' && f[1] === 'key')) &&
    !db.calls.some(c => c.filters.length === 0),
    'calls: ' + JSON.stringify(db.calls));
  check('H2 hydrate stores the catalog and renders the library',
    JSON.parse(localStorageStub.getItem('alhuda_custom_books')).length === 1 && libraryRenders === 1);
  const callsAfterFirst = db.calls.length;
  await sandbox.__hydrate();
  check('H3 second hydrate in the same session fetches nothing',
    db.calls.length === callsAfterFirst);
  // Per-book pages: one LIKE query, merged by index, holes preserved.
  const pagesP = sandbox.__pages('B1');
  await flush(); await flush();
  db.resolve('system_settings', [
    { key: 'BOOK_PAGE_B1_0', value: 'url-0' },
    { key: 'BOOK_PAGE_B1_2', value: 'url-2' }
  ], [['like', 'key', 'BOOK_PAGE_B1_%']]);
  const pagesOk = await pagesP;
  const stored = JSON.parse(localStorageStub.getItem('alhuda_custom_books'))[0];
  check('H4 per-book pages load via one LIKE query and keep page indices',
    pagesOk === true && stored.pages[0] === 'url-0' && stored.pages[2] === 'url-2' &&
    (stored.pages[1] === null || stored.pages[1] === undefined) &&
    db.calls.some(c => c.filters.some(f => f[0] === 'like' && f[1] === 'key' && f[2] === 'BOOK_PAGE_B1_%')));
  const callsAfterPages = db.calls.length;
  await sandbox.__pages('B1');
  check('H5 already-hydrated book fetches nothing again',
    db.calls.length === callsAfterPages);
}

// ===========================================================================
// I. Dynamic: parent login timeout (manual timer control, no 15s wait)
// ===========================================================================
{
  const loginSrc = extract(PARENT, /async function parentServerLogin\(/) +
    '\n' + extract(PARENT, /function getParentWorkerBase\(\)/);
  const timers = [];
  let fetchCalls = 0;
  let aborts = 0;
  const sandbox = {
    console,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    AbortController,
    fetch: async (url, opts) => {
      fetchCalls++;
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          aborts++;
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(loginSrc + '\nthis.__login = parentServerLogin;', sandbox);
  const loginP = sandbox.__login('parent1', 'secret');
  // Drive the timers by hand: abort(5s) -> backoff(700) -> abort -> backoff(1500) -> abort.
  const runTimer = (ms) => {
    const t = timers.find(x => x.ms === ms && !x.cancelled && !x.ran);
    if (!t) throw new Error('no timer for ' + ms + 'ms; have: ' + JSON.stringify(timers.map(x => x.ms)));
    t.ran = true;
    t.fn();
  };
  let loginResult;
  loginP.then(r => { loginResult = r; });
  runTimer(5000); await flush();
  runTimer(700); await flush();
  runTimer(5000); await flush();
  runTimer(1500); await flush();
  runTimer(5000); await flush(); await flush();
  check('I1 hung login attempts abort at 5s and retry (3 attempts total)',
    fetchCalls === 3 && aborts === 3, 'fetchCalls=' + fetchCalls + ' aborts=' + aborts);
  check('I2 login keeps the [700, 1500] backoff between attempts',
    JSON.stringify(timers.map(t => t.ms)) === JSON.stringify([5000, 700, 5000, 1500, 5000]),
    'timers: ' + JSON.stringify(timers.map(t => t.ms)));
  check('I3 login gives up as unreachable after the 3rd attempt',
    loginResult && loginResult.unreachable === true);
}

// ===========================================================================
// J. Dynamic: mirror trim — only the changed table is re-stringified
// ===========================================================================
{
  const realJSON = JSON;
  const stringifyLog = [];
  const countingJSON = {
    parse: (s) => realJSON.parse(s),
    stringify: (v, ...rest) => {
      stringifyLog.push(v);
      return realJSON.stringify(v, ...rest);
    }
  };
  const ls = makeStorage({ alhuda_d1_initial_sync_done_v1: 'true' });
  const families = Array.from({ length: 50 }, (_, i) => ({
    id: 'FAM-' + i, parent_name: 'Family ' + i, notes: 'x'.repeat(200)
  }));
  const students = [
    { id: 'STU-1', family_id: 'FAM-0', name: 'Student One' },
    { id: 'STU-2', family_id: 'FAM-1', name: 'Student Two' }
  ];
  const D1 = { families, students };
  const fetchCalls = [];
  const sandbox = {
    console, JSON: countingJSON,
    setTimeout, clearTimeout, AbortController,
    localStorage: ls, sessionStorage: makeStorage(),
    document: {
      hidden: false, addEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({ setAttribute: () => {}, style: {}, remove: () => {} }),
      body: { prepend: () => {} }
    },
    window: null,
    CustomEvent: class { constructor(t) { this.type = t; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    fetch: async (url, opts) => {
      fetchCalls.push(url);
      const method = (opts && opts.method) || 'GET';
      if (method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, d1_bound: true }) };
      const body = realJSON.parse(opts.body || '{}');
      const rows = (body.action === 'select' && body.select === 'id') ? [] : (D1[body.table] || []);
      return { ok: true, status: 200, json: async () => ({ data: rows }) };
    }
  };
  sandbox.window = {
    addEventListener: () => {}, dispatchEvent: () => {},
    location: { hostname: 'localhost', pathname: '/parent.html' },
    CustomEvent: sandbox.CustomEvent
  };
  vm.createContext(sandbox);
  vm.runInContext(DBJS, sandbox);
  const db = sandbox.window.db;

  const isWholeStore = (v) => v && typeof v === 'object' && !Array.isArray(v) &&
    Object.prototype.hasOwnProperty.call(v, 'families') &&
    Object.prototype.hasOwnProperty.call(v, 'students');
  const arrayBytes = (log) => log.filter(v => Array.isArray(v))
    .reduce((n, v) => n + realJSON.stringify(v).length, 0);
  const fullStoreBytes = realJSON.stringify({ families, students }).length;

  stringifyLog.length = 0;
  const famRes = await db.from('families').select('*');
  check('J1 live families select mirrors all 50 rows',
    Array.isArray(famRes.data) && famRes.data.length === 50);
  const mirror1 = realJSON.parse(ls.getItem('alhuda_cloudflare_local_db_v1'));
  check('J2 mirror keeps the same key, shape and contents after save',
    Array.isArray(mirror1.families) && mirror1.families.length === 50 &&
    Array.isArray(mirror1.students) && mirror1.students.length === 0 &&
    mirror1.families[0].parent_name === 'Family 0');
  check('J3 first save never stringifies the whole store',
    stringifyLog.filter(isWholeStore).length === 0);
  stringifyLog.length = 0;
  const stuRes = await db.from('students').select('*');
  check('J4 live students select returns both rows',
    Array.isArray(stuRes.data) && stuRes.data.length === 2);
  check('J5 second save still never stringifies the whole store',
    stringifyLog.filter(isWholeStore).length === 0);
  check('J6 second save stringifies only the small changed table',
    arrayBytes(stringifyLog) < fullStoreBytes * 0.2,
    'array bytes=' + arrayBytes(stringifyLog) + ' full=' + fullStoreBytes);
  const mirror2 = realJSON.parse(ls.getItem('alhuda_cloudflare_local_db_v1'));
  check('J7 mirror still holds families + students after the second save',
    mirror2.families.length === 50 && mirror2.students.length === 2 &&
    mirror2.students[0].name === 'Student One');
  // A local (offline-path) write names its table too: mirror stays whole.
  const before = ls.getItem('alhuda_cloudflare_local_db_v1');
  check('J8 mirror JSON is a plain object with the 12 tables in order',
    Object.keys(mirror2).join(',') ===
    'families,students,teachers,class_schedules,attendance_logs,payments,salary_slips,salary_adjustments,advance_requests,leave_requests,trial_students,system_settings' &&
    before === ls.getItem('alhuda_cloudflare_local_db_v1'));
}

// ===========================================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
