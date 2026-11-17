// Fee Upgrade Phase 2 — UI wiring: the new module is loaded, the Pending
// view carries the Bulk Collect bar + checkboxes, the Leave tab carries
// the Bulk Leave entry point + modal, and the glue functions exist.
// Run from the repo root: node test/fee-phase2-ui-wiring.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const FEES = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const LEAVES = fs.readFileSync(path.join(REPO_ROOT, 'js/leaves.js'), 'utf8');
const PHASE2_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase2.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- module loads + exports ------------------------------------------------------
const windowObj = {};
const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(PHASE2_SRC, sandbox);
const F = windowObj.FeePhase2;
const EXPECTED = ['MONTHS', 'esc', 'monthIdxOf', 'monthScore', 'lastDayOfMonth', 'normalizePendingRow', 'bulkCollectRows', 'bulkCollectSelection', 'findBulkCollectDuplicates', 'buildBulkPaymentRecord', 'runBulkCollect', 'bulkCollectRowResultHtml', 'bulkCollectSummaryHtml', 'studentLeaveState', 'normalizeBulkLeaveFamily', 'bulkLeaveFamilies', 'bulkLeaveMonthOptions', 'leaveWindowForMonths', 'bulkLeaveSummary', 'validateBulkLeave', 'runBulkLeave', 'bulkLeaveModalHtml', 'bulkLeaveConfirmHtml', 'bulkLeaveFamilyResultHtml', 'bulkLeaveSummaryHtml'];
check('FeePhase2 exports every function the glue calls', F && EXPECTED.every((n) => typeof F[n] === 'function' || Array.isArray(F[n])), EXPECTED.filter((n) => !(typeof F[n] === 'function' || Array.isArray(F[n]))).join(','));

// ---- index.html wiring -------------------------------------------------------------
check('index.html loads js/fee-phase2.js right after fee-phase1.js', INDEX.indexOf('<script src="js/fee-phase2.js"></script>') > INDEX.indexOf('<script src="js/fee-phase1.js"></script>') && INDEX.indexOf('<script src="js/fee-phase2.js"></script>') > 0);
check('index.html Bulk Collect bar exists with all controls', ['feeBulkCollectBar', 'feeBulkCollectCount', 'feeBulkCollectTotal', 'feeBulkCollectMethod', 'feeBulkCollectEmail', 'feeBulkCollectSkipDup', 'feeBulkCollectDupWarn', 'btnBulkCollectRun', 'feeBulkCollectProgress'].every((id) => INDEX.includes('id="' + id + '"')));
check('index.html Bulk Collect method options match the fee form', ['Online / Bank Transfer', 'Zelle', 'PayPal', 'Stripe', 'Wise', 'Cash / Other'].every((m) => INDEX.includes('value="' + m + '"')));
check('index.html Pending table has a select-all checkbox column', INDEX.includes('id="feeBulkSelectAll"') && INDEX.includes('togglePendingBulkSelectAll(this.checked)'));
check('index.html Bulk Leave button sits next to Mark Student on Leave', INDEX.includes('openBulkLeaveModal()') && INDEX.indexOf('openBulkLeaveModal()') > INDEX.indexOf('openMarkLeaveModal()'));
check('index.html Bulk Leave modal shell exists with a labelled close button', INDEX.includes('id="modalBulkLeave"') && INDEX.includes('id="bulkLeaveModalBody"'));
check('index.html Bulk Leave modal close button is labelled', /id="modalBulkLeave"[\s\S]{0,2000}aria-label="Close"/.test(INDEX));

// ---- fees.js glue --------------------------------------------------------------------
check('fees.js has the bulk save path (same save sequence as single)', FEES.includes('async function saveBulkFeePaymentRecord(record)') && FEES.includes('syncPaymentRecordsBatchToCloud(record.familyId, [record])'));
check('fees.js has the Bulk Collect UI glue', ['function togglePendingBulkSelectAll', 'function updatePendingBulkSelection', 'function syncPendingBulkUi', 'async function startBulkCollect', 'function bulkCollectPriorPaidForRow'].every((s) => FEES.includes(s)));
check('fees.js pending rows carry a Bulk Collect checkbox', FEES.includes('pending-bulk-check') && FEES.includes('updatePendingBulkSelection(this)'));
check('fees.js pending render clears stale selection + syncs the bar', FEES.includes('PENDING_BULK_SELECTED = {};') && FEES.includes('syncPendingBulkUi();'));
check('fees.js Bulk Collect reuses the single-payment record builder', FEES.includes('window.FeePhase2.runBulkCollect') && FEES.includes('saveRecord: saveBulkFeePaymentRecord'));
check('fees.js Bulk Collect emails receipts through the single path', FEES.includes('sendFeeInvoiceEmailModal(rec, true)'));

// ---- leaves.js glue -------------------------------------------------------------------
check('leaves.js exposes the single-student leave core for bulk reuse', LEAVES.includes('async function applyStudentLeave(studentId, input)') && LEAVES.includes('window.applyStudentLeave = applyStudentLeave;'));
check('leaves.js single-leave form now calls the extracted core', LEAVES.includes('applyStudentLeave(studentId, { startDate: startDate, returnDate: returnDate, reason: reason })'));
check('leaves.js has the Bulk Leave modal glue', ['function openBulkLeaveModal', 'function filterBulkLeaveFamilies', 'function syncBulkLeaveModalUi', 'function bulkLeaveReasonChange', 'function reviewBulkLeave', 'function backToBulkLeavePick', 'async function startBulkLeaveFromModal'].every((s) => LEAVES.includes(s)));
check('leaves.js Bulk Leave run calls the extracted core per student', LEAVES.includes('applyLeave: window.applyStudentLeave') && LEAVES.includes('window.FeePhase2.runBulkLeave'));

// ---- hygiene -----------------------------------------------------------------------------
{
  const buf = fs.readFileSync(path.join(REPO_ROOT, 'index.html'));
  const bareLF = buf.toString('utf8').replace(/\r\n/g, '').split('\n').length - 1;
  check('index.html is still CRLF (0 bare LF)', bareLF === 0, String(bareLF));
}
check('fee-phase2.js has no Roman Urdu UI strings', !/Yeh raqam|chhutti|mujhe|tumhara/i.test(PHASE2_SRC));
check('no new script uses document.write or eval', !PHASE2_SRC.includes('document.write') && !PHASE2_SRC.includes('eval('));

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
