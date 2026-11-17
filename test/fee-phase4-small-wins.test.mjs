// Fee Upgrade Phase 4 — small wins (#6, #11, #19, #42/#50, #31, #66, #70).
// Executes the REAL functions from js/fee-phase4.js in a vm sandbox.
// Run from the repo root: node test/fee-phase4-small-wins.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE4_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase4.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const windowObj = {};
const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(PHASE4_SRC, sandbox);
const F = windowObj.FeePhase4;

const FAM_PKR = { id: 'FAM-021', parent_name: 'Hajra Waqas', monthly_fee: 7500, currency: 'PKR', country: 'Pakistan', whatsapp: '923001234567', email: 'hajra@example.com', billing_day: 5, status: 'Active', students: [{ id: 'STU-027', name: 'Ayesha', status: 'Active' }] };
const FAM_GBP = { id: 'FAM-004', parent_name: 'Bilal Ahmed', monthly_fee: 100, currency: 'GBP', country: 'United Kingdom', whatsapp: '447700900123', email: 'bilal@example.com', billing_day: 1, status: 'Active', students: [{ id: 'STU-007', name: 'Mohib', status: 'Active' }, { id: 'STU-008', name: 'Sara', status: 'Active' }] };
const FAM_USD = { id: 'FAM-007', parent_name: 'Omar Farooq', monthly_fee: 200, currency: 'USD', country: 'United States', whatsapp: '15550123456', email: 'omar@example.com', billing_day: 10, status: 'Active', students: [{ id: 'STU-011', name: 'Zain', status: 'Active' }] };
const FAMILIES = [FAM_PKR, FAM_GBP, FAM_USD];

const REAL_NOV = { receiptNo: 'AH-REC-20261117-ABC123', familyId: 'FAM-021', month: 'November', year: 2026, amountPaid: 7500, totalPayable: 7500, remainingBalance: 0, status: 'Paid in Full', currency: 'PKR', date: '2026-11-05', parentName: 'Hajra Waqas', studentsNames: 'Ayesha', recordKind: 'payment' };
const PARTIAL_OCT = { receiptNo: 'AH-REC-20261003-DEF456', familyId: 'FAM-004', month: 'October', year: 2026, amountPaid: 50, totalPayable: 100, remainingBalance: 50, status: 'Partial (Balance Remaining)', currency: 'GBP', date: '2026-10-03', parentName: 'Bilal Ahmed', studentsNames: 'Mohib, Sara', recordKind: 'payment' };
const ADJ_NOV = { receiptNo: 'ADJ-202611-FAM-004', familyId: 'FAM-004', month: 'November', year: 2026, amountPaid: 0, totalPayable: 0, remainingBalance: 0, status: 'Paid (Status)', currency: 'GBP', date: '2026-11-17', parentName: 'Bilal Ahmed', studentsNames: 'Mohib, Sara', recordKind: 'month_status' };
const CANCELLED = { ...REAL_NOV, receiptNo: 'AH-REC-20261110-XXXXXX', status: 'Cancelled' };
const DUE_ROW = { receiptNo: 'DUE-202611-FAM-021', familyId: 'FAM-021', month: 'November', year: 2026, amountPaid: 0, totalPayable: 7500, remainingBalance: 7500, status: 'Due Invoice', currency: 'PKR', date: '2026-11-01', parentName: 'Hajra Waqas', studentsNames: 'Ayesha', recordKind: 'due_invoice' };
const RECORDS = [REAL_NOV, PARTIAL_OCT, ADJ_NOV, CANCELLED, DUE_ROW];

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map
  };
}

