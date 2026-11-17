// Fee Upgrade Phase 1 — Undo Payment (Batch 17).
// Part 1 executes the REAL newest-only rule from js/fee-phase1.js.
// Part 2 executes the REAL deleteFamilyPaymentRecord from
// js/profiles360.js (extracted by name) in undo mode vs delete mode.
// Run from the repo root: node test/fee-phase1-undo.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PROFILES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');

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

// ---- Part 1: newest-only rule ---------------------------------------------
const windowObj = {};
{
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PHASE1_SRC, sandbox);
}
const F = windowObj.FeePhase1;

{
  check('receiptBaseNo strips the advance suffix', F.receiptBaseNo('AH-REC-20261117-ABCDEF-2') === 'AH-REC-20261117-ABCDEF');
  check('receiptBaseNo leaves a plain receipt alone', F.receiptBaseNo('AH-REC-20261117-ABCDEF') === 'AH-REC-20261117-ABCDEF');

  const recs = [
    { receiptNo: 'AH-REC-20261101-AAAAAA', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-10-05' },
    { receiptNo: 'AH-REC-20261110-BBBBBB', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-11-10' }
  ];
  // Stored newest-first (unshift on save): index 0 is the newest.
  const newestFirst = [recs[1], recs[0]];
  check('newest payment for the month can be undone', F.isNewestPaymentRow(newestFirst, 'AH-REC-20261110-BBBBBB').ok === true);
  const older = F.isNewestPaymentRow(newestFirst, 'AH-REC-20261101-AAAAAA');
  check('older payment for the same month is refused', older.ok === false && /newer payment/.test(older.reason));

  const otherMonth = [
    { receiptNo: 'AH-REC-20261110-BBBBBB', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-11-10' },
    { receiptNo: 'AH-REC-20260901-CCCCCC', familyId: 'FAM-021', month: 'September', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-09-01' }
  ];
  check('newest of a different month is still undoable', F.isNewestPaymentRow(otherMonth, 'AH-REC-20260901-CCCCCC').ok === true);
  const otherFamily = [
    { receiptNo: 'AH-REC-20261110-BBBBBB', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-11-10' },
    { receiptNo: 'AH-REC-20261101-AAAAAA', familyId: 'FAM-009', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-10-05' }
  ];
  check('same month, different family does not block', F.isNewestPaymentRow(otherFamily, 'AH-REC-20261101-AAAAAA').ok === true);

  const withCancelled = [
    { receiptNo: 'AH-REC-20261112-DDDDDD', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Cancelled', date: '2026-11-12' },
    { receiptNo: 'AH-REC-20261101-AAAAAA', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-10-05' }
  ];
  check('a newer CANCELLED row does not block the undo', F.isNewestPaymentRow(withCancelled, 'AH-REC-20261101-AAAAAA').ok === true);
  check('a cancelled receipt itself cannot be undone', F.isNewestPaymentRow(withCancelled, 'AH-REC-20261112-DDDDDD').ok === false);

  // Multi-month advance receipt: all three sub-rows share one base number.
  const advance = [
    { receiptNo: 'AH-REC-20261101-ADVANCE-1', familyId: 'FAM-021', month: 'November', year: 2026, amountPaid: 5000, status: 'Paid in Advance', date: '2026-11-01' },
    { receiptNo: 'AH-REC-20261101-ADVANCE-2', familyId: 'FAM-021', month: 'December', year: 2026, amountPaid: 5000, status: 'Paid in Advance', date: '2026-11-01' },
    { receiptNo: 'AH-REC-20261101-ADVANCE-3', familyId: 'FAM-021', month: 'January', year: 2027, amountPaid: 5000, status: 'Paid in Advance', date: '2026-11-01' }
  ];
  check('advance group undoes as one receipt when all rows are newest', F.isNewestPaymentRow(advance, 'AH-REC-20261101-ADVANCE-1').ok === true);
  const advanceBlocked = advance.concat([
    { receiptNo: 'AH-REC-20261201-EEEEEE', familyId: 'FAM-021', month: 'December', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-12-01' }
  ]);
  const blocked = F.isNewestPaymentRow(advanceBlocked, 'AH-REC-20261101-ADVANCE-2');
  check('advance group is refused when any covered month has a newer payment', blocked.ok === false && /December 2026/.test(blocked.reason));

  check('unknown receipt is refused', F.isNewestPaymentRow(advance, 'AH-REC-20261101-NOPE').ok === false);
}

// ---- Part 2: deleteFamilyPaymentRecord in undo mode vs delete mode --------
function makeDeleteHarness(role) {
  const notesStore = {};
  const family = {
    id: 'FAM-021', parent_name: 'Bilal Ahmed', monthly_fee: 5000, currency: 'PKR',
    notes: JSON.stringify({
      fee_history: [
        { receiptNo: 'AH-REC-20261110-BBBBBB', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-11-10' },
        { receiptNo: 'AH-REC-20261101-AAAAAA', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-10-05' }
      ],
      matrix_overrides: { 'FAM-021_October_2026': { status: 'paid' } },
      deleted_payment_months: []
    })
  };
  const globalRecords = [
    { receiptNo: 'AH-REC-20261110-BBBBBB', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-11-10' },
    { receiptNo: 'AH-REC-20261101-AAAAAA', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 5000, status: 'Paid in Full', date: '2026-10-05' }
  ];
  const dualWriteCalls = [];
  const notifications = [];
  const dbUpdates = [];
  let confirmCalls = 0;
  let promptCalls = 0;
  const windowStub = {
    ALL_FAMILIES: [family],
    CURRENT_ROLE: role,
    FeeTables: {
      dualWritePaymentCancelled: async (rec, by, reason) => { dualWriteCalls.push({ rec, by, reason }); return { ok: true, found: true }; }
    },
    lmsNotify: (msg, opts) => { notifications.push({ msg, opts }); }
  };
  const documentStub = { getElementById: () => null };
  const dbStub = {
    from: () => ({
      update: (payload) => ({ eq: async () => { dbUpdates.push(payload); return { error: null }; } })
    })
  };
  // Minimal parseFamilyNotesData (mirrors the real one for these shapes).
  function parseFamilyNotesData(notesRaw) {
    if (!notesRaw) return { fee_history: [], matrix_overrides: {} };
    if (typeof notesRaw === 'object') return { ...notesRaw, fee_history: Array.isArray(notesRaw.fee_history) ? notesRaw.fee_history : [], matrix_overrides: notesRaw.matrix_overrides || {} };
    try {
      const parsed = JSON.parse(notesRaw);
      return { ...parsed, fee_history: Array.isArray(parsed.fee_history) ? parsed.fee_history : [], matrix_overrides: parsed.matrix_overrides || {} };
    } catch (e) { return { custom_notes: notesRaw, fee_history: [], matrix_overrides: {} }; }
  }
  const sandbox = {
    window: windowStub,
    document: documentStub,
    console,
    db: dbStub,
    CURRENT_ROLE: role,
    lmsNotify: windowStub.lmsNotify,
    lmsConfirm: async () => { confirmCalls++; return true; },
    lmsPrompt: async () => { promptCalls++; return 'test reason'; },
    getStoredFeeRecords: () => globalRecords,
    saveStoredFeeRecords: (recs) => { globalRecords.length = 0; globalRecords.push(...recs); },
    loadFeeDashboardStats: () => {},
    parseFamilyNotesData,
    _fee360TableCache: {},
    _LAST_FAMILY_360_CACHE: null,
    _CURRENT_360_STATE: { activeTab: 'students' }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = windowStub;
  const factory = new Function('window', 'document', 'console', 'db', 'CURRENT_ROLE', 'lmsNotify', 'lmsConfirm', 'lmsPrompt', 'getStoredFeeRecords', 'saveStoredFeeRecords', 'loadFeeDashboardStats', 'parseFamilyNotesData', '_fee360TableCache', '_LAST_FAMILY_360_CACHE', '_CURRENT_360_STATE', `
    ${extractFunction(PROFILES_SRC, '_parseFamilyStructuredNotes')}
    ${extractFunction(PROFILES_SRC, '_saveFamilyStructuredNotes')}
    ${extractFunction(PROFILES_SRC, '_notify360')}
    ${extractFunction(PROFILES_SRC, '_renderFamilyWorkspaceDOM')}
    ${extractFunction(PROFILES_SRC, 'deleteFamilyPaymentRecord')}
    return { deleteFamilyPaymentRecord };
  `);
  const api = factory(windowStub, documentStub, console, dbStub, role, windowStub.lmsNotify, sandbox.lmsConfirm, sandbox.lmsPrompt, sandbox.getStoredFeeRecords, sandbox.saveStoredFeeRecords, sandbox.loadFeeDashboardStats, parseFamilyNotesData, sandbox._fee360TableCache, sandbox._LAST_FAMILY_360_CACHE, sandbox._CURRENT_360_STATE);
  return {
    api, family, globalRecords, dualWriteCalls, notifications, dbUpdates,
    confirmCalls: () => confirmCalls, promptCalls: () => promptCalls,
    // _saveFamilyStructuredNotes REPLACES window.ALL_FAMILIES[i] with a
    // new object, so the notes must be read from the current array
    // element, never from the originally captured family object.
    notes: () => JSON.parse(windowStub.ALL_FAMILIES[0].notes),
    setNotes: (s) => { windowStub.ALL_FAMILIES[0].notes = s; }
  };
}

{
  // Owner undo: receipt-only removal, month becomes due again.
  const h = makeDeleteHarness('owner');
  const ret = await h.api.deleteFamilyPaymentRecord('FAM-021', 'AH-REC-20261110-BBBBBB', 'October', 2026, { undo: true, skipConfirm: true });
  const notes = h.notes();
  check('owner undo returns true', ret === true);
  check('owner undo removes ONLY the target receipt (older same-month payment stays)', notes.fee_history.length === 1 && notes.fee_history[0].receiptNo === 'AH-REC-20261101-AAAAAA');
  check('owner undo does NOT mark the month deleted (fee becomes due again)', !(notes.deleted_payment_months || []).includes('october_2026'));
  check('owner undo clears the matrix override so the month shows due', !notes.matrix_overrides['FAM-021_October_2026']);
  check('owner undo removes the receipt from the global records too', h.globalRecords.length === 1 && h.globalRecords[0].receiptNo === 'AH-REC-20261101-AAAAAA');
  check('owner undo cancels the table row with the undo reason', h.dualWriteCalls.length === 1 && h.dualWriteCalls[0].reason === 'undone by owner');
}

{
  // Owner delete (non-undo): the old behaviour is unchanged.
  const h = makeDeleteHarness('owner');
  const ret = await h.api.deleteFamilyPaymentRecord('FAM-021', 'AH-REC-20261110-BBBBBB', 'October', 2026);
  const notes = h.notes();
  check('owner delete returns true', ret === true);
  check('owner delete removes every record of the month (old clause)', notes.fee_history.length === 0);
  check('owner delete DOES mark the month deleted', (notes.deleted_payment_months || []).includes('october_2026'));
  check('owner delete cancels the table row with the delete reason', h.dualWriteCalls.length === 1 && h.dualWriteCalls[0].reason === 'deleted by owner');
}

{
  // Manager undo: cancel-with-reason, no confirm/prompt in undo mode.
  const h = makeDeleteHarness('manager');
  const ret = await h.api.deleteFamilyPaymentRecord('FAM-021', 'AH-REC-20261110-BBBBBB', 'October', 2026, { undo: true, skipConfirm: true });
  const after = h.notes();
  check('manager undo returns true', ret === true);
  check('manager undo asks no confirm and no reason prompt', h.confirmCalls() === 0 && h.promptCalls() === 0);
  const row = after.fee_history.find(r => r.receiptNo === 'AH-REC-20261110-BBBBBB');
  check('manager undo marks the receipt Cancelled (never deletes)', row && row.status === 'Cancelled');
  check('manager undo stamps the undo reason', row && row.cancel_reason === 'Undone (Undo Payment)');
  check('manager undo stamps cancelled_by manager', row && row.cancelled_by === 'manager');
  check('manager undo keeps the older same-month payment untouched', after.fee_history.find(r => r.receiptNo === 'AH-REC-20261101-AAAAAA' && r.status === 'Paid in Full'));
  check('manager undo does NOT mark the month deleted', !(after.deleted_payment_months || []).includes('october_2026'));
  check('manager undo cancels the table row with the undo reason', h.dualWriteCalls.length === 1 && h.dualWriteCalls[0].reason === 'Undone (Undo Payment)');
}

{
  // Manager delete (non-undo): confirm + reason prompt still run, and
  // the prompted reason is the one stamped.
  const h = makeDeleteHarness('manager');
  const ret = await h.api.deleteFamilyPaymentRecord('FAM-021', 'AH-REC-20261110-BBBBBB', 'October', 2026);
  const after = h.notes();
  check('manager delete returns true', ret === true);
  check('manager delete asks confirm and a reason', h.confirmCalls() === 1 && h.promptCalls() === 1);
  const row = after.fee_history.find(r => r.receiptNo === 'AH-REC-20261110-BBBBBB');
  check('manager delete stamps the prompted reason', row && row.status === 'Cancelled' && row.cancel_reason === 'test reason');
  // Managers never remove: the whole month is CANCELLED, rows stay.
  check('manager delete cancels every record of the month (rows kept)', after.fee_history.length === 2 && after.fee_history.every(r => r.status === 'Cancelled' && r.cancel_reason === 'test reason'));
}

{
  // Manager undo when the receipt lives only in the payments table.
  const h = makeDeleteHarness('manager');
  // Empty the legacy stores so the receipt is table-only.
  h.setNotes(JSON.stringify({ fee_history: [], matrix_overrides: {}, deleted_payment_months: [] }));
  h.globalRecords.length = 0;
  const ret = await h.api.deleteFamilyPaymentRecord('FAM-021', 'AH-REC-20261110-BBBBBB', 'October', 2026, { undo: true, skipConfirm: true });
  check('manager undo of a table-only receipt still succeeds via dual-write', ret === true);
  check('manager undo table-only path cancels the table row', h.dualWriteCalls.length === 1);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
