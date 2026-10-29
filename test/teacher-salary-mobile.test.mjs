// Teacher salary area on phone portrait (Phase 2) tests.
// The salary ledger (8 columns, 640px scroll width) becomes labelled
// cards on phones using the Batch C2 .tcard pattern; the salary
// summary cells stop overflowing narrow cards; everything else in
// the salary area (form, month select, request list, receipt modal)
// was already portrait-safe and must stay that way. Desktop markup
// is untouched: the media query alone changes phone rendering.
// Run from the repo root:  node test/teacher-salary-mobile.test.mjs
// Requires: node >= 22.5 (no DOM needed — structural checks on the
// real teacher.html, mirroring the Batch C2 suite's approach).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// Ledger wrapper: the overflow wrapper directly before the ledger
// table (identified by its Billing Month thead) carries .tcard.
const ledgerTableIdx = TEACHER.indexOf('Billing Month');
const wrapperIdx = TEACHER.lastIndexOf('overflow-x-auto touch-scroll', ledgerTableIdx);
const wrapperSnippet = TEACHER.slice(wrapperIdx, wrapperIdx + 60);
check('ledger: wrapper carries .tcard (phones render cards, desktop scrolls)',
  wrapperSnippet.includes('tcard'), wrapperSnippet);

// Ledger row template: between the teacherSlips map and its join.
const mapStart = TEACHER.indexOf('teacherSlips.map');
const mapEnd = TEACHER.indexOf("}).join('')", mapStart);
const rowTemplate = mapStart >= 0 && mapEnd > mapStart ? TEACHER.slice(mapStart, mapEnd) : '';
const labels = ['Billing Month', 'Assigned Students', 'Base Teaching', 'Adjustments (Bonus/Ded)',
  'Approved Advances', 'Net Payable', 'Status', 'Actions'];
for (const label of labels) {
  check(`ledger: row template labels "${label}"`, rowTemplate.includes(`data-label="${label}"`));
}
check('ledger: row template still has all 8 cells',
  (rowTemplate.match(/<td /g) || []).length === 8, `found ${(rowTemplate.match(/<td /g) || []).length}`);

// Desktop intact: scroll width + headers unchanged.
check('ledger: desktop keeps the 640px scroll width + overflow wrapper',
  TEACHER.includes('min-w-[640px]') && TEACHER.includes('overflow-x-auto touch-scroll'));
for (const h of ['Billing Month', 'Assigned Students', 'Base Teaching', 'Adjustments (Bonus/Ded)',
  'Approved Advances', 'Net Payable', 'Status', 'Actions']) {
  check(`ledger: desktop thead still has "${h}"`, TEACHER.includes(`<th class="p-3`) && TEACHER.includes(`>${h}<`));
}

// Phone CSS: summary cells fit narrow cards (inside the <=767px block).
const mediaStart = TEACHER.indexOf('@media (max-width: 767px)');
const mediaBlock = mediaStart >= 0 ? TEACHER.slice(mediaStart) : '';
check('summary: phone rule keeps summary cells inside narrow cards',
  mediaBlock.includes('#tSalSummaryBody .grid > div { min-width: 0; }'));
check('summary: phone rule wraps long mono amounts',
  mediaBlock.includes('#tSalSummaryBody .font-mono { overflow-wrap: anywhere; }'));
check('summary: summary grid is still 2-up on phones / 3-up on desktop (no column removed)',
  TEACHER.includes('grid grid-cols-2 sm:grid-cols-3 gap-2.5'));

// Form portrait structure (unchanged, must stay single-column + wrapping).
check('form: period/type grid is single-column on phones',
  TEACHER.includes('grid grid-cols-1 sm:grid-cols-2 gap-2.5'));
check('form: advance type buttons wrap instead of overflowing',
  TEACHER.includes('id="tAdvTypeGroup"') && TEACHER.includes('flex flex-wrap gap-1.5'));
check('form: submit row wraps',
  TEACHER.includes('id="tAdvSubmitBtn"') && TEACHER.includes('flex items-center gap-2 flex-wrap'));
check('form: month select is full-width',
  TEACHER.includes('id="tAdvPeriod" class="w-full'));

// No helper text deleted.
for (const helper of ['Must be more than 0 and no more than this period',
  'Submitting a request does not change your salary',
  'Approved advances are deducted from that month',
  'From your latest official slip']) {
  check(`form: helper text kept ("${helper.slice(0, 32)}…")`, TEACHER.includes(helper));
}

// Request list: already div cards (no table to card-ify).
check('requests: My Advance Requests renders div cards, not a table',
  TEACHER.includes('id="tAdvMyList"') && TEACHER.includes('p-3 bg-slate-50 rounded-xl border border-slate-200'));

// C2 invariants intact.
const tcardWrappers = (TEACHER.match(/overflow-x-auto touch-scroll tcard/g) || []).length;
check('cards: exactly 3 .tcard tables (classes, students, ledger)', tcardWrappers === 3, `found ${tcardWrappers}`);
check('cards: viewport still stops iOS focus-zoom',
  TEACHER.includes('interactive-widget=resizes-content'));
check('cards: phone button rule still 44px',
  mediaBlock.includes('#teacherMainContainer button, div.fixed[id^="modal"] button { min-height: 44px; }'));

// Receipt modal untouched (div layout, C2 modal rules cover it).
check('receipt: modal keeps full-width phone sizing',
  TEACHER.includes('id="teacherSalarySlipReceiptCard"') && TEACHER.includes('max-w-3xl') && TEACHER.includes('max-h-[94vh]'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
