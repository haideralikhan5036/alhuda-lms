// Batch 6D-1 test — reverse translator (fee-tables.js) + compare engine
// (backfill-finance.js): round-trips on the fields consumers actually read,
// table-side cancel/money overlays, column-only (manager) fallback, read-mode
// flag parsing, and compare with planted differences (incl. the slip-number
// rule: minted numbers are never compared). Loads the REAL modules in a vm.
// Run from the repo root: node test/batch6d1-translate-compare.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEE_TABLES = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
const BACKFILL = fs.readFileSync(path.join(REPO_ROOT, 'js/backfill-finance.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const SETTINGS = { fee_read_parent: 'compare', fee_read_360: 'on', fee_tables_v1: 'on', junk_key: 'banana' };
function settingsBuilder() {
  const b = {
    _eq: null,
    select() { return b; },
    eq(c, v) { b._eq = [c, v]; return b; },
    limit() { return b; },
    then(res) {
      const rows = Object.entries(SETTINGS)
        .filter(([k]) => !b._eq || b._eq[1] === k)
        .map(([key, value]) => ({ key, value }));
      res({ data: rows, error: null });
    },
  };
  return b;
}
function loadModules() {
  const windowObj = {
    db: { from: (t) => { if (t !== 'system_settings') throw new Error('unexpected table ' + t); return settingsBuilder(); } },
    lmsNotify: () => {},
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    getAuthenticatedOwnerSession: () => ({ id: 'OWN-001', username: 'owner' }),
    crypto: webcrypto,
  };
  const sandbox = { window: windowObj, console, crypto: webcrypto, CURRENT_ROLE: 'owner', setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(FEE_TABLES, sandbox);
  vm.runInNewContext(BACKFILL, sandbox);
  return windowObj;
}
const W = loadModules();
const FT = W.FeeTables;
const BF = W.BackfillFinance;
check('modules expose translator + compare + getReadMode', typeof FT.paymentLegacyFromRow === 'function' && typeof FT.slipLegacyFromRow === 'function' && typeof FT.adjustmentLegacyFromRow === 'function' && typeof FT.getReadMode === 'function' && typeof BF.comparePayments === 'function' && typeof BF.compareSalaries === 'function');

// ---- Translator: payments ------------------------------------------------------
const rec = (over) => ({
  receiptNo: 'AH-REC-T1', date: '2026-10-04', familyId: 'FAM-9', month: 'October', year: 2026,
  monthlyFee: 100, previousBalance: 0, creditDeducted: 0, totalPayable: 100, amountPaid: 100,
  discount: 0, remainingBalance: 0, excessPaid: 0, currency: 'CAD', paymentMethod: 'Bank Transfer',
  transactionId: 'TX1', notes: '', status: 'Paid in Full', isProrated: false, isAdvancePayment: false,
  whatsapp: '+10000000000', ...over,
});
{
  const back = FT.paymentLegacyFromRow(FT.paymentRowFromLegacy(rec({}), 'fee_form'));
  check('payment round-trip: consumed fields identical', back.receiptNo === 'AH-REC-T1' && back.familyId === 'FAM-9' && back.month === 'October' && back.year === 2026 && back.amountPaid === 100 && back.totalPayable === 100 && back.remainingBalance === 0 && back.currency === 'CAD' && back.status === 'Paid in Full' && back.whatsapp === '+10000000000' && back.transactionId === 'TX1', JSON.stringify(back).slice(0, 200));
}
{
  const r = rec({ receiptNo: 'AH-REC-T2', status: 'Cancelled', cancel_reason: 'wrong', cancelled_by: 'manager', cancelled_at: '2026-10-05T00:00:00Z' });
  const back = FT.paymentLegacyFromRow(FT.paymentRowFromLegacy(r, 'fee_history'));
  check('payment round-trip: cancelled fields survive', back.status === 'Cancelled' && back.cancel_reason === 'wrong' && back.cancelled_by === 'manager');
}
{
  const r = rec({ receiptNo: 'AH-REC-T3', isAdvancePayment: true, status: 'Paid in Advance' });
  const back = FT.paymentLegacyFromRow(FT.paymentRowFromLegacy(r, 'fee_form'));
  check('payment round-trip: advance flag restored', back.isAdvancePayment === true && back.recordKind === 'payment');
}
{
  const r = { receiptNo: 'AH-MAN-T4', date: '2026-10-06', familyId: 'FAM-9', month: 'October', year: 2026, amount: 250, currency: 'PKR', status: 'PAID', isManualInvoice: true };
  const back = FT.paymentLegacyFromRow(FT.paymentRowFromLegacy(r, 'manual_invoice'));
  check('payment round-trip: manual invoice kind + amount alias', back.isManualInvoice === true && back.amountPaid === 250);
}
{
  const row = FT.paymentRowFromLegacy(rec({ receiptNo: 'AH-REC-T5' }), 'fee_form');
  row.status = 'Cancelled'; row.cancel_reason = 'late cancel'; row.cancelled_by = 'owner'; row.cancelled_at = '2026-10-09T00:00:00Z';
  const back = FT.paymentLegacyFromRow(row);
  check('overlay: a table-side cancel wins over the Paid snapshot', back.status === 'Cancelled' && back.cancel_reason === 'late cancel' && back.cancelled_by === 'owner');
}
{
  const row = FT.paymentRowFromLegacy(rec({ receiptNo: 'AH-REC-T6' }), 'fee_form');
  row.amount_paid = 40; row.status = 'Partial'; row.remaining_balance = 60;
  const back = FT.paymentLegacyFromRow(row);
  check('overlay: money moved after snapshot -> status from the row mapping', back.status === 'Partial (Balance Remaining)' && back.amountPaid === 40 && back.remainingBalance === 60, back.status);
}
{
  const row = FT.paymentRowFromLegacy(rec({ receiptNo: 'AH-REC-T7' }), 'fee_form');
  row.legacy_json = null;
  const back = FT.paymentLegacyFromRow(row);
  check('column-only (manager): usable record, snapshots absent, month derived', back.receiptNo === 'AH-REC-T7' && back.amountPaid === 100 && back.status === 'Paid in Full' && back.whatsapp === undefined && back.month === 'October' && back.year === 2026, JSON.stringify(back).slice(0, 200));
}

// ---- Translator: slips + adjustments ------------------------------------------
const slip = (over) => ({ month: 'September 2026', base_subtotal: 2200, bonus: 0, deduction: 100, net_payable: 2100, status: 'Pending', saved_at: '2026-09-01T00:00:00Z', ...over });
{
  const row = FT.slipRowFromLegacy('TCH-1', slip({ slip_no: 'AH-SAL-KEEP-1' }));
  const back = FT.slipLegacyFromRow(row);
  check('slip round-trip: number in both casings, money, key', back.slip_no === 'AH-SAL-KEEP-1' && back.slipNo === 'AH-SAL-KEEP-1' && back.net_payable === 2100 && back.deduction === 100 && back.slip_key === 'TCH-1_September_2026', JSON.stringify(back).slice(0, 200));
}
{
  const row = { teacher_id: 'TCH-2', period: '2026-09', month_label: null, slip_no: 'AH-SAL-X1', status: 'Paid', paid_at: '2026-10-01T00:00:00Z', base_subtotal: 3000, bonus: 0, deduction_total: 0, net_payable: 3000, legacy_json: JSON.stringify({ teacher_id: 'TCH-2' }) };
  const back = FT.slipLegacyFromRow(row);
  check('slip from period only: month label + key constructed', back.month === 'September 2026' && back.slip_key === 'TCH-2_September_2026' && back.status === 'Paid', JSON.stringify(back).slice(0, 200));
}
{
  const ded = { id: 'DED-1', type: 'deduction', category: 'Absence', amount: 200, date: '2026-10-15', month: 'October 2026', reason: 'x', status: 'Applied' };
  const back = FT.adjustmentLegacyFromRow(FT.adjustmentRowFromLegacy('TCH-1', ded));
  check('adjustment round-trip: original id + type + amount kept', back.id === 'DED-1' && back.type === 'deduction' && back.amount === 200);
}

// ---- getReadMode ----------------------------------------------------------------
{
  FT._resetForTests();
  const [p, t, s, j] = [await FT.getReadMode('fee_read_parent'), await FT.getReadMode('fee_read_360'), await FT.getReadMode('salary_read_v1'), await FT.getReadMode('junk_key')];
  check('getReadMode: compare/on/absent->off/junk->off', p === 'compare' && t === 'on' && s === 'off' && j === 'off', [p, t, s, j].join(','));
  check('read-flag constants exported', FT.READ_FLAG_PARENT === 'fee_read_parent' && FT.READ_FLAG_360 === 'fee_read_360' && FT.READ_FLAG_SALARY === 'salary_read_v1');
}

// ---- Compare: payments -----------------------------------------------------------
const famSources = {
  families: [{ id: 'FAM-1', notes: JSON.stringify({ fee_history: [rec({ receiptNo: 'RA-1', familyId: 'FAM-1' }), rec({ receiptNo: 'RB-2', familyId: 'FAM-1', amountPaid: 50, totalPayable: 50 })] }) }],
  localRecords: [],
};
const planned = BF.planPayments({ ...famSources, runId: 'cmp' }).rows;
const asTable = (rows) => rows.map((r, i) => ({ ...r, id: 'PAY-T' + i }));
{
  const out = BF.comparePayments(famSources, asTable(planned));
  check('compare payments: identical tables are clean', out.clean === true && out.expectedCount === 2 && out.actualCount === 2, JSON.stringify(out).slice(0, 240));
}
{
  const rows = asTable(planned).filter((r) => r.receipt_no !== 'RA-1');
  const out = BF.comparePayments(famSources, rows);
  check('compare payments: a missing row is detected', out.clean === false && out.missingInTables.some((x) => String(x).includes('RA-1')), JSON.stringify(out.missingInTables));
}
{
  const rows = asTable(planned).map((r) => (r.receipt_no === 'RB-2' ? { ...r, amount_paid: 55 } : r));
  const out = BF.comparePayments(famSources, rows);
  check('compare payments: an amount difference is detected', out.clean === false && out.fieldDiffs.some((d) => d.field === 'amount_paid' && String(d.key).includes('RB-2')), JSON.stringify(out.fieldDiffs).slice(0, 200));
}
{
  const rows = [...asTable(planned), { ...planned[0], id: 'PAY-TX', receipt_no: 'RX-9' }];
  const out = BF.comparePayments(famSources, rows);
  check('compare payments: an extra row is detected', out.clean === false && out.extraInTables.some((x) => String(x).includes('RX-9')));
}
{
  const quirk = rec({ receiptNo: 'RQ-1', familyId: 'FAM-1', amountPaid: 0, totalPayable: 8000, remainingBalance: 0, status: 'Paid in Full' });
  const src = { families: [{ id: 'FAM-1', notes: JSON.stringify({ fee_history: [quirk] }) }], localRecords: [] };
  const rows = asTable(BF.planPayments({ ...src, runId: 'cmp' }).rows);
  const out = BF.comparePayments(src, rows);
  check('compare payments: stored-balance quirk is informational, still clean', out.clean === true && out.informational.length === 1, JSON.stringify(out).slice(0, 240));
}

// ---- Compare: salaries -------------------------------------------------------------
const salSources = {
  teachers: [{ id: 'TCH-1', address: JSON.stringify({ salary_slips: { 'TCH-1_September_2026': slip({}) }, deduction_records: [{ id: 'DED-1', type: 'deduction', category: 'Absence', amount: 200, date: '2026-10-15', month: 'October 2026', reason: 'x', status: 'Applied' }], deleted_salary_months: [] }) }],
  localSalaries: {},
  carrierSalaries: {},
};
const salPlan = BF.planSalaries({ ...salSources, runId: 'cmp' });
{
  const out = BF.compareSalaries(salSources, asTable(salPlan.slipRows), asTable(salPlan.adjustmentRows));
  check('compare salaries: identical tables are clean (minted slip number NOT compared)', out.clean === true, JSON.stringify(out).slice(0, 300));
}
{
  const withNo = { 'TCH-1_September_2026': slip({ slip_no: 'AH-SAL-KEEP-1' }) };
  const src2 = { teachers: [{ id: 'TCH-1', address: JSON.stringify({ salary_slips: withNo, deduction_records: [], deleted_salary_months: [] }) }], localSalaries: {}, carrierSalaries: {} };
  const plan2 = BF.planSalaries({ ...src2, runId: 'cmp' });
  const rows = asTable(plan2.slipRows).map((r) => ({ ...r, slip_no: 'AH-SAL-DIFFERENT' }));
  const out = BF.compareSalaries(src2, rows, []);
  check('compare salaries: a REAL slip-number difference is detected', out.clean === false && out.fieldDiffs.some((d) => d.field === 'slip_no'), JSON.stringify(out.fieldDiffs).slice(0, 200));
}
{
  const out = BF.compareSalaries(salSources, [], asTable(salPlan.adjustmentRows));
  check('compare salaries: a missing slip is detected', out.clean === false && out.missingSlips.length === 1);
}
{
  const out = BF.compareSalaries(salSources, asTable(salPlan.slipRows), []);
  check('compare salaries: a missing adjustment is detected by legacy id', out.clean === false && out.adjustments.missingIds.includes('DED-1'), JSON.stringify(out.adjustments));
}
{
  const out = BF.comparePayments(null, null);
  check('compare robustness: garbage input -> clean:false + error, no throw', out.clean === false && typeof out.error === 'string');
}

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch6d1-translate-compare: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
