// Batch 6D-2 test — FeeTables.loadPaymentsForFamily behaviour (mock db) +
// structural guards for the two switches (parent.html fee history,
// profiles360 Family 360 ledger): script wiring, flag checks, legacy paths
// intact, cache invalidation at the in-session write sites.
// Run from the repo root: node test/batch6d2-switches.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FEE_TABLES = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
const PARENT_HTML = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
const PROFILES = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- loadPaymentsForFamily with a mock db --------------------------------------
const ROWS = [
  { id: 'PAY-1', family_id: 'FAM-1', receipt_no: 'R-1', status: 'Paid', amount_paid: 100, total_payable: 100, discount: 0, remaining_balance: 0, currency: 'CAD', payment_method: 'Bank Transfer', transaction_id: 'T', payment_date: '2026-10-04', month_label: 'October 2026', billing_period: '2026-10', record_kind: 'payment', legacy_json: JSON.stringify({ receiptNo: 'R-1', familyId: 'FAM-1', month: 'October', year: 2026, amountPaid: 100, totalPayable: 100, status: 'Paid in Full', whatsapp: '+10000000000' }) },
  { id: 'PAY-2', family_id: 'FAM-1', receipt_no: 'R-2', status: 'Partial', amount_paid: 40, total_payable: 100, discount: 0, remaining_balance: 60, currency: 'CAD', payment_method: 'Card', transaction_id: '', payment_date: '2026-09-02', month_label: 'September 2026', billing_period: '2026-09', record_kind: 'payment', legacy_json: null },
  { id: 'PAY-3', family_id: 'FAM-2', receipt_no: 'R-3', status: 'Paid', amount_paid: 10, total_payable: 10, discount: 0, remaining_balance: 0, currency: 'PKR', payment_method: 'Cash', transaction_id: '', payment_date: '2026-09-01', month_label: 'September 2026', billing_period: '2026-09', record_kind: 'payment', legacy_json: JSON.stringify({ receiptNo: 'R-3', familyId: 'FAM-2', amountPaid: 10, status: 'Paid in Full' }) },
];
function paymentsBuilder(mode) {
  const b = {
    _eq: null,
    select() { return b; },
    eq(c, v) { b._eq = [c, v]; return b; },
    then(res) {
      if (mode === 'error') { res({ data: null, error: { message: 'boom' } }); return; }
      const rows = b._eq ? ROWS.filter((r) => r[b._eq[0]] === b._eq[1]) : ROWS;
      res({ data: rows, error: null });
    },
  };
  return b;
}
function loadWithDb(dbImpl) {
  const windowObj = {
    db: dbImpl,
    lmsNotify: () => {},
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    crypto: webcrypto,
  };
  const sandbox = { window: windowObj, console, crypto: webcrypto, CURRENT_ROLE: 'owner', setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(FEE_TABLES, sandbox);
  return windowObj.FeeTables;
}
{
  const FT = loadWithDb({ from: () => paymentsBuilder('ok') });
  check('helper exported', typeof FT.loadPaymentsForFamily === 'function');
  const fam1 = await FT.loadPaymentsForFamily('FAM-1');
  check('filtered load: only the family rows, converted', Array.isArray(fam1) && fam1.length === 2 && fam1[0].receiptNo === 'R-1' && fam1[0].whatsapp === '+10000000000' && fam1[1].status === 'Partial (Balance Remaining)', JSON.stringify(fam1).slice(0, 200));
  const all = await FT.loadPaymentsForFamily('');
  check('unfiltered load: all rows', Array.isArray(all) && all.length === 3);
  const none = await FT.loadPaymentsForFamily('FAM-404');
  check('unknown family: empty array (not null)', Array.isArray(none) && none.length === 0);
}
{
  const FT = loadWithDb({ from: () => paymentsBuilder('error') });
  check('db error -> null (callers fall back)', (await FT.loadPaymentsForFamily('FAM-1')) === null);
  const FT2 = loadWithDb(null);
  check('no db client -> null', (await FT2.loadPaymentsForFamily('FAM-1')) === null);
}

// ---- Structural guards: parent.html ---------------------------------------------
check('parent.html loads js/fee-tables.js after cloudflare-db', PARENT_HTML.indexOf('js/cloudflare-db.js') > -1 && PARENT_HTML.indexOf('js/fee-tables.js') > PARENT_HTML.indexOf('js/cloudflare-db.js'));
check('parent.html checks the parent read flag', PARENT_HTML.includes('READ_FLAG_PARENT') && PARENT_HTML.includes('getReadMode'));
check('parent.html uses the shared loader', PARENT_HTML.includes('loadPaymentsForFamily'));
check('parent.html table mode gates the legacy chain', (PARENT_HTML.match(/!feeHistoryFromTables/g) || []).length >= 3, String((PARENT_HTML.match(/!feeHistoryFromTables/g) || []).length));
check('parent.html legacy chain intact (fee_collections step still present)', PARENT_HTML.includes('fee_collections'));

// ---- Structural guards: profiles360.js -------------------------------------------
check('profiles360 has the table cache + prefetch', PROFILES.includes('_fee360TableCache') && PROFILES.includes('_prefetch360Payments'));
check('profiles360 checks the 360 read flag', PROFILES.includes('READ_FLAG_360'));
check('profiles360 prefetch hooked into openFamily360Profile', PROFILES.includes('openFamily360Profile') && PROFILES.indexOf('_prefetch360Payments(family.id)') > -1);
check('profiles360 legacy merge intact (receiptNo keying still present)', PROFILES.includes('mergedMap.set(r.receiptNo, r)'));
check('profiles360 write sites invalidate the cache (4)', (PROFILES.match(/delete _fee360TableCache\[/g) || []).length === 4, String((PROFILES.match(/delete _fee360TableCache\[/g) || []).length));
check('profiles360 AUTO rows generation intact', PROFILES.includes('AUTO-${famId}-${mName}-2026') || PROFILES.includes('AUTO-'));

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`batch6d2-switches: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
