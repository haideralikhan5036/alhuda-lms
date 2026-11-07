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
//                   switchTeacherPortalTab (one contiguous real chunk)
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
const T_END = TEACHER.indexOf('function openTeacherAdvanceSalaryRequest');
const TEACHER_CHUNK = TEACHER.slice(T_START, T_END);
check('teacher: real chunk extracted (sync + helpers + switch)',
  T_START > -1 && T_END > T_START && TEACHER_CHUNK.includes('function switchTeacherPortalTab')
  && TEACHER_CHUNK.includes('function restoreTeacherTabFromHash'));

const T_SECTIONS = ['sectionTeacherKpiGrid', 'sectionTeacherToday', 'sectionTeacherStudentList',
  'sectionTeacherLessonHistory', 'sectionTeacherTrials', 'sectionTeacherSalaries'];
function makeTeacherWorld(hash = '') {
  const els = {};
  for (const id of T_SECTIONS) els[id] = fakeEl(id, id === 'sectionTeacherLessonHistory' || id === 'sectionTeacherStudentList' || id === 'sectionTeacherTrials' || id === 'sectionTeacherSalaries' ? ['hidden'] : []);
  for (const id of ['sbNavDashboard', 'sbNavToday', 'sbNavStudents', 'sbNavHistory', 'sbNavTrials', 'sbNavSalaries']) els[id] = fakeEl(id);
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

console.log(`\nPORTAL REFRESH RESTORE SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
