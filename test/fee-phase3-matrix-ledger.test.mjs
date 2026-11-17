// Fee Upgrade Phase 3 — matrix + ledger integration (#33, #36, #45).
// Executes the REAL buildAnnualMatrixData + isFamilyMonthStatusPaid +
// renderFeeReceiptsHistoryRows from js/fees.js (extracted by name, same
// pattern as the Phase 1 fee-form suite) and the REAL paymentRowFromLegacy
// + loadPaymentsForFamily from js/fee-tables.js, plus structural checks
// for the dashboard / defaulters / fee-form / ledger / 360 wiring.
// Run from the repo root: node test/fee-phase3-matrix-ledger.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const TABLES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PHASE3_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase3.js'), 'utf8');
const PHASE5_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase5.js'), 'utf8');
const PHASE6_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase6.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const P360_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Brace scanner copied from the Phase 1 fee-form suite: skips string
// literals, template literals and comments, keeps a preceding `async`.
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

function makeElement() {
  return {
    value: '', innerText: '', innerHTML: '', className: '', checked: false, disabled: false,
    dataset: {}, style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: () => {}, querySelectorAll: () => []
  };
}

const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_IDX = NOW.getMonth();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function realRec(receiptNo, month, amountPaid, remainingBalance, status) {
  return { receiptNo, familyId: 'FAM-021', month, year: CUR_YEAR, monthlyFee: 5000, amountPaid, discount: 0, remainingBalance, status: status || 'Paid in Full', date: CUR_YEAR + '-01-05', currency: 'PKR', recordKind: 'payment' };
}
function adjRec(month, monthIdx) {
  return { receiptNo: 'ADJ-' + CUR_YEAR + String(monthIdx + 1).padStart(2, '0') + '-FAM-021', familyId: 'FAM-021', month, year: CUR_YEAR, monthlyFee: 5000, amountPaid: 0, discount: 0, remainingBalance: 0, status: 'Paid (Status)', date: CUR_YEAR + '-11-17', currency: 'PKR', recordKind: 'month_status', paymentMethod: 'One-Tap Quick Status' };
}

function makeMatrixHarness(records, overrides) {
  const family = {
    id: 'FAM-021', parent_name: 'Bilal Ahmed', monthly_fee: 5000, currency: 'PKR',
    students: [{ name: 'Ahmed', status: 'Active', joining_date: CUR_YEAR + '-01-15' }],
    notes: '{}'
  };
  const store = {
    alhuda_fee_records: JSON.stringify(records),
    alhuda_fee_matrix_overrides: JSON.stringify(overrides || {})
  };
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const elements = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement: () => makeElement(),
    querySelectorAll: () => []
  };
  const windowStub = { lmsNotify: () => {} };
  const phaseSandbox = { window: windowStub, document: documentStub, console, setTimeout, clearTimeout };
  phaseSandbox.globalThis = phaseSandbox;
  vm.runInNewContext(PHASE1_SRC, phaseSandbox);
  vm.runInNewContext(PHASE3_SRC, phaseSandbox);
  // Fee Upgrade Phase 5: renderFeeReceiptsHistoryRows now calls the
  // feeReceiptPdfCellHtml helper — load the real module so the real
  // stored/pending predicate is exercised, not the fallback.
  vm.runInNewContext(PHASE5_SRC, phaseSandbox);
  // Fee Dashboard + Form Improvements: renderFeeReceiptsHistoryRows
  // now applies the Paid-KPI month filter through FeePhase6.
  vm.runInNewContext(PHASE6_SRC, phaseSandbox);

  const factory = new Function('window', 'document', 'localStorage', 'console', 'families', `
    ${extractConst(FEES_SRC, 'FEE_CONFIG')}
    let CLOUD_FEE_RECORDS_CACHE = null;
    let CLOUD_MATRIX_OVERRIDES_CACHE = null;
    // Fee Dashboard + Form Improvements: the Paid-KPI receipts month
    // filter state read by renderFeeReceiptsHistoryRows.
    let FEE_RECEIPTS_MONTH_FILTER = null;
    const CACHED_FEE_FAMILIES = families;
    const ALL_LEAVE_RECORDS = [];
    const lmsNotify = window.lmsNotify || (() => {});
    ${extractFunction(FEES_SRC, 'getStoredFeeRecords')}
    ${extractFunction(FEES_SRC, 'getStoredMatrixOverrides')}
    ${extractFunction(FEES_SRC, 'checkFamilyLeaveInMonth')}
    ${extractFunction(FEES_SRC, 'getFamilyEnrollmentInfo')}
    ${extractFunction(FEES_SRC, 'isFamilyPreAdmission')}
    ${extractFunction(FEES_SRC, 'isFeeStatusRowRecord')}
    ${extractFunction(FEES_SRC, 'isFamilyMonthStatusPaid')}
    ${extractFunction(FEES_SRC, 'buildAnnualMatrixData')}
    ${extractFunction(FEES_SRC, 'feeReceiptUndoCellHtml')}
    ${extractFunction(FEES_SRC, 'feeReceiptPdfCellHtml')}
    ${extractFunction(FEES_SRC, 'renderFeeReceiptsHistoryRows')}
    return { buildAnnualMatrixData, isFamilyMonthStatusPaid, isFeeStatusRowRecord, renderFeeReceiptsHistoryRows, getStoredFeeRecords };
  `);
  const api = factory(windowStub, documentStub, localStorageStub, console, [family]);
  return { api, el: (id) => documentStub.getElementById(id), family };
}

