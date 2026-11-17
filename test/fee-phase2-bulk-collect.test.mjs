// Fee Upgrade Phase 2 — Bulk Collect (#52).
// Executes the REAL functions from js/fee-phase2.js in a vm sandbox.
// Run from the repo root: node test/fee-phase2-bulk-collect.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE2_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase2.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function loadPhase2() {
  const windowObj = {};
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PHASE2_SRC, sandbox);
  return windowObj.FeePhase2;
}

const F = loadPhase2();
check('FeePhase2 module loads with expected exports', typeof F.bulkCollectRows === 'function' && typeof F.runBulkCollect === 'function' && typeof F.buildBulkPaymentRecord === 'function' && typeof F.findBulkCollectDuplicates === 'function');

const ROWS = [
  { familyId: 'FAM-021', parentName: 'Hajra Waqas', studentsNames: 'Ayesha', country: 'Pakistan', whatsapp: '03001234567', email: 'a@example.com', currency: 'PKR', dueAmount: 7500, selectedMonth: 'November', selectedYear: 2026, isPartial: false, status: 'Pending', family: { id: 'FAM-021', monthly_fee: 7500 } },
  { familyId: 'FAM-004', parentName: 'Mohib Khan', studentsNames: 'Mohib', country: 'Pakistan', whatsapp: '03007654321', email: '', currency: 'PKR', dueAmount: 2200, selectedMonth: 'November', selectedYear: 2026, isPartial: true, status: 'Partial (Balance Pending)', family: { id: 'FAM-004', monthly_fee: 4400 } },
  { familyId: 'FAM-009', parentName: 'Sara Ahmed', studentsNames: 'Sara', country: 'USA', whatsapp: '', email: 's@example.com', currency: 'USD', dueAmount: 50, selectedMonth: 'November', selectedYear: 2026, isPartial: false, status: 'Pending', family: { id: 'FAM-009', monthly_fee: 50 } }
];

// ---- normalize / rows -------------------------------------------------------
check('normalizePendingRow keeps a valid row', F.normalizePendingRow(ROWS[0]).familyId === 'FAM-021' && F.normalizePendingRow(ROWS[0]).month === 'November' && F.normalizePendingRow(ROWS[0]).year === 2026);
check('normalizePendingRow drops missing familyId', F.normalizePendingRow({ dueAmount: 100 }) === null);
check('normalizePendingRow drops zero due amount', F.normalizePendingRow({ familyId: 'FAM-001', dueAmount: 0 }) === null);
check('normalizePendingRow drops negative due amount', F.normalizePendingRow({ familyId: 'FAM-001', dueAmount: -5 }) === null);
check('bulkCollectRows filters invalid rows', F.bulkCollectRows([...ROWS, { familyId: 'FAM-000', dueAmount: 0 }, null]).length === 3);

// ---- selection / totals -----------------------------------------------------
{
  const sel = F.bulkCollectSelection(F.bulkCollectRows(ROWS), ['FAM-021', 'fam-009']);
  check('bulkCollectSelection matches ids case-insensitively', sel.count === 2 && sel.selected[0].familyId === 'FAM-021');
  check('bulkCollectSelection totals per currency (no mixed sum)', sel.totals.PKR === 7500 && sel.totals.USD === 50 && Object.keys(sel.totals).length === 2);
  const empty = F.bulkCollectSelection(F.bulkCollectRows(ROWS), []);
  check('bulkCollectSelection empty is 0 + empty totals', empty.count === 0 && Object.keys(empty.totals).length === 0);
}

