// Admin Portal flagship redesign (2026-11-07): the teacher portal's
// emerald-glass shell applied to index.html (owner + manager — the
// same file). Interface only. This suite proves, against the REAL
// index.html and the REAL js/navigation.js + js/config.js functions:
//   1. the functional inventory survived: every shell id exists
//      exactly once (header children relocated, none dropped), the
//      data-tab set and tab-content sections are unchanged, and the
//      login view was byte-for-byte the pre-redesign one in THIS
//      build (a separate commission, excluded on purpose then); the
//      follow-up login redesign (2026-11-07) has since re-skinned it
//      with its own lgn- landmarks — it still carries no aui- hooks;
//   2. the flagship shell is present: glass sidebar with three pinned
//      bands (brand + live clock / scrolling nav / counters foot),
//      the white active pill merging into the content via radial
//      fillets, the invisible nav scrollbar, the mobile slim rail;
//   3. the REAL switchTab, executed in a vm over a fake DOM built
//      from the REAL markup, shows/hides exactly the same sections,
//      lights exactly the same pill, auto-expands the Settings group,
//      writes the refresh-restore hash, and still bounces a manager
//      away from the owner-only tab (PR #120 + OWNER_ONLY_TABS
//      semantics unchanged);
//   4. the REAL toggleSettingsGroup and toggleSidebar keep their
//      exact behaviour (group hidden toggle + chevron; desktop
//      collapse persisted to localStorage; mobile drawer open/close);
//   5. the REAL restoreAdminTabFromHash reopens the hashed tab for
//      the owner, stays silent for a manager on an owner-only hash,
//      and never restores the excluded 360 profile;
//   6. the mobile rail's active-state mirror script (the one inline
//      script this redesign adds to index.html) mirrors the sidebar
//      pill's tab onto the matching rail button when executed.
// Run from the repo root:  node test/admin-redesign-shell.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const NAV_JS = fs.readFileSync(path.join(REPO_ROOT, 'js/navigation.js'), 'utf8');
const CONFIG_JS = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS | ' + name); }
  else { failed++; console.log('FAIL | ' + name + (detail ? ' :: ' + detail : '')); }
}
const count = (hay, needle) => hay.split(needle).length - 1;

// ---------------------------------------------------------------------
// Part A — functional inventory on the real markup
// ---------------------------------------------------------------------
const SHELL_IDS = [
  // login view (re-skinned later by the login redesign — ids kept)
  'ownerLoginView', 'ownerLoginUsername', 'ownerLoginPassword',
  'ownerPassToggleIcon', 'btnSubmitOwnerLogin', 'ownerLoginErrorMsg',
  // app shell
  'mainAppWrapper', 'mainAppSidebar', 'sidebarBackdrop', 'mainContentArea',
  // relocated header children
  'userRoleSelect', 'teacherSessionPill', 'teacherActiveName',
  'headerRoleSecurityBadge', 'badgePendingTeacherRequests',
  'btnReturnAlertsBell', 'badgeReturnAlertsCount',
  // top bar (search + chips)
  'globalPersistentTopSearchBar', 'dashGlobalSearchInput',
  'dashGlobalSearchResultsPanel', 'badgeTopLeaveOverCount',
  'badgeTopRequestsCount', 'badgeTopAnnouncementsCount',
  'badgeTopComplaintsCount',
  // sidebar internals
  'liveClock', 'navFeePendingBadge', 'navLeaveCountBadge',
  'sidebarSettingsGroup', 'sidebarSettingsChevron',
  'sidebarActiveFamilies', 'sidebarActiveStudents', 'adminMobileRail',
  // dashboard head
  'dashboardHeading',
];
for (const id of SHELL_IDS) {
  check(`shell id exists exactly once: ${id}`, count(INDEX, `id="${id}"`) === 1,
    'count=' + count(INDEX, `id="${id}"`));
}

// The old full-width header element is gone; its pieces live on.
check('old top <header> element removed', !INDEX.includes('<header'));
check('hamburger contract kept in the top bar (phase3 pin string)',
  INDEX.includes('toggleSidebar()" aria-label="Toggle navigation sidebar" class="w-11 h-11'));
