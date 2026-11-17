// Fee Upgrade Phase 3 — one-tap Paid/Unpaid (#33, #36, #45).
// Executes the REAL functions from js/fee-phase3.js in a vm sandbox.
// Run from the repo root: node test/fee-phase3-one-tap.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PHASE3_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase3.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const windowObj = {};
const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
// Phase 1 first: the matrix Undo button renders only when
// window.FeePhase1.requestUndoFeePayment exists (same as the portal).
vm.runInNewContext(PHASE1_SRC, sandbox);
vm.runInNewContext(PHASE3_SRC, sandbox);
const F = windowObj.FeePhase3;

const FAM = { id: 'FAM-021', parent_name: 'Hajra Waqas', monthly_fee: 7500, currency: 'PKR', students: [{ name: 'Ayesha', status: 'Active' }] };
const REAL = { receiptNo: 'AH-REC-20261117-ABC123', familyId: 'FAM-021', month: 'November', year: 2026, amountPaid: 7500, remainingBalance: 0, status: 'Paid in Full', currency: 'PKR', date: '2026-11-05', recordKind: 'payment' };
function adjRow(month, year, famId) {
  return { receiptNo: 'ADJ-' + String(year) + String(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(month) + 1).padStart(2, '0') + '-' + famId, familyId: famId, month, year, amountPaid: 0, remainingBalance: 0, status: 'Paid (Status)', currency: 'PKR', date: '2026-11-17', recordKind: 'month_status', paymentMethod: 'One-Tap Quick Status' };
}
const ADJ_NOV = adjRow('November', 2026, 'FAM-021');
const ADJ_OCT = adjRow('October', 2026, 'FAM-021');
const CANCELLED_REAL = { ...REAL, receiptNo: 'AH-REC-20261117-XXXXXX', status: 'Cancelled' };

// ---- exports -----------------------------------------------------------------
{
  const EXPECTED = ['MONTHS', 'esc', 'monthIdxOf', 'monthScore', 'isMonthStatusRow', 'monthStatusRef', 'findMonthStatusRow', 'findRealPaymentForMonth', 'isMonthStatusPaid', 'buildMonthStatusRecord', 'validateMarkPaid', 'validateMarkUnpaid', 'uiStateForMonth', 'stagedToggleNext', 'switcherGridHtml', 'matrixStatusButtonsHtml', 'ledgerStatusButtonHtml', 'enrollmentRowHtml'];
  check('FeePhase3 exports every function the glue calls', F && EXPECTED.every((n) => typeof F[n] === 'function' || Array.isArray(F[n])), EXPECTED.filter((n) => !(typeof F[n] === 'function' || Array.isArray(F[n]))).join(','));
}

// ---- record detection --------------------------------------------------------
check('isMonthStatusRow true for record_kind month_status', F.isMonthStatusRow(ADJ_NOV) === true);
check('isMonthStatusRow true for an ADJ ref without the kind flag', F.isMonthStatusRow({ receiptNo: 'ADJ-202611-FAM-021' }) === true);
check('isMonthStatusRow is case-insensitive on the ref', F.isMonthStatusRow({ receiptNo: 'adj-202611-fam-021' }) === true);
check('isMonthStatusRow false for a real payment', F.isMonthStatusRow(REAL) === false);
check('isMonthStatusRow false for a due-invoice row', F.isMonthStatusRow({ receiptNo: 'DUE-202611-FAM-021', recordKind: 'due_invoice' }) === false);
check('isMonthStatusRow false for null / empty', F.isMonthStatusRow(null) === false && F.isMonthStatusRow({}) === false);
check('monthStatusRef builds ADJ-YYYYMM-FAMILYID', F.monthStatusRef('FAM-021', 10, 2026) === 'ADJ-202611-FAM-021' && F.monthStatusRef('FAM-021', 0, 2027) === 'ADJ-202701-FAM-021');