// ---- buildAnnualMatrixData: the REAL matrix builder ------------------------------
{
  const records = [
    realRec('AH-REC-001', 'January', 5000, 0),
    adjRec('February', 1),
    realRec('AH-REC-003', 'March', 3000, 2000, 'Partial (Balance Remaining)'),
    realRec('AH-REC-004', 'April', 5000, 0),
    adjRec('April', 3),
    adjRec('September', 8),
    realRec('AH-REC-009', 'September', 2000, 3000, 'Partial (Balance Remaining)')
  ];
  const overrides = {
    ['FAM-021_june_' + CUR_YEAR]: { familyId: 'FAM-021', month: 'June', year: CUR_YEAR, status: 'paid' },
    ['FAM-021_july_' + CUR_YEAR]: { familyId: 'FAM-021', month: 'July', year: CUR_YEAR, status: 'leave', notes: 'Approved Leave' },
    ['FAM-021_august_' + CUR_YEAR]: { familyId: 'FAM-021', month: 'August', year: CUR_YEAR, status: 'not_enrolled', notes: 'Not Enrolled' }
  };
  const { api } = makeMatrixHarness(records, overrides);
  const rows = api.buildAnnualMatrixData(CUR_YEAR);
  check('matrix: one row for the family', rows.length === 1 && rows[0].familyId === 'FAM-021');
  const m = (name) => rows[0].months.find((x) => x.month === name);
  check('matrix: real paid month reads paid, not status', m('January').isPaid === true && !m('January').isStatusPaid, JSON.stringify(m('January')));
  check('matrix: ADJ-only month reads Paid (Status), amount 0', m('February').isPaid === true && m('February').isStatusPaid === true && m('February').amountPaid === 0, JSON.stringify(m('February')));
  check('matrix: real partial month reads partial with the paid amount', m('March').isPartial === true && m('March').amountPaid === 3000, JSON.stringify(m('March')));
  check('matrix: ADJ + real paid — MONEY WINS, month is a normal paid month', m('April').isPaid === true && !m('April').isStatusPaid && m('April').amountPaid === 5000, JSON.stringify(m('April')));
  check('matrix: ADJ + real partial — money wins, partial 2000 paid', m('September').isPartial === true && m('September').amountPaid === 2000 && !m('September').isStatusPaid, JSON.stringify(m('September')));
  check('matrix: legacy paid override reads Paid (Status)', m('June').isPaid === true && m('June').isStatusPaid === true, JSON.stringify(m('June')));
  check('matrix: leave override beats a status row (leave stays leave)', m('July').isLeave === true && !m('July').isPaid, JSON.stringify(m('July')));
  check('matrix: not-enrolled override reads Not Enrolled', m('August').isNotEnrolled === true, JSON.stringify(m('August')));
  const dueIdx = CUR_IDX; // the current month, no records -> due
  check('matrix: current month with no records reads Due', m(MONTHS[dueIdx]).isDue === true && !m(MONTHS[dueIdx]).isPaid, JSON.stringify(m(MONTHS[dueIdx])));
  if (CUR_IDX < 11) {
    check('matrix: next month reads Future', m(MONTHS[CUR_IDX + 1]).isFuture === true, JSON.stringify(m(MONTHS[CUR_IDX + 1])));
  } else {
    const nextYear = api.buildAnnualMatrixData(CUR_YEAR + 1);
    check('matrix: every month next year reads Future', nextYear[0].months.every((x) => x.isFuture === true));
  }
  // isFamilyMonthStatusPaid, the predicate the dashboard / defaulters /
  // fee-form arrears call — executed here against the same records.
  const all = api.getStoredFeeRecords();
  check('predicate: ADJ-only month is status-paid', api.isFamilyMonthStatusPaid('FAM-021', 1, CUR_YEAR, all) === true);
  check('predicate: ADJ + real payment is NOT status-paid (money wins)', api.isFamilyMonthStatusPaid('FAM-021', 3, CUR_YEAR, all) === false);
  check('predicate: ADJ + real partial is NOT status-paid', api.isFamilyMonthStatusPaid('FAM-021', 8, CUR_YEAR, all) === false);
  check('predicate: due month is not status-paid', api.isFamilyMonthStatusPaid('FAM-021', dueIdx, CUR_YEAR, all) === false);
  check('predicate: legacy paid override is NOT an ADJ row (different mechanism)', api.isFamilyMonthStatusPaid('FAM-021', 5, CUR_YEAR, all) === false);
  check('predicate: record-level check spots ADJ rows', api.isFeeStatusRowRecord(adjRec('February', 1)) === true && api.isFeeStatusRowRecord(realRec('AH-REC-001', 'January', 5000, 0)) === false);
}

