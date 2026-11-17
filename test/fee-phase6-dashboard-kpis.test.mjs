// Fee Dashboard + Form Improvements — clickable KPI cards (#1).
// Executes the REAL loadFeeDashboardStats / calculateThreePlusMonthDefaulters
// / handleFeeKpiClick from js/fees.js (extracted by name) against a fake DOM,
// with the REAL FeePhase1 / FeePhase3 / FeePhase6 modules attached, and
// proves count == list for all five KPI cards.
// Run from the repo root: node test/fee-phase6-dashboard-kpis.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PHASE3_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase3.js'), 'utf8');
const PHASE6_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase6.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('(', start);
  let parens = 0;
  let state = null;
  let escaped = false;
  const scan = (from, stopAt) => {
    for (let k = from; k < src.length; k++) {
      const c = src[k];
      const next = src[k + 1];
      if (state === 'line') { if (c === '\n') state = null; continue; }
      if (state === 'block') { if (c === '*' && next === '/') { state = null; k++; } continue; }
      if (state === "'" || state === '"' || state === '`') {
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === state) state = null;
        continue;
      }
      if (c === '/' && next === '/') { state = 'line'; k++; continue; }
      if (c === '/' && next === '*') { state = 'block'; k++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; continue; }
      if (stopAt(k, c)) return k;
    }
    return -1;
  };
  i = scan(i, (k, c) => {
    if (c === '(') parens++;
    else if (c === ')') { parens--; if (parens === 0) return true; }
    return false;
  });
  if (i < 0) throw new Error('unbalanced parens extracting ' + name);
  let j = src.indexOf('{', i);
  let depth = 0;
  state = null;
  escaped = false;
  j = scan(j, (k, c) => {
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return true; }
    return false;
  });
  if (j < 0) throw new Error('unbalanced braces extracting ' + name);
  return src.slice(start, j + 1);
}
function extractConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('const not found: ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  let state = null;
  let escaped = false;
  for (; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (state === 'line') { if (c === '\n') state = null; continue; }
    if (state === 'block') { if (c === '*' && next === '/') { state = null; i++; } continue; }
    if (state === "'" || state === '"' || state === '`') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === state) state = null;
      continue;
    }
    if (c === '/' && next === '/') { state = 'line'; i++; continue; }
    if (c === '/' && next === '*') { state = 'block'; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { state = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error('unbalanced braces extracting ' + name);
  return src.slice(start, i) + ';';
}

function makeElement(hiddenByDefault) {
  const classes = new Set(hiddenByDefault ? ['hidden'] : []);
  const attrs = {};
  return {
    value: '', innerText: '', innerHTML: '', className: '', checked: false, disabled: false,
    dataset: {}, style: {},
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => attrs[k],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    appendChild: () => {},
    addEventListener: () => {},
    querySelectorAll: () => []
  };
}

function rec(familyId, month, year, amountPaid, remaining, status, receiptNo) {
  return { receiptNo: receiptNo || ('R-' + familyId + '-' + month + year), familyId, month, year, monthlyFee: 5000, amountPaid, discount: 0, remainingBalance: remaining, status: status || 'Paid in Full', date: year + '-01-05', currency: 'PKR', recordKind: 'payment' };
}

const FAMILIES = [
  { id: 'FAM-A', parent_name: 'Paid Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'A1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' },
  { id: 'FAM-B', parent_name: 'Unpaid Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'B1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' },
  { id: 'FAM-C', parent_name: 'Partial Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'C1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' },
  { id: 'FAM-D', parent_name: 'Deactivated Family', monthly_fee: 5000, currency: 'PKR', status: 'Inactive', students: [{ name: 'D1', status: 'Inactive', joining_date: '2026-01-05' }], notes: '{}' },
  { id: 'FAM-E', parent_name: 'On Leave Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'E1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' },
  { id: 'FAM-F', parent_name: 'Defaulter Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'F1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' },
  { id: 'FAM-G', parent_name: 'Arrears Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'G1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' }
];
// FAM-A: November paid in full. FAM-B: November unpaid. FAM-C: November partial.
// FAM-D (deactivated): November CANCELLED payment + 4 unpaid months — must
// appear in NO KPI list. FAM-E: on leave for November. FAM-F: Sep+Oct+Nov
// unpaid (3 months) but its September payment was CANCELLED, so it stays a
// defaulter only if cancelled records are ignored. Every live family is
// enrolled September 2026 with September + October paid, so only F reaches
// 3 unpaid months.
// FAM-G: September + October paid, but November it pays ONLY the month's
// fee (5000) while 5000 of arrears still stand (remainingBalance 5000) —
// the Paid KPI must NOT count it, and neither must the receipts chip,
// even though the amount paid equals the month's fee. That is the
// review-caught chip fix: "paid" means the whole bill settled, not
// "paid >= this month's fee".
const RECORDS = [
  rec('FAM-A', 'September', 2026, 5000, 0), rec('FAM-A', 'October', 2026, 5000, 0),
  rec('FAM-B', 'September', 2026, 5000, 0), rec('FAM-B', 'October', 2026, 5000, 0),
  rec('FAM-C', 'September', 2026, 5000, 0), rec('FAM-C', 'October', 2026, 5000, 0),
  rec('FAM-E', 'September', 2026, 5000, 0), rec('FAM-E', 'October', 2026, 5000, 0),
  rec('FAM-G', 'September', 2026, 5000, 0), rec('FAM-G', 'October', 2026, 5000, 0),
  rec('FAM-A', 'November', 2026, 5000, 0),
  rec('FAM-C', 'November', 2026, 2000, 3000, 'Partial (Balance Remaining)'),
  rec('FAM-G', 'November', 2026, 5000, 5000, 'Partial (Balance Remaining)'),
  rec('FAM-D', 'November', 2026, 5000, 0, 'Cancelled', 'R-FAM-D-CANCEL'),
  rec('FAM-D', 'January', 2026, 0, 5000, 'Pending', 'R-FAM-D-JAN'),
  rec('FAM-D', 'February', 2026, 0, 5000, 'Pending', 'R-FAM-D-FEB'),
  rec('FAM-D', 'March', 2026, 0, 5000, 'Pending', 'R-FAM-D-MAR'),
  rec('FAM-D', 'April', 2026, 0, 5000, 'Pending', 'R-FAM-D-APR'),
  rec('FAM-F', 'September', 2026, 5000, 0, 'Cancelled', 'R-FAM-F-CANCEL')
];
// Second scenario (credit-settled): FAM-H's November bill is covered by
// credit — a zero-amount record with remainingBalance 0. The Paid KPI
// counts it (remainingBalance <= 0), so the receipts chip must count it
// too, even though nothing was paid in cash.
const FAMILIES_H = [
  { id: 'FAM-A', parent_name: 'Paid Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'A1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' },
  { id: 'FAM-H', parent_name: 'Credit Settled Family', monthly_fee: 5000, currency: 'PKR', status: 'Active', students: [{ name: 'H1', status: 'Active', joining_date: '2026-09-05' }], notes: '{}' }
];
const RECORDS_H = [
  rec('FAM-A', 'September', 2026, 5000, 0), rec('FAM-A', 'October', 2026, 5000, 0),
  rec('FAM-H', 'September', 2026, 5000, 0), rec('FAM-H', 'October', 2026, 5000, 0),
  rec('FAM-A', 'November', 2026, 5000, 0),
  rec('FAM-H', 'November', 2026, 0, 0, 'Paid in Full')
];
const OVERRIDES = {
  'FAM-E_november_2026': { familyId: 'FAM-E', month: 'November', year: 2026, status: 'leave', notes: 'Approved Leave' }
};

function makeHarness(familiesArg, recordsArg) {
  const fams = familiesArg || FAMILIES;
  const recs = recordsArg || RECORDS;
  const HIDDEN = new Set(['feeAdvanceBox']);
  const elements = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, makeElement(HIDDEN.has(id)));
      return elements.get(id);
    },
    createElement: () => makeElement(false),
    querySelectorAll: () => []
  };
  documentStub.getElementById('feeDashMonthSelect').value = 'November';
  documentStub.getElementById('feeDashYearSelect').value = '2026';
  const store = {
    alhuda_fee_records: JSON.stringify(recs),
    alhuda_fee_matrix_overrides: JSON.stringify(OVERRIDES)
  };
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const windowStub = {
    lmsNotify: () => {},
    lmsConfirm: async () => true,
    FeePhase4: { allFeeCurrencies: () => [], getCustomCurrencies: () => [] }
  };
  const phaseSandbox = { window: windowStub, document: documentStub, console, setTimeout, clearTimeout };
  phaseSandbox.globalThis = phaseSandbox;
  vm.runInNewContext(PHASE1_SRC, phaseSandbox);
  vm.runInNewContext(PHASE3_SRC, phaseSandbox);
  vm.runInNewContext(PHASE6_SRC, phaseSandbox);
  const switchTabCalls = [];
  const setDirectoryKpiCalls = [];
  const subTabCalls = [];
  const factory = new Function('window', 'document', 'localStorage', 'console', 'families', `
    ${extractConst(FEES_SRC, 'FEE_CONFIG')}
    const CURRENT_USER = { role: 'owner' };
    let CLOUD_FEE_RECORDS_CACHE = null;
    let CLOUD_MATRIX_OVERRIDES_CACHE = null;
    let CACHED_PENDING_FEE_LIST = null;
    let CACHED_THREE_MONTH_DEFAULTERS = [];
    let FEE_CURRENT_SUBTAB = 'fee-subtab-overview';
    let FEE_KPI_SELECTED = null;
    let FEE_KPI_COUNTS = null;
    let FEE_RECEIPTS_MONTH_FILTER = null;
    let isNavigatingHistory = false;
    const CACHED_FEE_FAMILIES = families;
    const ALL_STUDENTS = families.flatMap((f) => (f.students || []).map((s) => ({ ...s, familyId: f.id })));
    const ALL_LEAVE_RECORDS = [];
    const lmsNotify = window.lmsNotify || (() => {});
    const lmsConfirm = (...args) => window.lmsConfirm(...args);
    function switchTab(tabId) { window.__switchTabCalls.push(tabId); }
    function setDirectoryKpi(mode, target) { window.__setDirectoryKpiCalls.push([mode, target]); }
    function isFamilyDeactivated(fam) { return fam && String(fam.status || '').toLowerCase() === 'inactive'; }
    function getActiveFamilies(fams) { return fams.filter((f) => !isFamilyDeactivated(f)); }
    function getOnLeaveFamilies(fams) { return fams.filter((f) => f.id === 'FAM-E'); }
    function getFamilyEmailAddress(fam) { return (fam && fam.email) || ''; }
    function loadPendingDefaultersList() { window.__subTabCalls.push('fee-subtab-pending'); }
    function loadThreePlusDefaultersList() { window.__subTabCalls.push('fee-subtab-defaulters'); }
    function loadMasterAnnualMatrix() { window.__subTabCalls.push('fee-subtab-matrix'); }
    function loadFeeReceiptsHistory() { window.__subTabCalls.push('fee-subtab-receipts'); }
    ${extractFunction(FEES_SRC, 'getStoredFeeRecords')}
    ${extractFunction(FEES_SRC, 'getStoredMatrixOverrides')}
    ${extractFunction(FEES_SRC, 'checkFamilyLeaveInMonth')}
    ${extractFunction(FEES_SRC, 'getFamilyEnrollmentInfo')}
    ${extractFunction(FEES_SRC, 'isFamilyPreAdmission')}
    ${extractFunction(FEES_SRC, 'feeFormApplicableFeeDetails')}
    ${extractFunction(FEES_SRC, 'isFeeStatusRowRecord')}
    ${extractFunction(FEES_SRC, 'isFamilyMonthStatusPaid')}
    ${extractFunction(FEES_SRC, 'isFeeRecordCancelled')}
    ${extractFunction(FEES_SRC, 'calculateThreePlusMonthDefaulters')}
    ${extractFunction(FEES_SRC, 'renderFeeCurrencyGrid')}
    ${extractFunction(FEES_SRC, 'loadFeeDashboardStats')}
    ${extractFunction(FEES_SRC, 'switchFeeSubTab')}
    ${extractFunction(FEES_SRC, 'clearFeeKpiSelection')}
    ${extractFunction(FEES_SRC, 'syncFeeKpiCardsUI')}
    ${extractFunction(FEES_SRC, 'feeKpiMonthYear')}
    ${extractFunction(FEES_SRC, 'handleFeeKpiClick')}
    ${extractFunction(FEES_SRC, 'setFeeReceiptsMonthFilter')}
    ${extractFunction(FEES_SRC, 'clearFeeReceiptsMonthFilter')}
    ${extractFunction(FEES_SRC, 'syncFeeReceiptsMonthChip')}
    return { loadFeeDashboardStats, handleFeeKpiClick, get cachedPending() { return CACHED_PENDING_FEE_LIST; }, get cachedDefaulters() { return CACHED_THREE_MONTH_DEFAULTERS; }, get kpiCounts() { return FEE_KPI_COUNTS; }, get kpiSelected() { return FEE_KPI_SELECTED; }, get receiptsFilter() { return FEE_RECEIPTS_MONTH_FILTER; } };
  `);
  windowStub.__switchTabCalls = switchTabCalls;
  windowStub.__setDirectoryKpiCalls = setDirectoryKpiCalls;
  windowStub.__subTabCalls = subTabCalls;
  const api = factory(windowStub, documentStub, localStorageStub, console, fams);
  return { api, el: (id) => documentStub.getElementById(id), switchTabCalls, setDirectoryKpiCalls, subTabCalls };
}

// ---- structural: the five cards exist in the page ----------------------------
{
  const cards = ['feeKpiCard-active', 'feeKpiCard-paid', 'feeKpiCard-pendings', 'feeKpiCard-defaulters', 'feeKpiCard-leave'];
  check('index.html has all five KPI cards as buttons', cards.every((id) => INDEX_SRC.includes(`id="${id}"`)), cards.filter((id) => !INDEX_SRC.includes(`id="${id}"`)).join(','));
  check('index.html KPI grid has 5 columns on large screens', INDEX_SRC.includes('lg:grid-cols-5'));
  check('index.html no longer has the combined "Pending Defaulters" card', !INDEX_SRC.includes('Pending Defaulters'));
  check('index.html keeps one Collect Fee button (dashboard) and drops the header one', !INDEX_SRC.includes('Collect Fee (1-Click)') && INDEX_SRC.includes('Collect Fee Now'));
  check('index.html drops the Pending + Defaulters top-bar buttons', !INDEX_SRC.includes('btnFeeSubTab-pending') && !INDEX_SRC.includes('btnFeeSubTab-defaulters'));
  check('fees.js keeps the Pending/Defaulters sub-view loaders', FEES_SRC.includes('function loadPendingDefaultersList') && FEES_SRC.includes('function loadThreePlusDefaultersList'));
  const switchBody = FEES_SRC.slice(FEES_SRC.indexOf('function switchFeeSubTab'), FEES_SRC.indexOf('function switchFeeSubTab') + 4000);
  check('fees.js switchFeeSubTab still routes to pending + defaulters programmatically', switchBody.includes("'fee-subtab-pending'") && switchBody.includes('loadPendingDefaultersList') && switchBody.includes("'fee-subtab-defaulters'") && switchBody.includes('loadThreePlusDefaultersList'));
  check('fees.js switchFeeSubTab also clears the KPI selection', FEES_SRC.includes('clearFeeKpiSelection()'));
}

const h = makeHarness();
await h.api.loadFeeDashboardStats();

{
  const counts = h.api.kpiCounts;
  check('dashboard: Active Families = 5 (A, B, C, F, G — E on leave, D deactivated)', String(h.el('kpiFeeTotalFamilies').innerText) === '5', String(h.el('kpiFeeTotalFamilies').innerText));
  check('dashboard: Paid Families = 1 (A only — G pays the month fee but arrears stand)', String(h.el('kpiFeePaidCount').innerText) === '1', String(h.el('kpiFeePaidCount').innerText));
  check('dashboard: Pendings = 4 (B, C, F, G — strictly November)', String(h.el('kpiFeePendingCount').innerText) === '4', String(h.el('kpiFeePendingCount').innerText));
  check('dashboard: Defaulters = 1 (F only — 3+ months)', String(h.el('kpiFeeDefaultersCount').innerText) === '1', String(h.el('kpiFeeDefaultersCount').innerText));
  check('dashboard: On Leave = 1 (E only)', String(h.el('kpiFeeLeaveCount').innerText) === '1', String(h.el('kpiFeeLeaveCount').innerText));
  check('dashboard: KPI count cache matches the painted counts', counts && counts.active === 5 && counts.paid === 1 && counts.pendings === 4 && counts.defaulters === 1 && counts.onLeave === 1, JSON.stringify(counts));
  const pendingIds = (h.api.cachedPending || []).map((p) => p.familyId).sort();
  check('count == list: Pending list holds exactly B, C, F, G', pendingIds.join(',') === 'FAM-B,FAM-C,FAM-F,FAM-G', pendingIds.join(','));
  const defIds = (h.api.cachedDefaulters || []).map((d) => d.familyId).sort();
  check('count == list: Defaulters list holds exactly F', defIds.join(',') === 'FAM-F', defIds.join(','));
  check('count == list: the deactivated family is in NO list', !pendingIds.includes('FAM-D') && !defIds.includes('FAM-D'));
  check('count == list: a cancelled payment never counts as Paid', String(h.el('kpiFeePaidCount').innerText) === '1');
  check('count == list: a cancelled September payment never rescues a defaulter', defIds.includes('FAM-F'));
}

{
  // Click targets: each card opens/filters the EXISTING view.
  h.api.handleFeeKpiClick('active');
  check('click Active: opens the Families tab with the v3 active filter', h.switchTabCalls.includes('tab-families') && h.setDirectoryKpiCalls.some((c) => c[0] === 'active'));
  h.api.handleFeeKpiClick('leave');
  check('click On Leave: opens the Families tab with the v3 leave filter', h.switchTabCalls.includes('tab-families') && h.setDirectoryKpiCalls.some((c) => c[0] === 'leave'));
  h.api.handleFeeKpiClick('paid');
  check('click Paid: opens Receipts filtered to the selected month', h.subTabCalls.includes('fee-subtab-receipts') && h.api.receiptsFilter && h.api.receiptsFilter.monthIdx === 10 && h.api.receiptsFilter.year === 2026, JSON.stringify(h.api.receiptsFilter));
  check('click Paid: the receipts chip states the month + fully-paid count (A only — C is partial, G still owes arrears)', h.el('feeReceiptsMonthChipText').innerText.indexOf('November 2026') !== -1 && h.el('feeReceiptsMonthChipText').innerText.indexOf('1 paid family') !== -1 && h.el('feeReceiptsMonthChipText').innerText.indexOf('(3 receipts)') !== -1, h.el('feeReceiptsMonthChipText').innerText);
  h.api.handleFeeKpiClick('pendings');
  check('click Pendings: opens the existing Pending sub-view', h.subTabCalls.includes('fee-subtab-pending'));
  h.api.handleFeeKpiClick('defaulters');
  check('click Defaulters: opens the existing 3+ Defaulters sub-view', h.subTabCalls.includes('fee-subtab-defaulters'));
  check('click: the last-clicked card carries the selected state', h.el('feeKpiCard-defaulters').classList.contains('fee-kpi-selected') && h.el('feeKpiCard-defaulters').getAttribute('aria-pressed') === 'true');
  check('click: only one card is selected at a time', ['active', 'paid', 'pendings', 'leave'].every((k) => !h.el('feeKpiCard-' + k).classList.contains('fee-kpi-selected')));
  check('click: re-loading the dashboard clears the selection', (() => { h.api.loadFeeDashboardStats(); return h.api.kpiSelected === null; })());
}

{
  // Credit-settled scenario: H pays nothing in cash in November — the
  // bill is covered by credit (remainingBalance 0). The Paid KPI counts
  // it, so the receipts chip must count it too.
  const h2 = makeHarness(FAMILIES_H, RECORDS_H);
  await h2.api.loadFeeDashboardStats();
  check('credit-settled: Paid Families = 2 (A + H)', String(h2.el('kpiFeePaidCount').innerText) === '2', String(h2.el('kpiFeePaidCount').innerText));
  check('credit-settled: Pendings = 0', String(h2.el('kpiFeePendingCount').innerText) === '0', String(h2.el('kpiFeePendingCount').innerText));
  h2.api.handleFeeKpiClick('paid');
  check('credit-settled: the receipts chip counts the credit-settled family', h2.el('feeReceiptsMonthChipText').innerText.indexOf('2 paid families') !== -1 && h2.el('feeReceiptsMonthChipText').innerText.indexOf('(2 receipts)') !== -1, h2.el('feeReceiptsMonthChipText').innerText);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
