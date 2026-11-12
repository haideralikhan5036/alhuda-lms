// Portal refresh restore (owner 2026-11-07): "kisi bhi page pe agar
// refresh kia jy to same page open ho, over all portals... ab
// dashboard open hota ha". Each portal mirrors its active TOP-LEVEL
// tab into the URL hash with history.replaceState (never pushState —
// Back behaviour is unchanged) and reopens the hashed tab at the end
// of its normal sign-in/session-restore funnel.
//
// This suite EXECUTES the real switch + restore code of all three
// portals in vm worlds over fake DOMs with a recording fake history:
//   teacher.html  — syncTeacherSidebarActiveState + hash helpers +
//                   switchTeacherPortalTab (one contiguous real chunk;
//                   since Salary Restructuring Phase 1 the chunk ends
//                   at toggleTeacherSalaryGroup — the PR #119 opener
//                   that used to bound it no longer exists — and the
//                   teacher tab set has SEVEN tabs: the dedicated
//                   'advance' page joined 'salaries')
//   parent.html   — hash helpers + switchPortalTab (contiguous chunk)
//   js/navigation.js — the whole real file (admin switchTab engine)
// Boot cases per portal: valid hash restores through the REAL switch
// path (per-tab loaders fire), invalid hash and no hash leave the
// default view untouched, and a switch records the hash via
// replaceState only. MANAGER coverage (owner addition 2026-11-07):
// the manager portal is this same index.html under a manager
// session — manager tab switches record and manager boots restore
// identically, and an owner-only hash under a manager session falls
// back to the default with NO Access Denied notice and the gated
// section never unhidden (proven twice: with the real tab set, where
// 'tab-owner-managers' is not even a section in index.html, and with
// a synthetic DOM where it exists, which exercises the explicit
// CURRENT_ROLE guard in restoreAdminTabFromHash). Structural checks
// pin the boot call sites
// (showDashboardView / showParentDashboardView / runAdminBoot +
// owner sign-in) and that the pre-existing query-strip blocks are
// untouched.
// Run from the repo root:  node test/portal-refresh-restore.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
const PARENT = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
const NAV = fs.readFileSync(path.join(REPO_ROOT, 'js/navigation.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(REPO_ROOT, 'js/auth.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS | ' + name); }
  else { failed++; console.log('FAIL | ' + name + (detail ? ' :: ' + detail : '')); }
}

// ---------------------------------------------------------------------
// Fake DOM / browser plumbing
// ---------------------------------------------------------------------
function fakeEl(id, classes = [], attrs = {}) {
  const set = new Set(classes);
  return {
    id, style: {}, _attrs: attrs,
    classList: {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      contains: c => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); return set.has(c); }
        force ? set.add(c) : set.delete(c); return !!force;
      },
    },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; },
    setAttribute() {},
    scrollIntoView() {}, focus() {},
    _set: set,
  };
}
function fakeBrowser(pathname, initialHash = '') {
  const loc = { pathname, search: '', hash: initialHash };
  const calls = { replace: [], push: [] };
  const history = {
    state: null,
    replaceState(state, title, url) {
      calls.replace.push(String(url));
      history.state = state;
      const i = String(url).indexOf('#');
      loc.hash = i >= 0 ? String(url).slice(i) : '';
    },
    pushState(state, title, url) {
      calls.push.push(String(url));
      history.state = state;
      const i = String(url).indexOf('#');
      loc.hash = i >= 0 ? String(url).slice(i) : '';
    },
  };
  return { loc, history, calls };
}

// ---------------------------------------------------------------------
// TEACHER PORTAL
// ---------------------------------------------------------------------
const T_START = TEACHER.indexOf('function syncTeacherSidebarActiveState');
// Phase 1 (reason): the chunk used to end at openTeacherAdvanceSalaryRequest;
// that function was removed when the advance form became a dedicated
// page, so the chunk now ends at its successor in the same spot,
// toggleTeacherSalaryGroup (the switch function sits between them).
const T_END = TEACHER.indexOf('function toggleTeacherSalaryGroup');
const TEACHER_CHUNK = TEACHER.slice(T_START, T_END);
check('teacher: real chunk extracted (sync + helpers + switch)',
  T_START > -1 && T_END > T_START && TEACHER_CHUNK.includes('function switchTeacherPortalTab')
  && TEACHER_CHUNK.includes('function restoreTeacherTabFromHash'));

// Phase 1 (reason): the dedicated advance page is a seventh section
// in the show/hide world — hidden at boot like the other non-default
// sections.
const T_SECTIONS = ['sectionTeacherKpiGrid', 'sectionTeacherToday', 'sectionTeacherStudentList',
  'sectionTeacherLessonHistory', 'sectionTeacherTrials', 'sectionTeacherSalaries', 'sectionTeacherAdvanceRequest'];
function makeTeacherWorld(hash = '') {
  const els = {};
  for (const id of T_SECTIONS) els[id] = fakeEl(id, id === 'sectionTeacherLessonHistory' || id === 'sectionTeacherStudentList' || id === 'sectionTeacherTrials' || id === 'sectionTeacherSalaries' || id === 'sectionTeacherAdvanceRequest' ? ['hidden'] : []);
  for (const id of ['sbNavDashboard', 'sbNavToday', 'sbNavStudents', 'sbNavHistory', 'sbNavTrials', 'sbNavSalaries', 'sbNavAdvanceSalary']) els[id] = fakeEl(id);
  const railBtns = ['dashboard', 'today', 'students', 'history', 'trials', 'salaries'].map(t => fakeEl('rail-' + t, [], { 'data-rail-tab': t }));
  const browser = fakeBrowser('/teacher', hash);
  const loaderCalls = [];
  const document = {
    title: 'Teacher Portal',
    getElementById: id => els[id] || null,
    querySelectorAll: sel => (sel === '#teacherMobileRail [data-rail-tab]' ? railBtns : []),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, document,
    renderTeacherStudentListTable: () => loaderCalls.push('students'),
    renderTeacherLessonHistory: () => loaderCalls.push('history'),
    loadTeacherTrialsData: () => loaderCalls.push('trials'),
    loadTeacherPreviousSalaries: () => loaderCalls.push('salaries'),
  };
  sandbox.window = { document, history: browser.history, location: browser.loc, innerWidth: 1280, addEventListener() {} };
  vm.createContext(sandbox);
  vm.runInContext("let CURRENT_TEACHER_TAB = 'dashboard';\n" + TEACHER_CHUNK, sandbox);
  return { sandbox, els, browser, loaderCalls };
}
const tVisible = w => T_SECTIONS.filter(id => !w.els[id].classList.contains('hidden'));

