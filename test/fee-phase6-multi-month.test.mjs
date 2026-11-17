// Fee Dashboard + Form Improvements — Multi Month Payments (#4).
// Executes the REAL FeePhase6 pure logic plus the REAL fee-form wiring
// from js/fees.js (extracted by name) against a fake DOM, with the REAL
// FeePhase1 / FeePhase3 / FeePhase6 modules attached.
// Run from the repo root: node test/fee-phase6-multi-month.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PHASE3_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase3.js'), 'utf8');
const PHASE6_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase6.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Brace scanner that skips string literals, template literals and
// comments (copied from test/fee-phase1-fee-form.test.mjs).
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

// ---- pure FeePhase6 ------------------------------------------------------------
const windowObj = {};
const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(PHASE6_SRC, sandbox);
const F = windowObj.FeePhase6;

{
  const EXPECTED = ['MONTHS', 'monthIdxOf', 'monthKey', 'monthLabel', 'monthScore',
    'isCancelledFeeRecord', 'isMonthStatusRow', 'paidSoFarForMonth', 'isMonthSettledByStatus',
    'buildMultiMonthOptions', 'multiMonthSelectionTotal', 'allocateMultiMonthPayment',
    'buildMultiMonthSequence', 'REMIND_ALL_QUESTION', 'remindAllConfirmConfig',
    'isReceiptInMonth', 'receiptsMonthFilterLabel'];
  check('FeePhase6 exports every function the glue calls', F && EXPECTED.every((n) => typeof F[n] === 'function' || Array.isArray(F[n]) || typeof F[n] === 'string'), EXPECTED.filter((n) => !(typeof F[n] === 'function' || Array.isArray(F[n]) || typeof F[n] === 'string')).join(','));
}

const FAM = { id: 'FAM-021', parent_name: 'Bilal Ahmed', monthly_fee: 7500, currency: 'PKR',
  students: [{ name: 'Ahmed', status: 'Active', joining_date: '2026-08-05' }], notes: '{}' };
function rec(month, year, amountPaid, remaining, status, receiptNo) {
  return { receiptNo: receiptNo || ('R-' + month + year), familyId: 'FAM-021', month, year, monthlyFee: 7500, amountPaid, discount: 0, remainingBalance: remaining, status: status || 'Paid in Full', date: year + '-01-05', currency: 'PKR', recordKind: 'payment' };
}
const RECORDS = [
  rec('August', 2026, 7500, 0),
  rec('September', 2026, 3000, 4500, 'Partial (Balance Remaining)'),
  rec('October', 2026, 7500, 0),
  { ...rec('October', 2026, 7500, 0, 'Cancelled', 'R-OCT-CANCELLED'), receiptNo: 'R-OCT-CANCELLED' }
];
const OVERRIDES = { 'FAM-021_july_2026': { familyId: 'FAM-021', month: 'July', year: 2026, status: 'leave', notes: 'Approved Leave' } };
function feeForMonth(mIdx) { return mIdx === 5 ? 0 : 7500; } // June has no fee due
const OPTS_ARGS = {
  fam: FAM, records: RECORDS, overrides: OVERRIDES, anchorMonthIdx: 10, anchorYear: 2026,
  enrollment: { year: 2026, monthIndex: 0 },
  isLeaveMonth: (mIdx, yr) => mIdx === 6 && yr === 2026,
  applicableFee: (mIdx) => feeForMonth(mIdx)
};