// ---- exports -----------------------------------------------------------------
{
  const EXPECTED = ['MONTHS', 'BUILT_IN_CURRENCIES', 'FEE_METHODS', 'CUSTOM_CURRENCIES_KEY', 'REMEMBERED_METHODS_KEY', 'esc', 'monthIdxOf', 'daysInMonth', 'universalSearch', 'universalSearchFamilyRowHtml', 'universalSearchReceiptRowHtml', 'paidForMonth', 'isStatusPaidFromRecords', 'buildCurrencyDetailRows', 'buildCurrencyPrevMonths', 'currencyCodeOf', 'getCustomCurrencies', 'addCustomCurrency', 'saveCustomCurrencies', 'allFeeCurrencies', 'currencySelectOptionsHtml', 'loadRememberedMethods', 'saveRememberedMethod', 'rememberedMethodFor', 'waLink', 'buildReceiptWhatsAppMessage', 'buildPendingWhatsAppMessage', 'buildDefaulterWhatsAppMessage', 'leaveWindowForMonth', 'planFeeFormLeave', 'runFeeFormLeave', 'notesTextOf', 'buildFamiliesCsv', 'familiesCsvFilename', 'parseDueDayInput', 'parseFeeTimingInput'];
  check('FeePhase4 exports every function the glue calls', F && EXPECTED.every((n) => typeof F[n] === 'function' || Array.isArray(F[n]) || typeof F[n] === 'string'), EXPECTED.filter((n) => !(typeof F[n] === 'function' || Array.isArray(F[n]) || typeof F[n] === 'string')).join(','));
  check('FeePhase4 keys are the fee-portal patterns', F.CUSTOM_CURRENCIES_KEY === 'alhuda_custom_currencies' && F.REMEMBERED_METHODS_KEY === 'alhuda_family_payment_methods');
}

// ---- #6 universal search ------------------------------------------------------
check('search finds a family by parent name', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'hajra' }).families.length === 1 && F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'hajra' }).families[0].id === 'FAM-021');
check('search finds a family by Family ID', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'fam-004' }).families[0].id === 'FAM-004');
check('search finds a family by student name', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'mohib' }).families[0].id === 'FAM-004');
check('search finds a receipt by receipt number', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'AH-REC-20261117' }).receipts[0].receiptNo === 'AH-REC-20261117-ABC123');
check('search finds a receipt by amount', F.universalSearch({ families: FAMILIES, records: RECORDS, query: '7500' }).receipts.some((r) => r.receiptNo === 'AH-REC-20261117-ABC123'));
check('search is case-insensitive', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'HAJRA' }).families.length === 1);
check('search returns nothing for a miss', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'zzz-no-such' }).families.length === 0 && F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'zzz-no-such' }).receipts.length === 0);
check('search returns empty for a blank query', F.universalSearch({ families: FAMILIES, records: RECORDS, query: '   ' }).families.length === 0);
check('search never returns cancelled / due-invoice / ADJ rows as receipts', F.universalSearch({ families: FAMILIES, records: RECORDS, query: '202611' }).receipts.every((r) => r.receiptNo === 'AH-REC-20261117-ABC123'));
check('search respects the limit', F.universalSearch({ families: FAMILIES, records: RECORDS, query: 'a', limit: 1 }).families.length === 1);
check('search family row html jumps to the family', F.universalSearchFamilyRowHtml(FAM_PKR).includes("selectFeeFamilyFromSearch('FAM-021')") && F.universalSearchFamilyRowHtml(FAM_PKR).includes('Hajra Waqas'));
check('search receipt row html jumps to the receipt', F.universalSearchReceiptRowHtml(REAL_NOV).includes("openFeeReceiptFromSearch('AH-REC-20261117-ABC123')"));