{ // switch records the hash via replaceState only, state preserved
  const w = makeTeacherWorld('');
  w.browser.history.state = { keep: 1 };
  vm.runInContext("switchTeacherPortalTab('salaries')", w.sandbox);
  check('teacher: switch to salaries shows only the salaries section',
    JSON.stringify(tVisible(w)) === JSON.stringify(['sectionTeacherSalaries']), JSON.stringify(tVisible(w)));
  check('teacher: switch records #salaries via replaceState',
    w.browser.calls.replace.length === 1 && w.browser.calls.replace[0] === '/teacher#salaries'
    && w.browser.loc.hash === '#salaries', JSON.stringify(w.browser.calls));
  check('teacher: switch never pushes a history entry', w.browser.calls.push.length === 0);
  check('teacher: replaceState preserves the existing history.state',
    w.browser.history.state && w.browser.history.state.keep === 1);
  check('teacher: real salaries loader fired on switch', w.loaderCalls.includes('salaries'));
}
{ // boot restore: valid hash
  const w = makeTeacherWorld('#history');
  vm.runInContext('restoreTeacherTabFromHash()', w.sandbox);
  check('teacher: boot with #history reopens Lesson History',
    JSON.stringify(tVisible(w)) === JSON.stringify(['sectionTeacherLessonHistory']), JSON.stringify(tVisible(w)));
  check('teacher: restore runs the real history renderer', w.loaderCalls.includes('history'));
}
{ // boot restore: invalid + absent hash leave the default untouched
  const wBad = makeTeacherWorld('#bogus-tab');
  vm.runInContext('restoreTeacherTabFromHash()', wBad.sandbox);
  check('teacher: boot with an invalid hash keeps the default view',
    JSON.stringify(tVisible(wBad)) === JSON.stringify(['sectionTeacherKpiGrid', 'sectionTeacherToday'])
    && wBad.loaderCalls.length === 0, JSON.stringify(tVisible(wBad)));
  const wNone = makeTeacherWorld('');
  vm.runInContext('restoreTeacherTabFromHash()', wNone.sandbox);
  check('teacher: boot with no hash keeps the default view',
    JSON.stringify(tVisible(wNone)) === JSON.stringify(['sectionTeacherKpiGrid', 'sectionTeacherToday'])
    && wNone.loaderCalls.length === 0);
  const wDash = makeTeacherWorld('#dashboard');
  vm.runInContext('restoreTeacherTabFromHash()', wDash.sandbox);
  check('teacher: boot with #dashboard is a no-op (default already shown)',
    JSON.stringify(tVisible(wDash)) === JSON.stringify(['sectionTeacherKpiGrid', 'sectionTeacherToday'])
    && wDash.loaderCalls.length === 0);
}
{ // Phase 1: the dedicated advance page records + restores #advance
  const w = makeTeacherWorld('');
  vm.runInContext("switchTeacherPortalTab('advance')", w.sandbox);
  check('teacher: switch to advance shows only the advance section',
    JSON.stringify(tVisible(w)) === JSON.stringify(['sectionTeacherAdvanceRequest']), JSON.stringify(tVisible(w)));
  check('teacher: switch records #advance via replaceState, never pushState',
    w.browser.calls.replace.length === 1 && w.browser.calls.replace[0] === '/teacher#advance'
    && w.browser.calls.push.length === 0 && w.browser.loc.hash === '#advance',
    JSON.stringify(w.browser.calls));
  check('teacher: advance switch fires the shared salaries loader (form feed)',
    w.loaderCalls.includes('salaries'));
  const wBoot = makeTeacherWorld('#advance');
  vm.runInContext('restoreTeacherTabFromHash()', wBoot.sandbox);
  check('teacher: boot with #advance reopens the Request Advance Salary page',
    JSON.stringify(tVisible(wBoot)) === JSON.stringify(['sectionTeacherAdvanceRequest']),
    JSON.stringify(tVisible(wBoot)));
}

// ---------------------------------------------------------------------
// PARENT PORTAL
// ---------------------------------------------------------------------
const P_START = PARENT.indexOf('const PARENT_PORTAL_TABS');
const P_END = PARENT.indexOf('function filterPortalCategory');
const PARENT_CHUNK = PARENT.slice(P_START, P_END);
check('parent: real chunk extracted (helpers + switchPortalTab)',
  P_START > -1 && P_END > P_START && PARENT_CHUNK.includes('function switchPortalTab')
  && PARENT_CHUNK.includes('function restoreParentTabFromHash'));

const P_TABS = ['tab-dashboard', 'tab-library', 'tab-timetable', 'tab-attendance', 'tab-fees'];
function makeParentWorld(hash = '') {
  const sections = P_TABS.map(id => fakeEl(id, id === 'tab-dashboard' ? ['portal-tab-content'] : ['portal-tab-content', 'hidden']));
  const navBtns = P_TABS.map(id => fakeEl('navBtn_' + id.replace('tab-', ''), ['portal-nav-btn']));
  const byId = {};
  sections.forEach(s => { byId[s.id] = s; });
  navBtns.forEach(b => { byId[b.id] = b; });
  const browser = fakeBrowser('/parent', hash);
  const document = {
    title: 'Parent Portal',
    getElementById: id => byId[id] || null,
    querySelectorAll: sel => (sel === '.portal-tab-content' ? sections : sel === '.portal-nav-btn' ? navBtns : []),
  };
  const sandbox = { console, setTimeout, clearTimeout, document, renderPortalLibrary: () => {} };
  sandbox.window = { document, history: browser.history, location: browser.loc, innerWidth: 1280, addEventListener() {} };
  vm.createContext(sandbox);
  vm.runInContext(PARENT_CHUNK, sandbox);
  return { sandbox, sections, navBtns, browser };
}
const pVisible = w => w.sections.filter(s => !s.classList.contains('hidden')).map(s => s.id);