// ---- renderFeeReceiptsHistoryRows: ADJ never renders as a receipt ------------------
{
  const records = [
    { receiptNo: 'AH-REC-001', familyId: 'FAM-021', parentName: 'Bilal Ahmed', studentsNames: 'Ahmed', month: 'January', year: CUR_YEAR, date: CUR_YEAR + '-01-05', currency: 'PKR', totalPayable: 5000, amountPaid: 5000, remainingBalance: 0, status: 'Paid in Full' },
    adjRec('February', 1),
    { receiptNo: 'AH-REC-003', familyId: 'FAM-021', parentName: 'Bilal Ahmed', studentsNames: 'Ahmed', month: 'March', year: CUR_YEAR, date: CUR_YEAR + '-03-05', currency: 'PKR', totalPayable: 5000, amountPaid: 3000, remainingBalance: 2000, status: 'Partial (Balance Remaining)' }
  ];
  const { api, el } = makeMatrixHarness(records, {});
  api.renderFeeReceiptsHistoryRows(records);
  const html = el('feeReceiptsTableBody').innerHTML;
  check('receipts: real receipts render', html.includes('AH-REC-001') && html.includes('AH-REC-003'));
  check('receipts: the ADJ row NEVER renders (no ref, no status text)', !html.includes('ADJ-') && !html.includes('Paid (Status)') && !html.includes('One-Tap Quick Status'));
  check('receipts: only the two real rows render', (html.match(/<tr class="hover:bg-slate-50 transition">/g) || []).length === 2);
  api.renderFeeReceiptsHistoryRows([adjRec('February', 1)]);
  check('receipts: ADJ-only input renders the empty message, not a row', el('feeReceiptsTableBody').innerHTML.includes('No payment receipts recorded yet'));
}

