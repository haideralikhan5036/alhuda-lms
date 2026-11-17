// Fee Upgrade Phase 1 — timeline + effective fee change (Batches 19-21).
// Executes the REAL functions from js/fee-phase1.js in a vm sandbox.
// Run from the repo root: node test/fee-phase1-timeline.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

function loadPhase1(stubs) {
  const windowObj = { ...(stubs || {}) };
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PHASE1_SRC, sandbox);
  // Dates must be built INSIDE the vm realm: an outer-realm Date fails
  // the module's `instanceof Date` check and silently falls back to today.
  const inRealmDate = (y, m, d) => vm.runInContext(`new Date(${y}, ${m}, ${d})`, sandbox);
  return { F: windowObj.FeePhase1, inRealmDate };
}

const { F, inRealmDate } = loadPhase1();

// ---- parse / normalize / upsert -------------------------------------------
{
  const fam = {
    id: 'FAM-021', monthly_fee: 8500, currency: 'PKR',
    notes: JSON.stringify({ fee_revisions: [
      { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01', reason: 'Annual review' },
      { effectiveYear: 2027, effectiveMonth: 'January', effectiveMonthIdx: 0, prevFee: 7500, newFee: 8500, revisedDate: '2026-11-10', reason: '' }
    ] })
  };
  const revs = F.parseFeeRevisions(fam);
  check('parseFeeRevisions reads notes.fee_revisions sorted', revs.length === 2 && revs[0].effectiveMonth === 'October' && revs[1].effectiveMonth === 'January');
  check('parseFeeRevisions tolerates a notes string', F.parseFeeRevisions(fam.notes).length === 2);
  check('parseFeeRevisions drops invalid entries', F.parseFeeRevisions({ fee_revisions: [{ effectiveYear: 1999, effectiveMonthIdx: 0, prevFee: 1, newFee: 2 }, { effectiveYear: 2026, effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500 }] }).length === 1);
  check('parseFeeRevisions on empty input is []', F.parseFeeRevisions(null).length === 0 && F.parseFeeRevisions({}).length === 0);

  const bad = F.normalizeFeeRevision({ effectiveYear: 2026, effectiveMonthIdx: 12, prevFee: 1, newFee: 2 });
  check('normalizeFeeRevision rejects month 12', bad === null);
  const bad2 = F.normalizeFeeRevision({ effectiveYear: 2026, effectiveMonthIdx: 9, prevFee: -5, newFee: 7500 });
  check('normalizeFeeRevision rejects negative prevFee', bad2 === null);
  const long = F.normalizeFeeRevision({ effectiveYear: 2026, effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, reason: 'x'.repeat(300) });
  check('normalizeFeeRevision truncates reason to 160', long && long.reason.length === 160);

  const replaced = F.upsertFeeRevision(revs, { effectiveYear: 2026, effectiveMonthIdx: 9, prevFee: 9999, newFee: 8000, revisedDate: '2026-11-17', reason: 'Corrected' });
  check('upsert same-month replace preserves original prevFee', replaced.length === 2 && replaced[0].prevFee === 5000 && replaced[0].newFee === 8000 && replaced[0].reason === 'Corrected');
  check('upsert does not mutate the input array', revs[0].newFee === 7500);
  const appended = F.upsertFeeRevision(revs, { effectiveYear: 2026, effectiveMonthIdx: 11, prevFee: 7500, newFee: 9000, revisedDate: '2026-11-17' });
  check('upsert new month appends sorted (Oct, Dec, Jan)', appended.length === 3 && appended[1].effectiveMonth === 'December' && appended[2].effectiveMonth === 'January');
  check('findFeeRevisionAt finds the October revision', F.findFeeRevisionAt(revs, 9, 2026) && F.findFeeRevisionAt(revs, 9, 2026).newFee === 7500);
  check('findFeeRevisionAt misses other months', F.findFeeRevisionAt(revs, 10, 2026) === null);
}

// ---- presets ---------------------------------------------------------------
{
  const base = inRealmDate(2026, 10, 17);
  const prev = F.feePresetTarget('previous', base);
  check('preset previous = October 2026', prev.monthIdx === 9 && prev.year === 2026);
  const cur = F.feePresetTarget('current', base);
  check('preset current = November 2026', cur.monthIdx === 10 && cur.year === 2026);
  const nxt = F.feePresetTarget('next', base);
  check('preset next = December 2026', nxt.monthIdx === 11 && nxt.year === 2026);
  const prev3 = F.feePresetTarget('prev3', base);
  check('preset prev3 = August 2026', prev3.monthIdx === 7 && prev3.year === 2026);
  const jan = F.feePresetTarget('previous', inRealmDate(2027, 0, 5));
  check('preset previous rolls the year back (Jan 2027 -> Dec 2026)', jan.monthIdx === 11 && jan.year === 2026);
}

// ---- applicable fee --------------------------------------------------------
{
  const fam = {
    id: 'FAM-021', monthly_fee: 8500, currency: 'PKR',
    notes: JSON.stringify({ fee_revisions: [
      { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01' },
      { effectiveYear: 2027, effectiveMonth: 'January', effectiveMonthIdx: 0, prevFee: 7500, newFee: 8500, revisedDate: '2026-11-10' }
    ] })
  };
  const sep = F.getApplicableFeeForMonth(fam, 8, 2026, {});
  check('month before first revision uses prevFee (previous-fee)', sep.fee === 5000 && sep.source === 'previous-fee');
  const oct = F.getApplicableFeeForMonth(fam, 9, 2026, {});
  check('revision month uses newFee (timeline)', oct.fee === 7500 && oct.source === 'timeline');
  const nov = F.getApplicableFeeForMonth(fam, 10, 2026, {});
  check('month after revision keeps the tier', nov.fee === 7500 && nov.source === 'timeline');
  check('scheduled change to master is NOT a mismatch', nov.timelineMismatch === false && nov.nextRevision && nov.nextRevision.newFee === 8500);
  const jan = F.getApplicableFeeForMonth(fam, 0, 2027, {});
  check('scheduled month uses the new fee, equal to master', jan.fee === 8500 && jan.timelineMismatch === false);

  const mismatchFam = {
    id: 'FAM-009', monthly_fee: 5000,
    notes: JSON.stringify({ fee_revisions: [
      { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01' }
    ] })
  };
  const mis = F.getApplicableFeeForMonth(mismatchFam, 10, 2026, {});
  check('timeline fee above master with no later revision IS a mismatch (red)', mis.fee === 7500 && mis.timelineMismatch === true);

  const plain = { id: 'FAM-001', monthly_fee: 4500 };
  const noRev = F.getApplicableFeeForMonth(plain, 10, 2026, {});
  check('no revisions, no records -> master fee', noRev.fee === 4500 && noRev.source === 'master');

  // Receipts inference (Batch 20 rule).
  const recs = [
    { familyId: 'FAM-001', month: 'August', year: 2026, monthlyFee: 4000, amountPaid: 4000, status: 'Paid in Full', date: '2026-08-05' },
    { familyId: 'FAM-001', month: 'October', year: 2026, monthlyFee: 4500, amountPaid: 4500, status: 'Paid in Full', date: '2026-10-03' }
  ];
  const octRec = F.getApplicableFeeForMonth(plain, 9, 2026, { records: recs });
  check('exact-month receipt fee is used (payment-record)', octRec.fee === 4500 && octRec.source === 'payment-record');
  const sepRec = F.getApplicableFeeForMonth(plain, 8, 2026, { records: recs });
  check('receipt month itself is used', sepRec.fee === 4000 && sepRec.source === 'payment-record');
  const novRec = F.getApplicableFeeForMonth(plain, 10, 2026, { records: recs });
  check('Batch 20: months AFTER the newest receipt use master, never projected', novRec.fee === 4500 && novRec.source === 'master');
  const julBefore = F.getApplicableFeeForMonth(plain, 6, 2026, { records: recs });
  check('month before all receipts with no closer receipt uses master', julBefore.fee === 4500 && julBefore.source === 'master');
  const cancelled = recs.concat([{ familyId: 'FAM-001', month: 'November', year: 2026, monthlyFee: 9999, amountPaid: 0, status: 'Cancelled', date: '2026-11-02' }]);
  const novCancel = F.getApplicableFeeForMonth(plain, 10, 2026, { records: cancelled });
  check('cancelled receipts are ignored by inference', novCancel.fee === 4500 && novCancel.source === 'master');
}

// ---- due date + ref --------------------------------------------------------
{
  check('due date billing_day 1 -> Nov 1', F.getFeeDueDate({ billing_day: 1 }, 10, 2026) === '2026-11-01');
  check('due date billing_day 31 clamps Feb to 28 (2026 not a leap year)', F.getFeeDueDate({ billing_day: 31 }, 1, 2026) === '2026-02-28');
  check('due date billing_day 31 clamps Feb to 29 in a leap year', F.getFeeDueDate({ billing_day: 31 }, 1, 2024) === '2024-02-29');
  check('due date defaults to day 1 without billing_day', F.getFeeDueDate({}, 10, 2026) === '2026-11-01');
  check('due date billing_day 15', F.getFeeDueDate({ billing_day: 15 }, 0, 2027) === '2027-01-15');
  check('DUE ref format', F.dueInvoiceRef('FAM-021', 10, 2026) === 'DUE-202611-FAM-021');
  check('DUE ref sanitises the family id', F.dueInvoiceRef('fam 021!', 0, 2026) === 'DUE-202601-FAM021');
}

// ---- buildFeeRevisionForEdit (Batch 21 rule) -------------------------------
{
  const fam = { id: 'FAM-021', monthly_fee: 5000, notes: JSON.stringify({ fee_revisions: [] }) };
  const { F: F2 } = loadPhase1({
    getStoredFeeRecords: () => [
      { familyId: 'FAM-021', month: 'August', year: 2026, monthlyFee: 5000, amountPaid: 5000, status: 'Paid in Full', date: '2026-08-05' }
    ]
  });
  const built = F2.buildFeeRevisionForEdit(fam, { newFee: 7500, preset: 'current', reason: 'Annual review' });
  // 'current' from today (Nov 2026 in this run's clock is not guaranteed),
  // so assert the shape + prevFee rule instead of the exact month.
  check('buildFeeRevisionForEdit returns a revision', !!built.revision && !built.error);
  check('revision newFee is the new fee', built.revision && built.revision.newFee === 7500);
  check('revision prevFee is the fee in force the month before (master, no timeline)', built.revision && built.revision.prevFee === 5000);
  check('revision reason is kept', built.revision && built.revision.reason === 'Annual review');

  const fam2 = {
    id: 'FAM-021', monthly_fee: 7500,
    notes: JSON.stringify({ fee_revisions: [
      { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01' }
    ] })
  };
  const built2 = F2.buildFeeRevisionForEdit(fam2, { newFee: 8500, preset: 'custom', month: 'January', year: 2027, reason: '' });
  check('custom effective month is honoured', built2.revision && built2.revision.effectiveMonth === 'January' && built2.revision.effectiveYear === 2027);
  check('prevFee follows the timeline (Oct tier 7500), not the master', built2.revision && built2.revision.prevFee === 7500);

  const bad = F2.buildFeeRevisionForEdit(fam, { newFee: 7500, preset: 'custom', month: 'NotAMonth', year: 2026 });
  check('invalid effective month is an error, not a revision', !!bad.error && !bad.revision);
  const badFee = F2.buildFeeRevisionForEdit(fam, { newFee: -5, preset: 'current' });
  check('negative fee is an error', !!badFee.error && !badFee.revision);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