{ // switch records the hash via replaceState only
  const w = makeParentWorld('');
  vm.runInContext("switchPortalTab('tab-fees')", w.sandbox);
  check('parent: switch to fees shows only the fees section',
    JSON.stringify(pVisible(w)) === JSON.stringify(['tab-fees']), JSON.stringify(pVisible(w)));
  check('parent: switch records #tab-fees via replaceState, never pushState',
    w.browser.calls.replace.length === 1 && w.browser.calls.replace[0] === '/parent#tab-fees'
    && w.browser.calls.push.length === 0 && w.browser.loc.hash === '#tab-fees',
    JSON.stringify(w.browser.calls));
  check('parent: fees nav button becomes active',
    w.navBtns.find(b => b.id === 'navBtn_fees').classList.contains('active'));
}
{ // boot restore cases
  const w = makeParentWorld('#tab-attendance');
  vm.runInContext('restoreParentTabFromHash()', w.sandbox);
  check('parent: boot with #tab-attendance reopens Attendance',
    JSON.stringify(pVisible(w)) === JSON.stringify(['tab-attendance']), JSON.stringify(pVisible(w)));
  const wBad = makeParentWorld('#tab-nope');
  vm.runInContext('restoreParentTabFromHash()', wBad.sandbox);
  check('parent: boot with an invalid hash keeps the dashboard',
    JSON.stringify(pVisible(wBad)) === JSON.stringify(['tab-dashboard']));
  const wNone = makeParentWorld('');
  vm.runInContext('restoreParentTabFromHash()', wNone.sandbox);
  check('parent: boot with no hash keeps the dashboard',
    JSON.stringify(pVisible(wNone)) === JSON.stringify(['tab-dashboard']));
}

// ---------------------------------------------------------------------
// ADMIN PORTAL (js/navigation.js, whole real file)
// ---------------------------------------------------------------------
const A_TABS = ['tab-dashboard', 'tab-families', 'tab-teachers', 'tab-trials', 'tab-attendance',
  'tab-salaries', 'tab-leaves', 'tab-invoices', 'tab-curriculum', 'tab-schedule-search',
  'tab-reports', 'tab-activity', 'tab-settings', 'tab-settings-academy'];
function makeAdminWorld({ hash = '', role = 'owner', withOwnerManagers = false } = {}) {
  const tabIds = withOwnerManagers ? [...A_TABS, 'tab-owner-managers'] : [...A_TABS];
  const sections = tabIds.map(id => fakeEl(id, id === 'tab-dashboard' ? ['tab-content'] : ['tab-content', 'hidden']));
  const prof = fakeEl('tab-profile-360', ['tab-content', 'hidden']);
  const allSections = [...sections, prof];
  const buttons = tabIds.map(id => fakeEl('btn-' + id, ['sidebar-nav-btn'], { 'data-tab': id }));
  const byId = {};
  allSections.forEach(s => { byId[s.id] = s; });
  const browser = fakeBrowser('/', hash);
  const notifyCalls = [];
  const loaderCalls = [];
  const document = {
    title: 'Admin Portal',
    getElementById: id => byId[id] || null,
    querySelectorAll: sel => {
      if (sel === '.sidebar-nav-btn' || sel === '.sidebar-nav-btn[data-tab]') return buttons;
      if (sel === '.tab-content') return allSections;
      return [];
    },
    querySelector: sel => {
      const m = /data-tab="([^"]+)"/.exec(sel || '');
      return m ? buttons.find(b => b.getAttribute('data-tab') === m[1]) || null : null;
    },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, document,
    CURRENT_ROLE: role,
    DASH_STUDENT_CHART: null, DASH_REVENUE_CHART: null,
    lmsNotify: msg => notifyCalls.push(msg),
  };
  for (const fn of ['loadDashboardData', 'loadAttendanceList', 'loadFamiliesAndStudents', 'loadTeachers',
    'calculateMonthlySalaries', 'loadFeeBillingLedger', 'loadTrialClassesData', 'loadLeaveManagementData',
    'loadCurriculumLibrary', 'initScheduleSearch']) {
    sandbox[fn] = () => loaderCalls.push(fn);
  }
  sandbox.window = { document, history: browser.history, location: browser.loc, innerWidth: 1280, addEventListener() {} };
  vm.createContext(sandbox);
  vm.runInContext(NAV, sandbox);
  return { sandbox, sections, prof, browser, notifyCalls, loaderCalls };
}
const aVisible = w => [...w.sections, w.prof].filter(s => !s.classList.contains('hidden')).map(s => s.id);

{ // switch: recordNavigation pushes (existing engine), then hash lands via replaceState
  const w = makeAdminWorld();
  vm.runInContext("switchTab('tab-families')", w.sandbox);
  check('admin: switch to families shows only families',
    JSON.stringify(aVisible(w)) === JSON.stringify(['tab-families']), JSON.stringify(aVisible(w)));
  check('admin: existing nav engine still pushes its state entry (Back unchanged)',
    w.browser.calls.push.length === 1 && w.browser.calls.push[0] === '/', JSON.stringify(w.browser.calls.push));
  check('admin: hash recorded AFTER the push via replaceState (final URL carries the tab)',
    w.browser.calls.replace.length === 1 && w.browser.calls.replace[0] === '/#tab-families'
    && w.browser.loc.hash === '#tab-families', JSON.stringify(w.browser.calls));
  check('admin: families loader fired through the real switchTab', w.loaderCalls.includes('loadFamiliesAndStudents'));
}
{ // 360 profile never touches the hash
  const w = makeAdminWorld();
  vm.runInContext("switchTab('tab-families')", w.sandbox);
  vm.runInContext("switchTab('tab-profile-360')", w.sandbox);
  check('admin: opening a 360 profile leaves the hash on the last real tab',
    w.browser.loc.hash === '#tab-families' && aVisible(w).includes('tab-profile-360'),
    w.browser.loc.hash + ' / ' + JSON.stringify(aVisible(w)));
}
{ // boot restore cases
  const w = makeAdminWorld({ hash: '#tab-salaries' });
  vm.runInContext('restoreAdminTabFromHash()', w.sandbox);
  check('admin: boot with #tab-salaries reopens Salaries',
    JSON.stringify(aVisible(w)) === JSON.stringify(['tab-salaries']), JSON.stringify(aVisible(w)));
  check('admin: restore runs the real salary compile', w.loaderCalls.includes('calculateMonthlySalaries'));
  const wBad = makeAdminWorld({ hash: '#tab-nope' });
  vm.runInContext('restoreAdminTabFromHash()', wBad.sandbox);
  check('admin: boot with an invalid hash keeps the dashboard',
    JSON.stringify(aVisible(wBad)) === JSON.stringify(['tab-dashboard']) && wBad.notifyCalls.length === 0);
  const wNone = makeAdminWorld();
  vm.runInContext('restoreAdminTabFromHash()', wNone.sandbox);
  check('admin: boot with no hash keeps the dashboard',
    JSON.stringify(aVisible(wNone)) === JSON.stringify(['tab-dashboard']));
}
{ // owner-only tab: manager restore is silent, owner restore works
  const wMgr = makeAdminWorld({ hash: '#tab-owner-managers', role: 'manager', withOwnerManagers: true });
  vm.runInContext('restoreAdminTabFromHash()', wMgr.sandbox);
  check('admin: manager booting with an owner-only hash stays on dashboard, no Access Denied notice',
    JSON.stringify(aVisible(wMgr)) === JSON.stringify(['tab-dashboard']) && wMgr.notifyCalls.length === 0,
    JSON.stringify(aVisible(wMgr)) + ' / ' + JSON.stringify(wMgr.notifyCalls));
  const wOwn = makeAdminWorld({ hash: '#tab-owner-managers', role: 'owner', withOwnerManagers: true });
  vm.runInContext('restoreAdminTabFromHash()', wOwn.sandbox);
  check('admin: owner booting with #tab-owner-managers reopens it',
    JSON.stringify(aVisible(wOwn)) === JSON.stringify(['tab-owner-managers']), JSON.stringify(aVisible(wOwn)));
}
{ // MANAGER session, faithful to the real index.html tab set (which
  // has NO tab-owner-managers section at all): normal manager tabs
  // record + restore exactly like the owner's, and the owner-only
  // hash is doubly dead — not a valid tab AND role-gated.
  const wSw = makeAdminWorld({ role: 'manager' });
  vm.runInContext("switchTab('tab-salaries')", wSw.sandbox);
  check('manager: tab switch records the hash identically (replaceState after the engine push)',
    wSw.browser.loc.hash === '#tab-salaries' && wSw.browser.calls.replace.length === 1
    && wSw.loaderCalls.includes('calculateMonthlySalaries'),
    wSw.browser.loc.hash + ' / ' + JSON.stringify(wSw.browser.calls));
  const wBoot = makeAdminWorld({ hash: '#tab-salaries', role: 'manager' });
  vm.runInContext('restoreAdminTabFromHash()', wBoot.sandbox);
  check('manager: boot with #tab-salaries reopens Salaries under a manager session',
    JSON.stringify(aVisible(wBoot)) === JSON.stringify(['tab-salaries']), JSON.stringify(aVisible(wBoot)));
  const wGate = makeAdminWorld({ hash: '#tab-owner-managers', role: 'manager' });
  vm.runInContext('restoreAdminTabFromHash()', wGate.sandbox);
  check('manager: owner-only hash with the REAL tab set stays on dashboard, no notice, nothing unhidden',
    JSON.stringify(aVisible(wGate)) === JSON.stringify(['tab-dashboard']) && wGate.notifyCalls.length === 0,
    JSON.stringify(aVisible(wGate)) + ' / ' + JSON.stringify(wGate.notifyCalls));
}