// ---- status-paid predicate ----------------------------------------------------
check('isMonthStatusPaid true for an ADJ-only month', F.isMonthStatusPaid([ADJ_NOV], 'FAM-021', 10, 2026) === true);
check('isMonthStatusPaid false when no ADJ row exists', F.isMonthStatusPaid([REAL], 'FAM-021', 9, 2026) === false);
check('isMonthStatusPaid false when a real payment exists (money wins)', F.isMonthStatusPaid([REAL, ADJ_NOV], 'FAM-021', 10, 2026) === false);
check('isMonthStatusPaid ignores a cancelled real payment', F.isMonthStatusPaid([{ ...REAL, status: 'Cancelled' }, ADJ_NOV], 'FAM-021', 10, 2026) === true);
check('isMonthStatusPaid ignores a cancelled ADJ row', F.isMonthStatusPaid([{ ...ADJ_NOV, status: 'Cancelled' }], 'FAM-021', 10, 2026) === false);
check('isMonthStatusPaid is family-scoped (other family ADJ does not leak)', F.isMonthStatusPaid([adjRow('November', 2026, 'FAM-004')], 'FAM-021', 10, 2026) === false);
check('isMonthStatusPaid is month-scoped', F.isMonthStatusPaid([ADJ_OCT], 'FAM-021', 10, 2026) === false);
check('findMonthStatusRow returns the row, findRealPaymentForMonth the payment', F.findMonthStatusRow([REAL, ADJ_NOV], 'FAM-021', 10, 2026) === ADJ_NOV && F.findRealPaymentForMonth([REAL, ADJ_NOV], 'FAM-021', 10, 2026) === REAL);
check('findRealPaymentForMonth skips cancelled rows', F.findRealPaymentForMonth([CANCELLED_REAL], 'FAM-021', 10, 2026) === null);

// ---- record builder ------------------------------------------------------------
{
  const rec = F.buildMonthStatusRecord(FAM, 10, 2026, 7500, 'manager');
  check('buildMonthStatusRecord ref is ADJ-YYYYMM-FAMILYID', rec.receiptNo === 'ADJ-202611-FAM-021');
  check('buildMonthStatusRecord amount is ZERO (not money)', rec.amountPaid === 0 && rec.totalPayable === 0 && rec.remainingBalance === 0 && rec.discount === 0 && rec.excessPaid === 0 && rec.creditDeducted === 0);
  check('buildMonthStatusRecord kind is month_status', rec.recordKind === 'month_status');
  check('buildMonthStatusRecord status is Paid (Status)', rec.status === 'Paid (Status)');
  check('buildMonthStatusRecord method names the mechanism', rec.paymentMethod === 'One-Tap Quick Status');
  check('buildMonthStatusRecord carries the family + month + fee snapshot', rec.familyId === 'FAM-021' && rec.month === 'November' && rec.year === 2026 && rec.monthlyFee === 7500 && rec.currency === 'PKR');
  check('buildMonthStatusRecord records who marked it', rec.markedBy === 'manager');
  check('buildMonthStatusRecord date is today-shaped', /^\d{4}-\d{2}-\d{2}$/.test(rec.date));
}

// ---- validateMarkPaid -----------------------------------------------------------
{
  const base = { family: FAM, monthIdx: 10, year: 2026, records: [] };
  check('validateMarkPaid ok for a plain due month', F.validateMarkPaid(base).ok === true);
  check('validateMarkPaid refuses a month with a real payment', F.validateMarkPaid({ ...base, records: [REAL] }).code === 'has_payment');
  check('validateMarkPaid allows when the real payment is cancelled', F.validateMarkPaid({ ...base, records: [{ ...REAL, status: 'Cancelled' }] }).ok === true);
  check('validateMarkPaid refuses an already status-paid month', F.validateMarkPaid({ ...base, records: [ADJ_NOV] }).code === 'already_paid');
  check('validateMarkPaid refuses a pre-admission month', F.validateMarkPaid({ ...base, isPreAdmission: true }).code === 'pre_admission');
  check('validateMarkPaid refuses a legacy not-enrolled month', F.validateMarkPaid({ ...base, isNotEnrolled: true }).code === 'not_enrolled');
  check('validateMarkPaid refuses a leave month', F.validateMarkPaid({ ...base, isLeave: true }).code === 'leave');
  check('validateMarkPaid refuses a future month', F.validateMarkPaid({ ...base, isFuture: true }).code === 'future');
  check('validateMarkPaid refuses a missing family', F.validateMarkPaid({ family: null, monthIdx: 10, year: 2026, records: [] }).code === 'no_family');
  check('validateMarkPaid refuses a bad month index', F.validateMarkPaid({ ...base, monthIdx: 12 }).code === 'bad_month');
  check('validateMarkPaid error messages are professional English', !/tum|mujhe|chhutti/i.test(F.validateMarkPaid({ ...base, records: [REAL] }).error));
}

