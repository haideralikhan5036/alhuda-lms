// Families directory KPI cards v3 (owner correction 2026-11-10) — the
// three combined cards (families + students added into one headline
// number) are replaced by FOUR cards (Total / Active / Deactivated /
// On Leave), each showing ONLY two separate figures: Families and
// Students. No combined families+students number exists anywhere.
// The buckets partition: Total = Active + Deactivated + On Leave, for
// families and for students separately. On Leave is defined by the
// shared predicates in js/config.js (isStudentOnLeaveForDirectory /
// isFamilyOnLeaveForDirectory): a student is on leave when regular,
// not self-deactivated, and on leave now (stored 'Leave'/'On Leave'
// status or an in-window on_leave notes window); a family is on leave
// only when the WHOLE family is effectively on leave (stored status
// contains 'leave', or every non-deactivated regular student is on
// leave). Deactivated always wins over Leave. The unified search box
// STAYS removed (owner decision 2026-10-29 / 2026-11-10).
// Run from the repo root:  node test/families-kpi-cards.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const FAMILIES = read('js/families.js');
const CONFIG = read('js/config.js');
const LEAVES = read('js/leaves.js');
const INDEX = read('index.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Removed (owner's red marks, 2026-10-29 — unchanged) -------------------
check('section subtitle removed', !INDEX.includes('Multiple Enrolled Sibling Students'));
check('360 hint line removed', !INDEX.includes('Click any Family or Student to open their dedicated'));
check('directory search box removed (stays removed)', !INDEX.includes('id="famUnifiedSearch"'));
check('view-mode tab bar removed', !INDEX.includes('id="btnViewFamTable"') && !INDEX.includes('id="btnViewStudentsList"') && !INDEX.includes('id="btnViewDeactivatedFams"'));
check('status filter pills removed', !INDEX.includes('id="btnFilterFamAll"') && !INDEX.includes('id="btnFilterStuActive"') && !INDEX.includes('id="familiesStatusFilterGroup"'));
check('old 4 summary cards removed', !INDEX.includes('id="famSummaryTotalFamilies"') && !INDEX.includes('id="famSummaryActiveStudents"'));
check('registry heading simplified, description removed',
  INDEX.includes('Families Master Registry') && !INDEX.includes('Families Master Registry (Sequential Numbered List)') && !INDEX.includes('id="familiesTableHeaderSubtitle"'));

// ---- Combined number: gone everywhere ---------------------------------------
for (const id of ['famKpiTotalCombined', 'famKpiActiveCombined', 'famKpiDeactivatedCombined']) {
  check(`combined span removed from markup: ${id}`, !INDEX.includes(`id="${id}"`));
  check(`combined value never written: ${id}`, !FAMILIES.includes(`'${id}'`));
}
check('no combined write expression survives in either writer',
  !/famKpi\w*Combined/.test(FAMILIES) && !/\.length \+ (allStu|activeStus|deactivatedStudentsOnly)/.test(FAMILIES));

// ---- Four KPI cards -----------------------------------------------------------
const CARDS = [
  ['famKpiTotal', 'total'], ['famKpiActive', 'active'],
  ['famKpiDeactivated', 'deactivated'], ['famKpiLeave', 'leave'],
];
for (const [id, mode] of CARDS) {
  check(`KPI card ${id}: whole card click shows the families list for '${mode}'`,
    INDEX.includes(`id="${id}"`) && INDEX.includes(`<div id="${id}" onclick="setDirectoryKpi('${mode}', 'families')"`));
  check(`KPI card ${id}: Families figure separately clickable for '${mode}'`,
    INDEX.includes(`onclick="event.stopPropagation(); setDirectoryKpi('${mode}', 'families')"`));
  check(`KPI card ${id}: Students figure separately clickable for '${mode}'`,
    INDEX.includes(`onclick="event.stopPropagation(); setDirectoryKpi('${mode}', 'students')"`));
}
for (const id of ['famKpiTotalFamCount', 'famKpiTotalStuCount', 'famKpiActiveFamCount', 'famKpiActiveStuCount',
                  'famKpiDeactivatedFamCount', 'famKpiDeactivatedStuCount', 'famKpiLeaveFamCount', 'famKpiLeaveStuCount']) {
  check(`KPI value span exists: ${id}`, INDEX.includes(`id="${id}"`));
}
check('KPI grid lays out four across on wide screens, 2x2 below',
  INDEX.includes('grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5'));