// ---------------------------------------------------------------------
// Structural pins: boot call sites + untouched pre-existing URL logic
// ---------------------------------------------------------------------
check('teacher: showDashboardView ends with the hash restore (both sign-in and session restore funnel there)',
  /loadTeacherPortalData\(\);\s*\n\s*restoreTeacherTabFromHash\(\);/.test(TEACHER));
check('teacher: pre-existing query-strip block unchanged',
  TEACHER.includes('if (window.location.search)') && TEACHER.includes("window.history.replaceState({}, document.title, window.location.pathname)"));
check('parent: showParentDashboardView ends with the hash restore',
  /renderPortalLibrary\(\);\s*\n\s*restoreParentTabFromHash\(\);/.test(PARENT));
check('parent: pre-existing query-strip block unchanged',
  PARENT.includes('if (window.location.search)') && PARENT.includes("window.history.replaceState({}, document.title, window.location.pathname)"));
check('admin: restore helper exported for the boot paths', NAV.includes('window.restoreAdminTabFromHash = restoreAdminTabFromHash'));
check('admin: runAdminBoot restores after the default dashboard load',
  CONFIG.includes('window.restoreAdminTabFromHash()'));
check('admin: owner sign-in success path restores after load',
  AUTH.includes('window.restoreAdminTabFromHash()'));
check('hash writers use replaceState only (no pushState in any record*InHash helper)',
  !/function record\w*TabInHash[\s\S]{0,400}?pushState/.test(TEACHER + PARENT + NAV));


// ---------------------------------------------------------------------
// REFRESH LOGIN FLASH (2026-11-12): on refresh after login every
// portal used to paint the full-screen login screen first and pause
// there - the gate only ran on DOMContentLoaded / window.onload,
// after every parser-blocking CDN script (and, on teacher / parent /
// manager, after a server round-trip), while the login views carried
// no .hidden that existed before the Tailwind Play CDN generated it.
// The fix: plain CSS keeps .hidden effective from the first paint,
// and a tiny dependency-free early gate script (LMS-EARLY-GATE
// markers) decides from the LOCAL token during parsing - a live
// token paints the app shell at once, anything else paints login -
// while the real boot still re-verifies against the backend and
// drops to login on failure. These checks EXECUTE the real
// early-gate scripts and the real boot functions in vm worlds.
// ---------------------------------------------------------------------
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const MANAGER = fs.readFileSync(path.join(REPO_ROOT, 'manager.html'), 'utf8');

