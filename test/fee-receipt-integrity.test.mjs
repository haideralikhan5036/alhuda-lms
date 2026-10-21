// Fee receipt integrity (Batch 3A, B9 + B15 client matchers) test.
// Extracts the REAL functions from js/fees.js and js/config.js by name
// (balanced-brace extraction) and drives them directly — no copies.
// Run from the repo root:  node test/fee-receipt-integrity.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  const begin = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
function extractConst(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error('const not found: ' + name);
  const end = src.indexOf(';', start);
  return src.slice(start, end + 1);
}

const feesSrc = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const configSrc = fs.readFileSync(path.join(REPO_ROOT, 'js/config.js'), 'utf8');

const sandbox = { FEE_CONFIG: { RECEIPT_PREFIX: 'AH-REC-' }, crypto: webcrypto, console, window: {} };
const feesFactory = new Function('FEE_CONFIG', 'crypto', 'console', 'window', `
  ${extractConst(feesSrc, 'RECEIPT_RANDOM_ALPHABET')}
  ${extractFunction(feesSrc, 'generateReceiptNo')}
  ${extractFunction(feesSrc, 'feeRecordKey')}
  ${extractFunction(feesSrc, 'feeRecordFingerprint')}
  ${extractFunction(feesSrc, 'ingestFeeRecord')}
  ${extractFunction(feesSrc, 'findFeeMonthDuplicate')}
  return { generateReceiptNo, feeRecordKey, feeRecordFingerprint, ingestFeeRecord, findFeeMonthDuplicate };
`);
const fees = feesFactory(sandbox.FEE_CONFIG, sandbox.crypto, sandbox.console, sandbox.window);

const cfgFactory = new Function('window', `
  ${extractFunction(configSrc, 'normalizePersonName')}
  ${extractFunction(configSrc, 'findDuplicateStudentName')}
  return { normalizePersonName, findDuplicateStudentName };
`);
const cfg = cfgFactory({});

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ---- Receipt number format ---------------------------------------------------
{
  const n = fees.generateReceiptNo(new Date(2026, 9, 21));
  check('B9 new receipt format AH-REC-YYYYMMDD-XXXXXX', /^AH-REC-20261021-[A-Z2-9]{6}$/.test(n), n);
  check('B9 suffix has no confusing chars (0,1,I,L,O)', !/[01ILO]/.test(n.split('-').pop()), n);
}

// ---- Two browsers minting at the same time ------------------------------------
{
  const seen = new Set();
  const when = new Date(2026, 9, 21, 10, 30, 0);
  for (let i = 0; i < 500; i++) seen.add(fees.generateReceiptNo(when));
  check('B9 500 same-second mints are all unique', seen.size === 500, 'unique=' + seen.size);
}

// ---- Deletion followed by a new receipt ----------------------------------------
{
  let records = [fees.generateReceiptNo(), fees.generateReceiptNo(), fees.generateReceiptNo()];
  const deleted = records[1];
  records = records.filter((_, i) => i !== 1); // one receipt deleted
  const fresh = fees.generateReceiptNo();
  check('B9 mint after deletion does not reuse any live or deleted number',
    !records.includes(fresh) && fresh !== deleted, 'fresh=' + fresh);
}

// ---- Ingest: two families carrying the SAME old-format number -------------------
{
  const map = new Map();
  const warnings = [];
  const a = { receiptNo: 'AH-REC-2026-0007', familyId: 'FAM-1', month: 'October', year: 2026, amountPaid: 100, totalPayable: 100, date: '2026-10-03' };
  const b = { receiptNo: 'AH-REC-2026-0007', familyId: 'FAM-2', month: 'October', year: 2026, amountPaid: 250, totalPayable: 250, date: '2026-10-04' };
  check('B9 ingest family A record -> added', fees.ingestFeeRecord(map, a, warnings) === 'added');
  check('B9 ingest family B record with SAME number -> added (no overwrite)', fees.ingestFeeRecord(map, b, warnings) === 'added');
  check('B9 both records survive ingest', map.size === 2 &&
    map.get(fees.feeRecordKey(a)).amountPaid === 100 && map.get(fees.feeRecordKey(b)).amountPaid === 250,
    'size=' + map.size);
}