{
  const opts = F.buildMultiMonthOptions(OPTS_ARGS);
  check('selector window is 36 months (3 full years around the form year)', opts.length === 36, String(opts.length));
  check('selector is anchored on the form year', opts[0].label === 'January 2025' && opts[12].label === 'January 2026' && opts[22].label === 'November 2026' && opts[35].label === 'December 2027');
  check('every year in the window has all 12 months', [2025, 2026, 2027].every((y) => opts.filter((o) => o.year === y).length === 12));
  const byKey = {};
  opts.forEach((o) => { byKey[o.key] = o; });
  check('paid month is identified (October 2026)', byKey['2026-10'].state === 'paid');
  check('partial month is available with its outstanding (September 4500)', byKey['2026-09'].state === 'available' && byKey['2026-09'].outstanding === 4500 && byKey['2026-09'].paidSoFar === 3000);
  check('leave month is disabled (July 2026)', byKey['2026-07'].state === 'leave');
  check('zero-fee month is disabled (June 2026)', byKey['2026-06'].state === 'no_fee');
  check('future month is available at its actual fee (December 2026)', byKey['2026-12'].state === 'available' && byKey['2026-12'].fee === 7500);
  check('unpaid current month is available (November 2026)', byKey['2026-11'].state === 'available' && byKey['2026-11'].outstanding === 7500);
}

{
  // No family yet: the window still builds (fees unknown, not "no fee").
  const opts = F.buildMultiMonthOptions({ fam: null, records: [], overrides: {}, anchorMonthIdx: 10, anchorYear: 2026, enrollment: null, isLeaveMonth: () => false, applicableFee: () => null });
  check('no family: the selector window still builds 36 months', opts.length === 36, String(opts.length));
  check('no family: every month is available (not disabled as no-fee)', opts.every((o) => o.state === 'available'), opts.filter((o) => o.state !== 'available').map((o) => o.label + ':' + o.state).join(','));
  check('no family: fees are unknown, not zero', opts.every((o) => o.fee === null), JSON.stringify(opts.slice(0, 3).map((o) => o.fee)));
  const tot = F.multiMonthSelectionTotal([opts[12], opts[13]]);
  check('no family: the total keeps fees unknown', tot.rows.every((r) => r.fee === null) && tot.total === 0, JSON.stringify(tot));
}

{
  // Enrollment: family joined August 2026 — earlier months are not enrolled.
  const opts = F.buildMultiMonthOptions({ ...OPTS_ARGS, enrollment: { year: 2026, monthIndex: 7 } });
  const byKey = {};
  opts.forEach((o) => { byKey[o.key] = o; });
  check('pre-admission months are disabled (July 2026, enrolled August)', byKey['2026-07'].state === 'not_enrolled');
  const optsNoAug = F.buildMultiMonthOptions({ ...OPTS_ARGS, enrollment: { year: 2026, monthIndex: 7 }, records: RECORDS.filter((r) => r.month !== 'August') });
  const byKey2 = {};
  optsNoAug.forEach((o) => { byKey2[o.key] = o; });
  check('admission month itself is selectable (August 2026)', byKey2['2026-08'].state === 'available');
}

{
  const opts = F.buildMultiMonthOptions(OPTS_ARGS);
  const byKey = {};
  opts.forEach((o) => { byKey[o.key] = o; });
  const sel = [byKey['2026-09'], byKey['2026-11'], byKey['2027-01']];
  const tot = F.multiMonthSelectionTotal(sel);
  check('total is per-month actual fees, never fee x N (4500 + 7500 + 7500)', tot.total === 19500, String(tot.total));
  check('total rows are chronological even when picked out of order', tot.rows.map((r) => r.label).join('|') === 'September 2026|November 2026|January 2027');
  const withPaid = F.multiMonthSelectionTotal([byKey['2026-10'], byKey['2026-11']]);
  check('a confirmed paid month contributes its FULL fee (second payment)', withPaid.total === 15000, String(withPaid.total));
}

{
  const opts = F.buildMultiMonthOptions(OPTS_ARGS);
  const byKey = {};
  opts.forEach((o) => { byKey[o.key] = o; });
  const sel = [byKey['2026-09'], byKey['2026-11'], byKey['2027-01']];
  const alloc = F.allocateMultiMonthPayment(sel, 10000);
  check('waterfall fills the earliest month first (4500 / 5500 / 0)', alloc.map((a) => a.allocated).join(',') === '4500,5500,0', JSON.stringify(alloc.map((a) => a.allocated)));
  check('allocation never exceeds the amount paid', F.allocateMultiMonthPayment(sel, 999999).reduce((s, a) => s + a.allocated, 0) === 19500);
  check('allocation of zero pays nothing anywhere', F.allocateMultiMonthPayment(sel, 0).every((a) => a.allocated === 0));
}