function makeGateToken(role, sub, expOffsetSec) {
  // Tokens are built programmatically (never literal): payload + signature.
  const payload = { role, sub, exp: Math.floor(Date.now() / 1000) + expOffsetSec };
  return Buffer.from(JSON.stringify(payload)).toString('base64url') + '.testsig';
}
function gateScript(src) {
  const m = src.match(/\/\* LMS-EARLY-GATE-START \*\/([\s\S]*?)\/\* LMS-EARLY-GATE-END \*\//);
  return m ? m[1] : null;
}
function fnSlice(src, startText, endText = null) {
  const s = src.indexOf(startText);
  if (s < 0) return null;
  if (endText) {
    const e = src.indexOf(endText, s + startText.length);
    if (e > -1) return src.slice(s, e);
  }
  let e = src.indexOf('\n    function ', s + startText.length);
  const e2 = src.indexOf('\n    async function ', s + startText.length);
  if (e2 > -1 && (e < 0 || e2 < e)) e = e2;
  return e < 0 ? src.slice(s) : src.slice(s, e);
}
function memStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    _map: map,
  };
}
function runGate(src, ids, opts = {}) {
  const script = gateScript(src);
  if (!script) return null;
  const els = {};
  for (const [id, classes] of Object.entries(ids)) els[id] = fakeEl(id, classes);
  const session = memStore(opts.session || {});
  const local = memStore(opts.local || {});
  const clearWorkerCalls = [];
  const document = { title: 'gate', getElementById: id => els[id] || null };
  const sandbox = {
    console, setTimeout, clearTimeout, document,
    sessionStorage: session, localStorage: local,
    atob: s => Buffer.from(s, 'base64').toString('latin1'),
    URLSearchParams,
    window: {
      location: { search: opts.search || '', pathname: opts.pathname || '/' },
      clearWorkerTokens: () => clearWorkerCalls.push(1),
      document,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { sandbox, els, session, local, clearWorkerCalls };
}
const gateShown = (w, id) => w.els[id] && !w.els[id].classList.contains('hidden');

check('flash: early gate script present in all four portals',
  ['index', 'teacher', 'parent', 'manager'].every((_, i) => [INDEX, TEACHER, PARENT, MANAGER].map(gateScript)[i]));
check('flash: gate scripts are dependency-free (no fetch, no await)',
  [INDEX, TEACHER, PARENT, MANAGER].every(s => {
    const g = gateScript(s);
    return g && !g.includes('fetch(') && !/\bawait\b/.test(g);
  }));

{ // INDEX (owner): valid token paints the app, no token paints login
  const w = runGate(INDEX, { ownerLoginView: ['hidden'], mainAppWrapper: ['hidden'] },
    { session: { alhuda_owner_token: makeGateToken('owner', 'OWN-001', 3600) } });
  check('flash: owner refresh with a live token shows the app shell, never the login view',
    w && gateShown(w, 'mainAppWrapper') && !gateShown(w, 'ownerLoginView')
    && w.els.mainAppWrapper.classList.contains('flex'),
    w ? JSON.stringify([...w.els.ownerLoginView._set, ...w.els.mainAppWrapper._set]) : 'no gate script');
  const wOut = runGate(INDEX, { ownerLoginView: ['hidden'], mainAppWrapper: ['hidden'] }, {});
  check('flash: owner refresh logged out shows the login view immediately, no app flash',
    wOut && gateShown(wOut, 'ownerLoginView') && !gateShown(wOut, 'mainAppWrapper'));
  const expired = makeGateToken('owner', 'OWN-001', -10);
  const wExp = runGate(INDEX, { ownerLoginView: ['hidden'], mainAppWrapper: ['hidden'] },
    { session: { alhuda_owner_token: expired } });
  check('flash: owner refresh with an expired token shows login and drops the dead token',
    wExp && gateShown(wExp, 'ownerLoginView') && !gateShown(wExp, 'mainAppWrapper')
    && wExp.session.getItem('alhuda_owner_token') === null);
  const wWrong = runGate(INDEX, { ownerLoginView: ['hidden'], mainAppWrapper: ['hidden'] },
    { session: { alhuda_owner_token: makeGateToken('teacher', 'TCH-1', 3600) } });
  check('flash: a wrong-role token in the owner key never paints the app',
    wWrong && gateShown(wWrong, 'ownerLoginView') && !gateShown(wWrong, 'mainAppWrapper'));
}
{ // INDEX (manager): ?role=manager with a live manager session paints the app
  const w = runGate(INDEX, { ownerLoginView: ['hidden'], mainAppWrapper: ['hidden'] },
    { search: '?role=manager',
      session: {
        alhuda_manager_session: JSON.stringify({ id: 'TCH-MGR', emp_id: 'MGR-001' }),
        alhuda_manager_token: makeGateToken('manager', 'TCH-MGR', 3600),
      } });
  check('flash: manager refresh with a live session shows the app shell, never the login view',
    w && gateShown(w, 'mainAppWrapper') && !gateShown(w, 'ownerLoginView'));
  const wBad = runGate(INDEX, { ownerLoginView: ['hidden'], mainAppWrapper: ['hidden'] },
    { search: '?role=manager',
      session: {
        alhuda_manager_session: JSON.stringify({ id: 'TCH-MGR', emp_id: 'MGR-001' }),
        alhuda_manager_token: makeGateToken('manager', 'TCH-MGR', -10),
      } });
  check('flash: manager refresh with an expired token leaves both views hidden (full gate redirects)',
    wBad && !gateShown(wBad, 'mainAppWrapper') && !gateShown(wBad, 'ownerLoginView'));
}
{ // TEACHER: valid token paints the shell, no token paints login
  const ids = { loginView: ['hidden'], teacherMainContainer: ['hidden'], dashboardView: ['hidden'],
    btnToggleTeacherSidebar: ['hidden'], teacherHeaderBadge: ['hidden'] };
  const w = runGate(TEACHER, ids, { session: { alhuda_teacher_token: makeGateToken('teacher', 'TCH-1', 3600) } });
  check('flash: teacher refresh with a live token shows the shell + dashboard, never the login view',
    w && gateShown(w, 'teacherMainContainer') && gateShown(w, 'dashboardView') && !gateShown(w, 'loginView')
    && gateShown(w, 'btnToggleTeacherSidebar') && gateShown(w, 'teacherHeaderBadge'));
  const wOut = runGate(TEACHER, ids, {});
  check('flash: teacher refresh logged out shows the login view, shell stays hidden',
    wOut && gateShown(wOut, 'loginView') && !gateShown(wOut, 'teacherMainContainer') && !gateShown(wOut, 'dashboardView'));
  const wExp = runGate(TEACHER, ids, { session: { alhuda_teacher_token: makeGateToken('teacher', 'TCH-1', -10) } });
  check('flash: teacher refresh with an expired token shows login and drops the dead token',
    wExp && gateShown(wExp, 'loginView') && wExp.session.getItem('alhuda_teacher_token') === null);
}
{ // PARENT: valid token paints the shell, no token paints login
  const ids = { parentLoginView: ['hidden'], parentTopNav: ['hidden'], parentMainPortalContent: ['hidden'],
    parentSubNavTabs: ['hidden'], parentHeaderAuthControls: ['hidden'] };
  const w = runGate(PARENT, ids, { session: { alhuda_parent_token: makeGateToken('parent', 'FAM-1', 3600) } });
  check('flash: parent refresh with a live token shows the shell, never the login view',
    w && gateShown(w, 'parentTopNav') && gateShown(w, 'parentMainPortalContent')
    && gateShown(w, 'parentSubNavTabs') && gateShown(w, 'parentHeaderAuthControls')
    && !gateShown(w, 'parentLoginView'));
  const wOut = runGate(PARENT, ids, {});
  check('flash: parent refresh logged out shows the login view, shell stays hidden',
    wOut && gateShown(wOut, 'parentLoginView') && !gateShown(wOut, 'parentMainPortalContent'));
  const wExp = runGate(PARENT, ids, { session: { alhuda_parent_token: makeGateToken('parent', 'FAM-1', -10) } });
  check('flash: parent refresh with an expired token shows login and drops the dead token',
    wExp && gateShown(wExp, 'parentLoginView') && wExp.session.getItem('alhuda_parent_token') === null);
}
{ // MANAGER gate page: no token shows the form at once, live token keeps it hidden
  const wOut = runGate(MANAGER, { managerLoginContainer: ['hidden'] }, {});
  check('flash: manager gate refresh logged out shows the login form immediately',
    wOut && gateShown(wOut, 'managerLoginContainer'));
  const wLive = runGate(MANAGER, { managerLoginContainer: ['hidden'] },
    { session: { alhuda_manager_token: makeGateToken('manager', 'TCH-MGR', 3600) } });
  check('flash: manager gate refresh with a live token keeps the form hidden (boot redirects)',
    wLive && !gateShown(wLive, 'managerLoginContainer'));
}

// ---------------------------------------------------------------------
// Boot re-verification: the early gate paints the shell, but the real
// boot must still re-check the session against the backend and drop
// to login when that fails.
// ---------------------------------------------------------------------
async function runVm(code, sandbox) {
  vm.createContext(sandbox);
  return vm.runInContext(code, sandbox);
}

{ // TEACHER BOOT (real function): valid token + live record -> dashboard; failing record -> login
  const boot = fnSlice(TEACHER, 'async function teacherBootOnReady()', '// DOMContentLoaded trigger for teacherBootOnReady');
  const views = fnSlice(TEACHER, 'function showDashboardView()') + '\n' + fnSlice(TEACHER, 'function showLoginView()');
  const helpers = fnSlice(TEACHER, 'function decodeJwtPayload(token)') + '\n'
    + fnSlice(TEACHER, 'function getTeacherToken()') + '\n' + fnSlice(TEACHER, 'function clearTeacherToken()');
  check('flash: teacher boot function extracted for execution', !!boot && !!views && !!helpers);
  async function teacherBootWorld({ token, dbOk }) {
    const els = {
      loginView: fakeEl('loginView', ['hidden']),
      teacherMainContainer: fakeEl('teacherMainContainer', []),
      dashboardView: fakeEl('dashboardView', []),
      teacherTopHeader: null,
      btnToggleTeacherSidebar: fakeEl('btnToggleTeacherSidebar', []),
      sbTeacherNameDisplay: fakeEl('sbTeacherNameDisplay'),
      sbTeacherShiftDisplay: fakeEl('sbTeacherShiftDisplay'),
      teacherHeaderBadge: fakeEl('teacherHeaderBadge', []),
      headerTeacherName: fakeEl('headerTeacherName'),
      btnTeacherDigitalLibraryHeader: fakeEl('btnTeacherDigitalLibraryHeader', []),
      heroInitials: fakeEl('heroInitials'), heroTeacherName: fakeEl('heroTeacherName'),
      heroTeacherShift: fakeEl('heroTeacherShift'),
      roleMismatchBanner: fakeEl('roleMismatchBanner'),
      liveClock: fakeEl('liveClock'),
    };
    const session = memStore(token ? { alhuda_teacher_token: token } : {});
    const calls = { dashboard: 0, tabs: 0, sidebar: 0, salaryGroup: 0 };
    const teacherRow = { id: 'TCH-1', full_name: 'Test Teacher', working_shift: 'Morning', address: '{}' };
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              if (!dbOk) throw new Error('unreachable');
              return { data: teacherRow };
            },
          }),
        }),
      }),
    };
    const document = { title: 't', getElementById: id => els[id] || null, readyState: 'complete' };
    const sandbox = {
      console, setTimeout: () => 0, setInterval: () => 0, clearTimeout, document,
      sessionStorage: session, localStorage: memStore({}),
      atob: s => Buffer.from(s, 'base64').toString('latin1'),
      db, isEligibleTeacherAccount: () => true,
      normalizeTeacherSession: t => ({ ...t, full_name: t.full_name, working_shift: t.working_shift }),
      loadTeacherPortalData: () => { calls.dashboard++; },
      restoreTeacherTabFromHash: () => { calls.tabs++; },
      toggleDesktopSidebar: () => { calls.sidebar++; },
      restoreTeacherSalaryGroupState: () => { calls.salaryGroup++; },
      window: { document, location: { search: '', pathname: '/teacher' }, history: { replaceState() {} }, innerWidth: 1280, addEventListener() {} },
    };
    await runVm('let CURRENT_TEACHER = null;\n' + helpers + '\n' + views + '\n' + boot
      + '\n;(async () => { await teacherBootOnReady(); })()', sandbox);
    return { els, session, calls };
  }
  const wOk = await teacherBootWorld({ token: makeGateToken('teacher', 'TCH-1', 3600), dbOk: true });
  check('flash: teacher boot re-verifies live (record found -> dashboard shown, login hidden)',
    !wOk.els.loginView.classList.contains('hidden') === false
    && !wOk.els.teacherMainContainer.classList.contains('hidden')
    && !wOk.els.dashboardView.classList.contains('hidden') && wOk.calls.dashboard === 1,
    JSON.stringify(wOk.calls));
  const wFail = await teacherBootWorld({ token: makeGateToken('teacher', 'TCH-1', 3600), dbOk: false });
  check('flash: teacher boot drops to login when the backend re-check fails (shell was already painted)',
    !wFail.els.loginView.classList.contains('hidden')
    && wFail.els.teacherMainContainer.classList.contains('hidden') && wFail.calls.dashboard === 0);
  const wExp = await teacherBootWorld({ token: makeGateToken('teacher', 'TCH-1', -10), dbOk: true });
  check('flash: teacher boot with an expired token shows login and clears the token',
    !wExp.els.loginView.classList.contains('hidden')
    && wExp.session.getItem('alhuda_teacher_token') === null);
}