// ---- fee-tables.js: dual-write + money readers --------------------------------------
{
  const factory = new Function('window', 'document', 'console', `
    var db = window.__fakeDb;
    var MONTH_NAMES = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
    var MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    ${extractFunction(TABLES_SRC, 'getDb')}
    ${extractFunction(TABLES_SRC, '_monthNumber')}
    ${extractFunction(TABLES_SRC, '_period')}
    ${extractFunction(TABLES_SRC, '_periodParts')}
    ${extractFunction(TABLES_SRC, '_parseLegacyJson')}
    ${extractFunction(TABLES_SRC, 'periodFromMonthYear')}
    ${extractFunction(TABLES_SRC, 'normaliseFeeStatus')}
    ${extractFunction(TABLES_SRC, 'currentActor')}
    ${extractFunction(TABLES_SRC, 'paymentRowFromLegacy')}
    ${extractFunction(TABLES_SRC, 'paymentLegacyFromRow')}
    ${extractFunction(TABLES_SRC, 'loadPaymentsForFamily')}
    return { paymentRowFromLegacy, loadPaymentsForFamily };
  `);
  const tableRows = [
    { receipt_no: 'AH-REC-001', family_id: 'FAM-021', record_kind: 'payment', amount_paid: 5000, month_label: 'January 2026', billing_period: '2026-01', legacy_json: '{}' },
    { receipt_no: 'ADJ-202602-FAM-021', family_id: 'FAM-021', record_kind: 'month_status', amount_paid: 0, month_label: 'February 2026', billing_period: '2026-02', legacy_json: '{}' },
    { receipt_no: 'DUE-202603-FAM-021', family_id: 'FAM-021', record_kind: 'due_invoice', amount_paid: 0, month_label: 'March 2026', billing_period: '2026-03', legacy_json: '{}' }
  ];
  const fakeDb = {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: tableRows, error: null })
      })
    })
  };
  const windowStub = { __fakeDb: fakeDb, CURRENT_ROLE: 'owner' };
  const api = factory(windowStub, { getElementById: () => null }, console);

  const adjRow = api.paymentRowFromLegacy({ familyId: 'FAM-021', receiptNo: 'ADJ-202602-FAM-021', month: 'February', year: CUR_YEAR, recordKind: 'month_status', amountPaid: 0, status: 'Paid (Status)' });
  check('dual-write: an ADJ record keeps record_kind month_status', adjRow.record_kind === 'month_status', adjRow.record_kind);
  check('dual-write: a due-invoice record keeps record_kind due_invoice', api.paymentRowFromLegacy({ familyId: 'FAM-021', receiptNo: 'DUE-1', recordKind: 'due_invoice' }).record_kind === 'due_invoice');
  check('dual-write: a manual invoice still maps to manual_invoice', api.paymentRowFromLegacy({ familyId: 'FAM-021', receiptNo: 'INV-1', isManualInvoice: true }).record_kind === 'manual_invoice');
  check('dual-write: a plain record still maps to payment', api.paymentRowFromLegacy({ familyId: 'FAM-021', receiptNo: 'AH-REC-1' }).record_kind === 'payment');

  const loaded = await api.loadPaymentsForFamily('FAM-021');
  check('money reader: loadPaymentsForFamily returns only the real payment', Array.isArray(loaded) && loaded.length === 1 && loaded[0].receiptNo === 'AH-REC-001', JSON.stringify(loaded && loaded.map((r) => r.receiptNo)));
  check('money reader: the ADJ row is filtered before mapping', !(loaded || []).some((r) => r.recordKind === 'month_status' || String(r.receiptNo || '').indexOf('ADJ-') === 0));
  check('money reader: the due-invoice row is still filtered too', !(loaded || []).some((r) => r.recordKind === 'due_invoice'));
}