// ---- #11 currency drill-down --------------------------------------------------
const feeForMonth = (fam, m, y) => Number(fam.monthly_fee || 0);
check('paidForMonth sums only real payments (ADJ / cancelled / DUE excluded)', F.paidForMonth(RECORDS, 'FAM-021', 10, 2026) === 7500 && F.paidForMonth(RECORDS, 'FAM-004', 10, 2026) === 0 && F.paidForMonth(RECORDS, 'FAM-004', 9, 2026) === 50);
check('isStatusPaidFromRecords true for an ADJ-only month', F.isStatusPaidFromRecords(RECORDS, 'FAM-004', 10, 2026) === true);
check('isStatusPaidFromRecords false when a real payment exists', F.isStatusPaidFromRecords(RECORDS, 'FAM-021', 10, 2026) === false);
{
  const rows = F.buildCurrencyDetailRows({ families: FAMILIES, records: RECORDS, currency: 'PKR', monthIdx: 10, year: 2026, feeForMonth });
  check('drill-down PKR November has only the PKR family, Paid in full', rows.length === 1 && rows[0].familyId === 'FAM-021' && rows[0].status === 'Paid' && rows[0].fee === 7500 && rows[0].paid === 7500 && rows[0].remaining === 0, JSON.stringify(rows));
  const gbpOct = F.buildCurrencyDetailRows({ families: FAMILIES, records: RECORDS, currency: 'GBP', monthIdx: 9, year: 2026, feeForMonth });
  check('drill-down GBP October is Partial (50 of 100)', gbpOct.length === 1 && gbpOct[0].status === 'Partial' && gbpOct[0].remaining === 50, JSON.stringify(gbpOct));
  const gbpNov = F.buildCurrencyDetailRows({ families: FAMILIES, records: RECORDS, currency: 'GBP', monthIdx: 10, year: 2026, feeForMonth });
  check('drill-down GBP November is Paid (Status) via the ADJ row', gbpNov.length === 1 && gbpNov[0].status === 'Paid (Status)' && gbpNov[0].fee === 100, JSON.stringify(gbpNov));
  const usdNov = F.buildCurrencyDetailRows({ families: FAMILIES, records: RECORDS, currency: 'USD', monthIdx: 10, year: 2026, feeForMonth });
  check('drill-down USD November is Due (nothing paid)', usdNov.length === 1 && usdNov[0].status === 'Due' && usdNov[0].remaining === 200, JSON.stringify(usdNov));
  const leaveRows = F.buildCurrencyDetailRows({ families: FAMILIES, records: RECORDS, currency: 'USD', monthIdx: 10, year: 2026, feeForMonth, isLeave: () => true });
  check('drill-down On Leave family shows fee 0 and On Leave status', leaveRows[0].status === 'On Leave' && leaveRows[0].fee === 0 && leaveRows[0].remaining === 0, JSON.stringify(leaveRows));
  const skipRows = F.buildCurrencyDetailRows({ families: FAMILIES, records: RECORDS, currency: 'USD', monthIdx: 10, year: 2026, feeForMonth, isPreAdmission: () => true });
  check('drill-down skips pre-admission families', skipRows.length === 0);
  const prev = F.buildCurrencyPrevMonths({ families: FAMILIES, records: RECORDS, currency: 'PKR', monthIdx: 10, year: 2026, feeForMonth });
  check('previous-months view covers 3 months, October first', prev.length === 3 && prev[0].month === 'October' && prev[0].year === 2026 && prev[0].expected === 7500 && prev[0].received === 0 && prev[0].pending === 7500, JSON.stringify(prev));
  const prevJan = F.buildCurrencyPrevMonths({ families: FAMILIES, records: RECORDS, currency: 'PKR', monthIdx: 0, year: 2026, feeForMonth });
  check('previous-months view rolls back across the year boundary', prevJan[0].month === 'December' && prevJan[0].year === 2025, JSON.stringify(prevJan));
}