{ // PARENT BOOT (real initializePortal): live family -> dashboard; failing fetch -> login
  const boot = fnSlice(PARENT, 'async function initializePortal()');
  const views = fnSlice(PARENT, 'function showParentLoginView()') + '\n' + fnSlice(PARENT, 'async function showParentDashboardView(');
  const helpers = fnSlice(PARENT, 'function decodeParentJwtPayload(token)') + '\n'
    + fnSlice(PARENT, 'function getParentToken()') + '\n' + fnSlice(PARENT, 'function clearParentToken()');
  check('flash: parent boot function extracted for execution', !!boot && !!views && !!helpers);
  async function parentBootWorld({ token, dbOk }) {
    const els = {
      parentLoginView: fakeEl('parentLoginView', ['hidden']),
      parentTopNav: fakeEl('parentTopNav', []),
      parentMainPortalContent: fakeEl('parentMainPortalContent', []),
      parentSubNavTabs: fakeEl('parentSubNavTabs', []),
      parentHeaderAuthControls: fakeEl('parentHeaderAuthControls', []),
      parentHeaderFamilyName: fakeEl('parentHeaderFamilyName'),
      parentRoleMismatchBanner: fakeEl('parentRoleMismatchBanner'),
    };
    const session = memStore(token ? { alhuda_parent_token: token } : {});
    const fam = { id: 'FAM-1', parent_name: 'Test Family' };
    const students = [{ id: 'STU-1' }];
    const db = {
      from: table => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              if (!dbOk) throw new Error('unreachable');
              return { data: fam };
            },
            then(resolve) { resolve(dbOk ? { data: students } : { data: null, error: { message: 'x' } }); },
          }),
        }),
      }),
    };
    const calls = { render: 0, library: 0, tabs: 0, dropdown: 0 };
    const document = { title: 'p', getElementById: id => els[id] || null, readyState: 'complete' };
    const sandbox = {
      console, setTimeout: () => 0, setInterval: () => 0, clearTimeout, document,
      sessionStorage: session, localStorage: memStore({}),
      atob: s => Buffer.from(s, 'base64').toString('latin1'),
      db,
      populateStudentDropdown: () => { calls.dropdown++; },
      renderCurrentStudentData: async () => { calls.render++; },
      renderPortalLibrary: () => { calls.library++; },
      restoreParentTabFromHash: () => { calls.tabs++; },
      window: { document, location: { search: '', pathname: '/parent' }, history: { replaceState() {} }, innerWidth: 1280, addEventListener() {} },
    };
    await runVm('let CURRENT_AUTH_FAMILY = null; let CURRENT_STUDENT = null; let ALL_STUDENTS = [];\n'
      + helpers + '\n' + views + '\n' + boot + '\n;(async () => { await initializePortal(); })()', sandbox);
    return { els, session, calls };
  }
  const wOk = await parentBootWorld({ token: makeGateToken('parent', 'FAM-1', 3600), dbOk: true });
  check('flash: parent boot re-verifies live (family found -> dashboard shown, login hidden)',
    !wOk.els.parentLoginView.classList.contains('hidden') === false
    && !wOk.els.parentMainPortalContent.classList.contains('hidden') && wOk.calls.render === 1,
    JSON.stringify(wOk.calls));
  const wFail = await parentBootWorld({ token: makeGateToken('parent', 'FAM-1', 3600), dbOk: false });
  check('flash: parent boot drops to login when the backend re-check fails',
    !wFail.els.parentLoginView.classList.contains('hidden')
    && wFail.els.parentMainPortalContent.classList.contains('hidden') && wFail.calls.render === 0);
  const wOut = await parentBootWorld({ token: null, dbOk: true });
  check('flash: parent boot with no token shows login',
    !wOut.els.parentLoginView.classList.contains('hidden'));
}