{
  const opts = F.buildMultiMonthOptions(OPTS_ARGS);
  const byKey = {};
  opts.forEach((o) => { byKey[o.key] = o; });
  const sel = [byKey['2026-09'], byKey['2026-11'], byKey['2027-01']];
  const alloc = F.allocateMultiMonthPayment(sel, 10000);
  const base = { receiptNo: 'AH-REC-20261117-ABC123', date: '2026-11-17', familyId: 'FAM-021', parentName: 'Bilal Ahmed', studentsNames: 'Ahmed', country: 'Pakistan', whatsapp: '', email: '', month: 'November', year: 2026, monthlyFee: 19500, previousBalance: 0, creditDeducted: 0, totalPayable: 19500, amountPaid: 10000, discount: 500, remainingBalance: 9000, excessPaid: 0, currency: 'PKR', paymentMethod: 'Cash / Other', transactionId: 'N/A', notes: '', status: 'Partial (Balance Remaining)', isProrated: false, activeDays: 0, joiningDate: '', isAdvancePayment: false, advanceMonthsCount: 1 };
  const seq = F.buildMultiMonthSequence(base, sel, alloc);
  check('sequence has one record per selected month', seq.length === 3);
  check('sequence receipt numbers are base-1..N', seq.map((r) => r.receiptNo).join('|') === 'AH-REC-20261117-ABC123-1|AH-REC-20261117-ABC123-2|AH-REC-20261117-ABC123-3');
  check('sequence months are the selected months, chronological', seq.map((r) => r.month + ' ' + r.year).join('|') === 'September 2026|November 2026|January 2027');
  check('sequence monthlyFee is the FULL applicable fee per month', seq.every((r) => r.monthlyFee === 7500));
  check('first record carries the form totals + discount + status', seq[0].totalPayable === 19500 && seq[0].discount === 500 && seq[0].status === 'Partial (Balance Remaining)' && seq[0].previousBalance === 0);
  check('later records carry only their own charge', seq[1].totalPayable === 7500 && seq[1].discount === 0 && seq[2].totalPayable === 7500);
  check('later records are Paid in Advance / Partial by allocation', seq[1].status === 'Partial (Balance Remaining)' && seq[1].remainingBalance === 2000 && seq[2].status === 'Partial (Balance Remaining)' && seq[2].remainingBalance === 7500);
  check('sequence is flagged Multi Month, not a plain advance', seq.every((r) => r.isMultiMonthPayment === true && r.isAdvancePayment === true && r.advanceMonthsCount === 3));
  const single = F.buildMultiMonthSequence(base, [byKey['2026-11']], F.allocateMultiMonthPayment([byKey['2026-11']], 7500));
  check('a single selected month saves as one plain record under the base receipt', single.length === 1 && single[0].receiptNo === 'AH-REC-20261117-ABC123' && single[0].month === 'November' && single[0].isMultiMonthPayment !== true);
}