// ---- #70 custom currencies ----------------------------------------------------
check('currencyCodeOf strips the label', F.currencyCodeOf('USD ($)') === 'USD' && F.currencyCodeOf('CHF') === 'CHF' && F.currencyCodeOf('  gbp (GBP) ') === 'GBP');
check('getCustomCurrencies reads the stored list, empty when missing', F.getCustomCurrencies(fakeStorage({})).length === 0 && F.getCustomCurrencies(fakeStorage({ alhuda_custom_currencies: JSON.stringify(['CHF (CHF)']) })).length === 1);
check('getCustomCurrencies survives corrupt storage', F.getCustomCurrencies(fakeStorage({ alhuda_custom_currencies: 'not-json{' })).length === 0);
{
  const added = F.addCustomCurrency(['CHF (CHF)'], 'kwd');
  check('addCustomCurrency uppercases and adds a new code', added.added === true && added.code === 'KWD' && added.list.includes('KWD (KWD)'));
  const dup = F.addCustomCurrency(['CHF (CHF)'], 'CHF');
  check('addCustomCurrency does not duplicate an existing code', dup.added === false && dup.list.length === 1);
  const bad = F.addCustomCurrency([], 'X');
  check('addCustomCurrency rejects a 1-letter code', bad.added === false && bad.error !== '');
  const bad2 = F.addCustomCurrency([], 'US DOLLAR');
  check('addCustomCurrency rejects a non-code string', bad2.added === false && bad2.error !== '');
}
{
  const st = fakeStorage({});
  check('saveCustomCurrencies round-trips through storage', F.saveCustomCurrencies(st, ['CHF (CHF)']) === true && F.getCustomCurrencies(st)[0] === 'CHF (CHF)');
  check('saveCustomCurrencies is safe without storage', F.saveCustomCurrencies(null, ['CHF (CHF)']) === false);
}
check('allFeeCurrencies merges built-ins + customs without duplicates', JSON.stringify(F.allFeeCurrencies(['USD', 'GBP'], ['GBP (GBP)', 'CHF (CHF)'])) === JSON.stringify(['USD', 'GBP', 'CHF']));
check('currency select options mark the selected code and offer add-new', F.currencySelectOptionsHtml(['USD', 'GBP', 'CHF'], 'GBP').includes('<option value="GBP" selected>GBP</option>') && F.currencySelectOptionsHtml(['USD'], 'USD').includes('__NEW_CURR__'));

// ---- #19 remembered payment method --------------------------------------------
{
  const st = fakeStorage({});
  check('remembered method is null before anything is saved', F.rememberedMethodFor(F.loadRememberedMethods(st), 'FAM-021') === null);
  F.saveRememberedMethod(st, 'FAM-021', 'Zelle');
  check('saved method is remembered for that family', F.rememberedMethodFor(F.loadRememberedMethods(st), 'FAM-021') === 'Zelle');
  check('remembered method is family-scoped', F.rememberedMethodFor(F.loadRememberedMethods(st), 'FAM-004') === null);
  check('remembered method lookup is case-insensitive on the family id', F.rememberedMethodFor(F.loadRememberedMethods(st), 'fam-021') === 'Zelle');
  F.saveRememberedMethod(st, 'FAM-021', 'Wise');
  check('a later payment overwrites the remembered method', F.rememberedMethodFor(F.loadRememberedMethods(st), 'FAM-021') === 'Wise');
  F.saveRememberedMethod(st, 'FAM-004', 'Not A Method');
  check('an unknown method string is never saved', F.rememberedMethodFor(F.loadRememberedMethods(st), 'FAM-004') === null);
  check('remembered methods survive corrupt storage', F.rememberedMethodFor(F.loadRememberedMethods(fakeStorage({ alhuda_family_payment_methods: 'junk{' })), 'FAM-021') === null);
}

