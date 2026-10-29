// Families directory KPI cards (owner redesign 2026-10-29) — the old
// summary cards, hint line, unified search, view tabs and status
// filter pills are replaced by three sleek clickable combined cards
// (Total / Active / Deactivated: families + students in one card);
// clicking a card shows the matching data below.
// Run from the repo root:  node test/families-kpi-cards.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const FAMILIES = read('js/families.js');
const INDEX = read('index.html');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Removed (owner's red marks) -------------------------------------------
check('section subtitle removed', !INDEX.includes('Multiple Enrolled Sibling Students'));
check('360 hint line removed', !INDEX.includes('Click any Family or Student to open their dedicated'));
check('directory search box removed', !INDEX.includes('id="famUnifiedSearch"'));
check('view-mode tab bar removed', !INDEX.includes('id="btnViewFamTable"') && !INDEX.includes('id="btnViewStudentsList"') && !INDEX.includes('id="btnViewDeactivatedFams"'));
check('status filter pills removed', !INDEX.includes('id="btnFilterFamAll"') && !INDEX.includes('id="btnFilterStuActive"') && !INDEX.includes('id="familiesStatusFilterGroup"'));
check('old 4 summary cards removed', !INDEX.includes('id="famSummaryTotalFamilies"') && !INDEX.includes('id="famSummaryActiveStudents"'));
check('registry heading simplified, description removed',
  INDEX.includes('Families Master Registry') && !INDEX.includes('Families Master Registry (Sequential Numbered List)') && !INDEX.includes('id="familiesTableHeaderSubtitle"'));

// ---- New KPI cards -----------------------------------------------------------
for (const [id, mode] of [['famKpiTotal', 'total'], ['famKpiActive', 'active'], ['famKpiDeactivated', 'deactivated']]) {
  check(`KPI card ${id} is a clickable button -> setDirectoryKpi('${mode}')`,
    INDEX.includes(`id="${id}"`) && INDEX.includes(`onclick="setDirectoryKpi('${mode}')"`) );
}
for (const id of ['famKpiTotalCombined', 'famKpiTotalBreakdown', 'famKpiActiveCombined', 'famKpiActiveBreakdown', 'famKpiDeactCombined', 'famKpiDeactBreakdown']) {
  check(`KPI value span exists: ${id}`, INDEX.includes(`id="${id}"`));
}
check('combined counts are written from the canonical counters sync (both writers)',
  (FAMILIES.match(/setFVal\('famKpiTotalCombined'/g) || []).length >= 2 && // both counter writers
  FAMILIES.includes("setFVal('famKpiActiveCombined', activeFamiliesList.length + activeStus)") &&
  FAMILIES.includes("setFVal('famKpiDeactCombined', deactivatedFamiliesList.length + deactivatedStudentsOnly.length)"));
check('click handler sets BOTH filters together and shows the data below',
  FAMILIES.includes('function setDirectoryKpi(mode)') &&
  FAMILIES.includes("CURRENT_FAMILIES_STATUS_FILTER = target;") &&
  FAMILIES.includes("CURRENT_STUDENTS_STATUS_FILTER = target;") &&
  FAMILIES.includes("switchFamiliesViewMode('deactivatedFams')") &&
  FAMILIES.includes('window.setDirectoryKpi = setDirectoryKpi;'));
check('selected card highlight syncs with the current filters/view',
  FAMILIES.includes('function syncDirectoryKpiCardsUI()') && FAMILIES.includes('function directoryKpiSelectedMode()'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
