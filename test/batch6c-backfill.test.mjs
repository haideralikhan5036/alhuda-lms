// Batch 6C test — js/backfill-finance.js planner: legacy merge (Batch 3A
// identity), duplicate receipt-number suffixing, quarantine, container-family
// authority, salary 3-copy newest-wins merge, deleted-month suppression,
// deduction records, reconciliation (incl. a doctored-builder refusal), and
// planner determinism. Loads the REAL js/fee-tables.js + js/backfill-finance.js
// in a vm. Run from the repo root: node test/batch6c-backfill.test.mjs
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

function loadModules() {
  const windowObj = {
    db: { from: () => { throw new Error('planner must not call the db'); } },
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

// ---- Fixtures (synthetic) -----------------------------------------------------
const RUN = 'B6C-TEST-RUN';
const rec = (over) => ({
  receiptNo: 'AH-REC-X', date: '2025-01-05', familyId: 'FAM-1', month: 'January', year: 2025,
  monthlyFee: 100, previousBalance: 0, creditDeducted: 0, totalPayable: 100, amountPaid: 100,
  discount: 0, remainingBalance: 0, excessPaid: 0, currency: 'GBP', paymentMethod: 'Bank Transfer',
  transactionId: 'N/A', notes: '', status: 'Paid in Full', isProrated: false, isAdvancePayment: false, ...over,
});
const r1 = rec({ receiptNo: 'AH-REC-20250101-AAAAAA' });
const r2 = rec({ receiptNo: 'AH-REC-20250101-AAAAAA', date: '2025-02-03', month: 'February' });
const r3 = rec({ receiptNo: 'AH-REC-CANC-01', date: '2025-03-02', month: 'March', amountPaid: 50, totalPayable: 50, status: 'Cancelled', cancel_reason: 'wrong amount', cancelled_by: 'manager', cancelled_at: '2025-03-03T00:00:00Z' });
const r4 = {}; // quarantine: no number, no date, no month
const r5 = rec({ receiptNo: undefined, date: '2025-04-01', month: 'April', amountPaid: 70, totalPayable: 70 });
delete r5.receiptNo;
const r6 = rec({ receiptNo: 'AH-REC-20250101-AAAAAA', familyId: 'FAM-2', date: '2025-01-20', amountPaid: 80, totalPayable: 80 });
const r7 = { receiptNo: 'AH-MAN-999', date: '2025-05-01', familyId: 'FAM-2', month: 'May', year: 2025, amount: 250, currency: 'PKR', status: 'PAID', isManualInvoice: true };
const r8 = rec({ receiptNo: 'AH-REC-MISM-01', familyId: 'FAM-XXX', date: '2025-05-06', month: 'May', amountPaid: 30, totalPayable: 30 });
const families = [
  { id: 'FAM-1', notes: JSON.stringify({ fee_history: [r1, r2, r3, r4, r5] }) },
  { id: 'FAM-2', notes: { fee_history: [r6, r7, r8] } },
];
const L1 = { ...r1 }; // exact copy -> absorbed
const L2 = rec({ receiptNo: 'AH-REC-20250101-AAAAAA', date: '2025-06-01', month: 'June', amountPaid: 999, totalPayable: 999 }); // conflict copy
const L3 = rec({ receiptNo: 'AH-REC-LOCAL-1', familyId: 'FAM-2', date: '2025-07-01', month: 'July', amountPaid: 60, totalPayable: 60 });
const L4 = rec({ receiptNo: 'AH-REC-LOCAL-2', familyId: 'FAM-UNKNOWN', date: '2025-07-02', month: 'July', amountPaid: 10, totalPayable: 10 });
const localRecords = [L1, L2, L3, L4];

const W = loadModules();
const BF = W.BackfillFinance;
check('modules load: BackfillFinance exposed', BF && typeof BF.planPayments === 'function' && typeof BF.planSalaries === 'function');

const { rows, report } = BF.planPayments({ families, localRecords, runId: RUN });
check('payments: source counts', report.sourceCounts.d1 === 8 && report.sourceCounts.local === 4 && report.sourceCounts.localOnly === 2 && report.sourceCounts.conflictCopies === 1, JSON.stringify(report.sourceCounts));
check('payments: planned rows = 10 (8 D1 - 1 quarantined + 3 local survivors)', rows.length === 10, String(rows.length));
check('payments: quarantine holds the empty record only', report.quarantine.length === 1 && report.quarantine[0].familyId === 'FAM-1', JSON.stringify(report.quarantine));
check('payments: noReceiptNo counts the dated numberless record', report.noReceiptNo === 1, String(report.noReceiptNo));
check('payments: reconciled with zero diffs', report.reconciled === true && report.diffs.length === 0, JSON.stringify(report.diffs));

const byNo = {};
for (const row of rows) { if (row.receipt_no) (byNo[row.receipt_no] = byNo[row.receipt_no] || []).push(row); }
const dupGroup = Object.keys(byNo).filter((k) => k.startsWith('AH-REC-20250101-AAAAAA'));
check('payments: duplicate group resolved to 4 unique numbers', dupGroup.length === 4 && new Set(dupGroup).size === 4, JSON.stringify(dupGroup));
check('payments: earliest record keeps the original number', rows.some((x) => x.receipt_no === 'AH-REC-20250101-AAAAAA' && x.family_id === 'FAM-1' && Number(x.amount_paid) === 100));
check('payments: cross-family copy got -DUP2 (date order)', rows.some((x) => x.receipt_no === 'AH-REC-20250101-AAAAAA-DUP2' && x.family_id === 'FAM-2'), JSON.stringify(dupGroup));
check('payments: duplicates report lists the group', report.duplicates.length === 1 && report.duplicates[0].suffixed.length === 3, JSON.stringify(report.duplicates).slice(0, 200));
check('payments: suffixed rows carry duplicate_of in _backfill', rows.filter((x) => (x.receipt_no || '').includes('-DUP')).every((x) => JSON.parse(x.legacy_json)._backfill.duplicate_of === 'AH-REC-20250101-AAAAAA'));
check('payments: every row stamped with the run id', rows.every((x) => JSON.parse(x.legacy_json)._backfill.run === RUN));
check('payments: container family wins over inner familyId (+warning)', rows.some((x) => x.receipt_no === 'AH-REC-MISM-01' && x.family_id === 'FAM-2') && report.warnings.some((w) => /FAM-XXX|mismatch/i.test(w)), JSON.stringify(report.warnings).slice(0, 240));
check('payments: local-only row planned with backfill_local source', rows.some((x) => x.receipt_no === 'AH-REC-LOCAL-1' && x.legacy_source === 'backfill_local'));
check('payments: unknown-family local record planned + warned', rows.some((x) => x.receipt_no === 'AH-REC-LOCAL-2' && x.family_id === 'FAM-UNKNOWN') && report.warnings.some((w) => /unknown family/i.test(w)));
check('payments: manual invoice keeps its kind + amount alias', rows.some((x) => x.receipt_no === 'AH-MAN-999' && x.record_kind === 'manual_invoice' && Number(x.amount_paid) === 250));
check('payments: cancelled record planned as Cancelled with reason', rows.some((x) => x.receipt_no === 'AH-REC-CANC-01' && x.status === 'Cancelled' && x.cancel_reason === 'wrong amount' && x.cancelled_by === 'manager'));
check('payments: per-family source sums (FAM-1 GBP 1319)', report.perFamily['FAM-1'] && Math.abs(report.perFamily['FAM-1'].sums.GBP - 1319) < 0.005 && report.perFamily['FAM-1'].count === 5, JSON.stringify(report.perFamily['FAM-1']));
check('payments: per-currency sums kept apart (FAM-2 GBP 170 / PKR 250)', Math.abs(report.perFamily['FAM-2'].sums.GBP - 170) < 0.005 && Math.abs(report.perFamily['FAM-2'].sums.PKR - 250) < 0.005, JSON.stringify(report.perFamily['FAM-2']));

// Determinism (write-phase idempotency foundation): same inputs -> identical plan
const again = BF.planPayments({ families, localRecords, runId: RUN });
check('payments: planner is deterministic (re-run = identical rows)', JSON.stringify(again.rows) === JSON.stringify(rows));

// Reconciliation refusal: doctor the builder so plan sums diverge from source sums
{
  const W2 = loadModules();
  const orig = W2.FeeTables.paymentRowFromLegacy;
  let tampered = false;
  W2.FeeTables.paymentRowFromLegacy = (r, s) => {
    const row = orig(r, s);
    if (!tampered && r && r.receiptNo === 'AH-REC-CANC-01') { row.amount_paid = Number(row.amount_paid) - 1; tampered = true; }
    return row;
  };
  const out = W2.BackfillFinance.planPayments({ families, localRecords: [], runId: RUN });
  check('gate: a doctored plan does NOT reconcile and reports diffs', out.report.reconciled === false && out.report.diffs.length >= 1, JSON.stringify(out.report.diffs).slice(0, 200));
}

// ---- Salaries ------------------------------------------------------------------
const slip = (over) => ({ month: 'September 2026', base_subtotal: 2000, bonus: 0, deduction: 0, net_payable: 2000, status: 'Pending', saved_at: '2026-09-01T00:00:00Z', ...over });
const teachers = [
  { id: 'TCH-1', address: JSON.stringify({
      salary_slips: { 'TCH-1_September_2026': slip({ net_payable: 1000 }) },
      deduction_records: [{ id: 'DED-1', type: 'deduction', category: 'Absence', amount: 200, date: '2026-10-15', month: 'October 2026', reason: 'Synthetic', status: 'Applied' }],
      deleted_salary_months: ['November 2026'] }) },
  { id: 'TCH-2', address: { salary_slips: {}, deduction_records: [] } },
];
const localSalaries = {
  'TCH-1_September_2026': slip({ net_payable: 2000, saved_at: '2026-10-01T00:00:00Z' }),
  'TCH-1_October_2026': slip({ month: 'October 2026', net_payable: 3000, base_subtotal: 3000 }),
  'TCH-1_November_2026': slip({ month: 'November 2026', net_payable: 4000, base_subtotal: 4000 }),
  'XXX_bad': slip({ month: 'October 2026' }),
};
const carrierSalaries = { 'TCH-2_December_2026': slip({ month: 'December 2026', teacher_id: 'TCH-2', net_payable: 5000, base_subtotal: 5000, saved_at: '2026-12-01T00:00:00Z' }) };

const sOut = BF.planSalaries({ teachers, localSalaries, carrierSalaries, runId: RUN });
check('salaries: 3 slips planned (Sept newest, Oct, Dec carrier)', sOut.slipRows.length === 3, String(sOut.slipRows.length));
check('salaries: newest saved_at wins (September net 2000, not 1000)', sOut.slipRows.some((x) => x.teacher_id === 'TCH-1' && x.period === '2026-09' && Number(x.net_payable) === 2000));
check('salaries: deleted month suppressed, not planned', !sOut.slipRows.some((x) => x.period === '2026-11') && sOut.report.suppressed.length === 1 && sOut.report.suppressed[0].teacherId === 'TCH-1', JSON.stringify(sOut.report.suppressed));
check('salaries: carrier slip planned for TCH-2', sOut.slipRows.some((x) => x.teacher_id === 'TCH-2' && x.period === '2026-12' && Number(x.net_payable) === 5000));
check('salaries: unknown-teacher slip is unparseable, not planned', sOut.report.unparseable.length === 1 && /unknown teacher/i.test(sOut.report.unparseable[0].reason || ''), JSON.stringify(sOut.report.unparseable));
check('salaries: deduction record becomes an adjustment row', sOut.adjustmentRows.length === 1 && Number(sOut.adjustmentRows[0].amount) === 200 && sOut.adjustmentRows[0].kind === 'deduction');
check('salaries: reconciled (suppressed + unparseable excluded both sides)', sOut.report.reconciled === true && sOut.report.diffs.length === 0, JSON.stringify(sOut.report.diffs));
check('salaries: slip rows stamped with run id', sOut.slipRows.every((x) => JSON.parse(x.legacy_json)._backfill.run === RUN));
check('salaries: per-teacher plan (TCH-1: 2 slips, 5000)', sOut.report.planPerTeacher['TCH-1'].slips === 2 && Math.abs(sOut.report.planPerTeacher['TCH-1'].sumNet - 5000) < 0.005, JSON.stringify(sOut.report.planPerTeacher));

// Malformed inputs never throw
{
  const e1 = BF.planPayments({});
  const e2 = BF.planSalaries(null);
  check('robustness: empty/malformed inputs return empty plans', Array.isArray(e1.rows) && e1.rows.length === 0 && Array.isArray(e2.slipRows) && e2.slipRows.length === 0);
}

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch6c-backfill: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