// ---- Ingest: same family + number but a DIFFERENT record -------------------------
{
  const map = new Map();
  const warnings = [];
  const a = { receiptNo: 'AH-REC-2026-0009', familyId: 'FAM-1', month: 'October', year: 2026, amountPaid: 100, totalPayable: 100, date: '2026-10-03' };
  const b = { receiptNo: 'AH-REC-2026-0009', familyId: 'FAM-1', month: 'November', year: 2026, amountPaid: 400, totalPayable: 400, date: '2026-11-02' };
  fees.ingestFeeRecord(map, a, warnings);
  const outcome = fees.ingestFeeRecord(map, b, warnings);
  const amounts = [...map.values()].map((r) => r.amountPaid).sort((x, y) => x - y);
  check('B9 different record with same number -> kept-both + warning',
    outcome === 'kept-both' && warnings.length === 1 && map.size === 2 && amounts.join(',') === '100,400',
    `outcome=${outcome} size=${map.size} warnings=${warnings.length}`);
}

// ---- Ingest: a fresher copy of the SAME record refreshes in place -----------------
{
  const map = new Map();
  const warnings = [];
  const a = { receiptNo: 'AH-REC-20261021-K7QX3M', familyId: 'FAM-1', month: 'October', year: 2026, amountPaid: 100, totalPayable: 100, date: '2026-10-21', status: 'Partial (Balance Remaining)' };
  const a2 = { ...a, status: 'Paid in Full' };
  fees.ingestFeeRecord(map, a, warnings);
  const outcome = fees.ingestFeeRecord(map, a2, warnings);
  check('B9 same record re-ingested -> refreshed, still one record, latest copy wins',
    outcome === 'refreshed' && map.size === 1 && map.get(fees.feeRecordKey(a)).status === 'Paid in Full' && warnings.length === 0,
    `outcome=${outcome} size=${map.size}`);
}

// ---- Fee month duplicate matcher (B15) ---------------------------------------------
{
  const records = [
    { receiptNo: 'AH-REC-2026-0001', familyId: 'FAM-1', month: 'October', year: 2026, status: 'Paid in Full' },
    { receiptNo: 'AH-REC-2026-0002', familyId: 'FAM-1', month: 'September', year: 2026, status: 'Cancelled' },
  ];
  check('B15 fee duplicate: same family + month + year matches (case-insensitive)',
    !!fees.findFeeMonthDuplicate(records, 'fam-1', 'october', 2026));
  check('B15 fee duplicate: cancelled record does NOT count',
    fees.findFeeMonthDuplicate(records, 'FAM-1', 'September', 2026) === null);
  check('B15 fee duplicate: different family does not match',
    fees.findFeeMonthDuplicate(records, 'FAM-9', 'October', 2026) === null);
  check('B15 fee duplicate: different month does not match',
    fees.findFeeMonthDuplicate(records, 'FAM-1', 'November', 2026) === null);
}

// ---- Student name duplicate matcher (B15) --------------------------------------------
{
  const students = [
    { id: 'STU-1', family_id: 'FAM-1', name: 'Fatima Zahra' },
    { id: 'STU-2', family_id: 'FAM-2', name: 'Fatima Zahra' },
  ];
  check('B15 student duplicate: same name in SAME family matches (normalised)',
    (cfg.findDuplicateStudentName(students, 'FAM-1', '  fatima   ZAHRA ') || {}).id === 'STU-1');
  check('B15 student duplicate: same name in a DIFFERENT family does not match',
    cfg.findDuplicateStudentName(students, 'FAM-3', 'Fatima Zahra') === null);
  check('B15 student duplicate: blank name never matches',
    cfg.findDuplicateStudentName(students, 'FAM-1', '   ') === null);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