check('role badge element kept byte-identical (phase3 pin string)',
  INDEX.includes('id="headerRoleSecurityBadge" class="shrink-0"'));

// Top bar slice: toggle + search + pill + badge + 4 chips all inside.
const topBarStart = INDEX.indexOf('id="globalPersistentTopSearchBar"');
const topBarEnd = INDEX.indexOf('id="tab-dashboard"');
const TOPBAR = INDEX.slice(topBarStart, topBarEnd);
for (const probe of ['aria-label="Toggle navigation sidebar"', 'id="dashGlobalSearchInput"',
  'id="teacherSessionPill"', 'id="headerRoleSecurityBadge"', 'id="badgeTopLeaveOverCount"',
  'id="badgeTopRequestsCount"', 'id="badgeTopAnnouncementsCount"', 'id="badgeTopComplaintsCount"']) {
  check(`top bar contains ${probe}`, TOPBAR.includes(probe));
}

// Sidebar slice: brand door, clock, all nav destinations, counters.
const asideStart = INDEX.indexOf('<aside id="mainAppSidebar"');
const ASIDE = INDEX.slice(asideStart, INDEX.indexOf('</aside>', asideStart));
check('sidebar is the glass shell',
  INDEX.includes('<aside id="mainAppSidebar" class="aui-sidebar-glass flex flex-col overflow-hidden">'));
check('sidebar brand row is the old header brand door (dashboard + wordmark)',
  ASIDE.includes(`onclick="switchTab('tab-dashboard')"`) && ASIDE.includes('AL-HUDA') &&
  ASIDE.includes('ISLAMIC CENTRE'));
check('sidebar bands in order: clock (header) < nav < counters (foot)',
  ASIDE.indexOf('id="liveClock"') > -1 &&
  ASIDE.indexOf('id="liveClock"') < ASIDE.indexOf('<nav class="aui-nav-scroll') &&
  ASIDE.indexOf('<nav class="aui-nav-scroll') < ASIDE.indexOf('id="sidebarActiveFamilies"'));
check('sidebar close (mobile) + collapse (desktop) buttons both call toggleSidebar()',
  count(ASIDE, 'onclick="toggleSidebar()"') === 2);