// ---- duplicates ---------------------------------------------------------------
{
  const records = [
    { familyId: 'FAM-021', month: 'November', year: 2026, status: 'Paid in Full', receiptNo: 'AH-REC-20261101-AAAAAA', amountPaid: 7500 },
    { familyId: 'FAM-004', month: 'October', year: 2026, status: 'Paid in Full', receiptNo: 'AH-REC-20261001-BBBBBB', amountPaid: 4400 },
    { familyId: 'FAM-009', month: 'November', year: 2026, status: 'Cancelled', receiptNo: 'AH-REC-20261102-CCCCCC', amountPaid: 50 }
  ];
  const dups = F.findBulkCollectDuplicates(records, F.bulkCollectRows(ROWS));
  check('findBulkCollectDuplicates finds the same-month payment', dups.length === 1 && dups[0].row.familyId === 'FAM-021');
  check('findBulkCollectDuplicates ignores other months', dups.every(d => d.row.familyId !== 'FAM-004'));
  check('findBulkCollectDuplicates ignores Cancelled records', dups.every(d => d.row.familyId !== 'FAM-009'));
}

// ---- record building ----------------------------------------------------------
{
  const row = F.normalizePendingRow(ROWS[0]);
  const rec = F.buildBulkPaymentRecord(row, { receiptNo: 'AH-REC-20261117-XYZ123', paymentMethod: 'Zelle', monthlyFee: 7500, priorPaid: 0 });
  check('buildBulkPaymentRecord mirrors the single-payment shape', rec.receiptNo === 'AH-REC-20261117-XYZ123' && rec.familyId === 'FAM-021' && rec.month === 'November' && rec.year === 2026 && rec.currency === 'PKR' && rec.paymentMethod === 'Zelle' && rec.transactionId === 'N/A' && rec.isProrated === false && rec.isAdvancePayment === false);
  check('buildBulkPaymentRecord full due is Paid in Full, remaining 0', rec.status === 'Paid in Full' && rec.remainingBalance === 0 && rec.amountPaid === 7500 && rec.totalPayable === 7500 && rec.previousBalance === 0);

  // Partial row: fee 4400, already paid 2200, due 2200 -> paying the due clears the month.
  const partial = F.normalizePendingRow(ROWS[1]);
  const recP = F.buildBulkPaymentRecord(partial, { receiptNo: 'AH-REC-20261117-XYZ124', monthlyFee: 4400, priorPaid: 2200 });
  check('buildBulkPaymentRecord partial top-up clears the month', recP.status === 'Paid in Full' && recP.remainingBalance === 0 && recP.amountPaid === 2200 && recP.monthlyFee === 4400);
  // Same partial row WITHOUT priorPaid: derived from monthlyFee - dueAmount.
  const recP2 = F.buildBulkPaymentRecord(partial, { receiptNo: 'AH-REC-20261117-XYZ125', monthlyFee: 4400 });
  check('buildBulkPaymentRecord derives priorPaid when not given', recP2.status === 'Paid in Full' && recP2.remainingBalance === 0);
  // monthlyFee falls back to the due amount.
  const recF = F.buildBulkPaymentRecord(partial, { receiptNo: 'AH-REC-20261117-XYZ126' });
  check('buildBulkPaymentRecord monthlyFee falls back to due amount', recF.monthlyFee === 2200 && recF.status === 'Paid in Full');
  // A short payment (amount < net due) stays Partial.
  const short = F.buildBulkPaymentRecord(F.normalizePendingRow({ ...ROWS[0], dueAmount: 3000 }), { receiptNo: 'AH-REC-20261117-XYZ127', monthlyFee: 7500, priorPaid: 0 });
  check('buildBulkPaymentRecord short payment stays Partial', short.status === 'Partial (Balance Remaining)' && short.remainingBalance === 4500);

  let threw = false;
  try { F.buildBulkPaymentRecord(row, {}); } catch (e) { threw = true; }
  check('buildBulkPaymentRecord refuses a missing receipt number', threw);
}