// ---- validateMarkUnpaid ---------------------------------------------------------
{
  const base = { family: FAM, monthIdx: 10, year: 2026, records: [ADJ_NOV] };
  const ok = F.validateMarkUnpaid(base);
  check('validateMarkUnpaid ok returns the ADJ row', ok.ok === true && ok.row === ADJ_NOV);
  check('validateMarkUnpaid refuses when no ADJ row exists', F.validateMarkUnpaid({ ...base, records: [] }).code === 'not_marked');
  const both = F.validateMarkUnpaid({ ...base, records: [REAL, ADJ_NOV] });
  check('validateMarkUnpaid REFUSES when a real payment exists (never touches money)', both.ok === false && both.code === 'has_payment');
  check('validateMarkUnpaid refuses when the ADJ row is cancelled', F.validateMarkUnpaid({ ...base, records: [{ ...ADJ_NOV, status: 'Cancelled' }] }).code === 'not_marked');
  check('validateMarkUnpaid refusal names undo/cancel as the path', /undo or cancel/i.test(F.validateMarkUnpaid({ ...base, records: [REAL, ADJ_NOV] }).error));
}

// ---- month state machine (returns a plain state string) -------------------------
{
  // NOTE: money-wins is NOT decided here — uiStateForMonth only reads
  // the flags it is given. The guarantee lives in buildAnnualMatrixData
  // (fees.js step 1 takes the real-payment branch first), pinned by
  // the matrix suite.
  const st = (m) => F.uiStateForMonth(m);
  check('uiStateForMonth paid real payment', st({ month: 'November', isPaid: true, amountPaid: 7500 }) === 'paid_receipt');
  check('uiStateForMonth status-paid (ADJ, no money)', st({ month: 'November', isPaid: true, isStatusPaid: true, amountPaid: 0 }) === 'paid_status');
  check('uiStateForMonth partial', st({ month: 'November', isPartial: true, amountPaid: 3000 }) === 'partial');
  check('uiStateForMonth leave', st({ month: 'November', isLeave: true }) === 'leave');
  check('uiStateForMonth not enrolled', st({ month: 'November', isNotEnrolled: true }) === 'not_enrolled');
  check('uiStateForMonth future', st({ month: 'November', isFuture: true }) === 'future');
  check('uiStateForMonth due', st({ month: 'November', isDue: true }) === 'due');
  check('uiStateForMonth bare month is due', st({ month: 'November' }) === 'due');
  check('uiStateForMonth paid beats partial when both flags set', st({ month: 'November', isPaid: true, isPartial: true }) === 'paid_receipt');
}

// ---- staged toggle (takes the state string) ---------------------------------------
{
  check('stagedToggleNext due -> paid', F.stagedToggleNext('due') === 'paid');
  check('stagedToggleNext paid_status -> unpaid', F.stagedToggleNext('paid_status') === 'unpaid');
  check('stagedToggleNext paid_receipt is not toggleable', F.stagedToggleNext('paid_receipt') === null);
  check('stagedToggleNext partial is not toggleable', F.stagedToggleNext('partial') === null);
  check('stagedToggleNext leave is not toggleable', F.stagedToggleNext('leave') === null);
  check('stagedToggleNext not_enrolled is not toggleable', F.stagedToggleNext('not_enrolled') === null);
  check('stagedToggleNext future is not toggleable', F.stagedToggleNext('future') === null);
}

// ---- switcher grid html ------------------------------------------------------------
{
  const months = F.MONTHS.map((m, i) => ({ month: m, isDue: i === 10, isPaid: i === 9, isStatusPaid: i === 9, amountPaid: 0, isLeave: i === 8, isNotEnrolled: i < 7, isFuture: i === 11 }));
  const html = F.switcherGridHtml(months, {});
  check('switcherGridHtml renders 12 month cells', (html.match(/<button type="button"/g) || []).length === 12);
  check('switcherGridHtml due cell is clickable and says Due', html.includes('toggleStagedMonthStatus(10)') && html.includes('Click to mark Paid'));
  check('switcherGridHtml status-paid cell offers Mark Unpaid', html.includes('toggleStagedMonthStatus(9)') && html.includes('Click to mark Unpaid'));
  check('switcherGridHtml leave / not-enrolled / future cells are disabled, not clickable', !html.includes('toggleStagedMonthStatus(8)') && !html.includes('toggleStagedMonthStatus(0)') && !html.includes('toggleStagedMonthStatus(11)'));
  const staged = F.switcherGridHtml(months, { 10: 'paid', 9: 'unpaid' });
  check('switcherGridHtml staged cells show the staged label + ring', staged.includes('STAGED: PAID') && staged.includes('STAGED: UNPAID') && staged.includes('ring-2'));
  check('switcherGridHtml has no Roman Urdu strings', !/tum|mujhe|chhutti|Yeh raqam/i.test(html));
}