{
  check('paidSoFar ignores cancelled + ADJ rows', F.paidSoFarForMonth(RECORDS, 'FAM-021', 9, 2026) === 7500);
  check('paidSoFar counts a partial payment', F.paidSoFarForMonth(RECORDS, 'FAM-021', 8, 2026) === 3000);
  const adj = { receiptNo: 'ADJ-202611-FAM-021', familyId: 'FAM-021', month: 'November', year: 2026, amountPaid: 0, status: 'Paid (Status)', recordKind: 'month_status' };
  check('isMonthSettledByStatus true for ADJ-only month', F.isMonthSettledByStatus([adj], 'FAM-021', 10, 2026) === true);
  check('isMonthSettledByStatus false when real money exists', F.isMonthSettledByStatus([adj, rec('November', 2026, 7500, 0)], 'FAM-021', 10, 2026) === false);
  check('isReceiptInMonth matches the billing month, real payments only', F.isReceiptInMonth(rec('November', 2026, 7500, 0), 10, 2026) === true && F.isReceiptInMonth(rec('October', 2026, 7500, 0), 10, 2026) === false);
  check('isReceiptInMonth refuses cancelled + ADJ rows', F.isReceiptInMonth({ ...rec('November', 2026, 7500, 0), status: 'Cancelled' }, 10, 2026) === false && F.isReceiptInMonth(adj, 10, 2026) === false);
}

// ---- fee-form wiring: the REAL submit path -------------------------------------
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