// ---- runner -------------------------------------------------------------------
{
  const rows = F.bulkCollectRows(ROWS);
  let n = 0;
  const deps = {
    generateReceiptNo: () => 'AH-REC-20261117-R' + String(++n).padStart(2, '0'),
    saveRecord: async (rec) => {
      if (rec.familyId === 'FAM-004') return { ok: false, error: 'Cloud sync failed' };
      return { ok: true, receiptNo: rec.receiptNo };
    },
    monthlyFeeForRow: (row) => (row.family ? row.family.monthly_fee : row.dueAmount),
    priorPaidForRow: (row) => (row.familyId === 'FAM-004' ? 2200 : 0)
  };
  const seen = [];
  const res = await F.runBulkCollect(rows, { ...deps, onRow: (i, total, outcome) => seen.push(outcome) });
  check('runBulkCollect pays 2, fails 1, and continues past the failure', res.paid === 2 && res.failed === 1 && res.results.length === 3);
  check('runBulkCollect reports the failed row with its error', res.results[1].ok === false && res.results[1].error === 'Cloud sync failed' && res.results[1].row.familyId === 'FAM-004');
  check('runBulkCollect totals only collected money, per currency', res.totalCollected.PKR === 7500 && res.totalCollected.USD === 50);
  check('runBulkCollect calls onRow for every row', seen.length === 3 && seen[2].ok === true);
  check('runBulkCollect mints a distinct receipt per row', new Set(res.results.map(r => r.receiptNo)).size === 3);

  // Email failure never fails the row.
  const emailRes = await F.runBulkCollect([rows[0]], {
    ...deps,
    emailReceipts: true,
    sendEmail: async () => { throw new Error('relay down'); }
  });
  check('runBulkCollect email failure is reported, row still paid', emailRes.paid === 1 && emailRes.results[0].emailError === 'Receipt email could not be sent.');

  // Missing deps throw before any save.
  let threwSave = false;
  try { await F.runBulkCollect(rows, { generateReceiptNo: deps.generateReceiptNo }); } catch (e) { threwSave = true; }
  check('runBulkCollect throws without a save function', threwSave);
  let threwGen = false;
  try { await F.runBulkCollect(rows, { saveRecord: deps.saveRecord }); } catch (e) { threwGen = true; }
  check('runBulkCollect throws without a receipt generator', threwGen);
  const emptyRes = await F.runBulkCollect([], deps);
  check('runBulkCollect on empty rows is 0/0', emptyRes.paid === 0 && emptyRes.failed === 0 && emptyRes.results.length === 0);
}

// ---- progress / summary HTML ----------------------------------------------------
{
  const okHtml = F.bulkCollectRowResultHtml({ row: { parentName: 'Hajra Waqas', familyId: 'FAM-021', currency: 'PKR', dueAmount: 7500 }, ok: true, receiptNo: 'AH-REC-20261117-R01' });
  check('bulkCollectRowResultHtml paid row shows amount + receipt', okHtml.includes('PKR 7500.00') && okHtml.includes('AH-REC-20261117-R01'));
  const badHtml = F.bulkCollectRowResultHtml({ row: { parentName: 'Mohib Khan', familyId: 'FAM-004', currency: 'PKR', dueAmount: 2200 }, ok: false, error: 'Cloud sync failed' });
  check('bulkCollectRowResultHtml failed row shows the error', badHtml.includes('Cloud sync failed') && badHtml.includes('FAM-004'));
  const sumHtml = F.bulkCollectSummaryHtml({ paid: 2, failed: 1, totalCollected: { PKR: 7500, USD: 50 }, results: [] }, 1);
  check('bulkCollectSummaryHtml shows paid/failed/skipped + totals', sumHtml.includes('2 paid, 1 failed') && sumHtml.includes('PKR 7500.00') && sumHtml.includes('USD 50.00') && sumHtml.includes('Skipped (already paid this month): <strong>1</strong>'));
  check('bulkCollectSummaryHtml escapes family names', F.bulkCollectRowResultHtml({ row: { parentName: '<b>X</b>', familyId: 'FAM-1', currency: 'USD', dueAmount: 1 }, ok: true, receiptNo: 'R1' }).includes('&lt;b&gt;X&lt;/b&gt;'));
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