// ---- wiring: dashboard / defaulters / fee form ---------------------------------------
check('fees.js dashboard Expected excludes ADJ-paid months', FEES_SRC.includes('isFamilyMonthStatusPaid(f.id, monthIdx3, selectedYear, records)'));
check('fees.js dashboard paidMap skips ADJ money but marks the month paid', FEES_SRC.includes("if (isFeeStatusRowRecord(r)) {") && FEES_SRC.includes('isFamilyMonthStatusPaid(r.familyId, monthIdx3, selectedYear, records)'));
check('fees.js defaulters skip ADJ-paid months', FEES_SRC.includes('isFamilyMonthStatusPaid(famUpper, mIdx, yr, records)'));
check('fees.js fee-form arrears skip ADJ-paid months', FEES_SRC.includes('isFamilyMonthStatusPaid(famId, m, targetYear, records)'));
check('fees.js fee-form paid-by-month skips ADJ rows', FEES_SRC.includes("if (isFeeStatusRowRecord(r)) return;"));
check('fees.js ledger transactions filter ADJ rows out', FEES_SRC.includes('!isFeeStatusRowRecord(r)'));

// ---- wiring: matrix modal + ledger + switcher -----------------------------------------
check('fees.js matrix modal renders the one-tap buttons', FEES_SRC.includes("document.getElementById('matrixActionStatusButtons')") && FEES_SRC.includes('matrixStatusButtonsHtml(window.FeePhase3.uiStateForMonth(m), realReceiptNo)'));
check('fees.js matrix modal status badge names a status-paid month', FEES_SRC.includes("m.isPaid && m.isStatusPaid") && FEES_SRC.includes('Paid (Status — no payment recorded)'));
check('fees.js applyMatrixAction handles mark_paid / mark_unpaid', FEES_SRC.includes("if (actionType === 'mark_paid' || actionType === 'mark_unpaid')") && FEES_SRC.includes('await markMonthPaid(familyId, mIdx, targetYearInt)') && FEES_SRC.includes('await markMonthUnpaid(familyId, mIdx, targetYearInt)'));
check('fees.js ledger cards carry the one-tap button', FEES_SRC.includes('ledgerStatusButtonHtml(window.FeePhase3.uiStateForMonth(m), m.month)'));
check('fees.js ledger has the mark handlers', FEES_SRC.includes('async function ledgerMarkMonthPaid(monthName)') && FEES_SRC.includes('async function ledgerMarkMonthUnpaid(monthName)'));
// Fee Dashboard + Form Improvements: the Phase 3 staged switcher is
// REMOVED from the Collect Fee form (the brief removes only the form
// section — the Ledger + Matrix one-tap buttons and the shared mark
// path stay, asserted above and below).
check('fees.js Collect Fee form no longer renders the status switcher', !FEES_SRC.includes('renderFeeStatusSwitcher') && !FEES_SRC.includes('function feeStatusSwitcherFamilyYear'));
check('fees.js staged switcher save/cancel/toggle are gone', !FEES_SRC.includes('saveStagedMonthStatuses') && !FEES_SRC.includes('cancelStagedMonthStatuses') && !FEES_SRC.includes('toggleStagedMonthStatus') && !FEES_SRC.includes('FEE_STATUS_STAGED'));
check('fees.js switchFeeSubTab / recalc / reset / refresh no longer call the switcher', !/switchFeeSubTab[\s\S]{0,1200}renderFeeStatusSwitcher/.test(FEES_SRC) && !/function refreshFeeViewsAfterStatusChange[\s\S]{0,400}renderFeeStatusSwitcher/.test(FEES_SRC));
check('fees.js shared write path exists with the cloud fail-closed Unpaid', FEES_SRC.includes('async function markMonthPaid(familyId, monthIdx, year)') && FEES_SRC.includes('async function markMonthUnpaid(familyId, monthIdx, year)') && FEES_SRC.includes("code: 'cloud_failed'"));
check('fees.js Mark Unpaid removes from family-notes fee_history', FEES_SRC.includes('async function removeFeeHistoryRecords(familyId, receiptNos)') && FEES_SRC.includes('notesObj.fee_history = notesObj.fee_history.filter'));
check('fees.js Mark Unpaid cancels (never deletes) the payments-table row', FEES_SRC.includes('dualWritePaymentCancelled') && FEES_SRC.includes("'status removed by one-tap Unpaid'"));

