// Parent Portal flagship redesign (2026-11-07): the teacher/admin
// emerald-glass shell applied to parent.html. Interface only. This
// suite proves, against the REAL parent.html and its REAL inline
// functions:
//   1. the functional inventory survived: every shell id exists
//      exactly once (header children relocated into the sidebar's
//      bands, none dropped), the five tab sections and the five nav
//      buttons are unchanged in set and order, and the login view
//      region is BYTE-IDENTICAL to main @ d64a83c (PR #130's login
//      redesign — frozen for this build);
//   2. the flagship shell is present: glass sidebar with three
//      pinned bands (brand / scrolling nav / foot controls), the
//      white active pill merging into the content via radial
//      fillets, the invisible nav scrollbar, the mobile slim rail,
//      fixed full-height sidebar geometry (top/bottom insets, no
//      height:100vh pocket), and content offset that applies only
//      while the shell is visible;
//   3. the REAL switchPortalTab, executed in a vm over a fake DOM,
//      shows/hides exactly the same sections, lights exactly the
//      same sidebar pill, and writes the refresh-restore hash
//      (PR #120 semantics unchanged);
//   4. the ONE inline script this redesign adds (toggleParentSidebar
//      + the rail active-state mirror) behaves: desktop toggles the
//      collapsed rail class, mobile toggles the drawer class, and
//      the mirror lights the rail button matching the active pill;
//   5. the REAL renderParentAnnouncements still renders into the
//      new shell's dashboard (audience-filtered, max 3, PR #84);
//   6. the REAL openParentAnnotatedPages still hands a fixture
//      lesson's annotated pages to the shared viewer.
// Run from the repo root:  node test/parent-redesign-shell.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PARENT = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');

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
  // shell root + new chrome
  'parentTopNav', 'parentSidebar', 'parentMobileRail', 'parentBackdrop',
  // sidebar bands (relocated header children)
  'parentSubNavTabs', 'parentHeaderAuthControls', 'parentHeaderFamilyName',
  'portalStudentSelect', 'portalNavBookCount',
  // nav buttons
  'navBtn_dashboard', 'navBtn_library', 'navBtn_timetable',
  'navBtn_attendance', 'navBtn_fees',
  // content + dashboard anchors
  'parentMainPortalContent', 'parentAnnouncementsBanner',
  'heroWelcomeName', 'liveClassCard', 'btnJoinLiveMeeting',
  'parentLessonNotesContainer', 'portalLibraryGrid', 'weeklyScheduleGrid',
  'attendanceTableBody', 'feeInvoicesTableBody',
  // modals
  'modalParentBookReader', 'modalFeeInvoice', 'modalLeaveRequest',
  // login view (frozen — ids kept)
  'parentLoginView', 'parentLoginUsername', 'parentLoginPassword',
  'parentPassToggleIcon', 'parentLoginErrorMsg', 'parentLoginErrorText',
  'parentRoleMismatchBanner', 'btnSubmitParentLogin',
];
for (const id of SHELL_IDS) {
  check(`shell id exists exactly once: ${id}`, count(PARENT, `id="${id}"`) === 1,
    'count=' + count(PARENT, `id="${id}"`));
}

// Login region byte-identical to main @ d64a83c (post PR #130). The
// hash covers everything from the login section comment to the main
// content comment; it may only change when the login commission
// itself changes the view.
const LOGIN_REGION_SHA256 = 'a12d097ca1707e0a5e6a8c8df39a6cd4eec64bf0fbdfaa6bf9f1a7ad888f63ea';
{
  const a = PARENT.indexOf('<!-- ================= 1. PARENT / STUDENT LOGIN SCREEN');
  const b = PARENT.indexOf('<!-- ================= 2. MAIN CONTENT WRAPPER');
  check('login region anchors found', a > -1 && b > a);
  const region = PARENT.slice(a, b);
  const hash = crypto.createHash('sha256').update(region).digest('hex');
  check('login view region is byte-identical to main (frozen)', hash === LOGIN_REGION_SHA256, hash);
  check('no pui- hooks leak into the login region', !region.includes('pui-'));
}