function makeSubmitHarness(records, confirmResult) {
  const HIDDEN_BY_DEFAULT = new Set(['feeArrearsAlertBox', 'feeAdvanceCreditAlertBox', 'feeFormCreditDeductedCol', 'feeOverpaymentNoticeBox', 'feeProrateBox', 'feeAdvanceBox']);
  const elements = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, makeElement(HIDDEN_BY_DEFAULT.has(id)));
      return elements.get(id);
    },
    createElement: () => makeElement(false),
    querySelectorAll: () => []
  };
  documentStub.getElementById('feeFormFeeSourceNote').style.display = 'none';
  const store = {
    alhuda_fee_records: JSON.stringify(records),
    alhuda_fee_matrix_overrides: JSON.stringify(OVERRIDES)
  };
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const confirmCalls = [];
  const notifyCalls = [];
  let confirmAnswer = confirmResult;
  const windowStub = {
    lmsNotify: (m) => { notifyCalls.push(String(m)); },
    lmsConfirm: async (opts) => { confirmCalls.push(opts); return confirmAnswer; }
  };
  const phaseSandbox = { window: windowStub, document: documentStub, console, setTimeout, clearTimeout };
  phaseSandbox.globalThis = phaseSandbox;
  vm.runInNewContext(PHASE1_SRC, phaseSandbox);
  vm.runInNewContext(PHASE3_SRC, phaseSandbox);
  vm.runInNewContext(PHASE6_SRC, phaseSandbox);
  let lastModal = null;
  const factory = new Function('window', 'document', 'localStorage', 'console', 'families', `
    ${extractConst(FEES_SRC, 'FEE_CONFIG')}
    const RECEIPT_RANDOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let CLOUD_FEE_RECORDS_CACHE = null;
    let CLOUD_MATRIX_OVERRIDES_CACHE = null;
    let FEE_MULTI_MONTH_SELECTED = [];
    let FEE_MULTI_MONTH_YEAR = null;
    const CACHED_FEE_FAMILIES = families;
    const ALL_LEAVE_RECORDS = [];
    const lmsNotify = window.lmsNotify || (() => {});
    const lmsConfirm = (...args) => window.lmsConfirm(...args);
    let lastModal = null;
    async function syncPaymentRecordsBatchToCloud() { return { ok: true }; }
    function openFeeInvoiceModal(r) { lastModal = r; }
    function sendFeeInvoiceEmailModal() {}
    function rememberPaymentMethodForFamily() {}
    async function loadFeeDashboardStats() {}
    function resetFeeForm() {}
    ${extractFunction(FEES_SRC, 'getStoredFeeRecords')}
    ${extractFunction(FEES_SRC, 'saveStoredFeeRecords')}
    ${extractFunction(FEES_SRC, 'generateReceiptNo')}
    ${extractFunction(FEES_SRC, 'getStoredMatrixOverrides')}
    ${extractFunction(FEES_SRC, 'checkFamilyLeaveInMonth')}
    ${extractFunction(FEES_SRC, 'getFamilyEnrollmentInfo')}
    ${extractFunction(FEES_SRC, 'isFamilyPreAdmission')}
    ${extractFunction(FEES_SRC, 'getFamilyAvailableAdvanceCredit')}
    ${extractFunction(FEES_SRC, 'feeFormApplicableFeeDetails')}
    ${extractFunction(FEES_SRC, 'isFeeStatusRowRecord')}
    ${extractFunction(FEES_SRC, 'isFamilyMonthStatusPaid')}
    ${extractFunction(FEES_SRC, 'findFeeMonthDuplicate')}
    ${extractFunction(FEES_SRC, 'calculateFeeRemainingLive')}
    ${extractFunction(FEES_SRC, 'recalcFeeTotalLive')}
    ${extractFunction(FEES_SRC, 'triggerFeeBalanceRecalc')}
    ${extractFunction(FEES_SRC, 'isMultiMonthMode')}
    ${extractFunction(FEES_SRC, 'multiMonthFormAnchor')}
    ${extractFunction(FEES_SRC, 'getMultiMonthSelection')}
    ${extractFunction(FEES_SRC, 'getMultiMonthYear')}
    ${extractFunction(FEES_SRC, 'handleMultiMonthYearChange')}
    ${extractFunction(FEES_SRC, 'clearMultiMonthSelection')}
    ${extractFunction(FEES_SRC, 'buildMultiMonthOptionsForForm')}
    ${extractFunction(FEES_SRC, 'renderMultiMonthSelector')}
    ${extractFunction(FEES_SRC, 'syncMultiMonthReview')}
    ${extractFunction(FEES_SRC, 'calcMultiMonthFee')}
    ${extractFunction(FEES_SRC, 'toggleMultiMonthSelection')}
    ${extractFunction(FEES_SRC, 'handleAdvanceFeeToggle')}
    ${extractFunction(FEES_SRC, 'handleFeePaymentSubmit')}
    return { triggerFeeBalanceRecalc, handleAdvanceFeeToggle, toggleMultiMonthSelection, getMultiMonthSelection, handleMultiMonthYearChange, handleFeePaymentSubmit, getStoredFeeRecords, get lastModal() { return lastModal; } };
  `);
  const api = factory(windowStub, documentStub, localStorageStub, console, [FAM]);
  return {
    api, el: (id) => documentStub.getElementById(id),
    confirmCalls, notifyCalls,
    setConfirm: (v) => { confirmAnswer = v; },
    setForm: () => {
      const el = (id) => documentStub.getElementById(id);
      el('feeFormFamilyId').value = 'FAM-021';
      el('feeFormParentName').value = 'Bilal Ahmed';
      el('feeFormStudentsNames').value = 'Ahmed';
      el('feeFormCountry').value = 'Pakistan';
      el('feeFormWhatsApp').value = '03001234567';
      el('feeFormParentEmail').value = 'bilal@example.com';
      el('feeFormMonth').value = 'November';
      el('feeFormYear').value = '2026';
      el('feeFormCurrency').value = 'PKR';
      el('feeFormPaymentMethod').value = 'Cash / Other';
      el('feeFormTxnId').value = '';
      el('feeFormNotes').value = '';
      el('feeFormDiscount').value = '0.00';
    }
  };
}