{ // MANAGER BOOT (real function): eligible record -> redirect; ineligible/no token -> form shown
  const boot = fnSlice(MANAGER, 'async function managerBootOnReady()', '// DOMContentLoaded trigger for managerBootOnReady');
  const decode = fnSlice(MANAGER, 'function decodeJwtPayload(token)');
  check('flash: manager boot function extracted for execution', !!boot && !!decode);
  async function managerBootWorld({ token, eligible }) {
    const els = {
      mgrRoleMismatchBanner: fakeEl('mgrRoleMismatchBanner'),
      managerLoginContainer: fakeEl('managerLoginContainer', ['hidden']),
    };
    const session = memStore(token ? { alhuda_manager_token: token } : {});
    const local = memStore({});
    const replaces = [];
    const document = { title: 'm', getElementById: id => els[id] || null, readyState: 'complete' };
    const sandbox = {
      console, setTimeout: () => 0, setInterval: () => 0, clearTimeout, document,
      sessionStorage: session, localStorage: local,
      atob: s => Buffer.from(s, 'base64').toString('latin1'),
      fetchManagersFromBackend: async () => ({
        managers: [{ id: 'TCH-MGR', full_name: 'Test Manager' }], accountsMap: {},
      }),
      isEligibleManagerAccount: () => eligible,
      resolveManagerCredentials: () => ({ emp_id: 'MGR-001', username: 'mgr', role_title: 'Manager' }),
      window: {
        document, location: { search: '', pathname: '/manager', replace: url => replaces.push(url) },
        history: { replaceState() {} }, innerWidth: 1280, addEventListener() {},
      },
    };
    await runVm(decode + '\n' + boot + '\n;(async () => { await managerBootOnReady(); })()', sandbox);
    return { els, session, replaces };
  }
  const wOk = await managerBootWorld({ token: makeGateToken('manager', 'TCH-MGR', 3600), eligible: true });
  check('flash: manager boot with a verified record redirects into the portal, form stays hidden',
    wOk.replaces.length === 1 && wOk.replaces[0] === 'index.html?role=manager'
    && wOk.els.managerLoginContainer.classList.contains('hidden'),
    JSON.stringify(wOk.replaces));
  const wBad = await managerBootWorld({ token: makeGateToken('manager', 'TCH-MGR', 3600), eligible: false });
  check('flash: manager boot with an ineligible record drops the token and shows the form',
    wBad.replaces.length === 0 && !wBad.els.managerLoginContainer.classList.contains('hidden')
    && wBad.session.getItem('alhuda_manager_token') === null);
  const wOut = await managerBootWorld({ token: null, eligible: true });
  check('flash: manager boot with no token shows the form, no redirect',
    wOut.replaces.length === 0 && !wOut.els.managerLoginContainer.classList.contains('hidden'));
}

