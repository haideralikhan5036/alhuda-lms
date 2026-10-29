// Phase 3.5 test — failure states (P2-12, P2-15, P2-16, P2-17).
// Structural guards: the fee/leave flows cannot run headlessly (DOM +
// cloud), so these checks pin the exact code paths that make each
// failure honest — a regression that reintroduces a silent success,
// a stale September default, or an unawaited sync fails here.
// Run from the repo root:  node test/phase3-failure-states.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEES = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const LEAVES = fs.readFileSync(path.join(REPO_ROOT, 'js/leaves.js'), 'utf8');
const P360 = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
const count = (src, re) => (src.match(re) || []).length;

// ==== Part A: P2-12 — current month is the default, not September =====
// The three hard-coded `selected` September options are gone from the
// fee selects, so the browser can no longer open the dashboard on
// last month before JS runs.
check('A no hard-coded September selected in index.html fee selects',
  !INDEX.includes('value="September" selected'),
  String(count(INDEX, /value="September" selected/g)));
check('A dashboard/pending/salary defaults are set once per page load',
  FEES.includes('let FEE_MONTH_DEFAULTS_APPLIED = false') &&
  FEES.includes('if (!FEE_MONTH_DEFAULTS_APPLIED)') &&
  FEES.includes('FEE_MONTH_DEFAULTS_APPLIED = true;'));
// The once-only flag matters: loadFeeBillingLedger runs on every
// fee-tab entry, so an unconditional set would snap a deliberate
// earlier-month review back to the current month.
check('A first-load block sets dashboard + pending + salary selects',
  FEES.includes("if (mSel) mSel.value = curMonthName;") &&
  FEES.includes("if (pMSel) pMSel.value = curMonthName;") &&
  FEES.includes('salMSel.value = curLabel;'));
check('A collect form still auto-corrects to the current month',
  FEES.includes('if (formMSel) formMSel.value = curMonthName;') &&
  FEES.includes('if (formYSel) formYSel.value = String(curYear);'));
check('A old defeat condition is gone (no "if (!mSel.value)" default)',
  !FEES.includes('if (mSel && !mSel.value) mSel.value = curMonthName;'));
// Family 360: AUTO rows cover all 12 months up to the CURRENT month
// (old code: Jan–Sep list, loop from index 8 — October had no row).
check('A 360 AUTO month list covers the full year',
  P360.includes("'January','February','March','April','May','June','July','August','September','October','November','December'"));
check('A 360 AUTO upper bound is the current month (2026) / December (later years)',
  P360.includes('(_now35.getFullYear() === 2026) ? _now35.getMonth() : 11') &&
  P360.includes('for (let mIdx = _upper35; mIdx >= startMonthIdx; mIdx--)'));
check('A 360 currentMonthPaid uses the actual current month, not September',
  P360.includes("_curMonth35") && !P360.includes("=== 'september' && r.status === 'PAID'"));
check('A 360 invoice-sent badge uses the actual current month label',
  P360.includes('_curLabel35') && !P360.includes("last_invoice_sent_month === 'September 2026'"));
check('A 360 manual-invoice month picker defaults to the current month',
  P360.includes("months[new Date().getMonth()] ? 'selected' : ''"));

// ==== Part B: P2-15 — approvals fail honestly ==========================
// The false-success toast is gone from code (the only remaining
// mention is the Batch 3.5 comment itself, quoting the old wording).
check('B no false "Approved! Teacher" toast in the approve path',
  !LEAVES.includes('Approved! Teacher'));
check('B failed student fetch restores the queue + reports failure',
  LEAVES.includes('removedLocalRequests') && LEAVES.includes('removedPendingRequests') &&
  LEAVES.includes('The request was NOT approved') &&
  LEAVES.includes("type: 'error'"));
check('B reschedule log-write error throws instead of warn-and-continue',
  LEAVES.includes('if (logErr) throw logErr;') &&
  !LEAVES.includes('Could not update attendance log:'));
check('B reschedule notes update is error-checked (no silent second write)',
  LEAVES.includes('reschedNotesErr') && LEAVES.includes('if (reschedNotesErr) throw reschedNotesErr;'));
// The branches the audit already called honest are untouched.
check('B leave + time-change branches still throw on their write errors',
  LEAVES.includes('if (upErr) throw upErr;') && LEAVES.includes('if (upSchedErr) throw upSchedErr;'));

// ==== Part C: P2-16 — fee sync is awaited and honest ===================
check('C sync function returns a result object on every path',
  FEES.includes('return { ok: true }') && count(FEES, /return \{ ok: false/g) >= 3);
check('C submit AWAITS the cloud sync before any success claim',
  FEES.includes('await syncPaymentRecordsBatchToCloud(paymentRecord.familyId, addedBatch)'));
check('C success toast is gated on the sync result (no bare success toast)',
  FEES.includes('if (syncResult && syncResult.ok) lmsNotify("Fee payment recorded successfully!")') &&
  count(FEES, /Fee payment recorded successfully!/g) === 1);
check('C sync failure marks the receipt unsynced + persistent error toast',
  FEES.includes('rec.cloudSyncPending = true;') &&
  FEES.includes('marked unsynced. Use Sync to retry') &&
  FEES.includes("type: 'error'"));
check('C cloud copy never carries the local retry flag',
  FEES.includes('delete toStore.cloudSyncPending;'));
check('C manual sync actually retries unsynced records (not just reload)',
  FEES.includes('rec.cloudSyncPending') && FEES.includes('delete rec.cloudSyncPending;') &&
  FEES.includes('pendingByFamily') && FEES.includes('unsynced fee record(s) synced to the cloud.') &&
  FEES.includes('still unsynced — please try Sync again.'));
check('C manual sync no longer toasts about a sync it never performed',
  !FEES.includes('Syncing latest fee records with cloud...') &&
  !FEES.includes('lmsNotify("Fee records reloaded.")'));
check('C sync failures move the indicator to offline (honest state)',
  count(FEES, /updateCloudSyncIndicator\('offline'\)/g) >= 3);

// ==== Part D: P2-17 — silent invoice email branches on dispatch =======
check('D silent auto-send claims dispatch only on real dispatch',
  FEES.includes('Silent path (auto-send): Batch 3.5 (audit P2-17)') &&
  FEES.includes('if (dispatchedSuccessfully) {') &&
  FEES.includes('Invoice email could NOT be sent — the receipt is still saved, please send it manually.'));
check('D relay-success toast appears exactly once (inside the gated branch)',
  count(FEES, /Official Invoice Email dispatched via Al-Huda Official Relay\./g) === 1);
check('D no email content/recipient change (relay call sites untouched)',
  FEES.includes('sendViaOfficialEmailRelay') && FEES.includes('to: targetEmail'));

// ==== Part E: batch discipline ==========================================
check('E no native alert/confirm/prompt calls in fees.js (Batch 8 system only)',
  !/[^a-zA-Z]alert\(|[^a-zA-Z]confirm\(|[^a-zA-Z]prompt\(/.test(FEES));
check('E worker release is the commission release (2026-10-29-salary-advance)',
  WORKER.includes("const WORKER_RELEASE = '2026-10-29-salary-advance'"));
check('E no D1 schema change in this batch (no CREATE TABLE / ALTER TABLE)',
  !FEES.includes('CREATE TABLE') && !LEAVES.includes('CREATE TABLE') && !P360.includes('CREATE TABLE'));

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`phase3-failure-states: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