check('On Leave card uses the amber accent', INDEX.includes('id="famKpiLeave"') && INDEX.includes('bg-amber-50/70 border-amber-200'));

// ---- Shared predicates live in js/config.js -----------------------------------
check('config.js defines the shared directory leave predicates and getters',
  CONFIG.includes('function isStudentOnLeaveForDirectory(') &&
  CONFIG.includes('function isFamilyOnLeaveForDirectory(') &&
  CONFIG.includes('function getOnLeaveStudents(') &&
  CONFIG.includes('function getOnLeaveFamilies(') &&
  CONFIG.includes('window.isStudentOnLeaveForDirectory = isStudentOnLeaveForDirectory;') &&
  CONFIG.includes('window.getOnLeaveFamilies = getOnLeaveFamilies;'));
check('student predicate reuses the canonical isStudentOnLeaveNow behind a typeof guard',
  CONFIG.includes("typeof isStudentOnLeaveNow === 'function'") && CONFIG.includes('isStudentOnLeaveNow(s, meta, null)'));

// ---- Both counter writers produce the partition --------------------------------
check('both writers write the Leave figures',
  (FAMILIES.match(/setFVal\('famKpiLeaveFamCount', leaveFamiliesList\.length\)/g) || []).length === 2 &&
  (FAMILIES.match(/setFVal\('famKpiLeaveStuCount', leaveStudentsOnly\.length\)/g) || []).length === 2);
check('both writers write every card figure',
  (FAMILIES.match(/setFVal\('famKpiTotalFamCount', regularFamilies\.length\)/g) || []).length === 2 &&
  (FAMILIES.match(/setFVal\('famKpiTotalStuCount', allStu\.length\)/g) || []).length === 2 &&
  (FAMILIES.match(/setFVal\('famKpiDeactivatedStuCount', deactivatedStudentsOnly\.length\)/g) || []).length === 2);
check('both writers split On Leave out of the Active figures (no stored-leave inclusion left)',
  (FAMILIES.match(/activeStudentsOnly\.filter\(s => !leaveStudentsOnly\.includes\(s\)\)\.length/g) || []).length === 2 &&
  !FAMILIES.includes("st === 'active' || st === 'regular' || st === 'leave'"));
check('sidebar foot counters take the same corrected Active counts in both writers',
  FAMILIES.includes("setFVal('sidebarActiveFamilies', displayActiveFamilies.length)") &&
  FAMILIES.includes("setFVal('sidebarActiveFamilies', displayActiveFams)") &&
  (FAMILIES.match(/setFVal\('sidebarActiveStudents', activeStus\)/g) || []).length === 2);

// ---- Click routing / filters ---------------------------------------------------
check('click handler sets BOTH filters together and shows the matching list below',
  FAMILIES.includes('function setDirectoryKpi(mode, target)') &&
  FAMILIES.includes("CURRENT_FAMILIES_STATUS_FILTER = status;") &&
  FAMILIES.includes("CURRENT_STUDENTS_STATUS_FILTER = status;") &&
  FAMILIES.includes("switchFamiliesViewMode('deactivatedFams')") &&
  FAMILIES.includes("switchFamiliesViewMode('studentsList')") &&
  FAMILIES.includes("switchFamiliesViewMode('famTable')") &&
  FAMILIES.includes('window.setDirectoryKpi = setDirectoryKpi;'));
check("setDirectoryKpi maps the 'leave' mode to the LEAVE status",
  FAMILIES.includes("mode === 'leave' ? 'LEAVE'"));