// ---- #42 / #50 WhatsApp builders ----------------------------------------------
{
  const msg = F.buildReceiptWhatsAppMessage(REAL_NOV, { academyName: 'Al-Huda Islamic Centre', creditAmt: 0, excessAmt: 0, remaining: 0 });
  check('receipt WhatsApp has receipt no, amount, month, status', msg.includes('Receipt No: *AH-REC-20261117-ABC123*') && msg.includes('Billing Period: *November 2026*') && msg.includes('Amount Paid: *PKR 7500.00*') && msg.includes('Status: *Paid in Full*'));
  check('receipt WhatsApp carries NO pdf link (LMS PDFs are client-side, unstored)', !/https?:\/\/|drive\.google|pdf/i.test(msg));
  const msgCredit = F.buildReceiptWhatsAppMessage({ ...REAL_NOV, totalPayable: 8000, amountPaid: 7500 }, { academyName: 'Al-Huda Islamic Centre', creditAmt: 500, excessAmt: 250, remaining: 0 });
  check('receipt WhatsApp shows credit deducted + advance credit lines', msgCredit.includes('Advance Credit Deducted: *- PKR 500.00*') && msgCredit.includes('Next Month Advance Credit: *+ PKR 250.00*'));
  const pend = F.buildPendingWhatsAppMessage({ parentName: 'Bilal Ahmed', studentsNames: 'Mohib, Sara', currency: 'GBP', dueAmount: 100 }, 'October 2026', 'Al-Huda Islamic Centre');
  check('pending WhatsApp has family name, due amount and month', pend.includes('Respected Bilal Ahmed') && pend.includes('October 2026') && pend.includes('GBP 100.00') && pend.includes('Mohib, Sara'));
  const def = F.buildDefaulterWhatsAppMessage({ parentName: 'Omar Farooq', studentsNames: 'Zain', unpaidMonthsCount: 3, unpaidMonthsText: 'Sep, Oct, Nov 2026', currency: 'USD', totalArrearsDue: 600 }, 'Al-Huda Islamic Centre');
  check('defaulter WhatsApp is the urgent notice with months + arrears', def.includes('URGENT FEE NOTICE — AL-HUDA ISLAMIC CENTRE') && def.includes('3 months') && def.includes('USD 600.00'));
  check('waLink strips non-digits and encodes the message', F.waLink('+92 300 1234567', 'Hello World') === 'https://wa.me/923001234567?text=Hello%20World');
}

// ---- #31 leave from the fee form ----------------------------------------------
check('leave window is the 1st to the last day of the month', JSON.stringify(F.leaveWindowForMonth(10, 2026)) === JSON.stringify({ startDate: '2026-11-01', returnDate: '2026-11-30' }));
check('leave window clamps February correctly (2026 is not a leap year)', F.leaveWindowForMonth(1, 2026).returnDate === '2026-02-28');
check('leave window clamps February in a leap year', F.leaveWindowForMonth(1, 2024).returnDate === '2024-02-29');
{
  const stateOf = (s) => (s.id === 'STU-007' ? 'deactivated' : (s.id === 'STU-008' ? 'on-leave' : 'ok'));
  const plan = F.planFeeFormLeave(FAM_GBP.students, 10, 2026, 'Travelling', stateOf);
  check('leave plan splits todo / skipped by student state', plan.todo.length === 0 && plan.skipped.length === 2 && plan.window.startDate === '2026-11-01' && plan.reason === 'Travelling', JSON.stringify(plan));
  const plan2 = F.planFeeFormLeave(FAM_PKR.students, 10, 2026, '', stateOf);
  check('leave plan defaults an empty reason to Leave', plan2.todo.length === 1 && plan2.reason === 'Leave');
}
{
  const calls = [];
  const stubLeave = async (id, input) => { calls.push({ id, input }); return { ok: true }; };
  const plan = F.planFeeFormLeave(FAM_GBP.students, 10, 2026, 'Travelling', () => 'ok');
  const res = await F.runFeeFormLeave(plan, { applyLeave: stubLeave });
  check('leave run calls the shared leave core once per student with the month window', calls.length === 2 && calls[0].input.startDate === '2026-11-01' && calls[0].input.returnDate === '2026-11-30' && calls[0].input.reason === 'Travelling' && res.ok === true && res.applied.length === 2, JSON.stringify(calls));
  const failing = async (id) => (id === 'STU-007' ? { ok: false, error: 'Could not save the leave.' } : { ok: true });
  const res2 = await F.runFeeFormLeave(plan, { applyLeave: failing });
  check('leave run reports a failed student without failing the whole run', res2.ok === false && res2.applied.length === 1 && res2.failed.length === 1 && res2.failed[0].name === 'Mohib');
  let threw = false;
  try { await F.runFeeFormLeave(plan, {}); } catch (e) { threw = true; }
  check('leave run refuses to run without the leave function', threw === true);
}