{ // OWNER GATE (real initRoleFromUrl + view fns from js/auth.js)
  const decode = fnSlice(AUTH, 'function decodeTokenPayload(token)');
  const ownerToken = fnSlice(AUTH, 'function getOwnerToken()');
  const ownerSession = fnSlice(AUTH, 'function getAuthenticatedOwnerSession()');
  const mgrSession = fnSlice(AUTH, 'function getAuthenticatedManagerSession()');
  const views = fnSlice(AUTH, 'function showOwnerLoginView()') + '\n' + fnSlice(AUTH, 'function showMainAppView()');
  const gate = fnSlice(AUTH, 'function initRoleFromUrl()');
  check('flash: owner gate functions extracted for execution', !!decode && !!ownerSession && !!views && !!gate && !!mgrSession);
  function ownerWorld({ search = '', session = {} } = {}) {
    const els = {
      ownerLoginView: fakeEl('ownerLoginView', ['hidden']),
      mainAppWrapper: fakeEl('mainAppWrapper', ['hidden']),
      teacherSessionPill: fakeEl('teacherSessionPill'),
    };
    const sessionStore = memStore(session);
    const local = memStore({});
    const replaces = [];
    const roleCalls = [];
    const document = {
      title: 'a', getElementById: id => els[id] || null,
      querySelectorAll: () => [], querySelector: () => null,
    };
    const sandbox = {
      console, setTimeout, clearTimeout, document,
      sessionStorage: sessionStore, localStorage: local,
      atob: s => Buffer.from(s, 'base64').toString('latin1'),
      URLSearchParams,
      CURRENT_ROLE: 'owner', ACTIVE_MANAGER_ID: null,
      switchUserRole: role => { roleCalls.push(role); },
      window: {
        document, location: { search, pathname: '/', replace: url => replaces.push(url) },
        history: { replaceState() {} }, innerWidth: 1280, addEventListener() {},
      },
    };
    runVm(decode + '\n' + ownerToken + '\n' + ownerSession + '\n' + mgrSession + '\n' + views + '\n' + gate, sandbox);
    return { sandbox, els, sessionStore, local, replaces, roleCalls };
  }
  const wOk = ownerWorld({ session: { alhuda_owner_token: makeGateToken('owner', 'OWN-001', 3600) } });
  vm.runInContext('initRoleFromUrl()', wOk.sandbox);
  check('flash: owner gate with a live token shows the app shell, never the login view',
    !wOk.els.mainAppWrapper.classList.contains('hidden')
    && wOk.els.ownerLoginView.classList.contains('hidden') && wOk.roleCalls.includes('owner'));
  const wOut = ownerWorld({});
  vm.runInContext('initRoleFromUrl()', wOut.sandbox);
  check('flash: owner gate logged out shows the login view, app stays hidden',
    !wOut.els.ownerLoginView.classList.contains('hidden')
    && wOut.els.mainAppWrapper.classList.contains('hidden'));
  const wMgr = ownerWorld({
    search: '?role=manager',
    session: {
      alhuda_manager_session: JSON.stringify({ id: 'TCH-MGR', emp_id: 'MGR-001' }),
      alhuda_manager_token: makeGateToken('manager', 'TCH-MGR', 3600),
    },
  });
  vm.runInContext('initRoleFromUrl()', wMgr.sandbox);
  check('flash: manager gate with a live session shows the app shell under the manager role',
    !wMgr.els.mainAppWrapper.classList.contains('hidden') && wMgr.roleCalls.includes('manager'));
  const wMgrBad = ownerWorld({ search: '?role=manager', session: {} });
  vm.runInContext('initRoleFromUrl()', wMgrBad.sandbox);
  check('flash: manager gate with no session redirects to the manager gate page',
    wMgrBad.replaces.length === 1 && wMgrBad.replaces[0] === 'manager.html');
}

{ // OWNER BACKGROUND VERIFY: the alhuda-session-expired listener drops to the right login
  const m = AUTH.match(/\/\/ LMS-SESSION-EXPIRED-LISTENER-START([\s\S]*?)\/\/ LMS-SESSION-EXPIRED-LISTENER-END/);
  check('flash: session-expired listener present in js/auth.js', !!m);
  function listenerWorld(role) {
    const handlers = [];
    let loginCalls = 0;
    const replaces = [];
    const sandbox = {
      console, setTimeout, clearTimeout,
      localStorage: memStore(role ? { alhuda_active_portal_role: role } : {}),
      showOwnerLoginView: () => { loginCalls++; },
      window: {
        addEventListener: (type, fn) => { handlers.push({ type, fn }); },
        location: { replace: url => replaces.push(url) },
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(m[1], sandbox);
    return { handlers, get loginCalls() { return loginCalls; }, replaces };
  }
  const wOwn = listenerWorld('owner');
  check('flash: expired listener registered exactly once', wOwn.handlers.length === 1
    && wOwn.handlers[0].type === 'alhuda-session-expired');
  wOwn.handlers[0].fn();
  check('flash: a failed owner verify drops to the owner login view',
    wOwn.loginCalls === 1 && wOwn.replaces.length === 0);
  const wMgr = listenerWorld('manager');
  wMgr.handlers[0].fn();
  check('flash: a failed manager verify redirects to the manager gate page, not the owner login',
    wMgr.replaces.length === 1 && wMgr.replaces[0] === 'manager.html' && wMgr.loginCalls === 0);
}

// ---------------------------------------------------------------------
// Structural pins: the flash fix itself
// ---------------------------------------------------------------------
check('flash: plain-CSS gate rule keeps .hidden effective before Tailwind (owner)',
  INDEX.includes('#ownerLoginView.hidden, #mainAppWrapper.hidden { display: none !important; }'));
check('flash: plain-CSS gate rule keeps .hidden effective before Tailwind (teacher)',
  TEACHER.includes('#loginView.hidden, #teacherMainContainer.hidden, #dashboardView.hidden { display: none !important; }'));
check('flash: plain-CSS gate rule keeps .hidden effective before Tailwind (parent)',
  PARENT.includes('#parentLoginView.hidden, #parentTopNav.hidden, #parentMainPortalContent.hidden, #parentSubNavTabs.hidden, #parentHeaderAuthControls.hidden { display: none !important; }'));
check('flash: plain-CSS gate rule keeps .hidden effective before Tailwind (manager)',
  MANAGER.includes('#managerLoginContainer.hidden { display: none !important; }'));
check('flash: login views start hidden in the markup (teacher / parent / manager)',
  /id="loginView" class="[^"]*hidden/.test(TEACHER)
  && /id="parentLoginView" class="[^"]*hidden/.test(PARENT)
  && /id="managerLoginContainer" class="[^"]*hidden/.test(MANAGER));
check('flash: teacher + manager boots no longer wait for window.onload',
  !TEACHER.includes('window.onload = async function')
  && !MANAGER.includes('window.onload = async function')
  && TEACHER.includes("document.addEventListener('DOMContentLoaded', teacherBootOnReady)")
  && MANAGER.includes("document.addEventListener('DOMContentLoaded', managerBootOnReady)"));
check('flash: hash restore still runs in the boot paths (unchanged)',
  /loadTeacherPortalData\(\);\s*\n\s*restoreTeacherTabFromHash\(\);/.test(TEACHER)
  && /renderPortalLibrary\(\);\s*\n\s*restoreParentTabFromHash\(\);/.test(PARENT)
  && CONFIG.includes('window.restoreAdminTabFromHash()'));

console.log(`\nPORTAL REFRESH RESTORE SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