// ---- wiring: index.html ------------------------------------------------------------------
check('index.html loads js/fee-phase3.js right after fee-phase2.js', INDEX_SRC.indexOf('<script src="js/fee-phase3.js"></script>') > INDEX_SRC.indexOf('<script src="js/fee-phase2.js"></script>') && INDEX_SRC.indexOf('<script src="js/fee-phase3.js"></script>') > 0);
check('index.html Collect Fee switcher card is gone (grid + enrollment + save/cancel)', ['feeStatusSwitcherCard', 'feeStatusSwitcherGrid', 'feeStatusEnrollmentRow', 'feeStatusStagedLine', 'btnFeeStatusSaveStaged', 'btnFeeStatusCancelStaged'].every((id) => !INDEX_SRC.includes('id="' + id + '"')));
check('index.html keeps the fee-phase3.js script (Ledger/Matrix one-tap still use it)', INDEX_SRC.includes('<script src="js/fee-phase3.js"></script>'));
check('index.html matrix modal has the status buttons container', INDEX_SRC.includes('id="matrixActionStatusButtons"'));
{
  const buf = fs.readFileSync(path.join(REPO_ROOT, 'index.html'));
  const bareLF = buf.toString('utf8').replace(/\r\n/g, '').split('\n').length - 1;
  check('index.html is still CRLF (0 bare LF)', bareLF === 0, String(bareLF));
}

// ---- wiring: 360 tab + delete guard -------------------------------------------------------
check('profiles360.js 360 tab never renders an ADJ row as a receipt', P360_SRC.includes("const _isStatusRow = (r.recordKind === 'month_status')") && P360_SRC.includes("coveredMonths.add(`${mName.toLowerCase()}_${yr}`)"));
check('profiles360.js 360 tab counts an ADJ-paid current month as paid', P360_SRC.includes('_adjCurrentMonthPaid') && P360_SRC.includes('const currentMonthPaid = _adjCurrentMonthPaid ||'));
check('profiles360.js delete refuses an ADJ row', P360_SRC.includes("/^ADJ-\\d{6}-/i.test(String(recordId || ''))") && P360_SRC.includes('Use Mark Unpaid to remove it.'));

// ---- role gating: one-tap follows the Collect Fee scope (owner + manager) -----------------
check('fees.js mark functions have NO owner-only gate (manager allowed, same as Collect Fee)', !/markMonthPaid[\s\S]{0,400}CURRENT_ROLE === 'owner'/.test(FEES_SRC) && !/markMonthUnpaid[\s\S]{0,400}CURRENT_ROLE === 'owner'/.test(FEES_SRC));
check('fees.js the write path still validates through FeePhase3 (never trusts the UI)', FEES_SRC.includes('window.FeePhase3.validateMarkPaid') && FEES_SRC.includes('window.FeePhase3.validateMarkUnpaid'));
check('fees.js new Phase 3 UI strings are professional English', ['Marked Paid (status — no payment)', 'Could not remove the status from the cloud', 'marked Paid (status — no payment recorded)', 'marked Unpaid — the month is due again'].every((s) => FEES_SRC.includes(s)));

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