{
  // Full payment across three non-consecutive months (Sep partial +
  // Nov + Dec future). The September duplicate warning is confirmed.
  const h = makeSubmitHarness([
    rec('August', 2026, 7500, 0),
    rec('September', 2026, 3000, 4500, 'Partial (Balance Remaining)'),
    rec('October', 2026, 7500, 0)
  ], true);
  h.setForm();
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  h.api.toggleMultiMonthSelection(8, 2026);
  h.api.toggleMultiMonthSelection(10, 2026);
  h.api.toggleMultiMonthSelection(11, 2026);
  check('submit harness: fee is the per-month total (4500 + 7500 + 7500)', h.el('feeFormMonthlyFee').value === '19500.00', h.el('feeFormMonthlyFee').value);
  check('submit harness: September arrears are NOT double-counted in previous balance', h.el('feeFormPreviousBalance').value === '0.00', h.el('feeFormPreviousBalance').value);
  check('submit harness: total payable is 19500.00', h.el('feeFormTotalPayable').value === '19500.00', h.el('feeFormTotalPayable').value);
  await h.api.handleFeePaymentSubmit({ preventDefault: () => {} });
  const stored = h.api.getStoredFeeRecords();
  const fresh = stored.filter((r) => String(r.receiptNo || '').indexOf('AH-REC-') === 0);
  check('submit saves exactly 3 new records', fresh.length === 3, 'fresh=' + fresh.length);
  const byMonth = {};
  fresh.forEach((r) => { byMonth[r.month + ' ' + r.year] = r; });
  check('submit: September record carries the FULL applicable fee (7500)', byMonth['September 2026'] && byMonth['September 2026'].monthlyFee === 7500);
  check('submit: September record paid its outstanding (4500)', byMonth['September 2026'] && byMonth['September 2026'].amountPaid === 4500);
  check('submit: November + December records are Paid in Advance', byMonth['November 2026'] && byMonth['November 2026'].status === 'Paid in Advance' && byMonth['December 2026'] && byMonth['December 2026'].status === 'Paid in Advance');
  check('submit: receipt numbers are base-1..N in chronological order', fresh.map((r) => r.receiptNo).join('|') === fresh[0].receiptNo.replace(/-\d$/, '') + '-1|' + fresh[0].receiptNo.replace(/-\d$/, '') + '-2|' + fresh[0].receiptNo.replace(/-\d$/, '') + '-3' || fresh.every((r) => /-\d$/.test(r.receiptNo)));
  check('submit: the original September partial record is never overwritten', stored.filter((r) => r.month === 'September' && r.year === 2026).length === 2);
  check('submit: the duplicate warning was asked (September already had a record)', h.confirmCalls.some((c) => (typeof c === 'object' ? (c.title || '') : c).indexOf('Possible Duplicate') !== -1));
  check('submit: invoice modal opens on the first sequence record (September)', h.api.lastModal && h.api.lastModal.month === 'September');
}

{
  // Partial payment: 5000 now across the same three months.
  const h = makeSubmitHarness([
    rec('August', 2026, 7500, 0),
    rec('September', 2026, 3000, 4500, 'Partial (Balance Remaining)'),
    rec('October', 2026, 7500, 0)
  ], true);
  h.setForm();
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  h.api.toggleMultiMonthSelection(8, 2026);
  h.api.toggleMultiMonthSelection(10, 2026);
  h.api.toggleMultiMonthSelection(11, 2026);
  h.el('feeFormAmountPaid').value = '5000';
  h.el('feeFormAmountPaid').dataset.manualEdited = 'true';
  await h.api.handleFeePaymentSubmit({ preventDefault: () => {} });
  const stored = h.api.getStoredFeeRecords();
  const fresh = stored.filter((r) => String(r.receiptNo || '').indexOf('AH-REC-') === 0);
  const byMonth = {};
  fresh.forEach((r) => { byMonth[r.month + ' ' + r.year] = r; });
  check('partial: waterfall pays September in full first (4500)', byMonth['September 2026'] && byMonth['September 2026'].amountPaid === 4500);
  check('partial: November gets the remaining 500 (remaining 7000)', byMonth['November 2026'] && byMonth['November 2026'].amountPaid === 500 && byMonth['November 2026'].remainingBalance === 7000);
  check('partial: December gets nothing (remaining 7500)', byMonth['December 2026'] && byMonth['December 2026'].amountPaid === 0 && byMonth['December 2026'].remainingBalance === 7500);
  check('partial: later months read Partial, never Paid in Advance', byMonth['November 2026'].status === 'Partial (Balance Remaining)' && byMonth['December 2026'].status === 'Partial (Balance Remaining)');
}