check('selected-card sync knows the leave mode and the leave card',
  FAMILIES.includes('function syncDirectoryKpiCardsUI()') && FAMILIES.includes('function directoryKpiSelectedMode()') &&
  FAMILIES.includes("CURRENT_FAMILIES_STATUS_FILTER === 'LEAVE' && CURRENT_STUDENTS_STATUS_FILTER === 'LEAVE'") &&
  FAMILIES.includes("'famKpiLeave': base + 'bg-amber-50/70 border-amber-200'") &&
  FAMILIES.includes("famKpiLeave: 'leave'"));
check('both status setters accept LEAVE',
  FAMILIES.includes("CURRENT_FAMILIES_STATUS_FILTER = ['ALL', 'ACTIVE', 'DEACTIVATED', 'LEAVE'].includes(filterMode)") &&
  FAMILIES.includes("CURRENT_STUDENTS_STATUS_FILTER = ['ALL', 'ACTIVE', 'DEACTIVATED', 'LEAVE'].includes(filterMode)"));
check('both filter getters have a LEAVE branch on the shared getters',
  FAMILIES.includes("if (CURRENT_FAMILIES_STATUS_FILTER === 'LEAVE')") &&
  FAMILIES.includes('? getOnLeaveFamilies(allFams, ALL_STUDENTS)') &&
  FAMILIES.includes("if (CURRENT_STUDENTS_STATUS_FILTER === 'LEAVE')") &&
  FAMILIES.includes('? getOnLeaveStudents(allStus, ALL_FAMILIES)'));
check('list headers gain On Leave labels',
  FAMILIES.includes("'On Leave Families'") && FAMILIES.includes("'On Leave Students'"));

// ============================================================================
// EXECUTED: real predicates, real counter writer, real click router and
// real filter getters over fixtures (house vm pattern).
// ============================================================================
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

const CONFIG_FNS = [
  'isRegularFamilyRecord', 'isRegularStudentRecord', 'isStudentSelfDeactivated',
  'getFamilyRegularStudents', 'isFamilyDeactivated', 'isActiveFamilyRecord',
  'isDeactivatedFamilyRecord', 'isStudentDeactivatedOrParentDeactivated',
  'isActiveStudentRecord', 'getAllFamilies', 'getActiveFamilies',
  'getDeactivatedFamilies', 'getAllStudents', 'getActiveStudents',
  'getDeactivatedStudents', 'isStudentOnLeaveForDirectory',
  'isFamilyOnLeaveForDirectory', 'getOnLeaveStudents', 'getOnLeaveFamilies',
].map(n => extractFunction(CONFIG, n)).join('\n');
const FAMILIES_FNS = [
  'syncAllFamilyAndStudentCountersUI', 'directoryKpiSelectedMode',
  'syncDirectoryKpiCardsUI', 'setDirectoryKpi',
  'getFilteredFamiliesByCurrentStatus', 'getFilteredStudentsByCurrentStatus',
].map(n => extractFunction(FAMILIES, n)).join('\n');
const LEAVE_PREDICATE = extractFunction(LEAVES, 'isStudentOnLeaveNow');

// ---- fixtures (dates relative to the real run day) ---------------------------
const DAY = 86400000;
const nowMs = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const inWindow = JSON.stringify({ on_leave: true, leave_start_date: iso(nowMs - 5 * DAY), return_date: iso(nowMs + 5 * DAY) });
const pastWindow = JSON.stringify({ on_leave: true, leave_start_date: iso(nowMs - 20 * DAY), return_date: iso(nowMs - 10 * DAY) });
const futureWindow = JSON.stringify({ on_leave: true, leave_start_date: iso(nowMs + 3 * DAY), return_date: iso(nowMs + 9 * DAY) });

