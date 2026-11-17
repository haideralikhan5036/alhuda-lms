// Fee Upgrade Phase 1 — fee form uses the timeline fee (Batches 19-21).
// Executes the REAL triggerFeeBalanceRecalc + helpers from js/fees.js
// (extracted by name) against a fake DOM, with the REAL FeePhase1
// module attached. On main these assertions FAIL (master fee used).
// Run from the repo root: node test/fee-phase1-fee-form.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PHASE3_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase3.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Brace scanner that skips string literals, template literals and
// comments, so a stray brace inside a message cannot truncate a
// function. It also keeps a preceding `async` keyword (the body may
// await) and skips the parameter list first, so a default parameter
// such as `extraColumns = {}` cannot end the extraction early.
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
  return {
    value: '', innerText: '', innerHTML: '', className: '', checked: false, disabled: false,
    dataset: {}, style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c)
    },
    appendChild: () => {},
    querySelectorAll: () => []
  };
}

function makeFormHarness(families, records) {
  // Elements hidden by default in the real DOM (Tailwind `hidden` class).
  // feeFormMasterFeeLine has NO hidden class in index.html (it is always
  // visible, empty until filled); feeFormFeeSourceNote hides via inline
  // style="display:none;" and renderFeeSourceNote toggles style.display.
  const HIDDEN_BY_DEFAULT = new Set([
    'feeArrearsAlertBox', 'feeAdvanceCreditAlertBox', 'feeFormCreditDeductedCol',
    'feeOverpaymentNoticeBox', 'feeProrateBox', 'feeAdvanceBox'
  ]);
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
    alhuda_fee_matrix_overrides: '{}'
  };
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; }
  };
  const windowStub = { lmsNotify: () => {} };
  // Load the real FeePhase1 module into the same window object, WITH the
  // fake document attached — renderFeeSourceNote needs document and
  // returns early without it.
  // Fee Upgrade Phase 3: FeePhase3 is loaded too — triggerFeeBalanceRecalc
  // now ends by rendering the one-tap status switcher, which calls the
  // Phase 3 helpers and the switcher HTML builders.
  const phaseSandbox = { window: windowStub, document: documentStub, console, setTimeout, clearTimeout };
  phaseSandbox.globalThis = phaseSandbox;
  vm.runInNewContext(PHASE1_SRC, phaseSandbox);
  vm.runInNewContext(PHASE3_SRC, phaseSandbox);

  const factory = new Function('window', 'document', 'localStorage', 'console', 'families', `
    ${extractConst(FEES_SRC, 'FEE_CONFIG')}
    let CLOUD_FEE_RECORDS_CACHE = null;
    let CLOUD_MATRIX_OVERRIDES_CACHE = null;
    // Fee Upgrade Phase 3: staged one-tap toggles for the switcher.
    let FEE_STATUS_STAGED = {};
    const CACHED_FEE_FAMILIES = families;
    const ALL_LEAVE_RECORDS = [];
    const lmsNotify = window.lmsNotify || (() => {});
    ${extractFunction(FEES_SRC, 'getStoredFeeRecords')}
    ${extractFunction(FEES_SRC, 'getStoredMatrixOverrides')}
    ${extractFunction(FEES_SRC, 'checkFamilyLeaveInMonth')}
    ${extractFunction(FEES_SRC, 'getFamilyEnrollmentInfo')}
    ${extractFunction(FEES_SRC, 'isFamilyPreAdmission')}
    ${extractFunction(FEES_SRC, 'getFamilyAvailableAdvanceCredit')}
    ${extractFunction(FEES_SRC, 'feeFormApplicableFeeDetails')}
    ${extractFunction(FEES_SRC, 'calculateFeeRemainingLive')}
    ${extractFunction(FEES_SRC, 'recalcFeeTotalLive')}
    ${extractFunction(FEES_SRC, 'calcProratedFeeFromDays')}
    ${extractFunction(FEES_SRC, 'calcAdvancePaymentFee')}
    ${extractFunction(FEES_SRC, 'triggerFeeBalanceRecalc')}
    // Fee Upgrade Phase 3: triggerFeeBalanceRecalc now calls these
    // (ADJ-row exclusion in the arrears loop + the status switcher).
    ${extractFunction(FEES_SRC, 'isFeeStatusRowRecord')}
    ${extractFunction(FEES_SRC, 'isFamilyMonthStatusPaid')}
    ${extractFunction(FEES_SRC, 'buildAnnualMatrixData')}
    ${extractFunction(FEES_SRC, 'feeStatusSwitcherFamilyYear')}
    ${extractFunction(FEES_SRC, 'renderFeeStatusSwitcher')}
    ${extractFunction(FEES_SRC, 'syncFeeStatusSwitcherBar')}
    return { triggerFeeBalanceRecalc };
  `);
  const api = factory(windowStub, documentStub, localStorageStub, console, families);
  return {
    api, el: (id) => documentStub.getElementById(id),
    setForm: (familyId, month, year) => {
      documentStub.getElementById('feeFormFamilyId').value = familyId;
      documentStub.getElementById('feeFormMonth').value = month;
      documentStub.getElementById('feeFormYear').value = String(year);
    }
  };
}