// Nav structure: the exact pre-redesign data-tab set, in order.
const DATA_TABS = [...INDEX.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
const EXPECTED_TABS = ['tab-dashboard', 'tab-families', 'tab-teachers', 'tab-trials',
  'tab-invoices', 'tab-salaries', 'tab-leaves', 'tab-schedule-search', 'tab-curriculum',
  'tab-attendance', 'tab-settings', 'tab-settings-academy'];
check('data-tab set + order unchanged (12 sidebar destinations)',
  JSON.stringify(DATA_TABS) === JSON.stringify(EXPECTED_TABS), JSON.stringify(DATA_TABS));
const SECTIONS = ['tab-dashboard', 'tab-families', 'tab-teachers', 'tab-trials',
  'tab-invoices', 'tab-salaries', 'tab-leaves', 'tab-schedule-search', 'tab-curriculum',
  'tab-attendance', 'tab-settings', 'tab-settings-academy', 'tab-profile-360'];
for (const id of SECTIONS) {
  check(`tab-content section exists exactly once: ${id}`, count(INDEX, `id="${id}"`) === 1);
}
// Role gating markup untouched: the five role-admin doors stay marked.
for (const tab of ['tab-families', 'tab-teachers', 'tab-trials', 'tab-invoices', 'tab-salaries']) {
  const m = INDEX.match(new RegExp(`<button[^>]*data-tab="${tab}"[^>]*>`));
  check(`nav button ${tab} keeps its role-admin class`, !!m && m[0].includes('role-admin'),
    m ? m[0].slice(0, 80) : 'missing');
}
// Badges ride inside their buttons.
check('fee pending badge inside the Fee Management button',
  INDEX.indexOf('id="navFeePendingBadge"') > INDEX.indexOf('data-tab="tab-invoices"') &&
  INDEX.indexOf('id="navFeePendingBadge"') < INDEX.indexOf('data-tab="tab-salaries"'));
check('leave count badge inside the Leave button',
  INDEX.indexOf('id="navLeaveCountBadge"') > INDEX.indexOf('data-tab="tab-leaves"') &&
  INDEX.indexOf('id="navLeaveCountBadge"') < INDEX.indexOf('data-tab="tab-schedule-search"'));
check('Course Materials keeps its "Library" chip',
  INDEX.indexOf('>Library<') > INDEX.indexOf('data-tab="tab-curriculum"') &&
  INDEX.indexOf('>Library<') < INDEX.indexOf('data-tab="tab-attendance"'));

// Settings group pins (mirror settings-nav + academy-profile).
check('settings toggle wiring + label within 400 chars (settings-nav pin)',
  /onclick="toggleSettingsGroup\(\)"[\s\S]{0,400}?<span class="truncate">Settings<\/span>/.test(INDEX));
check('settings group starts hidden (settings-nav pin)',
  INDEX.includes('id="sidebarSettingsGroup" class="hidden'));
check('settings order: attendance < toggle < group < course payment < academy profile',
  INDEX.indexOf('data-tab="tab-attendance"') < INDEX.indexOf('onclick="toggleSettingsGroup()"') &&
  INDEX.indexOf('onclick="toggleSettingsGroup()"') < INDEX.indexOf('id="sidebarSettingsGroup"') &&
  INDEX.indexOf('id="sidebarSettingsGroup"') < INDEX.indexOf('data-tab="tab-settings"') &&
  INDEX.indexOf('data-tab="tab-settings"') < INDEX.indexOf('data-tab="tab-settings-academy"'));

// Mobile rail: inside the app wrapper, six tab shortcuts + menu door.
const railStart = INDEX.indexOf('id="adminMobileRail"');
check('mobile rail lives inside #mainAppWrapper (hides with login state)',
  INDEX.indexOf('id="mainAppWrapper"') < railStart && railStart < INDEX.indexOf('id="sidebarBackdrop"'));
const RAIL = [...INDEX.matchAll(/<button[^>]*data-rail-tab="([^"]+)"[^>]*onclick="([^"]*)"/g)]
  .map(m => ({ tab: m[1], onclick: m[2] }));
check('mobile rail has six tab buttons', RAIL.length === 6, JSON.stringify(RAIL.map(r => r.tab)));
for (const r of RAIL) {
  check(`rail button [${r.tab}] calls switchTab('${r.tab}')`,
    r.onclick.includes(`switchTab('${r.tab}')`), r.onclick);
}
check('mobile rail menu button opens the drawer via toggleSidebar()',
  /<div id="adminMobileRail"[\s\S]{0,1200}?onclick="toggleSidebar\(\)"/.test(INDEX));

// Login view: excluded from THIS redesign on purpose; the exclusion
// was lifted by the follow-up login redesign (2026-11-07), which
// re-skinned the gate with its own lgn- classes. The pins below now
// assert the new landmarks + the untouched form contract instead of
// the old card classes (reason: the separate commission has landed).
check('login view carries NO flagship hooks (aui- stays out of the gate)',
  !INDEX.includes('aui-login'));
check('login view carries the new lgn- landmarks (split card + panel + form side)',
  INDEX.includes('class="lgn-card"') && INDEX.includes('class="lgn-panel"') &&
  INDEX.includes('class="lgn-formside"'));
check('login submit keeps its id + real label inside the pill CTA',
  INDEX.includes('id="btnSubmitOwnerLogin" class="lgn-cta"') &&
  INDEX.includes('Login to Control Center'));
check('login form keeps the real submit handler + password toggle wiring',
  INDEX.includes('onsubmit="handleOwnerSignIn(event)"') &&
  INDEX.includes('onclick="toggleOwnerPassVisibility()"'));

// ---------------------------------------------------------------------
// Part B — flagship CSS + geometry + dashboard pins
// ---------------------------------------------------------------------
check('merge pill CSS present (flush pill + radial fillets)',
  INDEX.includes('border-radius: 999px 0 0 999px') &&
  INDEX.includes('radial-gradient(circle at 0 0') &&
  INDEX.includes('radial-gradient(circle at 0 100%'));
check('emerald glass gradient present (teacher recipe)',
  INDEX.includes('linear-gradient(168deg, #0e6e4b 0%, #095239 34%, #06402c 62%, #032a1e 100%)'));
check('nav scrollbar not painted (junction reads as one piece)',
  INDEX.includes('.aui-nav-scroll') && INDEX.includes('scrollbar-width: none') &&
  INDEX.includes('.aui-nav-scroll::-webkit-scrollbar'));
check('settings sub-pills indented, active still reaches the edge',
  INDEX.includes('#sidebarSettingsGroup .sidebar-nav-btn') &&
  INDEX.includes('width: calc(100% - 48px)') && INDEX.includes('width: calc(100% - 24px)'));
check('portal scale stays 85% (body zoom, PR #127)',
  INDEX.includes('body { zoom: 0.85; }'));
check('geometry: desktop sidebar full height at 312px, content offset matches',
  INDEX.includes('width: 312px !important') && INDEX.includes('margin-left: 312px !important') &&
  /@media \(min-width: 1024px\) \{\s*#mainAppSidebar \{\s*position: fixed !important;\s*top: 0 !important;/.test(INDEX));
check('geometry: collapsed rail is 92px (5.75rem, teacher parity)',
  INDEX.includes('#mainAppSidebar.sidebar-collapsed') && INDEX.includes('width: 92px !important') &&
  INDEX.includes('margin-left: 92px !important'));
check('geometry: mobile drawer is transform-based, content clears the slim rail',
  INDEX.includes('transform: translateX(-110%) !important') &&
  INDEX.includes('padding-left: 84px !important'));
check('content area is white (the pill merges into it)',
  /#mainContentArea \{\s*background: #ffffff;/.test(INDEX));
check('dashboard section opening + KPI grid untouched (dashboard-sleek pins)',
  INDEX.includes('<section id="tab-dashboard" class="tab-content block max-w-[1200px] mx-auto w-full">') &&
  INDEX.includes('grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5') &&
  count(INDEX, 'h-[80px] min-h-[80px] sm:h-[88px]') === 8);
check('dashboard charts keep their canvases',
  INDEX.includes('id="chartStudentGrowth"') && INDEX.includes('id="chartFeeRevenue"'));
check('shell functions stay in js/* (not redefined inline)',
  !INDEX.includes('function switchTab(') && !INDEX.includes('function toggleSidebar(') &&
  !INDEX.includes('function toggleSettingsGroup('));
check('the one added inline script is the rail active-state mirror',
  INDEX.includes('syncAdminRailActiveState') && INDEX.includes("getElementById('adminMobileRail')"));

// ---------------------------------------------------------------------
// Part C — fake DOM built from the REAL markup (ids + initial classes)
// ---------------------------------------------------------------------
class FakeEl {
  constructor(id, classAttr, attrs) {
    this.id = id;
    this._set = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
    this._attrs = attrs || {};
    this._children = null;
    this.style = {};
    this.classList = {
      add: (...cs) => cs.forEach(c => this._set.add(c)),
      remove: (...cs) => cs.forEach(c => this._set.delete(c)),
      toggle: (c, force) => {
        const want = force === undefined ? !this._set.has(c) : !!force;
        if (want) this._set.add(c); else this._set.delete(c);
        return want;
      },
      contains: (c) => this._set.has(c),
    };
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  contains(el) { return !!this._children && this._children.has(el); }
}
const registry = new Map();
for (const m of INDEX.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const tag = m[0];
  const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
  if (!registry.has(m[2])) registry.set(m[2], new FakeEl(m[2], cls, {}));
}
// Sidebar buttons carry no ids: parse them as tags, in document order.
const navButtons = [];
for (const m of INDEX.matchAll(/<button[^>]*class="[^"]*sidebar-nav-btn[^"]*"[^>]*>/g)) {
  const tag = m[0];
  const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
  const tab = (tag.match(/data-tab="([^"]+)"/) || [])[1] || null;
  navButtons.push(new FakeEl('', cls, tab ? { 'data-tab': tab } : {}));
}
const tabSections = SECTIONS.map(id => registry.get(id)).filter(Boolean);
// The Settings group contains exactly the buttons parsed after it.
{
  const groupEl = registry.get('sidebarSettingsGroup');
  const groupPos = INDEX.indexOf('id="sidebarSettingsGroup"');
  const inGroup = navButtons.filter(b => {
    const tab = b.getAttribute('data-tab');
    return tab && INDEX.indexOf(`data-tab="${tab}"`) > groupPos;
  });
  groupEl._children = new Set(inGroup);
}
const documentStub = {
  title: '',
  getElementById: (id) => registry.get(id) || null,
  querySelectorAll: (sel) => {
    if (sel === '.sidebar-nav-btn') return navButtons;
    if (sel === '.sidebar-nav-btn[data-tab]') return navButtons.filter(b => b.getAttribute('data-tab'));
    if (sel === '.tab-content') return tabSections;
    return [];
  },
  querySelector: (sel) => {
    const m = sel.match(/data-tab="([^"]+)"/);
    if (m) return navButtons.find(b => b.getAttribute('data-tab') === m[1]) || null;
    return null;
  },
};

// ---------------------------------------------------------------------
// Part D — execute the REAL functions in a vm
// ---------------------------------------------------------------------
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
const calls = [];
const historyCalls = [];
const lsStore = new Map();
const sandbox = {
  console,
  document: documentStub,
  localStorage: {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => { lsStore.set(k, String(v)); },
    removeItem: (k) => { lsStore.delete(k); },
  },
  lmsNotify: (msg) => calls.push('notify:' + String(msg)),
  updateBackBtnVisibility: () => {},
  loadDashboardData: () => calls.push('loadDashboardData'),
  loadAttendanceList: () => calls.push('loadAttendanceList'),
  loadFamiliesAndStudents: () => calls.push('loadFamiliesAndStudents'),
  loadTeachers: () => calls.push('loadTeachers'),
  calculateMonthlySalaries: () => calls.push('calculateMonthlySalaries'),
  loadFeeBillingLedger: () => calls.push('loadFeeBillingLedger'),
  loadTrialClassesData: () => calls.push('loadTrialClassesData'),
  loadLeaveManagementData: () => calls.push('loadLeaveManagementData'),
  loadCurriculumLibrary: () => calls.push('loadCurriculumLibrary'),
  initScheduleSearch: () => calls.push('initScheduleSearch'),
};
sandbox.window = {
  innerWidth: 1280,
  location: { pathname: '/', hash: '' },
  history: {
    state: null,
    pushState: (...a) => historyCalls.push(['push', ...a]),
    replaceState: (...a) => historyCalls.push(['replace', ...a]),
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const OWNER_ONLY_LINE = (NAV_JS.match(/const OWNER_ONLY_TABS = \[[^\]]*\];/) || [])[0] || '';
check('executed setup: OWNER_ONLY_TABS const found in navigation.js', OWNER_ONLY_LINE.length > 0);
vm.runInContext(`
  let CURRENT_ROLE = 'owner';
  let isNavigatingHistory = false;
  let currentNavState = { tabId: 'tab-dashboard', subTabId: null, label: 'Dashboard' };
  let appNavHistory = [];
  const NAV_FEATURE_LABELS = {};
  let DASH_STUDENT_CHART = null;
  let DASH_REVENUE_CHART = null;
  let lastAdminTopLevelTab = null;
  ${OWNER_ONLY_LINE}
  ${extractFunction(NAV_JS, 'recordNavigation')}
  ${extractFunction(NAV_JS, 'adminTopLevelTabIds')}
  ${extractFunction(NAV_JS, 'recordAdminTabInHash')}
  ${extractFunction(NAV_JS, 'adminTabKeyFromHash')}
  ${extractFunction(NAV_JS, 'restoreAdminTabFromHash')}
  ${extractFunction(NAV_JS, 'toggleSettingsGroup')}
  ${extractFunction(NAV_JS, 'switchTab')}
  ${extractFunction(CONFIG_JS, 'toggleSidebar')}
  this.__api = { switchTab, toggleSettingsGroup, restoreAdminTabFromHash, toggleSidebar,
    setRole: (r) => { CURRENT_ROLE = r; } };
`, sandbox);
const api = sandbox.__api;
const sectionShown = (id) => {
  const el = registry.get(id);
  return el.classList.contains('block') && !el.classList.contains('hidden');
};
const activeTabs = () => navButtons.filter(b => b.classList.contains('active'))
  .map(b => b.getAttribute('data-tab'));

// --- Tab switching matrix over every sidebar destination -------------
const seenLoaders = new Set();
for (const tab of EXPECTED_TABS) {
  calls.length = 0; historyCalls.length = 0;
  api.switchTab(tab);
  calls.forEach(c => seenLoaders.add(c));
  check(`switchTab('${tab}') shows only its section`,
    SECTIONS.every(id => sectionShown(id) === (id === tab)),
    SECTIONS.filter(id => sectionShown(id)).join(','));
  check(`switchTab('${tab}') lights only its sidebar pill`,
    JSON.stringify(activeTabs()) === JSON.stringify([tab]), JSON.stringify(activeTabs()));
  check(`switchTab('${tab}') writes the refresh-restore hash`,
    historyCalls.some(c => c[0] === 'replace' && String(c[c.length - 1]).endsWith('#' + tab)),
    JSON.stringify(historyCalls));
}
check('tab switches still trigger their data loaders',
  ['loadDashboardData', 'loadFamiliesAndStudents', 'loadTeachers', 'loadTrialClassesData',
   'loadFeeBillingLedger', 'calculateMonthlySalaries', 'loadLeaveManagementData',
   'initScheduleSearch', 'loadCurriculumLibrary', 'loadAttendanceList']
    .every(n => seenLoaders.has(n)), JSON.stringify([...seenLoaders]));

// --- Settings group: switch auto-expands; the real toggle flips -----
{
  const group = registry.get('sidebarSettingsGroup');
  const chev = registry.get('sidebarSettingsChevron');
  api.switchTab('tab-settings');
  check('switching to a Settings sub-tab auto-expands the group + rotates the chevron',
    !group.classList.contains('hidden') && chev.style.transform === 'rotate(180deg)');
  api.toggleSettingsGroup();
  check('toggleSettingsGroup collapses the group + resets the chevron',
    group.classList.contains('hidden') && chev.style.transform === '');
  api.toggleSettingsGroup();
  check('toggleSettingsGroup re-expands the group',
    !group.classList.contains('hidden') && chev.style.transform === 'rotate(180deg)');
}

// --- Manager gating through the REAL switchTab ------------------------
{
  calls.length = 0;
  api.setRole('manager');
  api.switchTab('tab-owner-managers');
  check('manager is bounced from the owner-only tab with the Access Denied notice',
    calls.some(c => c.startsWith('notify:Access Denied')) && sectionShown('tab-dashboard'),
    JSON.stringify(calls));
  api.switchTab('tab-families');
  check('manager keeps full access to a shared tab (families)',
    sectionShown('tab-families') && JSON.stringify(activeTabs()) === JSON.stringify(['tab-families']));
  api.setRole('owner');
  api.switchTab('tab-dashboard');
}

// --- Refresh restore through the REAL restoreAdminTabFromHash ---------
{
  sandbox.window.location.hash = '#tab-leaves';
  api.restoreAdminTabFromHash();
  check('owner refresh on #tab-leaves reopens Leave',
    sectionShown('tab-leaves') && JSON.stringify(activeTabs()) === JSON.stringify(['tab-leaves']));
  api.setRole('manager');
  sandbox.window.location.hash = '#tab-owner-managers';
  api.switchTab('tab-dashboard');
  api.restoreAdminTabFromHash();
  check('manager refresh on an owner-only hash stays on the dashboard, silently',
    sectionShown('tab-dashboard'));
  api.setRole('owner');
  sandbox.window.location.hash = '#tab-profile-360';
  api.restoreAdminTabFromHash();
  check('the 360 profile is never hash-restored (excluded by design)',
    sectionShown('tab-dashboard') && !sectionShown('tab-profile-360'));
  sandbox.window.location.hash = '';
}

// --- toggleSidebar: desktop collapse + mobile drawer, executed -------
{
  const sidebar = registry.get('mainAppSidebar');
  const content = registry.get('mainContentArea');
  const backdrop = registry.get('sidebarBackdrop');
  sandbox.window.innerWidth = 1280;
  api.toggleSidebar();
  check('desktop toggle collapses sidebar + content and persists the preference',
    sidebar.classList.contains('sidebar-collapsed') && content.classList.contains('sidebar-collapsed') &&
    lsStore.get('alhuda_sidebar_collapsed') === 'true');
  api.toggleSidebar();
  check('desktop toggle expands again and persists that',
    !sidebar.classList.contains('sidebar-collapsed') && !content.classList.contains('sidebar-collapsed') &&
    lsStore.get('alhuda_sidebar_collapsed') === 'false');
  sandbox.window.innerWidth = 390;
  backdrop.classList.add('hidden');
  api.toggleSidebar();
  check('mobile toggle opens the drawer + shows the backdrop',
    sidebar.classList.contains('sidebar-mobile-open') && !backdrop.classList.contains('hidden'));
  api.toggleSidebar();
  check('mobile toggle closes the drawer + hides the backdrop',
    !sidebar.classList.contains('sidebar-mobile-open') && backdrop.classList.contains('hidden'));
  sandbox.window.innerWidth = 1280;
}

// --- The rail mirror script, extracted from index.html and executed --
{
  const fnPos = INDEX.indexOf('syncAdminRailActiveState');
  const scriptStart = INDEX.lastIndexOf('<script>', fnPos);
  const scriptEnd = INDEX.indexOf('</script>', fnPos);
  const scriptMatch = fnPos > -1 && scriptStart > -1 && scriptEnd > fnPos
    ? [null, INDEX.slice(scriptStart + '<script>'.length, scriptEnd)] : null;
  check('rail mirror script extractable from the real markup', !!scriptMatch);
  const railBtnStubs = RAIL.map(r => new FakeEl('', 'aui-rail-btn', { 'data-rail-tab': r.tab }));
  let observerCb = null;
  const railSandbox = {
    console,
    MutationObserver: class { constructor(cb) { observerCb = cb; } observe() {} },
    document: {
      getElementById: (id) => {
        if (id === 'adminMobileRail') {
          return { querySelectorAll: (sel) => (sel.includes('data-rail-tab') ? railBtnStubs : []) };
        }
        if (id === 'mainAppSidebar') {
          return {
            querySelector: (sel) => {
              if (!sel.includes('.sidebar-nav-btn.active')) return null;
              const b = navButtons.find(x => x.classList.contains('active'));
              return b ? { getAttribute: (k) => b.getAttribute(k) } : null;
            },
          };
        }
        return null;
      },
    },
  };
  vm.createContext(railSandbox);
  vm.runInContext(scriptMatch[1], railSandbox);
  // The script syncs once at boot: dashboard is the markup-active tab.
  check('rail mirror marks the dashboard rail button at boot',
    railBtnStubs.filter(b => b.classList.contains('active')).map(b => b.getAttribute('data-rail-tab'))
      .join() === 'tab-dashboard');
  api.switchTab('tab-salaries');
  observerCb();
  check('rail mirror follows the sidebar pill after a tab switch',
    railBtnStubs.filter(b => b.classList.contains('active')).map(b => b.getAttribute('data-rail-tab'))
      .join() === 'tab-salaries');
  api.switchTab('tab-dashboard');
}

console.log('---');
console.log(`admin-redesign-shell: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