// ---- #66 families CSV ---------------------------------------------------------
{
  const csv = F.buildFamiliesCsv(FAMILIES, { isManager: false });
  const lines = csv.split('\n');
  check('CSV header has the nine columns', lines[0] === 'Family ID,Parent,Students,Country,WhatsApp,Parent Email,Monthly Fee,Currency,Billing Day,Status,Notes');
  check('CSV owner row carries the real WhatsApp + email', lines[1].includes('923001234567') && lines[1].includes('hajra@example.com') && lines[1].includes('FAM-021') && lines[1].includes('7500.00'));
  check('CSV joins multiple students with a semicolon', lines[2].includes('Mohib; Sara'));
  const csvMgr = F.buildFamiliesCsv(FAMILIES, { isManager: true });
  check('CSV manager row masks BOTH contact columns as Hidden', csvMgr.split('\n')[1].includes('Hidden') && !csvMgr.includes('923001234567') && !csvMgr.includes('hajra@example.com') && !csvMgr.includes('bilal@example.com'));
  const quoted = F.buildFamiliesCsv([{ ...FAM_PKR, parent_name: 'Hajra, Waqas' }], { isManager: false });
  check('CSV quotes a field containing a comma', quoted.split('\n')[1].includes('"Hajra, Waqas"'));
  check('CSV filename is dated', F.familiesCsvFilename(new Date(2026, 10, 17)) === 'alhuda_families_2026-11-17.csv');
  check('CSV notes text reads the custom_notes key', F.notesTextOf({ notes: JSON.stringify({ custom_notes: 'City: Lahore' }) }) === 'City: Lahore');
  check('CSV notes text passes plain-text notes through', F.notesTextOf({ notes: 'Old note' }) === 'Old note');
}

// ---- #9 / #13 due-date form helpers -------------------------------------------
check('parseDueDayInput: blank is unset', F.parseDueDayInput('') === null && F.parseDueDayInput(null) === null);
check('parseDueDayInput: a plain day passes through', F.parseDueDayInput('15') === 15);
check('parseDueDayInput: clamps to 1..31', F.parseDueDayInput('99') === 31 && F.parseDueDayInput('0') === 1);
check('parseDueDayInput: non-numeric is unset', F.parseDueDayInput('abc') === null);
check('parseFeeTimingInput: blank is unset', F.parseFeeTimingInput('') === null);
check('parseFeeTimingInput: Advance stays Advance', F.parseFeeTimingInput('Advance') === 'Advance');
check('parseFeeTimingInput: Arrears stays Arrears', F.parseFeeTimingInput('Arrears') === 'Arrears');
check('parseFeeTimingInput: fee-portal End of Month maps to Arrears', F.parseFeeTimingInput('End of Month') === 'Arrears');

// ---- hygiene ------------------------------------------------------------------
check('fee-phase4.js has no Roman Urdu UI strings', !/Yeh raqam|chhutti|mujhe|tumhara|krna ha/i.test(PHASE4_SRC));
check('fee-phase4.js uses no document.write or eval', !PHASE4_SRC.includes('document.write') && !PHASE4_SRC.includes('eval('));

const failed = results.filter((r) => !r.pass);
console.log(`\nTOTAL: ${results.length - failed.length}/${results.length} passed${failed.length ? ' — FAILED: ' + failed.map((f) => f.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