// ---- matrix + ledger buttons ---------------------------------------------------------
{
  const due = F.matrixStatusButtonsHtml('due', '');
  check('matrix buttons due month offers Mark Paid only', due.includes("applyMatrixAction('mark_paid')") && !due.includes("mark_unpaid"));
  const st = F.matrixStatusButtonsHtml('paid_status', '');
  check('matrix buttons status-paid month offers Mark Unpaid only', st.includes("applyMatrixAction('mark_unpaid')") && !st.includes("mark_paid"));
  const real = F.matrixStatusButtonsHtml('paid_receipt', 'AH-REC-20261117-ABC123');
  check('matrix buttons real payment shows the receipt + Undo, never Mark Unpaid', real.includes('AH-REC-20261117-ABC123') && real.includes('Undo Payment') && !real.includes("mark_unpaid") && !real.includes("mark_paid"));
  check('matrix buttons partial month explains, offers no toggle', F.matrixStatusButtonsHtml('partial', '').includes('partial payment') && !F.matrixStatusButtonsHtml('partial', '').includes('mark_paid'));
  check('matrix buttons leave month offers nothing toggleable', !F.matrixStatusButtonsHtml('leave', '').includes('mark_'));
  check('matrix buttons future month offers nothing toggleable', !F.matrixStatusButtonsHtml('future', '').includes('mark_'));
  check('matrix buttons not-enrolled month offers nothing toggleable', !F.matrixStatusButtonsHtml('not_enrolled', '').includes('mark_'));
  const ledDue = F.ledgerStatusButtonHtml('due', 'November');
  check('ledger button due month offers Mark Paid', ledDue.includes("ledgerMarkMonthPaid('November')"));
  const ledSt = F.ledgerStatusButtonHtml('paid_status', 'November');
  check('ledger button status-paid month offers Mark Unpaid', ledSt.includes("ledgerMarkMonthUnpaid('November')"));
  check('ledger button real payment offers nothing', F.ledgerStatusButtonHtml('paid_receipt', 'November') === '');
  check('ledger button partial month offers nothing', F.ledgerStatusButtonHtml('partial', 'November') === '');
}

// ---- enrollment row html ---------------------------------------------------------------
{
  const manual = F.enrollmentRowHtml({ monthName: 'March', year: 2026, source: 'manual_override', monthIndex: 2 }, 2026);
  check('enrollmentRowHtml shows the manual admission date + Clear', manual.includes('Enrolled from:') && manual.includes('March 2026') && manual.includes('(set here)') && manual.includes('clearFeeEnrollmentDate()'));
  const lms = F.enrollmentRowHtml({ monthName: 'January', year: 2026, source: 'joining_date', monthIndex: 0 }, 2026);
  check('enrollmentRowHtml shows the LMS joining date with no Clear button', lms.includes('January 2026') && lms.includes('(from joining date)') && !lms.includes('clearFeeEnrollmentDate()'));
  check('enrollmentRowHtml month picker preselects the admission month', F.enrollmentRowHtml({ monthName: 'March', year: 2026, source: 'manual_override', monthIndex: 2 }, 2026).includes('<option value="2" selected>March</option>'));
  check('enrollmentRowHtml year input carries the switcher year', F.enrollmentRowHtml({ monthName: 'January', year: 2026, source: 'joining_date', monthIndex: 0 }, 2026).includes('id="feeStatusEnrollYear" value="2026"'));
  check('enrollmentRowHtml has no Roman Urdu strings', !/tum|mujhe|chhutti/i.test(manual + lms));
}

// ---- role scope (documented decision) ----------------------------------------------------
{
  // The module takes no role input: owner + manager share the Collect
  // Fee scope, so the validators decide identically for both roles.
  // The record just notes who marked it.
  const recOwner = F.buildMonthStatusRecord(FAM, 10, 2026, 7500, 'owner');
  const recMgr = F.buildMonthStatusRecord(FAM, 10, 2026, 7500, 'manager');
  check('role scope: validators take no role (same result for owner + manager)', F.validateMarkPaid({ family: FAM, monthIdx: 10, year: 2026, records: [] }).ok === true && F.validateMarkUnpaid({ family: FAM, monthIdx: 10, year: 2026, records: [ADJ_NOV] }).ok === true);
  check('role scope: the record notes owner vs manager as markedBy', recOwner.markedBy === 'owner' && recMgr.markedBy === 'manager');
}

check('fee-phase3.js has no Roman Urdu UI strings', !/Yeh raqam|chhutti|mujhe|tumhara/i.test(PHASE3_SRC));
check('fee-phase3.js uses no document.write or eval', !PHASE3_SRC.includes('document.write') && !PHASE3_SRC.includes('eval('));

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