// Tab sections: set + order in the markup.
const SECTION_IDS = [...PARENT.matchAll(/<section id="(tab-[^"]+)" class="portal-tab-content/g)].map(m => m[1]);
check('tab sections set + order unchanged',
  JSON.stringify(SECTION_IDS) === JSON.stringify(['tab-dashboard', 'tab-library', 'tab-timetable', 'tab-attendance', 'tab-fees']),
  JSON.stringify(SECTION_IDS));

// Nav buttons: set + order + handlers + the phase3 44px pin shape.
const NAV_SLICE_START = PARENT.indexOf('id="parentSubNavTabs"');
const NAV_SLICE_END = PARENT.indexOf('id="parentHeaderAuthControls"');
const NAV_SLICE = PARENT.slice(NAV_SLICE_START, NAV_SLICE_END);
const NAV_BTNS = [...NAV_SLICE.matchAll(/id="(navBtn_[^"]+)"/g)].map(m => m[1]);
check('sidebar nav buttons set + order unchanged',
  JSON.stringify(NAV_BTNS) === JSON.stringify(['navBtn_dashboard', 'navBtn_library', 'navBtn_timetable', 'navBtn_attendance', 'navBtn_fees']),
  JSON.stringify(NAV_BTNS));
for (const tab of ['tab-dashboard', 'tab-library', 'tab-timetable', 'tab-attendance', 'tab-fees']) {
  check(`sidebar nav keeps onclick switchPortalTab('${tab}')`,
    NAV_SLICE.includes(`onclick="switchPortalTab('${tab}')"`));
}
check('all five sidebar nav buttons keep portal-nav-btn + min-h-[44px] (phase3 pin shape)',
  count(NAV_SLICE, 'portal-nav-btn') >= 5 &&
  (NAV_SLICE.match(/portal-nav-btn[^"]*min-h-\[44px\]/g) || []).length === 5);
check('leave action keeps openLeaveRequestModal() in the nav band',
  NAV_SLICE.includes('pui-leave-btn') && NAV_SLICE.includes('onclick="openLeaveRequestModal()"'));
check('book count badge id rides inside the library pill',
  NAV_SLICE.indexOf('id="portalNavBookCount"') > NAV_SLICE.indexOf('id="navBtn_library"'));

// Sidebar bands in order: brand < nav < foot controls.
const ASIDE_START = PARENT.indexOf('<aside id="parentSidebar"');
const ASIDE = PARENT.slice(ASIDE_START, PARENT.indexOf('</aside>', ASIDE_START));
check('sidebar is the glass shell',
  PARENT.includes('<aside id="parentSidebar" class="pui-glass flex flex-col overflow-hidden">'));
check('sidebar bands in order: brand < subnav < header controls',
  ASIDE.indexOf('AL-HUDA') > -1 &&
  ASIDE.indexOf('AL-HUDA') < ASIDE.indexOf('id="parentSubNavTabs"') &&
  ASIDE.indexOf('id="parentSubNavTabs"') < ASIDE.indexOf('id="parentHeaderAuthControls"'));
check('brand medallion click returns to the dashboard',
  ASIDE.includes(`onclick="switchPortalTab('tab-dashboard')"`));
check('student selector keeps its handler inside the foot band',
  ASIDE.includes('id="portalStudentSelect"') && ASIDE.includes('onchange="switchStudentAccount(this.value)"'));
check('logout keeps handleParentLogout() in the foot band',
  ASIDE.includes('onclick="handleParentLogout()"'));
check('sidebar close (mobile) + collapse (desktop) buttons both call toggleParentSidebar()',
  count(ASIDE, 'onclick="toggleParentSidebar()"') === 2);

// Mobile rail: same five destinations + leave + logout.
const RAIL_START = PARENT.indexOf('id="parentMobileRail"');
const RAIL = PARENT.slice(RAIL_START, PARENT.indexOf('id="parentBackdrop"', RAIL_START));
const RAIL_TABS = [...RAIL.matchAll(/data-rail-tab="([^"]+)"/g)].map(m => m[1]);
check('rail destinations set + order match the sidebar',
  JSON.stringify(RAIL_TABS) === JSON.stringify(['tab-dashboard', 'tab-library', 'tab-timetable', 'tab-attendance', 'tab-fees']),
  JSON.stringify(RAIL_TABS));
for (const tab of RAIL_TABS) {
  check(`rail button calls switchPortalTab('${tab}')`, RAIL.includes(`onclick="switchPortalTab('${tab}')"`));
}
check('rail carries the menu, leave and logout actions',
  RAIL.includes('onclick="toggleParentSidebar()"') &&
  RAIL.includes('onclick="openLeaveRequestModal()"') &&
  RAIL.includes('onclick="handleParentLogout()"'));

// Slim top bar inside the content column: toggle + tagline + Library.
const MAIN_START = PARENT.indexOf('id="parentMainPortalContent"');
const TOPBAR = PARENT.slice(MAIN_START, PARENT.indexOf('id="tab-dashboard"', MAIN_START));
check('top bar holds the sidebar toggle, the portal tagline and the Library shortcut',
  TOPBAR.includes('pui-topbar') &&
  TOPBAR.includes('aria-label="Toggle navigation sidebar"') &&
  TOPBAR.includes('onclick="toggleParentSidebar()"') &&
  TOPBAR.includes('Live Learning, Lesson Progress') &&
  TOPBAR.includes(`onclick="switchPortalTab('tab-library')"`));

// Announcements container still lives at the top of the dashboard.
{
  const dashStart = PARENT.indexOf('id="tab-dashboard"');
  const dashSlice = PARENT.slice(dashStart, PARENT.indexOf('id="tab-library"', dashStart));
  check('announcements banner is inside the dashboard section',
    dashSlice.includes('id="parentAnnouncementsBanner"'));
}

// ---------------------------------------------------------------------
// Part B — flagship CSS pins
// ---------------------------------------------------------------------
const PUI_START = PARENT.indexOf('FLAGSHIP REDESIGN (2026-11-07');
const PUI_CSS = PARENT.slice(PUI_START, PARENT.indexOf('</style>', PUI_START));
check('glass sidebar gradient present (pui-glass)', PUI_CSS.includes('.pui-glass') && PUI_CSS.includes('linear-gradient(168deg, #0e6e4b'));
check('sidebar geometry: fixed with top/bottom insets, width 292px',
  /#parentSidebar\s*\{[^}]*position: fixed;[^}]*top: 0;[^}]*bottom: 0;[^}]*width: 292px;/.test(PUI_CSS));
check('sidebar geometry: NO height:100vh declaration anywhere in the flagship block (pocket trap)',
  !/height:\s*100vh\s*[;}]/.test(PUI_CSS));
check('merging active pill: white pill + radial fillets',
  PUI_CSS.includes('#parentSidebar .portal-nav-btn.active') &&
  PUI_CSS.includes('border-radius: 999px 0 0 999px') &&
  PUI_CSS.includes('.portal-nav-btn.active::before') &&
  PUI_CSS.includes('radial-gradient(circle at 0 0') &&
  PUI_CSS.includes('radial-gradient(circle at 0 100%'));
check('nav scrollbar is not painted', PUI_CSS.includes('.pui-nav-scroll') && PUI_CSS.includes('scrollbar-width: none'));
check('content offset only while the shell is visible (sibling selector)',
  PUI_CSS.includes('#parentTopNav:not(.hidden) ~ #parentMainPortalContent') &&
  PUI_CSS.includes('#parentTopNav:not(.hidden) ~ footer.pui-footer') &&
  PUI_CSS.includes('margin-left: 292px') && PUI_CSS.includes('margin-left: 84px'));
check('mobile drawer: off-canvas transform + drawer-open state + backdrop state',
  PUI_CSS.includes('transform: translateX(-105%)') &&
  PUI_CSS.includes('#parentTopNav.pui-drawer-open #parentSidebar') &&
  PUI_CSS.includes('#parentTopNav.pui-drawer-open #parentBackdrop'));
check('desktop collapse: 92px rail + collapsed content offset',
  PUI_CSS.includes('#parentTopNav.pui-collapsed #parentSidebar { width: 92px; }') &&
  PUI_CSS.includes('#parentTopNav.pui-collapsed:not(.hidden) ~ #parentMainPortalContent'));
check('rail buttons: glass circles with a white active state',
  PUI_CSS.includes('.pui-rail-btn') && PUI_CSS.includes('.pui-rail-btn.active'));
check('parent portal keeps NO body zoom (stays 100%)',
  !/body\s*\{[^}]*zoom/.test(PARENT));
check('footer carries the pui-footer offset hook',
  PARENT.includes('<footer class="pui-footer bg-white'));

// The one added inline script.
check('chrome script: toggleParentSidebar defined exactly once',
  count(PARENT, 'function toggleParentSidebar()') === 1);
check('chrome script: rail mirror defined exactly once',
  count(PARENT, 'function syncParentRailActiveState()') === 1);

// ---------------------------------------------------------------------
// Part C — executed checks: real switchPortalTab + chrome script
// ---------------------------------------------------------------------
function fakeEl(id, classes = [], attrs = {}) {
  const set = new Set(classes);
  return {
    id, innerHTML: '', _attrs: { ...attrs },
    classList: {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !set.has(c) : !!force;
        if (on) set.add(c); else set.delete(c);
        return on;
      },
      contains: c => set.has(c),
    },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = v; },
  };
}
function fakeBrowser(pathname, hash) {
  const calls = { replace: [], push: [] };
  const loc = { pathname, hash, href: 'https://x' + pathname + hash };
  const history = {
    state: null,
    replaceState: (s, t, url) => { calls.replace.push(url); loc.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; },
    pushState: (s, t, url) => { calls.push.push(url); },
  };
  return { calls, loc, history };
}

const P_TABS = ['tab-dashboard', 'tab-library', 'tab-timetable', 'tab-attendance', 'tab-fees'];
const TAB_CHUNK = (() => {
  const s = PARENT.indexOf('const PARENT_PORTAL_TABS');
  const e = PARENT.indexOf('function filterPortalCategory');
  return PARENT.slice(s, e);
})();
const CHROME_CHUNK = (() => {
  const s = PARENT.indexOf('function toggleParentSidebar()');
  const e = PARENT.indexOf('</script>', s);
  return PARENT.slice(s, e);
})();
check('executed chunks extracted (tab engine + chrome script)',
  TAB_CHUNK.includes('function switchPortalTab') && CHROME_CHUNK.includes('syncParentRailActiveState'));

function makeWorld(hash = '') {
  const sections = P_TABS.map(id => fakeEl(id, id === 'tab-dashboard' ? ['portal-tab-content'] : ['portal-tab-content', 'hidden']));
  const navBtns = P_TABS.map(id => fakeEl('navBtn_' + id.replace('tab-', ''), id === 'tab-dashboard' ? ['portal-nav-btn', 'active'] : ['portal-nav-btn']));
  const railBtns = P_TABS.map(id => fakeEl('', ['pui-rail-btn'], { 'data-rail-tab': id }));
  const root = fakeEl('parentTopNav', ['hidden']);
  const navBox = { querySelector: sel => (sel === '.portal-nav-btn.active' ? navBtns.find(b => b.classList.contains('active')) || null : null) };
  const railBox = { querySelectorAll: sel => (sel === '[data-rail-tab]' ? railBtns : []) };
  const byId = { parentTopNav: root, parentSubNavTabs: navBox, parentMobileRail: railBox };
  sections.forEach(s => { byId[s.id] = s; });
  navBtns.forEach(b => { byId[b.id] = b; });
  const browser = fakeBrowser('/parent', hash);
  const observers = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
  }
  const document = {
    title: 'Parent Portal',
    getElementById: id => byId[id] || null,
    querySelectorAll: sel => (sel === '.portal-tab-content' ? sections : sel === '.portal-nav-btn' ? navBtns : []),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, document,
    MutationObserver: FakeMutationObserver,
    renderPortalLibrary: () => {},
  };
  sandbox.window = {
    document, history: browser.history, location: browser.loc,
    innerWidth: 1280, addEventListener() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(TAB_CHUNK, sandbox);
  vm.runInContext(CHROME_CHUNK, sandbox);
  return {
    sandbox, sections, navBtns, railBtns, root, browser,
    fireObservers: () => observers.forEach(o => o.cb()),
  };
}
const visible = w => w.sections.filter(s => !s.classList.contains('hidden')).map(s => s.id);
const activeNav = w => w.navBtns.filter(b => b.classList.contains('active')).map(b => b.id);
const activeRail = w => w.railBtns.filter(b => b.classList.contains('active')).map(b => b.getAttribute('data-rail-tab'));

for (const tab of P_TABS) {
  const w = makeWorld('');
  vm.runInContext(`switchPortalTab('${tab}')`, w.sandbox);
  check(`switch to ${tab}: only that section visible`, JSON.stringify(visible(w)) === JSON.stringify([tab]), JSON.stringify(visible(w)));
  check(`switch to ${tab}: exactly one active pill (navBtn_${tab.replace('tab-', '')})`,
    JSON.stringify(activeNav(w)) === JSON.stringify(['navBtn_' + tab.replace('tab-', '')]), JSON.stringify(activeNav(w)));
  check(`switch to ${tab}: hash recorded via replaceState only`,
    w.browser.calls.replace.length === 1 && w.browser.calls.replace[0] === '/parent#' + tab && w.browser.calls.push.length === 0,
    JSON.stringify(w.browser.calls));
  w.fireObservers();
  check(`switch to ${tab}: rail mirror lights only the matching rail button`,
    JSON.stringify(activeRail(w)) === JSON.stringify([tab]), JSON.stringify(activeRail(w)));
}

{ // hash restore still reopens the tab inside the new shell
  const w = makeWorld('#tab-attendance');
  vm.runInContext('restoreParentTabFromHash()', w.sandbox);
  check('restore #tab-attendance: attendance visible + pill lit',
    JSON.stringify(visible(w)) === JSON.stringify(['tab-attendance']) &&
    JSON.stringify(activeNav(w)) === JSON.stringify(['navBtn_attendance']));
  w.fireObservers();
  check('restore #tab-attendance: rail mirror follows',
    JSON.stringify(activeRail(w)) === JSON.stringify(['tab-attendance']));
}

{ // the chrome toggle: desktop collapses, mobile opens the drawer
  const w = makeWorld('');
  vm.runInContext('toggleParentSidebar()', w.sandbox); // innerWidth 1280
  check('toggle at desktop width: pui-collapsed toggled on, drawer class untouched',
    w.root.classList.contains('pui-collapsed') && !w.root.classList.contains('pui-drawer-open'));
  vm.runInContext('toggleParentSidebar()', w.sandbox);
  check('toggle again at desktop width: pui-collapsed removed',
    !w.root.classList.contains('pui-collapsed'));
  w.sandbox.window.innerWidth = 390;
  vm.runInContext('toggleParentSidebar()', w.sandbox);
  check('toggle at mobile width: pui-drawer-open toggled on, collapse class untouched',
    w.root.classList.contains('pui-drawer-open') && !w.root.classList.contains('pui-collapsed'));
}

// ---------------------------------------------------------------------
// Part D — executed: announcements still render in the new shell
// ---------------------------------------------------------------------
{
  const s = PARENT.indexOf('function annEscP');
  const e = PARENT.indexOf('async function loadParentAnnouncements');
  const chunk = PARENT.slice(s, e);
  check('announcements chunk extracted', chunk.includes('function renderParentAnnouncements'));
  const banner = fakeEl('parentAnnouncementsBanner', ['hidden']);
  const sandbox = {
    console,
    document: { getElementById: id => (id === 'parentAnnouncementsBanner' ? banner : null) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(chunk, sandbox);
  const fixture = [
    { target: 'students', title: 'Portal Fixture One', message: 'First notice', created_at: '2026-11-07' },
    { target: 'teachers', title: 'Staff Only', message: 'Must not render', created_at: '2026-11-07' },
    { target: 'both', title: 'Portal Fixture Two', message: 'Second notice', created_at: '2026-11-07' },
    { target: 'students', title: 'Portal Fixture Three', message: 'Third notice', created_at: '2026-11-07' },
    { target: 'students', title: 'Portal Fixture Four', message: 'Fourth is over the cap', created_at: '2026-11-07' },
  ];
  vm.runInContext(`renderParentAnnouncements(${JSON.stringify(fixture)})`, sandbox);
  check('announcements: banner unhidden with audience-filtered items',
    !banner.classList.contains('hidden') &&
    banner.innerHTML.includes('Official Announcements (4)') &&
    banner.innerHTML.includes('Portal Fixture One') &&
    !banner.innerHTML.includes('Staff Only'));
  check('announcements: capped at 3 rendered items (PR #84)',
    banner.innerHTML.includes('Portal Fixture Three') &&
    !banner.innerHTML.includes('Portal Fixture Four'));
  vm.runInContext('renderParentAnnouncements([])', sandbox);
  check('announcements: empty list hides the banner again',
    banner.classList.contains('hidden') && banner.innerHTML === '');
}

// ---------------------------------------------------------------------
// Part E — executed: annotated-pages viewer entry still fires
// ---------------------------------------------------------------------
{
  const s = PARENT.indexOf('function openParentAnnotatedPages');
  const e = PARENT.indexOf('async function openParentSavedLessonPage');
  const chunk = PARENT.slice(s, e);
  check('annotated opener chunk extracted', chunk.includes('openAnnotatedPagesViewer'));
  const viewerCalls = [];
  const sandbox = {
    console,
    _LH_PARENT_VISIBLE_LOGS: [
      {
        _lhEntry: {
          annotatedPages: [
            { key: 'annotated/FAM-004/p1.webp', para: 1, page: 3 },
            { key: 'annotated/FAM-004/p2.webp', para: 1, page: 4 },
          ],
          imageKey: 'lesson-images/FAM-004/main.webp',
        },
        lesson_notes: null,
      },
      {
        _lhEntry: null,
        lesson_notes: JSON.stringify({ annotated_pages: [{ key: 'annotated/FAM-004/p9.webp', page: 9 }] }),
      },
    ],
    window: {
      LessonHistory: {
        openAnnotatedPagesViewer: (pages, opts) => viewerCalls.push({ pages, opts }),
        normalizeAnnotatedPages: raw => (Array.isArray(raw) ? raw : []),
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(chunk, sandbox);
  vm.runInContext('openParentAnnotatedPages(0)', sandbox);
  check('annotated viewer: opens with the entry pages + image key',
    viewerCalls.length === 1 && viewerCalls[0].pages.length === 2 &&
    viewerCalls[0].opts.imageKey === 'lesson-images/FAM-004/main.webp',
    JSON.stringify(viewerCalls));
  vm.runInContext('openParentAnnotatedPages(1)', sandbox);
  check('annotated viewer: raw lesson_notes fallback also opens the viewer',
    viewerCalls.length === 2 && viewerCalls[1].pages.length === 1 &&
    viewerCalls[1].pages[0].key === 'annotated/FAM-004/p9.webp',
    JSON.stringify(viewerCalls));
}

console.log('---');
console.log(`parent-redesign-shell: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