const stu = (id, family_id, status, notes) => ({ id, family_id, status, notes: notes || '' });
const fam = (id, status) => ({ id, status, parent_name: 'Parent ' + id });
const FAMS = [
  fam('FAM-A', 'Active'),   // two attending students
  fam('FAM-B', 'Active'),   // one in-window leave + one attending (partial)
  fam('FAM-C', 'Active'),   // only student has stored 'Leave'
  fam('FAM-D', 'On Leave'), // Family 360 marker; student attending
  fam('FAM-E', 'Active'),   // in-window leave + stored 'Leave'
  fam('FAM-F', 'Inactive'), // deactivated; one student carries a stale leave window
  fam('FAM-G', 'Active'),   // one self-deactivated + one in-window leave
  fam('FAM-H', 'Active'),   // no students at all
  fam('FAM-I', 'Active'),   // past-window + future-window leave meta
];
const STUS = [
  stu('A1', 'FAM-A', 'Active'), stu('A2', 'FAM-A', 'Active'),
  stu('B1', 'FAM-B', 'Active', inWindow), stu('B2', 'FAM-B', 'Active'),
  stu('C1', 'FAM-C', 'Leave'),
  stu('D1', 'FAM-D', 'Active'),
  stu('E1', 'FAM-E', 'Active', inWindow), stu('E2', 'FAM-E', 'Leave'),
  stu('F1', 'FAM-F', 'Inactive'), stu('F2', 'FAM-F', 'Inactive', inWindow),
  stu('G1', 'FAM-G', 'Inactive'), stu('G2', 'FAM-G', 'Active', inWindow),
  stu('I1', 'FAM-I', 'Active', pastWindow), stu('I2', 'FAM-I', 'Active', futureWindow),
];
const EXPECT = {
  famTotal: 9, famActive: 4, famDeactivated: 1, famLeave: 4,
  stuTotal: 14, stuActive: 6, stuDeactivated: 3, stuLeave: 5,
  leaveFamIds: ['FAM-C', 'FAM-D', 'FAM-E', 'FAM-G'],
  activeFamIds: ['FAM-A', 'FAM-B', 'FAM-H', 'FAM-I'],
  leaveStuIds: ['B1', 'C1', 'E1', 'E2', 'G2'],
  activeStuIds: ['A1', 'A2', 'B2', 'D1', 'I1', 'I2'],
  deactStuIds: ['F1', 'F2', 'G1'],
};
const sortedIds = (rows) => rows.map(r => r.id).sort();
const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function makeContext() {
  const els = {};
  const requestedIds = new Set();
  const viewSwitches = [];
  // Browser-faithful fixture element: innerText coerces to string.
  const fixtureEl = () => {
    const el = { _text: '', className: '', textContent: '' };
    Object.defineProperty(el, 'innerText', {
      get() { return this._text; },
      set(v) { this._text = String(v); },
    });
    return el;
  };
  const sandbox = {
    console,
    document: {
      getElementById: (id) => {
        requestedIds.add(id);
        if (!els[id]) els[id] = fixtureEl();
        return els[id];
      },
    },
    ALL_FAMILIES: FAMS, ALL_STUDENTS: STUS, ALL_TEACHERS: [],
    CURRENT_FAMILIES_VIEW: 'famTable',
    CURRENT_FAMILIES_STATUS_FILTER: 'ACTIVE',
    CURRENT_STUDENTS_STATUS_FILTER: 'ACTIVE',
    FAM_TABLE_PAGE: 1, STU_TABLE_PAGE: 1, FAM_SEARCH_QUERY: '',
    updateStatusFilterPillsUI: () => {},
    renderFamiliesMasterTable: () => {},
    renderAllStudentsListTable: () => {},
    renderFamiliesCards: () => {},
    switchFamiliesViewMode: (mode) => { viewSwitches.push(mode); sandbox.CURRENT_FAMILIES_VIEW = mode; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CONFIG_FNS + '\n' + LEAVE_PREDICATE + '\n' + FAMILIES_FNS, sandbox);
  return { sandbox, els, requestedIds, viewSwitches };
}

// ---- predicate spot checks ------------------------------------------------------
{
  const { sandbox } = makeContext();
  const byId = Object.fromEntries(STUS.map(s => [s.id, s]));
  check('executed: in-window leave student is on leave', sandbox.isStudentOnLeaveForDirectory(byId['B1']) === true);
  check("executed: stored 'Leave' student is on leave", sandbox.isStudentOnLeaveForDirectory(byId['C1']) === true);
  check('executed: deactivated student with a stale leave window is NOT on leave (Deactivated wins)',
    sandbox.isStudentOnLeaveForDirectory(byId['F2']) === false);
  check('executed: past-window and future-window students are NOT on leave',
    sandbox.isStudentOnLeaveForDirectory(byId['I1']) === false && sandbox.isStudentOnLeaveForDirectory(byId['I2']) === false);
  const famB = FAMS.find(f => f.id === 'FAM-B');
  check('executed: partially-on-leave family stays Active (not on leave)',
    sandbox.isFamilyOnLeaveForDirectory(famB, STUS.filter(s => s.family_id === 'FAM-B')) === false);
  const famF = FAMS.find(f => f.id === 'FAM-F');
  check('executed: deactivated family is NOT on leave even with a leave-window student',
    sandbox.isFamilyOnLeaveForDirectory(famF, STUS.filter(s => s.family_id === 'FAM-F')) === false);
  const famH = FAMS.find(f => f.id === 'FAM-H');
  check('executed: family with no students is NOT on leave',
    sandbox.isFamilyOnLeaveForDirectory(famH, []) === false);
}

// ---- getter partition ------------------------------------------------------------
{
  const { sandbox } = makeContext();
  check('executed: family getters partition (leave set exact)',
    sameIds(sortedIds(sandbox.getOnLeaveFamilies(FAMS, STUS)), EXPECT.leaveFamIds),
    JSON.stringify(sortedIds(sandbox.getOnLeaveFamilies(FAMS, STUS))));
  check('executed: student getters partition (leave set exact)',
    sameIds(sortedIds(sandbox.getOnLeaveStudents(STUS, FAMS)), EXPECT.leaveStuIds),
    JSON.stringify(sortedIds(sandbox.getOnLeaveStudents(STUS, FAMS))));
  const famBuckets = ['ACTIVE', 'DEACTIVATED', 'LEAVE'].map(m => {
    sandbox.CURRENT_FAMILIES_STATUS_FILTER = m;
    return sortedIds(sandbox.getFilteredFamiliesByCurrentStatus());
  });
  check('executed: family filter buckets are disjoint and cover Total',
    famBuckets.flat().length === EXPECT.famTotal && new Set(famBuckets.flat()).size === EXPECT.famTotal &&
    sameIds(famBuckets[0], EXPECT.activeFamIds) && sameIds(famBuckets[2], EXPECT.leaveFamIds),
    JSON.stringify(famBuckets));
  const stuBuckets = ['ACTIVE', 'DEACTIVATED', 'LEAVE'].map(m => {
    sandbox.CURRENT_STUDENTS_STATUS_FILTER = m;
    return sortedIds(sandbox.getFilteredStudentsByCurrentStatus());
  });
  check('executed: student filter buckets are disjoint and cover Total',
    stuBuckets.flat().length === EXPECT.stuTotal && new Set(stuBuckets.flat()).size === EXPECT.stuTotal &&
    sameIds(stuBuckets[0], EXPECT.activeStuIds) && sameIds(stuBuckets[1], EXPECT.deactStuIds) && sameIds(stuBuckets[2], EXPECT.leaveStuIds),
    JSON.stringify(stuBuckets));
  check('executed: multi-student family counted once as a family, students counted individually',
    sandbox.getAllFamilies(FAMS).length === EXPECT.famTotal &&
    sandbox.getAllStudents(STUS, FAMS).filter(s => s.family_id === 'FAM-B').length === 2);
}

// ---- counter writer execution ------------------------------------------------------
{
  const { sandbox, els, requestedIds } = makeContext();
  sandbox.syncAllFamilyAndStudentCountersUI(FAMS, STUS);
  const val = (id) => els[id] && els[id].innerText;
  check('executed writer: Total card figures', val('famKpiTotalFamCount') === String(EXPECT.famTotal) && val('famKpiTotalStuCount') === String(EXPECT.stuTotal),
    `got ${val('famKpiTotalFamCount')}/${val('famKpiTotalStuCount')}`);
  check('executed writer: Active card figures exclude On Leave', val('famKpiActiveFamCount') === String(EXPECT.famActive) && val('famKpiActiveStuCount') === String(EXPECT.stuActive),
    `got ${val('famKpiActiveFamCount')}/${val('famKpiActiveStuCount')}`);
  check('executed writer: Deactivated card figures', val('famKpiDeactivatedFamCount') === String(EXPECT.famDeactivated) && val('famKpiDeactivatedStuCount') === String(EXPECT.stuDeactivated),
    `got ${val('famKpiDeactivatedFamCount')}/${val('famKpiDeactivatedStuCount')}`);
  check('executed writer: On Leave card figures', val('famKpiLeaveFamCount') === String(EXPECT.famLeave) && val('famKpiLeaveStuCount') === String(EXPECT.stuLeave),
    `got ${val('famKpiLeaveFamCount')}/${val('famKpiLeaveStuCount')}`);
  check('executed writer: partition identity Total = Active + Deactivated + On Leave (both metrics)',
    EXPECT.famActive + EXPECT.famDeactivated + EXPECT.famLeave === EXPECT.famTotal &&
    EXPECT.stuActive + EXPECT.stuDeactivated + EXPECT.stuLeave === EXPECT.stuTotal &&
    Number(val('famKpiActiveFamCount')) + Number(val('famKpiDeactivatedFamCount')) + Number(val('famKpiLeaveFamCount')) === Number(val('famKpiTotalFamCount')) &&
    Number(val('famKpiActiveStuCount')) + Number(val('famKpiDeactivatedStuCount')) + Number(val('famKpiLeaveStuCount')) === Number(val('famKpiTotalStuCount')));
  check('executed writer: sidebar foot takes the corrected Active counts',
    val('sidebarActiveFamilies') === String(EXPECT.famActive) && val('sidebarActiveStudents') === String(EXPECT.stuActive),
    `got ${val('sidebarActiveFamilies')}/${val('sidebarActiveStudents')}`);
  check('executed writer: no combined element was ever written',
    ![...requestedIds].some(id => id.includes('Combined')), [...requestedIds].filter(id => id.includes('Combined')).join(','));
}

// ---- click routing execution ---------------------------------------------------------
{
  const { sandbox, els, viewSwitches } = makeContext();
  sandbox.setDirectoryKpi('leave', 'families');
  check("executed click: 'leave' card sets BOTH filters to LEAVE",
    sandbox.CURRENT_FAMILIES_STATUS_FILTER === 'LEAVE' && sandbox.CURRENT_STUDENTS_STATUS_FILTER === 'LEAVE',
    `${sandbox.CURRENT_FAMILIES_STATUS_FILTER}/${sandbox.CURRENT_STUDENTS_STATUS_FILTER}`);
  check("executed click: 'leave' families target stays on the master table (no deactivated view)",
    sandbox.CURRENT_FAMILIES_VIEW === 'famTable' && !viewSwitches.includes('deactivatedFams'));
  check("executed click: LEAVE families list is exactly the On Leave card set",
    sameIds(sortedIds(sandbox.getFilteredFamiliesByCurrentStatus()), EXPECT.leaveFamIds));
  check("executed click: selected mode resolves to 'leave' and the Leave card highlights",
    sandbox.directoryKpiSelectedMode() === 'leave' &&
    (sandbox.syncDirectoryKpiCardsUI(), (els['famKpiLeave'].className || '').includes('ring-amber-500')) &&
    !(els['famKpiActive'].className || '').includes('ring-2'));
  sandbox.setDirectoryKpi('leave', 'students');
  check("executed click: 'leave' students target opens the students list with the On Leave set",
    sandbox.CURRENT_FAMILIES_VIEW === 'studentsList' &&
    sameIds(sortedIds(sandbox.getFilteredStudentsByCurrentStatus()), EXPECT.leaveStuIds));
  sandbox.setDirectoryKpi('total', 'families');
  check("executed click: 'total' resets both filters to ALL and lists everything",
    sandbox.CURRENT_FAMILIES_STATUS_FILTER === 'ALL' && sandbox.CURRENT_STUDENTS_STATUS_FILTER === 'ALL' &&
    sandbox.directoryKpiSelectedMode() === 'total' &&
    sandbox.getFilteredFamiliesByCurrentStatus().length === EXPECT.famTotal);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