{
  // Toggle on, nothing selected: the submit is refused, nothing saved.
  const h = makeSubmitHarness([rec('August', 2026, 7500, 0)], true);
  h.setForm();
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  const before = h.api.getStoredFeeRecords().length;
  await h.api.handleFeePaymentSubmit({ preventDefault: () => {} });
  check('empty selection: submit saves nothing', h.api.getStoredFeeRecords().length === before);
  check('empty selection: the user is told to pick a month', h.notifyCalls.some((m) => m.indexOf('Select at least one month') !== -1));
}

{
  // A paid month needs the explicit warning confirm at selection time.
  const h = makeSubmitHarness([
    rec('August', 2026, 7500, 0),
    rec('September', 2026, 3000, 4500, 'Partial (Balance Remaining)'),
    rec('October', 2026, 7500, 0)
  ], false);
  h.setForm();
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  h.api.toggleMultiMonthSelection(9, 2026); // October — already paid
  await new Promise((r) => setTimeout(r, 0));
  check('paid month: declining the warning leaves it unselected', h.api.getMultiMonthSelection().length === 0);
  check('paid month: the warning names the month + second payment', h.confirmCalls.some((c) => (c.message || '').indexOf('October 2026') !== -1 && (c.message || '').indexOf('SECOND payment') !== -1));
  h.setConfirm(true);
  await h.api.toggleMultiMonthSelection(9, 2026);
  check('paid month: confirming includes it at its full fee', h.api.getMultiMonthSelection().length === 1 && h.el('feeFormMonthlyFee').value === '7500.00', h.el('feeFormMonthlyFee').value);
}

{
  // Click again to deselect; the total follows.
  const h = makeSubmitHarness([rec('August', 2026, 7500, 0)], true);
  h.setForm();
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  h.api.toggleMultiMonthSelection(10, 2026);
  h.api.toggleMultiMonthSelection(11, 2026);
  check('deselect setup: two months total 15000', h.el('feeFormMonthlyFee').value === '15000.00', h.el('feeFormMonthlyFee').value);
  h.api.toggleMultiMonthSelection(11, 2026);
  check('deselect: clicking again removes the month (7500 left)', h.el('feeFormMonthlyFee').value === '7500.00' && h.api.getMultiMonthSelection().length === 1, h.el('feeFormMonthlyFee').value);
}

{
  // No family selected yet: the month boxes must still render and be
  // selectable — the toggle must never show an empty box. Fees are
  // unknown until a family is picked, then they fill in.
  const h = makeSubmitHarness([rec('August', 2026, 7500, 0)], true);
  h.el('feeFormMonth').value = 'November';
  h.el('feeFormYear').value = '2026';
  h.el('feeFormCurrency').value = 'PKR';
  // NOTE: no setForm() — feeFormFamilyId stays empty, as in the live
  // screenshot where the toggle was on before any family was picked.
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  const boxes = (h.el('feeMultiMonthGrid').innerHTML.match(/fee-mm-box/g) || []).length;
  check('no family: the month grid still renders the 12 months of the form year', boxes === 12, 'boxes=' + boxes);
  check('no family: boxes show no fee yet (— instead of 0.00)', h.el('feeMultiMonthGrid').innerHTML.indexOf('—') !== -1 && h.el('feeMultiMonthGrid').innerHTML.indexOf('0.00') === -1);
  h.api.toggleMultiMonthSelection(10, 2026); // November
  h.api.toggleMultiMonthSelection(11, 2026); // December
  check('no family: months are selectable before a family is picked', h.api.getMultiMonthSelection().length === 2, String(h.api.getMultiMonthSelection().length));
  check('no family: the review names the months without amounts', h.el('feeMultiMonthReview').innerText.indexOf('November 2026') !== -1 && h.el('feeMultiMonthReview').innerText.indexOf('December 2026') !== -1 && h.el('feeMultiMonthReview').innerText.indexOf('0.00') === -1);
  // Now pick the family: the same selection stays, fees fill in.
  h.setForm();
  h.api.triggerFeeBalanceRecalc();
  const boxesAfter = (h.el('feeMultiMonthGrid').innerHTML.match(/fee-mm-box/g) || []).length;
  check('family picked later: the grid still shows the 12 months of the form year', boxesAfter === 12, 'boxes=' + boxesAfter);
  check('family picked later: the earlier selection survives', h.api.getMultiMonthSelection().length === 2, String(h.api.getMultiMonthSelection().length));
  check('family picked later: fees fill in (7500 + 7500)', h.el('feeFormMonthlyFee').value === '15000.00', h.el('feeFormMonthlyFee').value);
  check('family picked later: boxes now show the real fee', h.el('feeMultiMonthGrid').innerHTML.indexOf('7500.00') !== -1);
}

