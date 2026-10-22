// Batch 6B frontend test — js/fee-tables.js: period/status normalisation,
// row builders (field-by-field, no contact columns, legacy_json verbatim),
// and the dual-write entry points against a mock db client.
// Scenarios: flag ON (writes happen, updates don't duplicate, cancels land),
// flag OFF (zero finance-table calls), and table-write failure (truthful
// warning, no throw). Run from the repo root: node test/batch6b-fee-tables.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CODE = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Mock db client mimicking the shim's awaitable builder -----------------
function makeMockDb({ flagValue = 'on', failInsertInto = null } = {}) {
  const tables = {
    system_settings: [{ key: 'fee_tables_v1', value: flagValue }],
    payments: [], salary_slips: [], salary_adjustments: [],
  };
  const calls = [];
  let seq = 0;
  const prefixes = { payments: 'PAY-', salary_slips: 'SAL-', salary_adjustments: 'ADJ-', system_settings: 'SYS-' };
  function from(table) {
    const state = { op: 'select', filters: [], payload: null, limitN: null };
    const b = {
      select() { state.op = 'select'; return b; },
      insert(rowsArr) { state.op = 'insert'; state.payload = rowsArr; return b; },
      update(patch) { state.op = 'update'; state.payload = patch; return b; },
      eq(col, val) { state.filters.push([col, val]); return b; },
      limit(n) { state.limitN = n; return b; },
      then(resolve, reject) {
        try { resolve(execute()); } catch (e) { reject(e); }
      },
    };
    function execute() {
      calls.push(table + ':' + state.op);
      const store = tables[table];
      const match = (row) => state.filters.every(([c, v]) => String(row[c]) === String(v));
      if (state.op === 'select') {
        let out = store.filter(match);
        if (state.limitN) out = out.slice(0, state.limitN);
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      if (state.op === 'insert') {
        if (failInsertInto === table) return { data: null, error: { message: 'mock insert failure' } };
        const inserted = state.payload.map((p) => {
          const row = { ...p };
          if (!row.id) row.id = prefixes[table] + (++seq);
          store.push(row);
          return { ...row };
        });
        return { data: inserted, error: null };
      }
      if (state.op === 'update') {
        const targets = store.filter(match);
        for (const t of targets) Object.assign(t, state.payload);
        return { data: targets.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: { message: 'unknown op' } };
    }
    return b;
  }
  return { from, _tables: tables, _calls: calls };
}

function loadFeeTables(mockDb, notifications) {
  const windowObj = {
    db: mockDb,
    lmsNotify: (text, opts) => { notifications.push(String(text)); },
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    getAuthenticatedOwnerSession: () => ({ id: 'OWN-001', username: 'owner' }),
    crypto: webcrypto,
  };
  const sandbox = {
    window: windowObj,
    console,
    crypto: webcrypto,
    CURRENT_ROLE: 'owner',
    setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(CODE, sandbox);
  return windowObj.FeeTables;
}

// ---- Fixtures (synthetic) ----------------------------------------------------
const feeRec = {
  receiptNo: 'AH-REC-20261022-ABC123', date: '2026-10-22', familyId: 'FAM-1',
  parentName: 'Synthetic Parent', studentsNames: 'Kid One', country: 'United Kingdom',
  whatsapp: 'SYNTHETIC-CONTACT', email: 'synthetic@example.invalid',
  month: 'October', year: 2026, monthlyFee: 100, previousBalance: 0, creditDeducted: 0,
  totalPayable: 100, amountPaid: 100, discount: 0, remainingBalance: 0, excessPaid: 0,
  currency: 'GBP', paymentMethod: 'Bank Transfer', transactionId: 'N/A', notes: '',
  status: 'Paid in Full', isProrated: false, activeDays: 0, joiningDate: '', isAdvancePayment: false, advanceMonthsCount: 0,
};
const advanceRec2 = { ...feeRec, receiptNo: 'AH-REC-20261022-ABC123-2', month: 'November', monthlyFee: 100, totalPayable: 100, amountPaid: 100, status: 'Paid in Advance', isAdvancePayment: true, advanceMonthsCount: 3 };
const manualRec = { receiptNo: 'AH-MAN-123456', date: '2026-10-05', familyId: 'FAM-1', month: 'October', year: 2026, amount: 250, status: 'PAID', isManualInvoice: true, description: 'Synthetic invoice', created_at: '2026-10-05T10:00:00.000Z' };
const slip = { teacher_id: 'TCH-1', month: 'October 2026', base_subtotal: 8900, bonus: 0, deduction: 200, net_payable: 8700, status: 'Pending', remarks: '', student_items_snapshot: [{ student_id: 'STU-1', final_rate: 8900 }] };
const dedRec = { id: 'DED-TST-9', type: 'deduction', category: 'Absence', amount: 200, date: '2026-10-15', month: 'October 2026', reason: 'Synthetic', status: 'Applied' };

// ---- 1. Normalisation ---------------------------------------------------------
{
  const FT = loadFeeTables(makeMockDb(), []);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  check('period: all 12 full month names', months.every((m, i) => FT.periodFromMonthYear(m, 2026) === `2026-${String(i + 1).padStart(2, '0')}`));
  check('period: abbreviations', FT.periodFromMonthYear('Sept', 2026) === '2026-09' && FT.periodFromMonthYear('Sep', '2026') === '2026-09' && FT.periodFromMonthYear('Oct', 2026) === '2026-10');
  check('period: numeric month', FT.periodFromMonthYear(10, 2026) === '2026-10' && FT.periodFromMonthYear('3', 2026) === '2026-03');
  check('period: labels', FT.periodFromLabel('September 2026') === '2026-09' && FT.periodFromLabel('2026-09') === '2026-09' && FT.periodFromLabel('2026/09') === '2026-09' && FT.periodFromLabel('Sept 2026') === '2026-09');
  check('period: junk -> null', FT.periodFromMonthYear('Foo', 2026) === null && FT.periodFromLabel('not a month') === null && FT.periodFromMonthYear(null, 2026) === null);
  check('status: Paid in Full -> Paid', FT.normaliseFeeStatus(feeRec) === 'Paid');
  check('status: remaining > 0 -> Partial', FT.normaliseFeeStatus({ ...feeRec, remainingBalance: 40, status: 'Partial (Balance Remaining)' }) === 'Partial');
  check('status: UNPAID manual -> Partial', FT.normaliseFeeStatus({ ...manualRec, status: 'UNPAID' }) === 'Partial');
  check('status: PAID manual -> Paid', FT.normaliseFeeStatus(manualRec) === 'Paid');
  check('status: advance split -> Advance', FT.normaliseFeeStatus(advanceRec2) === 'Advance');
  check('status: cancel fields win -> Cancelled', FT.normaliseFeeStatus({ ...feeRec, cancel_reason: 'x', cancelled_at: '2026-10-22T00:00:00Z' }) === 'Cancelled');
  const row = FT.paymentRowFromLegacy(feeRec, 'fee_form');
  check('builder: core columns', row.family_id === 'FAM-1' && row.receipt_no === feeRec.receiptNo && row.billing_period === '2026-10' && row.month_label === 'October' && Number(row.amount_paid) === 100 && row.status === 'Paid' && row.status_label === 'Paid in Full' && row.legacy_source === 'fee_form');
  check('builder: NO contact columns', !('whatsapp' in row) && !('email' in row) && !('parentName' in row) && !('parent_name' in row) && !('country' in row));
  check('builder: legacy_json is the original record verbatim', JSON.stringify(JSON.parse(row.legacy_json)) === JSON.stringify(feeRec));
  const advRow = FT.paymentRowFromLegacy(advanceRec2, 'fee_form');
  check('builder: advance split row', advRow.billing_period === '2026-11' && advRow.is_advance === 1 && advRow.status === 'Advance' && Number(advRow.advance_months_count) === 3);
  const manRow = FT.paymentRowFromLegacy(manualRec, 'manual_invoice');
  check('builder: manual invoice (amount alias)', Number(manRow.amount_paid) === 250 && manRow.record_kind === 'manual_invoice' && manRow.status === 'Paid');
  const sRow = FT.slipRowFromLegacy('TCH-1', slip);
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  check('builder: slip number format AH-SAL-<YYYYMM>-<6 alphabet chars>', sRow.slip_no.startsWith('AH-SAL-202610-') && sRow.slip_no.length === 20 && [...sRow.slip_no.slice(14)].every((c) => ALPHABET.includes(c)), sRow.slip_no);
  check('builder: slip columns', sRow.teacher_id === 'TCH-1' && sRow.period === '2026-10' && Number(sRow.net_payable) === 8700 && Number(sRow.deduction_total) === 200 && sRow.status === 'Pending' && typeof sRow.student_items_snapshot === 'string');
  check('builder: existing slip number preserved', FT.slipRowFromLegacy('TCH-1', { ...slip, slip_no: 'AH-SAL-202610-KEEPME' }).slip_no === 'AH-SAL-202610-KEEPME');
  const aRow = FT.adjustmentRowFromLegacy('TCH-1', dedRec);
  check('builder: adjustment row', aRow.kind === 'deduction' && Number(aRow.amount) === 200 && aRow.period === '2026-10' && JSON.parse(aRow.legacy_json).id === 'DED-TST-9');
}

// ---- 2. Dual-write, flag ON ----------------------------------------------------
{
  const notes = [];
  const mock = makeMockDb({ flagValue: 'on' });
  const FT = loadFeeTables(mock, notes);
  const T = mock._tables;

  let res = await FT.dualWritePayment(feeRec, 'fee_form');
  check('ON: fee save writes one payments row', res && res.ok !== false && T.payments.length === 1, JSON.stringify(res));
  check('ON: row columns equal the legacy record', T.payments[0].receipt_no === feeRec.receiptNo && Number(T.payments[0].amount_paid) === 100 && T.payments[0].legacy_json === JSON.stringify(feeRec));
  res = await FT.dualWritePayment({ ...feeRec, amountPaid: 60, remainingBalance: 40, status: 'Partial (Balance Remaining)' }, 'fee_form');
  check('ON: re-save updates the same row (no duplicate)', T.payments.length === 1 && Number(T.payments[0].amount_paid) === 60 && T.payments[0].status === 'Partial');
  res = await FT.dualWritePaymentCancelled(feeRec, 'manager', 'wrong amount entered');
  check('ON: cancel lands with reason/by', T.payments[0].status === 'Cancelled' && T.payments[0].cancelled_by === 'manager' && T.payments[0].cancel_reason === 'wrong amount entered' && !!T.payments[0].cancelled_at, JSON.stringify(T.payments[0]).slice(0, 200));

  res = await FT.dualWriteSlip('TCH-1', slip);
  check('ON: slip save writes one salary_slips row', T.salary_slips.length === 1, JSON.stringify(res).slice(0, 160));
  const slipNo1 = T.salary_slips[0].slip_no;
  check('ON: slip row carries minted slip_no', typeof slipNo1 === 'string' && slipNo1.startsWith('AH-SAL-202610-'), slipNo1);
  res = await FT.dualWriteSlip('TCH-1', { ...slip, status: 'Paid', paid_at: '2026-10-31T09:00:00.000Z', slip_no: slipNo1 });
  check('ON: Paid toggle updates the same row, number stable, paid_at set', T.salary_slips.length === 1 && T.salary_slips[0].status === 'Paid' && T.salary_slips[0].paid_at === '2026-10-31T09:00:00.000Z' && T.salary_slips[0].slip_no === slipNo1);
  res = await FT.dualWriteAdjustment('TCH-1', dedRec);
  check('ON: deduction add writes one adjustments row', T.salary_adjustments.length === 1 && Number(T.salary_adjustments[0].amount) === 200 && T.salary_adjustments[0].status === 'Applied', JSON.stringify(res).slice(0, 160));
  res = await FT.dualWriteAdjustmentCancelled('TCH-1', dedRec);
  check('ON: deduction delete cancels (not deletes) the row', T.salary_adjustments.length === 1 && T.salary_adjustments[0].status === 'Cancelled');
  res = await FT.dualWriteSlipCancelled('TCH-1', 'October 2026');
  check('ON: month delete cancels the slip with owner reason', T.salary_slips[0].status === 'Cancelled' && T.salary_slips[0].cancel_reason === 'deleted by owner', JSON.stringify(T.salary_slips[0]).slice(0, 200));
}

// ---- 3. Flag OFF ----------------------------------------------------------------
{
  const notes = [];
  const mock = makeMockDb({ flagValue: 'off' });
  const FT = loadFeeTables(mock, notes);
  const res1 = await FT.dualWritePayment(feeRec, 'fee_form');
  const res2 = await FT.dualWriteSlip('TCH-1', slip);
  const res3 = await FT.dualWriteAdjustment('TCH-1', dedRec);
  const financeCalls = mock._calls.filter((c) => !c.startsWith('system_settings'));
  check('OFF: all dual-writes report skipped', res1.skipped === true && res2.skipped === true && res3.skipped === true, JSON.stringify([res1, res2, res3]).slice(0, 160));
  check('OFF: ZERO finance-table calls', financeCalls.length === 0, JSON.stringify(mock._calls));
  check('OFF: no tables written, no warnings', mock._tables.payments.length === 0 && mock._tables.salary_slips.length === 0 && notes.length === 0);
}

// ---- 4. Failure path --------------------------------------------------------------
{
  const notes = [];
  const mock = makeMockDb({ flagValue: 'on', failInsertInto: 'payments' });
  const FT = loadFeeTables(mock, notes);
  let threw = false;
  let res = null;
  try { res = await FT.dualWritePayment(feeRec, 'fee_form'); } catch (e) { threw = true; }
  check('FAIL: dual-write never throws to the caller', !threw);
  check('FAIL: result reports the failure truthfully', res && res.ok === false, JSON.stringify(res).slice(0, 160));
  check('FAIL: a truthful warning was shown', notes.length >= 1 && /could not be written/i.test(notes[0]), JSON.stringify(notes).slice(0, 200));
}

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch6b-fee-tables: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
