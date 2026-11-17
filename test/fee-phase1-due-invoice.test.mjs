// Fee Upgrade Phase 1 — Fee Due Invoice (Batches 15-16).
// Part 1 executes the REAL classify/build functions from js/fee-phase1.js.
// Part 2 executes the REAL fee-tables.js loaders with a mock db: the
// payments filter (due invoices never leak into money readers) and the
// idempotent due-invoice insert.
// Run from the repo root: node test/fee-phase1-due-invoice.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const FEE_TABLES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const windowObj = {};
{
  const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PHASE1_SRC, sandbox);
}
const F = windowObj.FeePhase1;

// A family enrolled Aug 2026 at 5000/month, billing day 1.
function testFamily() {
  return {
    id: 'FAM-021', parent_name: 'Bilal Ahmed', monthly_fee: 5000, currency: 'PKR',
    billing_day: 1, status: 'Active', country: 'Pakistan',
    students: [{ name: 'Ahmed', status: 'Active' }, { name: 'Sara', status: 'Active' }]
  };
}
function testRecords() {
  return [
    { receiptNo: 'AH-REC-20260801-AAAAAA', familyId: 'FAM-021', month: 'August', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-08-05' },
    { receiptNo: 'AH-REC-20261001-BBBBBB', familyId: 'FAM-021', month: 'October', year: 2026, monthlyFee: 5000, amountPaid: 3000, discount: 0, status: 'Partial (Balance Remaining)', date: '2026-10-03' }
  ];
}
function testCtx(records, overrides) {
  return {
    records: records || testRecords(),
    enrollInfo: { year: 2026, monthIndex: 7, monthName: 'August', source: 'test' },
    today: '2026-11-17',
    isLeave: () => ({ isLeave: false, reason: '' }),
    isNotEnrolled: () => false,
    isPreAdmission: () => false,
    feeForMonth: (m, y) => F.getApplicableFeeForMonth(testFamily(), m, y, { records: records || testRecords() }).fee
  };
}

// ---- classify --------------------------------------------------------------
{
  const cls = F.classifyFeeArrears(testFamily(), 10, 2026, testCtx());
  check('classify: September unpaid is an arrear (5000)', cls.arrearsMonths.some(a => a.month === 'September' && a.shortfall === 5000));
  check('classify: October partial shortfall is 2000', cls.arrearsMonths.some(a => a.month === 'October' && a.shortfall === 2000 && a.isPartial === true));
  check('classify: arrears total is 7000', cls.arrearsAmount === 7000);
  check('classify: current November is unpaid and due', cls.currentStatus === 'unpaid' && cls.currentIsDue === true && cls.currentDueAmount === 5000);
  check('classify: current due date is the billing day', cls.currentDueDate === '2026-11-01');

  const leaveCtx = testCtx();
  leaveCtx.isLeave = (m) => (m === 'September' ? { isLeave: true, reason: 'Approved Leave' } : { isLeave: false, reason: '' });
  const clsLeave = F.classifyFeeArrears(testFamily(), 10, 2026, leaveCtx);
  check('classify: a leave month is skipped from arrears', clsLeave.arrearsAmount === 2000 && !clsLeave.arrearsMonths.some(a => a.month === 'September'));

  const earlyCtx = testCtx();
  earlyCtx.today = '2026-10-15';
  const clsEarly = F.classifyFeeArrears(testFamily(), 10, 2026, earlyCtx);
  check('classify: November is not due yet on Oct 15', clsEarly.currentIsDue === false);
  check('classify: arrears still count the due months', clsEarly.arrearsAmount === 7000);

  const timelineCtx = testCtx();
  const timelineFam = testFamily();
  timelineFam.notes = JSON.stringify({ fee_revisions: [
    { effectiveYear: 2026, effectiveMonth: 'October', effectiveMonthIdx: 9, prevFee: 5000, newFee: 7500, revisedDate: '2026-10-01' }
  ] });
  timelineCtx.feeForMonth = (m, y) => F.getApplicableFeeForMonth(timelineFam, m, y, { records: testRecords() }).fee;
  const clsTimeline = F.classifyFeeArrears(timelineFam, 10, 2026, timelineCtx);
  check('classify: October shortfall uses the timeline fee (7500 - 3000 = 4500)', clsTimeline.arrearsMonths.some(a => a.month === 'October' && a.shortfall === 4500));
}

// ---- buildFeeDueInvoiceData -------------------------------------------------
{
  const data = F.buildFeeDueInvoiceData(testFamily(), 10, 2026, testCtx());
  check('due invoice is eligible', data.eligible === true);
  check('due invoice ref is DUE-YYYYMM-FAMILYID', data.invoiceRef === 'DUE-202611-FAM-021');
  check('due invoice total = arrears 7000 + current 5000', data.outstanding === 12000);
  check('due invoice totalPayable = monthly fee + arrears', data.totalPayable === 12000);
  check('due invoice arrears list names Sep + Oct', data.arrearsMonths.join(',') === 'September 2026,October 2026');
  check('due invoice due date is Nov 1', data.dueDate === '2026-11-01');
  check('due invoice timing is Advance', data.feeTiming === 'Advance' && /Advance/.test(data.timingMessage));
  check('due invoice amountPaid is the current month paid (0)', data.amountPaid === 0);
  check('due invoice discount sums the month records (0)', data.discount === 0);

  const inactive = testFamily();
  inactive.status = 'Inactive';
  const inact = F.buildFeeDueInvoiceData(inactive, 10, 2026, testCtx());
  check('inactive family is refused', inact.eligible === false && /not Active/.test(inact.reason));

  const leaveCtx = testCtx();
  leaveCtx.isLeave = (m) => (m === 'November' ? { isLeave: true, reason: 'Approved Leave' } : { isLeave: false, reason: '' });
  const onLeave = F.buildFeeDueInvoiceData(testFamily(), 10, 2026, leaveCtx);
  check('family on leave in the invoice month is refused', onLeave.eligible === false && /Leave/.test(onLeave.reason));

  const paidCtx = testCtx([
    { receiptNo: 'R-AUG', familyId: 'FAM-021', month: 'August', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-08-05' },
    { receiptNo: 'R-SEP', familyId: 'FAM-021', month: 'September', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-09-05' },
    { receiptNo: 'R-OCT', familyId: 'FAM-021', month: 'October', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-10-05' },
    { receiptNo: 'R-NOV', familyId: 'FAM-021', month: 'November', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-11-05' }
  ]);
  const paid = F.buildFeeDueInvoiceData(testFamily(), 10, 2026, paidCtx);
  check('fully paid family is refused', paid.eligible === false && /No outstanding/.test(paid.reason));

  const earlyCtx = testCtx();
  earlyCtx.today = '2026-10-15';
  const early = F.buildFeeDueInvoiceData(testFamily(), 10, 2026, earlyCtx);
  check('not-yet-due month WITH arrears is still eligible (arrears only)', early.eligible === true && early.outstanding === 7000);

  const noArrearsEarly = testCtx([
    { receiptNo: 'R-AUG', familyId: 'FAM-021', month: 'August', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-08-05' },
    { receiptNo: 'R-SEP', familyId: 'FAM-021', month: 'September', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-09-05' },
    { receiptNo: 'R-OCT', familyId: 'FAM-021', month: 'October', year: 2026, monthlyFee: 5000, amountPaid: 5000, discount: 0, status: 'Paid in Full', date: '2026-10-05' }
  ]);
  noArrearsEarly.today = '2026-10-15';
  const notYet = F.buildFeeDueInvoiceData(testFamily(), 10, 2026, noArrearsEarly);
  // Nothing is owed at all (no arrears, current month not due yet), so
  // the totalOwed<=0 refusal fires first — exactly like the fee portal,
  // whose own "Not Yet Due" branch is unreachable in this case too.
  check('not-yet-due month with NO arrears is refused (nothing owed yet)', notYet.eligible === false && /No outstanding payable fee/.test(notYet.reason), notYet.reason);
}

// ---- fee-tables.js: filter + idempotent insert ------------------------------
function loadFeeTables(dbRows) {
  const rows = dbRows.slice();
  const calls = [];
  const dbImpl = {
    from: (table) => {
      let eqCol = null; let eqVal = null; let limitN = null;
      const builder = {
        select: () => builder,
        eq: (c, v) => { eqCol = c; eqVal = v; return builder; },
        limit: (n) => { limitN = n; return builder; },
        insert: async (list) => {
          calls.push({ op: 'insert', table, list });
          list.forEach((r) => rows.push({ id: 'PAY-' + (rows.length + 1), ...r }));
          return { data: list.map((r) => ({ id: 'PAY-' + rows.length, ...r })), error: null };
        },
        update: async (patch) => {
          calls.push({ op: 'update', table, patch, eqCol, eqVal });
          return { data: [], error: null };
        },
        then: (res) => {
          let out = rows.filter((r) => eqCol === null || String(r[eqCol]) === String(eqVal));
          if (limitN !== null) out = out.slice(0, limitN);
          res({ data: out, error: null });
        }
      };
      return builder;
    }
  };
  const w = {
    db: dbImpl, lmsNotify: () => {}, sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null }, crypto: webcrypto
  };
  const sandbox = { window: w, console, crypto: webcrypto, CURRENT_ROLE: 'owner', setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(FEE_TABLES_SRC, sandbox);
  return { FT: w.FeeTables, rows, calls };
}

{
  const dueRow = {
    id: 'PAY-9', family_id: 'FAM-021', receipt_no: 'DUE-202611-FAM-021', record_kind: 'due_invoice',
    billing_period: '2026-11', month_label: 'November', payment_date: '2026-11-17',
    amount_paid: 0, discount: 0, total_payable: 12000, monthly_fee: 5000, previous_balance: 7000,
    remaining_balance: 12000, currency: 'PKR', status: 'Issued',
    legacy_json: JSON.stringify({
      invoiceRef: 'DUE-202611-FAM-021', familyId: 'FAM-021', parentName: 'Bilal Ahmed',
      month: 'November', year: 2026, currency: 'PKR', monthlyFee: 5000,
      previousArrears: 7000, arrearsCount: 2, arrearsMonths: ['September 2026', 'October 2026'],
      arrearsDetail: [{ month: 'September', year: 2026, shortfall: 5000, isPartial: false }],
      discount: 0, totalPayable: 12000, amountPaid: 0, outstanding: 12000,
      dueDate: '2026-11-01', feeTiming: 'Advance', timingMessage: 'Fee plan: Advance (start of month).',
      statusLabel: 'unpaid', issueDate: '2026-11-17'
    })
  };
  const payRow = {
    id: 'PAY-1', family_id: 'FAM-021', receipt_no: 'AH-REC-20261110-BBBBBB', record_kind: 'payment',
    billing_period: '2026-10', month_label: 'October', payment_date: '2026-11-10',
    amount_paid: 3000, discount: 0, total_payable: 5000, monthly_fee: 5000, previous_balance: 0,
    remaining_balance: 2000, currency: 'PKR', status: 'Partial',
    legacy_json: JSON.stringify({ receiptNo: 'AH-REC-20261110-BBBBBB', familyId: 'FAM-021', month: 'October', year: 2026, amountPaid: 3000, totalPayable: 5000, status: 'Partial (Balance Remaining)' })
  };
  const { FT } = loadFeeTables([dueRow, payRow]);
  const payments = await FT.loadPaymentsForFamily('FAM-021');
  check('loadPaymentsForFamily never returns a due-invoice row', Array.isArray(payments) && payments.length === 1 && payments[0].receiptNo === 'AH-REC-20261110-BBBBBB');
  const dues = await FT.loadDueInvoicesForFamily('FAM-021');
  check('loadDueInvoicesForFamily returns only due-invoice rows', Array.isArray(dues) && dues.length === 1 && dues[0].invoiceRef === 'DUE-202611-FAM-021');
  check('dueInvoiceFromRow restores the outstanding total', dues[0].outstanding === 12000);
  check('dueInvoiceFromRow restores the arrears detail', Array.isArray(dues[0].arrearsDetail) && dues[0].arrearsDetail.length === 1);
  const allDues = await FT.loadDueInvoicesForFamily('');
  check('loadDueInvoicesForFamily with no family returns all due invoices', allDues.length === 1);

  // Idempotent insert.
  const { FT: FT2, rows: rows2, calls } = loadFeeTables([payRow]);
  const data = F.buildFeeDueInvoiceData(testFamily(), 10, 2026, testCtx());
  const first = await FT2.insertDueInvoiceRow(data);
  check('first insert stores the due invoice (not existed)', first.existed === false && first.row.invoiceRef === 'DUE-202611-FAM-021');
  check('inserted row carries record_kind due_invoice', rows2.some((r) => r.receipt_no === 'DUE-202611-FAM-021' && r.record_kind === 'due_invoice'));
  const second = await FT2.insertDueInvoiceRow(data);
  check('second insert of the same ref returns the stored row unchanged (existed)', second.existed === true && second.row.invoiceRef === 'DUE-202611-FAM-021');
  check('second insert issues no second INSERT call', calls.filter((c) => c.op === 'insert').length === 1);

  const built = FT2.dueInvoiceRowFromData(data);
  check('dueInvoiceRowFromData sets receipt_no to the DUE ref', built.receipt_no === 'DUE-202611-FAM-021');
  check('dueInvoiceRowFromData remaining_balance is the outstanding total', built.remaining_balance === 12000);
  check('dueInvoiceRowFromData status is Issued', built.status === 'Issued');
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
