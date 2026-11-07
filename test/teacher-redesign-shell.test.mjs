// Teacher Portal flagship redesign (2026-11-06): the re-skin must be
// interface-only. This suite proves, against the REAL teacher.html:
//   1. every pre-existing tab section still exists (exactly once) and
//      the reparented Salaries section now lives inside the content
//      column (cockpit) alongside the other sections;
//   2. the REAL switchTeacherPortalTab, extracted and executed in a vm
//      over a fake DOM built from the REAL markup (ids + initial
//      hidden state), shows/hides exactly the same sections per tab
//      as before the redesign — for all six tabs;
//   3. the sidebar buttons AND the new mobile rail buttons carry
//      onclick handlers that call the same switchTeacherPortalTab with
//      the same tab names (arguments are read from the real markup and
//      executed), and the active state lands on the matching sidebar
//      pill and rail button;
//   4. the mobile drawer mechanics (toggleTeacherSidebar) still work
//      on the relocated menu button's target elements;
//   5. the announcements banner, overdue-class reminder and the live
//      salary accrual card still populate through their real render
//      functions (accrual figures come from a fixture provider — the
//      real compile pipeline is covered by salary-portal-accrual);
//   6. Today's Classes rows still render through the real renderer
//      with working Start Class / Complete Class handlers, avatar
//      initials, and the ${actionButtons} slot intact.
//   7. the sidebar Salary group (owner 2026-11-07): a "Salary" parent
//      with exactly two sub-options — Salary Slips is the renamed
//      former "Previous Salaries" door (same button id + tab, so the
//      matrix above covers it unchanged) and Request Advance Salary
//      runs the REAL openTeacherAdvanceSalaryRequest, which must land
//      on the salaries tab with the advance request card targeted.
// Run from the repo root:  node test/teacher-redesign-shell.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
// escapeHtml / escapeJsAttr are real page functions too — they live in
// js/security.js, which teacher.html loads as an external script.
const SECURITY_JS = fs.readFileSync(path.join(REPO_ROOT, 'js/security.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('PASS | ' + name); }
  else { failed++; console.log('FAIL | ' + name + (detail ? ' :: ' + detail : '')); }
}

// ---------------------------------------------------------------------
// Part A — markup inventory on the real file
// ---------------------------------------------------------------------
const SECTION_IDS = [
  'sectionTeacherKpiGrid', 'sectionTeacherToday', 'sectionTeacherStudentList',
  'sectionTeacherLessonHistory', 'sectionTeacherTrials', 'sectionTeacherSalaries',
];
for (const id of SECTION_IDS) {
  check(`section exists exactly once: ${id}`,
    TEACHER.split(`id="${id}"`).length - 1 === 1);
}

// Tag-stack parse: ancestry of key elements in the real markup.
function ancestryOf(targetId) {
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;
  const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);
  const stack = [];
  let m;
  while ((m = tagRe.exec(TEACHER)) !== null) {
    const [, close, tag, attrs] = m;
    if (VOID.has(tag)) continue;
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const id = (attrs.match(/id="([^"]+)"/) || [])[1];
    if (id === targetId) return stack.map(s => ({ tag: s.tag, id: s.id, cls: s.cls }));
    stack.push({ tag, id, cls: (attrs.match(/class="([^"]*)"/) || [])[1] || '' });
  }
  return null;
}
const salAnc = ancestryOf('sectionTeacherSalaries');
check('salaries section is inside the cockpit content column',
  !!salAnc && salAnc.some(a => a.cls.includes('flex-1 w-full min-w-0')),
  JSON.stringify(salAnc && salAnc.map(a => a.id || a.cls.slice(0, 30))));
const railAnc = ancestryOf('teacherMobileRail');
check('mobile rail lives inside #dashboardView (hides with login state)',
  !!railAnc && railAnc.some(a => a.id === 'dashboardView'));

// Button wiring read from the real markup.
function buttonOnclickById(id) {
  const m = TEACHER.match(new RegExp(`<button id="${id}"[^>]*onclick="([^"]*)"`));
  return m ? m[1] : null;
}
const NAVMAP = {
  dashboard: 'sbNavDashboard', today: 'sbNavToday', students: 'sbNavStudents',
  history: 'sbNavHistory', trials: 'sbNavTrials', salaries: 'sbNavSalaries',
};
for (const [tab, id] of Object.entries(NAVMAP)) {
  const oc = buttonOnclickById(id);
  check(`sidebar button #${id} calls switchTeacherPortalTab('${tab}')`,
    !!oc && oc.includes(`switchTeacherPortalTab('${tab}')`), String(oc));
}
const railButtons = [...TEACHER.matchAll(/<button[^>]*data-rail-tab="(\w+)"[^>]*onclick="([^"]*)"/g)]
  .map(m => ({ tab: m[1], onclick: m[2] }));
check('mobile rail has one button per tab (6)', railButtons.length === 6,
  JSON.stringify(railButtons.map(r => r.tab)));
for (const tab of Object.keys(NAVMAP)) {
  const rb = railButtons.find(r => r.tab === tab);
  check(`rail button [${tab}] calls switchTeacherPortalTab('${tab}')`,
    !!rb && rb.onclick.includes(`switchTeacherPortalTab('${tab}')`),
    rb ? rb.onclick : 'missing');
}

// Flagship CSS present (merge pill + fillets + rail buttons).
check('active pill merge CSS present (flush pill + radial fillets)',
  TEACHER.includes('border-radius: 999px 0 0 999px') &&
  TEACHER.includes('radial-gradient(circle at 0 0') &&
  TEACHER.includes('radial-gradient(circle at 0 100%'));
check('preset hooks preserved: overdue banner, announcements, salary body, clock, session badge',
  ['id="teacherOverdueClassReminder"', 'id="teacherAnnouncementsBanner"',
   'id="tSalSummaryBody"', 'id="liveClock"', 'id="teacherHeaderBadge"',
   'id="headerTeacherName"'].every(s => TEACHER.includes(s)));
check('hamburger contract kept (id + handler + aria-label)',
  TEACHER.includes('btnToggleTeacherSidebar" onclick="toggleTeacherSidebar()" aria-label="Toggle navigation sidebar"'));

// ---------------------------------------------------------------------
// Part A2 — owner marks (2026-11-06): literal removals + scale/junction
// ---------------------------------------------------------------------
// (1) Schedule Student removed root-and-branch; shared neighbours stay.
check('owner marks: no Schedule Student affordance, handler or modal remains',
  ['Schedule Student', 'openTeacherAddScheduleModal', 'submitTeacherAddScheduleSlot',
   'modalTeacherAddScheduleSlot', 'sbNavAddSchedule', 'TeacherAddSchedule']
    .every(s => !TEACHER.includes(s)));
check('owner marks: reschedule (Change Time) and shared slot helpers survive',
  TEACHER.includes('openTimeChangeRequestModal') &&
  TEACHER.includes('function getTeacherSlotDurationMins') &&
  TEACHER.includes('function parseTeacherTimeToMinutes'));
// (2) Hero declutter: description + Zoom chip gone; kept pieces stay.
check('owner marks: hero description paragraph and Zoom Configured chip removed',
  !TEACHER.includes('operations cockpit') && !TEACHER.includes('heroTeacherZoomStatus') &&
  !TEACHER.includes('Zoom Configured'));
check('owner marks: hero keeps greeting, shift chip, status chip, refresh',
  TEACHER.includes('id="heroTeacherName"') && TEACHER.includes('id="heroTeacherShift"') &&
  TEACHER.includes('id="heroTeacherStatus"') && TEACHER.includes('loadTeacherPortalData()'));
// (3) Live/next-class banner card removed; the PR #97 overdue reminder
// is a different element and stays (behaviour proven in Part C/D).
check('owner marks: live/next-class status banner removed entirely',
  !TEACHER.includes('liveClassAlertBanner') && !TEACHER.includes('ALL SESSIONS DONE') &&
  TEACHER.includes('id="teacherOverdueClassReminder"'));
// (4) KPI captions removed; titles + number elements stay.
check('owner marks: KPI caption lines removed, stat numbers stay',
  ['Active Assigned Students', 'Scheduled Sessions Today', 'Marked Present Today',
   'Upcoming Slots Today', 'id="statAssignedStudentsSub"']
    .every(s => !TEACHER.includes(s)) &&
  ['id="statAssignedStudents"', 'id="statTodayClasses"', 'id="statCompleted"', 'id="statRemaining"']
    .every(s => TEACHER.includes(s)));
// (7) All four KPI cards clickable + keyboard-activatable.
check('owner marks: KPI cards wired to their drill-downs',
  TEACHER.includes('onclick="switchTeacherPortalTab(\'students\')"') &&
  TEACHER.includes('onclick="showTeacherTodayKpi(\'all\')"') &&
  TEACHER.includes('onclick="showTeacherTodayKpi(\'completed\')"') &&
  TEACHER.includes('onclick="showTeacherTodayKpi(\'remaining\')"'));
check('owner marks: KPI cards carry button semantics + keyboard activation',
  (TEACHER.match(/role="button" tabindex="0" onkeydown=/g) || []).length >= 4);
// (5) Junction: the sidebar scrollbar is not painted (scrolling itself
// is browser-verified); (6) global scale 77% on body.
check('owner marks: sidebar scrollbar hidden at the junction',
  TEACHER.includes('aside#teacherSidebar .custom-sidebar-scroll') &&
  TEACHER.includes('scrollbar-width: none') &&
  TEACHER.includes('aside#teacherSidebar .custom-sidebar-scroll::-webkit-scrollbar'));
check('owner marks: portal scale is 85% (body zoom)',
  TEACHER.includes('body { zoom: 0.85; }'));
// (Was 0.77 in PR #117; owner 2026-11-07: 77% proved a touch too
// small, stepped up to 85% — "bit bigger, not too much".)
// Full-height fixed sidebar (owner 2026-11-07, "no pocket style"):
// the old desktop sidebar was sticky + height:100vh, which under the
// body zoom rendered at only zoom x viewport height. The aside is
// now fixed with top/bottom insets at every size, the nav groups
// live in their own scroll band, and the foot is pinned below it.
check('sidebar fix: aside is fixed full-height, sticky/100vh gone',
  TEACHER.includes('class="tui-sidebar-glass fixed inset-y-0') &&
  !TEACHER.includes('lg:sticky') && !TEACHER.includes('lg:h-screen'));
check('sidebar fix: content column offset matches sidebar widths',
  TEACHER.includes('.tui-main-col') &&
  TEACHER.includes('margin-left: 292px') &&
  TEACHER.includes('aside#teacherSidebar.is-collapsed + .tui-main-col') &&
  TEACHER.includes('margin-left: 5.75rem'));
check('sidebar fix: nav band scrolls, brand and foot are pinned bands',
  TEACHER.includes('class="sidebar-nav-scroll flex-1 min-h-0 overflow-y-auto custom-sidebar-scroll') &&
  TEACHER.indexOf('sidebar-nav-scroll') < TEACHER.indexOf('id="sbNavSalaries"') &&
  TEACHER.indexOf('id="sbNavSalaries"') < TEACHER.indexOf('/scrolling nav band') &&
  TEACHER.indexOf('/scrolling nav band') < TEACHER.indexOf('id="sbTeacherNameDisplay"'));

// ---------------------------------------------------------------------
// Part A3 — Salary group (owner 2026-11-07). Purely additive checks:
// the group reuses the existing 'salaries' tab and button id, so the
// NAVMAP / matrix checks above needed NO changes — the reasons each
// new check exists are recorded inline.
// ---------------------------------------------------------------------
// The parent exists as a labelled header row (icon + "Salary"), sits
// where the old standalone item sat (after Trial Classes, inside the
// nav band), and precedes both sub-options.
check('salary group: "Salary" parent header present in the sidebar',
  TEACHER.includes('class="sidebar-salary-parent"') &&
  TEACHER.includes('<span class="sidebar-text truncate">Salary</span>') &&
  TEACHER.includes('fa-money-check-dollar'));
check('salary group: parent + sub-options sit after Trial Classes, in order',
  TEACHER.indexOf('id="sbNavTrials"') < TEACHER.indexOf('class="sidebar-salary-parent"') &&
  TEACHER.indexOf('class="sidebar-salary-parent"') < TEACHER.indexOf('id="sbNavSalaries"') &&
  TEACHER.indexOf('id="sbNavSalaries"') < TEACHER.indexOf('id="sbNavAdvanceSalary"') &&
  TEACHER.indexOf('id="sbNavAdvanceSalary"') < TEACHER.indexOf('/scrolling nav band'));
// Salary Slips is the renamed door: same button, label now "Salary
// Slips", sub-option styling hooks present; the old standalone
// sidebar label is gone (the section's own header text
// "Previous Salaries & Compensation" is page content, not the
// sidebar item, and correctly stays).
check('salary group: slips sub-option is the renamed former door',
  TEACHER.includes('<span class="sidebar-text truncate">Salary Slips</span>') &&
  !TEACHER.includes('<span class="sidebar-text truncate">Previous Salaries</span>') &&
  /<button id="sbNavSalaries"[^>]*class="[^"]*sidebar-sub-btn/.test(TEACHER));
// The Advance sub-option is wired to the real opener (executed in
// Part C), styled as a sub-option, and hidden on the collapsed rail
// (sidebar/drawer-only by design; the rail keeps the slips icon).
const advBtnOnclick = buttonOnclickById('sbNavAdvanceSalary');
check('salary group: advance sub-option wired to the real opener',
  !!advBtnOnclick && advBtnOnclick.includes('openTeacherAdvanceSalaryRequest()'),
  String(advBtnOnclick));
check('salary group: collapsed rail hides parent + advance sub-option',
  TEACHER.includes('aside#teacherSidebar.is-collapsed .sidebar-salary-parent') &&
  TEACHER.includes('aside#teacherSidebar.is-collapsed .sidebar-sub-advance'));
// The opener's target: the existing Batch B advance request card,
// given an anchor id (exactly once) inside the salaries section.
check('salary group: advance request card anchor exists once, inside the salaries section',
  TEACHER.split('id="tAdvanceRequestCard"').length - 1 === 1 &&
  (ancestryOf('tAdvanceRequestCard') || []).some(a => a.id === 'sectionTeacherSalaries'));
check('salary group: the existing advance form pieces are untouched',
  TEACHER.includes('id="tAdvPeriod"') && TEACHER.includes('id="tAdvSubmitBtn"') &&
  TEACHER.includes("onclick=\"submitTeacherAdvanceRequest()\"") &&
  TEACHER.includes('id="tAdvMyList"'));

// ---------------------------------------------------------------------
// Part B — fake DOM built from the REAL markup (ids + initial classes)
// ---------------------------------------------------------------------
class FakeEl {
  constructor(id, classAttr, attrs) {
    this.id = id;
    this._set = new Set(String(classAttr || '').split(/\s+/).filter(Boolean));
    this._attrs = attrs || {};
    this.style = {};
    this.innerHTML = '';
    this.innerText = '';
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
  scrollIntoView() {}
}
const registry = new Map();
for (const m of TEACHER.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const tag = m[0];
  const cls = (tag.match(/class="([^"]*)"/) || [])[1] || '';
  const rail = (tag.match(/data-rail-tab="([^"]+)"/) || [])[1];
  const attrs = rail ? { 'data-rail-tab': rail } : {};
  if (!registry.has(m[2])) registry.set(m[2], new FakeEl(m[2], cls, attrs));
}
// Rail buttons carry no ids, so the id-registry misses them; build
// their stubs from the markup-parsed rail button list (Part A) instead.
const railEls = railButtons.map(r => new FakeEl('', 'tui-rail-btn', { 'data-rail-tab': r.tab }));
const documentStub = {
  getElementById: (id) => registry.get(id) || null,
  querySelectorAll: (sel) => (sel.includes('data-rail-tab') ? railEls : []),
};

// ---------------------------------------------------------------------
// Part C — execute the REAL functions in a vm
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
const sandbox = {
  console,
  document: documentStub,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  setTimeout: () => 0, clearTimeout: () => {},
  // Recorders for the data loaders the switch function triggers.
  renderTeacherStudentListTable: () => calls.push('renderStudents'),
  renderTeacherLessonHistory: () => calls.push('renderHistory'),
  loadTeacherTrialsData: () => calls.push('loadTrials'),
  loadTeacherPreviousSalaries: () => calls.push('loadSalaries'),
  lmsNotify: () => {},
  // Fixture providers for the salary accrual card gate (the real
  // compile pipeline itself is covered by salary-portal-accrual).
  compileOwnCurrentMonthAccrual: () => ({
    accrual: {
      grossEarned: 10000, remaining: 15000, totalSlots: 20,
      daysElapsed: 12, daysInMonth: 30, dailyAccrual: 833.33,
      asOf: '2026-11-12',
    },
    baseSubtotal: 25000, rateLines: ['Quran Reading PKR 2,200/slot'],
  }),
  resolveAssignmentRate: () => 0,
  assignmentSegmentProration: () => 0,
  payrollFormatSlots: (n) => String(n),
  CourseCatalogue: { fromServer: () => true },
  Assignments: {},
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 390;
vm.createContext(sandbox);
const code = `
  let CURRENT_TEACHER = { id: 'TCH-FIX', name: 'Fixture Teacher' };
  let CURRENT_TEACHER_TAB = 'dashboard';
  let TODAY_CLASSES = [];
  let TEACHER_TODAY_FILTER = 'all';
  let _teacherClassesDegraded = null;
  let _overdueReminderSnoozedUntil = 0;
  const TEACHER_REMINDER_SNOOZE_MS = 120000;
  ${extractFunction(SECURITY_JS, 'escapeHtml')}
  ${extractFunction(SECURITY_JS, 'escapeJsAttr')}
  ${extractFunction(TEACHER, 'annEscT')}
  ${extractFunction(TEACHER, 'getPktNowParts')}
  ${extractFunction(TEACHER, 'formatPktMinutesLabel')}
  ${extractFunction(TEACHER, 'getTeacherSlotDurationMins')}
  ${extractFunction(TEACHER, 'resolveEffectiveClassZoomLink')}
  ${extractFunction(TEACHER, 'syncTeacherSidebarActiveState')}
  ${extractFunction(TEACHER, 'switchTeacherPortalTab')}
  ${extractFunction(TEACHER, 'openTeacherAdvanceSalaryRequest')}
  ${extractFunction(TEACHER, 'toggleTeacherSidebar')}
  ${extractFunction(TEACHER, 'getOverdueStartedClasses')}
  ${extractFunction(TEACHER, 'checkOverdueClassReminder')}
  ${extractFunction(TEACHER, 'renderTeacherAnnouncements')}
  ${extractFunction(TEACHER, '_teacherLiveAccrualHtml')}
  ${extractFunction(TEACHER, 'renderTeacherClassesTable')}
  ${extractFunction(TEACHER, 'syncTeacherTodayFilterChip')}
  ${extractFunction(TEACHER, 'setTeacherTodayFilter')}
  ${extractFunction(TEACHER, 'showTeacherTodayKpi')}
  this.__api = { switchTeacherPortalTab, toggleTeacherSidebar, checkOverdueClassReminder,
    renderTeacherAnnouncements, _teacherLiveAccrualHtml, renderTeacherClassesTable,
    showTeacherTodayKpi, setTeacherTodayFilter, openTeacherAdvanceSalaryRequest,
    setClasses: (c) => { TODAY_CLASSES = c; },
    getFilter: () => TEACHER_TODAY_FILTER,
    getTab: () => CURRENT_TEACHER_TAB };
`;
vm.runInContext(code, sandbox);
const api = sandbox.__api;

// --- Tab switching matrix (the pre-redesign visibility contract) -----
const EXPECT = {
  dashboard: { sectionTeacherKpiGrid: 1, sectionTeacherToday: 1, sectionTeacherStudentList: 0, sectionTeacherLessonHistory: 0, sectionTeacherTrials: 0, sectionTeacherSalaries: 0 },
  today:     { sectionTeacherKpiGrid: 1, sectionTeacherToday: 1, sectionTeacherStudentList: 0, sectionTeacherLessonHistory: 0, sectionTeacherTrials: 0, sectionTeacherSalaries: 0 },
  students:  { sectionTeacherKpiGrid: 1, sectionTeacherToday: 0, sectionTeacherStudentList: 1, sectionTeacherLessonHistory: 0, sectionTeacherTrials: 0, sectionTeacherSalaries: 0 },
  history:   { sectionTeacherKpiGrid: 0, sectionTeacherToday: 0, sectionTeacherStudentList: 0, sectionTeacherLessonHistory: 1, sectionTeacherTrials: 0, sectionTeacherSalaries: 0 },
  trials:    { sectionTeacherKpiGrid: 0, sectionTeacherToday: 0, sectionTeacherStudentList: 0, sectionTeacherLessonHistory: 0, sectionTeacherTrials: 1, sectionTeacherSalaries: 0 },
  salaries:  { sectionTeacherKpiGrid: 0, sectionTeacherToday: 0, sectionTeacherStudentList: 0, sectionTeacherLessonHistory: 0, sectionTeacherTrials: 0, sectionTeacherSalaries: 1 },
};
for (const [tab, matrix] of Object.entries(EXPECT)) {
  api.switchTeacherPortalTab(tab);
  const visOk = Object.entries(matrix).every(([id, want]) => {
    const el = registry.get(id);
    return el && el.classList.contains('hidden') === (want === 0);
  });
  check(`tab '${tab}' shows/hides exactly the pre-redesign sections`, visOk);
  check(`tab '${tab}' marks CURRENT_TEACHER_TAB`, api.getTab() === tab);
  const sbActive = Object.entries(NAVMAP)
    .filter(([, id]) => registry.get(id).classList.contains('active'))
    .map(([t]) => t);
  check(`tab '${tab}' activates only its sidebar pill`, sbActive.length === 1 && sbActive[0] === tab,
    JSON.stringify(sbActive));
  const railActive = railEls.filter(e => e.classList.contains('active'))
    .map(e => e.getAttribute('data-rail-tab'));
  check(`tab '${tab}' activates only its rail button`, railActive.length === 1 && railActive[0] === tab,
    JSON.stringify(railActive));
}
check('tab switches still trigger their data loaders',
  calls.includes('renderStudents') && calls.includes('renderHistory') &&
  calls.includes('loadTrials') && calls.includes('loadSalaries'),
  JSON.stringify(calls));

// --- Click-through: run the tab argument taken from each REAL button -
for (const [tab, id] of Object.entries(NAVMAP)) {
  const arg = (buttonOnclickById(id).match(/switchTeacherPortalTab\('(\w+)'\)/) || [])[1];
  api.switchTeacherPortalTab(arg);
  check(`sidebar #${id} onclick argument lands on tab '${tab}'`, api.getTab() === tab && arg === tab);
}
for (const rb of railButtons) {
  const arg = (rb.onclick.match(/switchTeacherPortalTab\('(\w+)'\)/) || [])[1];
  api.switchTeacherPortalTab(arg);
  check(`rail [${rb.tab}] onclick argument lands on tab '${rb.tab}'`, api.getTab() === rb.tab && arg === rb.tab);
}

// --- Salary group: the Advance door, executed for real ----------------
// The REAL opener must (a) land on the salaries tab with exactly the
// salaries visibility matrix, (b) leave the Salary Slips pill active,
// and (c) target the real advance request card (its one-shot flash
// class is added synchronously; the suite's setTimeout stub never
// fires, so the class remaining proves the opener added it).
api.openTeacherAdvanceSalaryRequest();
check('salary group: advance door lands on the salaries tab',
  api.getTab() === 'salaries' &&
  !registry.get('sectionTeacherSalaries').classList.contains('hidden') &&
  registry.get('sectionTeacherToday').classList.contains('hidden') &&
  registry.get('sectionTeacherStudentList').classList.contains('hidden') &&
  registry.get('sectionTeacherLessonHistory').classList.contains('hidden') &&
  registry.get('sectionTeacherTrials').classList.contains('hidden'));
check('salary group: advance door leaves the Salary Slips pill active',
  registry.get('sbNavSalaries').classList.contains('active'));
check('salary group: advance door targets the real request card (flash applied)',
  registry.get('tAdvanceRequestCard').classList.contains('tui-advance-flash'));

// --- Mobile drawer mechanics on the real elements ---------------------
const sidebarEl = registry.get('teacherSidebar');
const backdropEl = registry.get('teacherSidebarBackdrop');
api.toggleTeacherSidebar(true);
check('mobile: opening the drawer slides the sidebar in + shows backdrop',
  !sidebarEl.classList.contains('-translate-x-full') && !backdropEl.classList.contains('hidden'));
api.toggleTeacherSidebar(false);
check('mobile: closing the drawer restores both',
  sidebarEl.classList.contains('-translate-x-full') && backdropEl.classList.contains('hidden'));

// --- Announcements banner populates ----------------------------------
api.renderTeacherAnnouncements([
  { target: 'teachers', title: 'Fixture Notice', message: 'Portal redesign check', created_at: '2026-11-06' },
  { target: 'parents', title: 'Parents Only', message: 'must not appear', created_at: '2026-11-06' },
]);
const annEl = registry.get('teacherAnnouncementsBanner');
check('announcements banner shows teacher-targeted items only',
  !annEl.classList.contains('hidden') && annEl.innerHTML.includes('Fixture Notice') &&
  !annEl.innerHTML.includes('Parents Only'));
api.renderTeacherAnnouncements([]);
check('announcements banner hides again when empty',
  annEl.classList.contains('hidden') && annEl.innerHTML === '');

// --- Live salary accrual card (real renderer, fixture figures) -------
const live = api._teacherLiveAccrualHtml('November 2026');
check('salary accrual card renders with figures',
  live.figures === true && live.html.includes('Your salary earned so far this month: PKR 10,000'));
check('salary accrual card carries the gold progress bar at 40% (10,000 of 25,000)',
  live.html.includes('width:40%') && live.html.includes('linear-gradient(90deg,#dcbc55,#c9a227)'));

// --- Today's Classes rows: real renderer ------------------------------
const now = new Date();
const localMin = now.getHours() * 60 + now.getMinutes();
const hhmm = (mins) => {
  const t = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + ':00';
};
api.setClasses([
  { id: 'SCH-FIX-1', student_id: 'STU-101', start_time: hhmm(localMin + 180), end_time: hhmm(localMin + 210),
    startMin: localMin + 180, endMin: localMin + 210, durationMins: 30, status: 'Scheduled',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300', isLive: false, isUpcoming: true,
    isLeaveStudent: false, isAdvanceExtra: false, log: null,
    students: { id: 'STU-101', name: 'Ayesha Khan' } },
  { id: 'SCH-FIX-2', student_id: 'STU-102', start_time: hhmm(localMin - 90), end_time: hhmm(localMin - 60),
    startMin: localMin - 90, endMin: 0, durationMins: 30, status: 'Running',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300', isLive: true, isUpcoming: false,
    isLeaveStudent: false, isAdvanceExtra: false, log: { status: 'Running' },
    students: { id: 'STU-102', name: 'Bilal Ahmed' } },
]);
api.renderTeacherClassesTable();
const tbodyHtml = registry.get('teacherClassesTableBody').innerHTML;
check("today's rows render a Start Class button wired to the real handler",
  tbodyHtml.includes("handleTeacherStartClass('SCH-FIX-1'") && tbodyHtml.includes('START CLASS'));
check("today's rows render a Complete Class button wired to the real handler",
  tbodyHtml.includes("handleTeacherCompleteClass('SCH-FIX-2'") && tbodyHtml.includes('COMPLETE CLASS'));
check("today's rows carry the flagship avatar initials",
  tbodyHtml.includes('>AK<') && tbodyHtml.includes('>BA<'));
check("today's rows keep the data-label card hooks",
  tbodyHtml.includes('data-label="Student"') && tbodyHtml.includes('data-label="Time"'));

// --- Overdue reminder populates through the real checker --------------
api.checkOverdueClassReminder();
const odEl = registry.get('teacherOverdueClassReminder');
check('overdue reminder shows for the still-open class (PKT end time passed)',
  !odEl.classList.contains('hidden') && odEl.innerHTML.includes('Bilal Ahmed') &&
  odEl.innerHTML.includes("handleTeacherCompleteClass('SCH-FIX-2'"));

// ---------------------------------------------------------------------
// Part D — owner marks (8): Completed counts ALL marked classes.
// The REAL loadTeacherPortalData runs against a fixture db stub whose
// eq-filtering mirrors the engine's; the fixture day mixes Completed +
// Present + Absent + Leave + one unmarked class. The KPI counters are
// locals of the loader whose only consumers are the stat elements, so
// this proves the display counts directly.
// ---------------------------------------------------------------------
sandbox.waitForD1ProbeSettled = async () => {};
const pkt = vm.runInContext('getPktNowParts()', sandbox);
const D_STUDENTS = ['Ayesha Khan', 'Bilal Ahmed', 'Fatima Noor', 'Omar Farooq', 'Zainab Ali']
  .map((name, i) => ({ id: `STU-D${i + 1}`, name, family_id: 'FAM-D1',
    assigned_teacher_id: 'TCH-FIX', status: 'Active' }));
const D_STATUSES = ['Completed', 'Present', 'Absent', 'Leave', null];
const D_SCHEDULES = D_STUDENTS.map((s, i) => ({
  id: `SCH-D${i + 1}`, student_id: s.id, teacher_id: 'TCH-FIX',
  day_of_week: pkt.day, start_time: `0${7 + i}:00:00`, end_time: `0${7 + i}:30:00`,
  course_name: 'Quran Reading', students: { id: s.id, name: s.name },
}));
const D_LOGS = D_STATUSES.map((st, i) => st && ({
  id: `LOG-D${i + 1}`, student_id: D_STUDENTS[i].id, schedule_id: D_SCHEDULES[i].id,
  teacher_id: 'TCH-FIX', date: pkt.date, status: st, lesson_notes: '',
})).filter(Boolean);
const FIXTURE_TABLES = {
  teachers: [{ id: 'TCH-FIX', full_name: 'Fixture Teacher', working_shift: 'Morning',
    zoom_link: 'https://zoom.us/j/fixture', status: 'Active', address: '{}' }],
  students: D_STUDENTS, class_schedules: D_SCHEDULES, attendance_logs: D_LOGS,
};
function fixtureDbFrom(table) {
  const q = { _filters: [], _single: false,
    select() { return q; },
    eq(c, v) { q._filters.push([c, v]); return q; },
    order() { return q; }, limit() { return q; }, offset() { return q; },
    single() { q._single = true; return q; },
    then(res, rej) {
      const rows = (FIXTURE_TABLES[table] || [])
        .filter(r => q._filters.every(([c, v]) => String(r[c]) === String(v)));
      const out = q._single
        ? { data: rows[0] || null, error: null, _lmsSource: 'd1' }
        : { data: rows, error: null, _lmsSource: 'd1' };
      return Promise.resolve(out).then(res, rej);
    } };
  return q;
}
sandbox.db = { from: fixtureDbFrom };
// Some Part C extractions already carried top-level declarations into
// the context; declare only the globals that are still missing.
const blockBPrelude = [];
for (const [name, init] of [
  ['ASSIGNED_STUDENTS', '[]'], ['ACTIVE_ASSIGNED_STUDENTS', '[]'],
  ['LEAVE_ASSIGNED_STUDENTS', '[]'], ['_teacherLoadInFlight', 'false'],
  ['DAY_NAMES', "['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']"],
  ['TEACHER_BRANCH_TIMEOUT_MS', '15000'],
]) {
  if (vm.runInContext(`typeof ${name}`, sandbox) === 'undefined') {
    blockBPrelude.push(`let ${name} = ${init};`);
  }
}
vm.runInContext(`
  ${blockBPrelude.join('\n')}
  function scheduleTeacherClassesRetry() {}
  function resetTeacherClassesRetry() {}
  ${/* parseEmployeeMeta contains a '{' string literal that defeats the
       brace counter — extract it by its closing indent instead. */
    (TEACHER.match(/function parseEmployeeMeta\(rawStr\) \{[\s\S]*?\n    \}/) || [''])[0]}
  ${extractFunction(TEACHER, 'normalizeTeacherSession')}
  ${extractFunction(TEACHER, 'isPortalRegularStudent')}
  ${extractFunction(TEACHER, 'isPortalStudentDeactivated')}
  ${extractFunction(TEACHER, 'isPortalStudentOnLeave')}
  ${extractFunction(TEACHER, 'settleTeacherBranch')}
  ${extractFunction(TEACHER, 'loadTeacherPortalData')}
  this.__loader = loadTeacherPortalData;
`, sandbox);
await sandbox.__loader();
const statText = (id) => String(registry.get(id).innerText);
check('owner marks (8): Today total counts every scheduled class',
  statText('statTodayClasses') === '5', statText('statTodayClasses'));
check('owner marks (8): Completed counts ALL marked (Completed+Present+Absent+Leave)',
  statText('statCompleted') === '4', statText('statCompleted'));
check('owner marks (8): Remaining counts only the not-yet-marked',
  statText('statRemaining') === '1', statText('statRemaining'));
check('owner marks (8): Completed + Remaining equals the day total',
  Number(statText('statCompleted')) + Number(statText('statRemaining')) === Number(statText('statTodayClasses')));

// --- Owner marks (7): KPI drill-down filters on the loader's rows -----
api.showTeacherTodayKpi('completed');
let rowsHtml = registry.get('teacherClassesTableBody').innerHTML;
check('owner marks (7): Completed view lists the Absent and Leave rows with their status',
  api.getFilter() === 'completed' && rowsHtml.includes('Fatima Noor') &&
  rowsHtml.includes('Omar Farooq') && rowsHtml.includes('ABSENT') && rowsHtml.includes('LEAVE') &&
  !rowsHtml.includes('Zainab Ali'));
check('owner marks (7): filter chip names the Completed view and is visible',
  !registry.get('todayFilterChip').classList.contains('hidden') &&
  String(registry.get('todayFilterLabel').innerText).includes('Marked'));
api.showTeacherTodayKpi('remaining');
rowsHtml = registry.get('teacherClassesTableBody').innerHTML;
check('owner marks (7): Remaining view lists only the unmarked class',
  api.getFilter() === 'remaining' && rowsHtml.includes('Zainab Ali') &&
  !rowsHtml.includes('Fatima Noor') && !rowsHtml.includes('Ayesha Khan'));
api.showTeacherTodayKpi('all');
rowsHtml = registry.get('teacherClassesTableBody').innerHTML;
check('owner marks (7): Today view restores the full list and hides the chip',
  api.getFilter() === 'all' && rowsHtml.includes('Zainab Ali') && rowsHtml.includes('Fatima Noor') &&
  registry.get('todayFilterChip').classList.contains('hidden'));

console.log('---');
console.log(`teacher-redesign-shell: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