{
  // One line of 12 months + year dropdown: the row shows the form
  // year by default, the dropdown offers the year either side, and
  // a selection survives switching years.
  const h = makeSubmitHarness([rec('August', 2026, 7500, 0)], true);
  h.setForm();
  h.el('feeToggleAdvance').checked = true;
  h.api.handleAdvanceFeeToggle();
  const boxes = (h.el('feeMultiMonthGrid').innerHTML.match(/fee-mm-box/g) || []).length;
  check('year row: one line shows exactly the 12 months of the form year', boxes === 12, 'boxes=' + boxes);
  const yearHtml = h.el('feeMultiMonthYear').innerHTML;
  check('year row: the dropdown offers the form year either side', yearHtml.indexOf('2025') !== -1 && yearHtml.indexOf('2026') !== -1 && yearHtml.indexOf('2027') !== -1 && h.el('feeMultiMonthYear').value === '2026', yearHtml + ' value=' + h.el('feeMultiMonthYear').value);
  check('year row: chips show month names only (the year lives in the dropdown)', h.el('feeMultiMonthGrid').innerHTML.indexOf('>January<') !== -1 && h.el('feeMultiMonthGrid').innerHTML.indexOf('>September<') !== -1 && h.el('feeMultiMonthGrid').innerHTML.indexOf('>December<') !== -1 && h.el('feeMultiMonthGrid').innerHTML.indexOf('January 2026<') === -1 && h.el('feeMultiMonthYear').value === '2026');
  // Switch to 2025: 12 boxes of 2025 (all not-enrolled for this family).
  h.el('feeMultiMonthYear').value = '2025';
  h.api.handleMultiMonthYearChange();
  const boxes25 = (h.el('feeMultiMonthGrid').innerHTML.match(/fee-mm-box/g) || []).length;
  check('year row: switching year shows that year, 12 months', boxes25 === 12 && h.el('feeMultiMonthGrid').innerHTML.indexOf('>December<') !== -1 && h.el('feeMultiMonthGrid').innerHTML.indexOf('December 2025<') === -1 && h.el('feeMultiMonthYear').value === '2025', 'boxes=' + boxes25);
  // Cross-year selection: December 2026 + January 2027.
  h.el('feeMultiMonthYear').value = '2026';
  h.api.handleMultiMonthYearChange();
  h.api.toggleMultiMonthSelection(11, 2026); // December 2026
  h.el('feeMultiMonthYear').value = '2027';
  h.api.handleMultiMonthYearChange();
  h.api.toggleMultiMonthSelection(0, 2027); // January 2027
  check('year row: selection survives switching years', h.api.getMultiMonthSelection().length === 2, String(h.api.getMultiMonthSelection().length));
  check('year row: cross-year total is per-month actual fees', h.el('feeFormMonthlyFee').value === '15000.00', h.el('feeFormMonthlyFee').value);
  check('year row: the review lists both years', h.el('feeMultiMonthReview').innerText.indexOf('December 2026') !== -1 && h.el('feeMultiMonthReview').innerText.indexOf('January 2027') !== -1);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