const mismatchFamily = {
  id: 'FAM-021', parent_name: 'Bilal Ahmed', monthly_fee: 5000, currency: 'PKR',
  students: [{ name: 'Ahmed', status: 'Active', joining_date: '2026-08-01' }],
  notes: JSON.stringify({ fee_revisions: [
    { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01' }
  ] })
};
const paidRecords = [
  { receiptNo: 'R-AUG', familyId: 'FAM-021', month: 'August', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-08-05' },
  { receiptNo: 'R-SEP', familyId: 'FAM-021', month: 'September', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-09-05' },
  { receiptNo: 'R-OCT', familyId: 'FAM-021', month: 'October', year: 2026, monthlyFee: 7500, amountPaid: 7500, discount: 0, status: 'Paid in Full', date: '2026-10-05' }
];

{
  // Timeline fee drives the form; master fee (5000) is NOT used.
  const h = makeFormHarness([mismatchFamily], paidRecords);
  h.setForm('FAM-021', 'November', 2026);
  h.api.triggerFeeBalanceRecalc();
  check('fee form shows the timeline fee (7500), not the master fee (5000)', h.el('feeFormMonthlyFee').value === '7500.00', h.el('feeFormMonthlyFee').value);
  check('previous balance is 0 when every month was paid at its timeline fee', h.el('feeFormPreviousBalance').value === '0.00', h.el('feeFormPreviousBalance').value);
  check('total payable equals the timeline fee', h.el('feeFormTotalPayable').value === '7500.00', h.el('feeFormTotalPayable').value);
  const note = h.el('feeFormFeeSourceNote');
  check('mismatch note is SHOWN (red) when the timeline fee differs from master', note.style.display === 'block' && /Fee history does not match/.test(note.innerHTML), note.innerHTML);
  const line = h.el('feeFormMasterFeeLine');
  check('master-fee line shows the agreed fee alongside the note', /Current Agreed Monthly Fee/.test(line.innerHTML) && /5000\.00/.test(line.innerHTML), line.innerHTML);
}

{
  // Scheduled change: master already equals the future fee, so the note
  // is gold (scheduled), not red.
  const fam = {
    id: 'FAM-009', parent_name: 'Sana', monthly_fee: 8500, currency: 'PKR',
    students: [{ name: 'Zain', status: 'Active', joining_date: '2026-08-01' }],
    notes: JSON.stringify({ fee_revisions: [
      { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01' },
      { effectiveYear: 2027, effectiveMonth: 'January', effectiveMonthIdx: 0, prevFee: 7500, newFee: 8500, revisedDate: '2026-11-10' }
    ] })
  };
  const recs = [
    { receiptNo: 'R-AUG', familyId: 'FAM-009', month: 'August', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-08-05' },
    { receiptNo: 'R-SEP', familyId: 'FAM-009', month: 'September', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-09-05' },
    { receiptNo: 'R-OCT', familyId: 'FAM-009', month: 'October', year: 2026, monthlyFee: 7500, amountPaid: 7500, discount: 0, status: 'Paid in Full', date: '2026-10-05' }
  ];
  const h = makeFormHarness([fam], recs);
  h.setForm('FAM-009', 'November', 2026);
  h.api.triggerFeeBalanceRecalc();
  check('scheduled-change family: fee is the current tier (7500)', h.el('feeFormMonthlyFee').value === '7500.00', h.el('feeFormMonthlyFee').value);
  const note = h.el('feeFormFeeSourceNote');
  check('scheduled-change note is gold and names January 2027', note.style.display === 'block' && /Scheduled fee change/.test(note.innerHTML) && /January 2027/.test(note.innerHTML), note.innerHTML);
}

{
  // Arrears use the timeline fee for the month (Oct 7500), not master.
  const unpaidOct = paidRecords.filter(r => r.month !== 'October');
  const h = makeFormHarness([mismatchFamily], unpaidOct);
  h.setForm('FAM-021', 'November', 2026);
  h.api.triggerFeeBalanceRecalc();
  check('unpaid October arrears use the timeline fee (7500), not master (5000)', h.el('feeFormPreviousBalance').value === '7500.00', h.el('feeFormPreviousBalance').value);
  check('total payable is arrears + timeline fee (15000)', h.el('feeFormTotalPayable').value === '15000.00', h.el('feeFormTotalPayable').value);
  check('arrears alert banner is shown', !h.el('feeArrearsAlertBox').classList.contains('hidden'));
}

{
  // Plain family: no revisions, no note, master fee.
  const fam = {
    id: 'FAM-001', parent_name: 'Plain', monthly_fee: 4500, currency: 'PKR',
    students: [{ name: 'Ali', status: 'Active', joining_date: '2026-01-05' }],
    notes: '{}'
  };
  const recs = [];
  for (let m = 0; m < 10; m++) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];
    recs.push({ receiptNo: 'R-' + m, familyId: 'FAM-001', month: months[m], year: 2026, monthlyFee: 4500, amountPaid: 4500, discount: 0, status: 'Paid in Full', date: `2026-${String(m + 1).padStart(2, '0')}-05` });
  }
  const h = makeFormHarness([fam], recs);
  h.setForm('FAM-001', 'November', 2026);
  h.api.triggerFeeBalanceRecalc();
  check('plain family: fee is the master fee (4500)', h.el('feeFormMonthlyFee').value === '4500.00', h.el('feeFormMonthlyFee').value);
  check('plain family: no fee-source note is shown', h.el('feeFormFeeSourceNote').style.display === 'none');
  check('plain family: previous balance is 0', h.el('feeFormPreviousBalance').value === '0.00');
}

{
  // Prorate and advance calculators base on the timeline fee.
  const h = makeFormHarness([mismatchFamily], paidRecords);
  h.setForm('FAM-021', 'November', 2026);
  h.el('feeToggleProrated').checked = true;
  h.el('feeProrateActiveDays').value = '15';
  h.el('feeProrateTotalDays').value = '30';
  h.api.triggerFeeBalanceRecalc();
  check('prorate uses the timeline fee: 7500/30*15 = 3750', h.el('feeProrateCalcAmount').value === '3750.00', h.el('feeProrateCalcAmount').value);

  const h2 = makeFormHarness([mismatchFamily], paidRecords);
  h2.setForm('FAM-021', 'November', 2026);
  h2.el('feeToggleAdvance').checked = true;
  h2.el('feeSelectAdvanceMonths').value = '2';
  h2.api.triggerFeeBalanceRecalc();
  check('advance uses the timeline fee: 7500 x 2 = 15000', h2.el('feeAdvanceCalcAmount').value === '15000.00', h2.el('feeAdvanceCalcAmount').value);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
