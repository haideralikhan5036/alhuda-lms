// Fee Upgrade Phase 4 — due-date engine (#9, #13) + Phase 4 wiring.
// Executes the REAL getFeeDueDate / classifyFeeArrears from
// js/fee-phase1.js in a vm sandbox, and pins the Phase 4 wiring in
// index.html, js/fees.js, js/families.js and js/profiles360.js.
// Run from the repo root: node test/fee-phase4-due-date.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHASE1_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase1.js'), 'utf8');
const PHASE4_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-phase4.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const FEES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const FAMILIES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/families.js'), 'utf8');
const PROFILES_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/profiles360.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const windowObj = {};
const sandbox = { window: windowObj, console, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.runInNewContext(PHASE1_SRC, sandbox);
const F1 = windowObj.FeePhase1;

// ---- due-date settings read ---------------------------------------------------
check('readFeeDueSettings: no notes means unset (defaults apply)', JSON.stringify(F1.readFeeDueSettings({ billing_day: 5 })) === JSON.stringify({ dueDay: null, timing: null }));
check('readFeeDueSettings: object notes are read', JSON.stringify(F1.readFeeDueSettings({ billing_day: 5, notes: { fee_due_day: 15, fee_timing: 'Arrears' } })) === JSON.stringify({ dueDay: 15, timing: 'Arrears' }));
check('readFeeDueSettings: JSON-string notes are parsed', F1.readFeeDueSettings({ billing_day: 5, notes: JSON.stringify({ fee_due_day: 20, fee_timing: 'Arrears' }) }).dueDay === 20);
check('readFeeDueSettings: corrupt notes JSON falls back to unset', F1.readFeeDueSettings({ billing_day: 5, notes: 'not-json{' }).dueDay === null);
check('readFeeDueSettings: null family is unset', JSON.stringify(F1.readFeeDueSettings(null)) === JSON.stringify({ dueDay: null, timing: null }));
check('normalizeFeeTiming: fee-portal End of Month maps to Arrears', F1.normalizeFeeTiming('End of Month') === 'Arrears' && F1.normalizeFeeTiming('after month') === 'Arrears' && F1.normalizeFeeTiming('Arrears') === 'Arrears');
check('normalizeFeeTiming: anything else is Advance', F1.normalizeFeeTiming('Advance') === 'Advance' && F1.normalizeFeeTiming('') === 'Advance' && F1.normalizeFeeTiming(null) === 'Advance');
check('dueDayOf: unset falls back to billing_day', F1.dueDayOf({ billing_day: 5 }) === 5 && F1.dueDayOf({}) === 1 && F1.dueDayOf(null) === 1);
check('dueDayOf: stored due day wins over billing_day', F1.dueDayOf({ billing_day: 5, notes: { fee_due_day: 15 } }) === 15);
check('feeTimingOf: unset is Advance', F1.feeTimingOf({ billing_day: 5 }) === 'Advance' && F1.feeTimingOf({ notes: { fee_timing: 'Arrears' } }) === 'Arrears');

// ---- getFeeDueDate: defaults preserve the old behaviour exactly ---------------
check('getFeeDueDate: unset settings keep Advance on billing_day', F1.getFeeDueDate({ billing_day: 5 }, 10, 2026) === '2026-11-05');
check('getFeeDueDate: no billing_day defaults to the 1st', F1.getFeeDueDate({}, 10, 2026) === '2026-11-01');
check('getFeeDueDate: explicit Advance timing is the same as unset', F1.getFeeDueDate({ billing_day: 5, notes: { fee_timing: 'Advance' } }, 10, 2026) === '2026-11-05');

// ---- getFeeDueDate: Due Day + Arrears change the date (fee-portal rules) -----
check('getFeeDueDate: stored Due Day moves the Advance due date', F1.getFeeDueDate({ billing_day: 5, notes: { fee_due_day: 15 } }, 10, 2026) === '2026-11-15');
check('getFeeDueDate: Arrears moves the due date to the next month', F1.getFeeDueDate({ billing_day: 5, notes: { fee_due_day: 10, fee_timing: 'Arrears' } }, 10, 2026) === '2026-12-10');
check('getFeeDueDate: fee-portal End of Month timing is Arrears', F1.getFeeDueDate({ billing_day: 1, notes: { fee_timing: 'End of Month' } }, 10, 2026) === '2026-12-01');
check('getFeeDueDate: Arrears in December rolls over to January', F1.getFeeDueDate({ billing_day: 5, notes: { fee_timing: 'Arrears' } }, 11, 2026) === '2027-01-05');
check('getFeeDueDate: Due Day 31 clamps to February (28 days in 2026)', F1.getFeeDueDate({ billing_day: 1, notes: { fee_due_day: 31 } }, 1, 2026) === '2026-02-28');
check('getFeeDueDate: Due Day 31 clamps to February in a leap year', F1.getFeeDueDate({ billing_day: 1, notes: { fee_due_day: 31 } }, 1, 2024) === '2024-02-29');
check('getFeeDueDate: JSON-string notes work the same as object notes', F1.getFeeDueDate({ billing_day: 5, notes: JSON.stringify({ fee_due_day: 20, fee_timing: 'Arrears' }) }, 10, 2026) === '2026-12-20');

// ---- classifyFeeArrears becomes due-date aware -------------------------------
const FAM_ADV = { id: 'FAM-021', parent_name: 'Hajra Waqas', monthly_fee: 7500, currency: 'PKR', billing_day: 5, status: 'Active' };
const FAM_ARR = { id: 'FAM-021', parent_name: 'Hajra Waqas', monthly_fee: 7500, currency: 'PKR', billing_day: 5, status: 'Active', notes: { fee_due_day: 5, fee_timing: 'Arrears' } };
const ctxFor = (today) => ({ today, records: [], feeForMonth: () => 7500, enrollInfo: { year: 2026, monthIndex: 9 } });
{
  const adv = F1.classifyFeeArrears(FAM_ADV, 10, 2026, ctxFor('2026-11-06'));
  check('classification: Advance family is due on 6 Nov (due 5 Nov)', adv.currentDueDate === '2026-11-05' && adv.currentIsDue === true, JSON.stringify(adv));
  const arr = F1.classifyFeeArrears(FAM_ARR, 10, 2026, ctxFor('2026-11-06'));
  check('classification: Arrears family is NOT due on 6 Nov (due 5 Dec)', arr.currentDueDate === '2026-12-05' && arr.currentIsDue === false, JSON.stringify(arr));
  const advOct = F1.classifyFeeArrears(FAM_ADV, 10, 2026, ctxFor('2026-10-20'));
  check('classification: Advance October is already an arrear on 20 Oct', advOct.arrearsCount === 1 && advOct.arrearsMonths[0].month === 'October' && advOct.arrearsAmount === 7500, JSON.stringify(advOct));
  const arrOct = F1.classifyFeeArrears(FAM_ARR, 10, 2026, ctxFor('2026-10-20'));
  check('classification: Arrears October is NOT an arrear on 20 Oct (due 5 Nov)', arrOct.arrearsCount === 0 && arrOct.arrearsAmount === 0, JSON.stringify(arrOct));
  const arrNov = F1.classifyFeeArrears(FAM_ARR, 10, 2026, ctxFor('2026-11-06'));
  check('classification: Arrears October IS an arrear on 6 Nov (due 5 Nov)', arrNov.arrearsCount === 1 && arrNov.arrearsMonths[0].month === 'October', JSON.stringify(arrNov));
}
{
  const invAdv = F1.buildFeeDueInvoiceData(FAM_ADV, 10, 2026, ctxFor('2026-11-06'));
  check('due invoice: Advance family is eligible on 6 Nov (Oct arrears + Nov fee)', invAdv.eligible === true && invAdv.totalPayable === 15000 && invAdv.dueDate === '2026-11-05' && invAdv.feeTiming === 'Advance', JSON.stringify(invAdv));
  const invArr = F1.buildFeeDueInvoiceData(FAM_ARR, 10, 2026, ctxFor('2026-11-06'));
  check('due invoice: Arrears family is eligible via October arrears only (Nov not yet due)', invArr.eligible === true && invArr.outstanding === 7500 && invArr.dueDate === '2026-12-05' && invArr.feeTiming === 'Arrears' && /Arrears/.test(invArr.timingMessage), JSON.stringify(invArr));
  const invArrNew = F1.buildFeeDueInvoiceData(FAM_ARR, 10, 2026, { today: '2026-11-06', records: [], feeForMonth: () => 7500, enrollInfo: { year: 2026, monthIndex: 10 } });
  check('due invoice: Arrears family with no arrears gets no invoice on 6 Nov (month not yet due)', invArrNew.eligible === false && /No outstanding payable fee/.test(invArrNew.reason || ''), JSON.stringify(invArrNew));
}

// ---- Phase 4 wiring: index.html ----------------------------------------------
check('index.html loads js/fee-phase4.js right after fee-phase3.js', INDEX_SRC.indexOf('<script src="js/fee-phase4.js"></script>') > INDEX_SRC.indexOf('<script src="js/fee-phase3.js"></script>') && INDEX_SRC.indexOf('<script src="js/fee-phase4.js"></script>') > 0);
check('index.html has the universal search modal + button', INDEX_SRC.includes('id="modalUniversalSearch"') && INDEX_SRC.includes('openUniversalSearchModal()') && INDEX_SRC.includes('id="txtUniversalSearch"'));
check('index.html has the currency drill-down modal', INDEX_SRC.includes('id="modalCurrencyDetail"') && INDEX_SRC.includes('id="currencyDetailBody"') && INDEX_SRC.includes('id="currencyDetailPrev"'));
// Fee Dashboard + Form Improvements: leave-from-fee-form is REMOVED
// from the Collect Fee form (owner-confirmed). The Leave tab and the
// shared leave core stay untouched.
check('index.html has NO leave-from-fee-form toggle/box', !INDEX_SRC.includes('id="chkFeeFormLeave"') && !INDEX_SRC.includes('toggleFeeFormLeaveMode()') && !INDEX_SRC.includes('id="feeFormLeaveBox"') && !INDEX_SRC.includes('id="txtFeeFormLeaveReason"'));
check('index.html has the families CSV export button', INDEX_SRC.includes('exportFamiliesCsv()'));
check('index.html Add Family form has Due Day + Fee Timing fields', INDEX_SRC.includes('id="famDueDayInput"') && INDEX_SRC.includes('id="famFeeTimingSelect"'));
check('index.html fee form keeps no leave wiring at all', !/chkFeeFormLeave|toggleFeeFormLeaveMode|submitFeeFormLeave|feeFormLeaveBox/i.test(INDEX_SRC));

// ---- Phase 4 wiring: js/fees.js ----------------------------------------------
check('fees.js currency grid includes custom currencies + click to drill down', FEES_SRC.includes('allFeeCurrencies') && FEES_SRC.includes("card.addEventListener('click', () => openCurrencyDetailModal(cur))"));
check('fees.js opens the currency detail modal with per-family rows', FEES_SRC.includes('function openCurrencyDetailModal') && FEES_SRC.includes('buildCurrencyDetailRows') && FEES_SRC.includes('buildCurrencyPrevMonths'));
check('fees.js receipt WhatsApp uses the tested builder', FEES_SRC.includes('buildReceiptWhatsAppMessage'));
check('fees.js pending WhatsApp uses the tested builder', FEES_SRC.includes('buildPendingWhatsAppMessage'));
check('fees.js defaulter WhatsApp uses the tested builder', FEES_SRC.includes('buildDefaulterWhatsAppMessage'));
check('fees.js applies the remembered method when a family is picked', FEES_SRC.includes('applyRememberedPaymentMethod(fam.id)'));
check('fees.js saves the remembered method after a payment', FEES_SRC.includes('rememberPaymentMethodForFamily(famId, paymentRecord.paymentMethod)'));
check('fees.js submit no longer branches to leave-from-fee-form', !FEES_SRC.includes('submitFeeFormLeave') && !FEES_SRC.includes('chkFeeFormLeave') && !FEES_SRC.includes('toggleFeeFormLeaveMode') && !FEES_SRC.includes('updateFeeFormLeaveSummary'));
check('fees.js fee-form leave runner is gone, Phase 4 module keeps its helpers', !FEES_SRC.includes('function submitFeeFormLeave') && PHASE4_SRC.includes('function planFeeFormLeave') && PHASE4_SRC.includes('function runFeeFormLeave'));
check('fees.js has the CSV export with manager masking', FEES_SRC.includes('function exportFamiliesCsv') && FEES_SRC.includes("buildFamiliesCsv(families, { isManager:"));

// ---- Phase 4 wiring: js/families.js + js/profiles360.js ----------------------
check('families.js saves Due Day + Fee Timing into family notes', FAMILIES_SRC.includes('fee_due_day: feeDueDay') && FAMILIES_SRC.includes('fee_timing: feeTiming'));
check('families.js resets the new Add Family fields on open', FAMILIES_SRC.includes("document.getElementById('famDueDayInput')") && FAMILIES_SRC.includes("document.getElementById('famFeeTimingSelect')"));
check('profiles360.js Edit Family currency is a select (built-ins + customs + add-new)', PROFILES_SRC.includes('id="fwEditFamCurr"') && PROFILES_SRC.includes('currencySelectOptionsHtml') && PROFILES_SRC.includes('__NEW_CURR__'));
check('profiles360.js Edit Family has Due Day + Fee Timing fields', PROFILES_SRC.includes('id="fwEditFamDueDay"') && PROFILES_SRC.includes('id="fwEditFamTiming"'));
check('profiles360.js saves Due Day + Fee Timing into family notes', PROFILES_SRC.includes('fNotes.fee_due_day = editDueDay') && PROFILES_SRC.includes('fNotes.fee_timing = editTiming'));
check('profiles360.js has the Edit Family custom-currency helpers', PROFILES_SRC.includes('function handleEditFamilyCurrencyChange') && PROFILES_SRC.includes('function saveEditFamilyCustomCurrency'));

// ---- hygiene ------------------------------------------------------------------
check('fee-phase4.js has no Roman Urdu UI strings', !/Yeh raqam|chhutti|mujhe|tumhara|krna ha/i.test(PHASE4_SRC));
check('fee-phase1.js due-date change adds no Worker / D1 code', !/wrangler|workers\.dev/i.test(PHASE1_SRC.slice(PHASE1_SRC.indexOf('function readFeeDueSettings'), PHASE1_SRC.indexOf('function classifyFeeArrears'))));

const failed = results.filter((r) => !r.pass);
console.log(`\nTOTAL: ${results.length - failed.length}/${results.length} passed${failed.length ? ' — FAILED: ' + failed.map((f) => f.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
