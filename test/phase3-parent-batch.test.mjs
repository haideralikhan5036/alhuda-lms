// Phase 3.2 test — parent batch (P1-6, P2-24, P2-25, P2-27).
// Part A: js/lesson-history.js pure helpers in a vm (attended predicate +
// attendance rate + dedupe integration). Part B: js/fee-tables.js
// mergeLegacyFeeSources in a vm (newest-wins fee chain). Part C:
// structural guards on parent.html / js/fees.js / index.html (rate block,
// badges, student-row refetch, notes-only leave, truthful receipt
// labels, Worker release NOT bumped).
// Run from the repo root:  node test/phase3-parent-batch.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LH_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/lesson-history.js'), 'utf8');
const FT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/fee-tables.js'), 'utf8');
const PARENT = fs.readFileSync(path.join(REPO_ROOT, 'parent.html'), 'utf8');
const FEES = fs.readFileSync(path.join(REPO_ROOT, 'js/fees.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(REPO_ROOT, 'cloudflare/worker.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

// ==== Part A: attendance helpers =========================================
{
  const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch'); } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LH_SRC + '\nthis.__LH = LessonHistory;', sandbox);
  const LH = sandbox.__LH;
  check('A module loads with new helpers', !!LH && typeof LH.isAttendedStatus === 'function' && typeof LH.attendanceRate === 'function');

  check('A isAttendedStatus: Completed + Present true', LH.isAttendedStatus('Completed') === true && LH.isAttendedStatus('Present') === true);
  check('A isAttendedStatus: Absent/Leave/Running/Waiting/null/empty false',
    LH.isAttendedStatus('Absent') === false && LH.isAttendedStatus('Leave') === false &&
    LH.isAttendedStatus('Running') === false && LH.isAttendedStatus('Waiting') === false &&
    LH.isAttendedStatus(null) === false && LH.isAttendedStatus('') === false);

  const r0 = LH.attendanceRate([]);
  check('A attendanceRate: no records -> 0/0/0%', r0.present === 0 && r0.total === 0 && r0.percent === 0, JSON.stringify(r0));
  const r1 = LH.attendanceRate([{ status: 'Completed' }, { status: 'Completed' }, { status: 'Completed' }]);
  check('A attendanceRate: all Completed -> 100% (old Present-only code gave 0%)', r1.present === 3 && r1.total === 3 && r1.percent === 100, JSON.stringify(r1));
  const r2 = LH.attendanceRate([{ status: 'Completed' }, { status: 'Completed' }, { status: 'Present' }, { status: 'Absent' }, { status: 'Leave' }]);
  check('A attendanceRate: 3 attended / 5 total -> 60%', r2.present === 3 && r2.total === 5 && r2.percent === 60, JSON.stringify(r2));
  const r3 = LH.attendanceRate([{ status: 'Completed' }, { status: 'Completed' }, { status: 'Absent' }]);
  check('A attendanceRate: 2/3 -> 67% (old code: 0%)', r3.present === 2 && r3.total === 3 && r3.percent === 67, JSON.stringify(r3));

  // Dedupe integration: a re-save (same schedule+date) must not inflate
  // the denominator; the table and the rate then agree.
  const raw = [
    { id: 'L1', schedule_id: 'SC1', student_id: 'ST1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T10:00:00Z', lesson_notes: '{}' },
    { id: 'L2', schedule_id: 'SC1', student_id: 'ST1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T11:00:00Z', lesson_notes: '{}' },
    { id: 'L3', schedule_id: 'SC2', student_id: 'ST1', date: '2026-10-19', status: 'Absent', created_at: '2026-10-19T10:00:00Z', lesson_notes: '{}' },
  ];
  const deduped = LH.dedupeLessonRows(raw);
  const rr = LH.attendanceRate(deduped);
  check('A dedupe + rate: 3 raw rows -> 2 entries, 1/2 -> 50%', deduped.length === 2 && rr.present === 1 && rr.total === 2 && rr.percent === 50,
    'deduped=' + deduped.length + ' ' + JSON.stringify(rr));
}

// ==== Part B: fee-chain merge ============================================
{
  const sandbox = {
    window: {},
    console,
    JSON, Object, Array, String, Number, Math, Date, parseFloat, parseInt, isFinite,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(FT_SRC, sandbox);
  const FT = sandbox.window.FeeTables;
  check('B fee-tables exposes mergeLegacyFeeSources', !!FT && typeof FT.mergeLegacyFeeSources === 'function');

  const notesR1 = { receiptNo: 'R1', date: '2026-08-05', amountPaid: 100 };
  const collR1 = { receiptNo: 'R1', payment_date: '2026-10-05', amountPaid: 120 };
  const m1 = FT.mergeLegacyFeeSources([{ rank: 1, list: [notesR1] }, { rank: 0, list: [collR1] }]);
  check('B newest wins: stale notes (Aug, 100) vs newer collections (Oct, 120) -> 120',
    m1.length === 1 && m1[0].amountPaid === 120, JSON.stringify(m1));

  const tieNotes = { receiptNo: 'R2', date: '2026-09-01', amountPaid: 50, src: 'notes' };
  const tieColl = { receiptNo: 'R2', payment_date: '2026-09-01', amountPaid: 55, src: 'coll' };
  const m2 = FT.mergeLegacyFeeSources([{ rank: 0, list: [tieColl] }, { rank: 1, list: [tieNotes] }]);
  check('B tie on date: rank 0 (collections) wins', m2.length === 1 && m2[0].src === 'coll', JSON.stringify(m2));

  const m3 = FT.mergeLegacyFeeSources([
    { rank: 1, list: [{ receiptNo: null, date: '2026-10-01', amountPaid: 10 }, { date: '2026-09-01', amountPaid: 20 }] },
  ]);
  check('B numberless records are all kept (never deduped)', m3.length === 2, JSON.stringify(m3));

  check('B empty sources -> []', JSON.stringify(FT.mergeLegacyFeeSources([])) === '[]' &&
    JSON.stringify(FT.mergeLegacyFeeSources([{ rank: 0, list: [] }])) === '[]');

  const m5 = FT.mergeLegacyFeeSources([{ rank: 0, list: [
    { receiptNo: 'R9', date: '2026-09-01', amountPaid: 1 },
    { receiptNo: 'R10', date: '2026-10-01', amountPaid: 2 },
    { receiptNo: null, date: '2026-11-01', amountPaid: 3 },
    { receiptNo: 'R11', amountPaid: 4 },
  ] }]);
  check('B output is date-desc, undated last (Nov numberless first)', m5.map((r) => r.receiptNo).join(',') === ',R10,R9,R11',
    JSON.stringify(m5.map((r) => r.receiptNo)));
  check('B undated numberless record still present at end', m5.length === 4 && m5[3].amountPaid === 4, JSON.stringify(m5));

  const m6 = FT.mergeLegacyFeeSources([
    { rank: 1, list: [{ receiptNo: 'r-1', date: '2026-08-01', amountPaid: 1 }] },
    { rank: 0, list: [{ receiptNo: 'R-1', payment_date: '2026-09-01', amountPaid: 2 }] },
  ]);
  check('B dedup key is case-insensitive on receiptNo', m6.length === 1 && m6[0].amountPaid === 2, JSON.stringify(m6));
}

// ==== Part C: structural guards ==========================================
check('C parent rate block uses deduped entries + attended predicate',
  PARENT.includes('dedupeLessonRows(attLogs)') && PARENT.includes('parentIsAttendedStatus'));
check('C parent badges no longer use Present-only emerald test',
  !PARENT.includes("log.status === 'Present' ? 'bg-emerald"));
check('C parent badges use the attended predicate (2 sites)',
  (PARENT.match(/parentIsAttendedStatus\(log\.status\)/g) || []).length === 2,
  String((PARENT.match(/parentIsAttendedStatus\(log\.status\)/g) || []).length));
check('C parent fee chain calls the merge helper with all four sources',
  PARENT.includes('mergeLegacyFeeSources') && PARENT.includes('collectionsMapped') &&
  PARENT.includes('freshFamilyNotes') && PARENT.includes('cachedFamilyNotes') && PARENT.includes('localMatched'));
check('C parent table path still checked first (fee_read_parent ON wins outright)',
  PARENT.indexOf('feeHistoryFromTables = true') < PARENT.indexOf('mergeLegacyFeeSources'));
check('C parent live sync refetches the student row (family-scoped, fail-open)',
  PARENT.includes("db.from('students').select('*').eq('id', CURRENT_STUDENT.id)") &&
  PARENT.includes('ALL_STUDENTS[idx] = freshStudent') && PARENT.includes('CURRENT_STUDENT = freshStudent'));
check('C parent leave submit still notes-only (update object carries notes only)',
  PARENT.includes('notesObj.leave_request = leaveRequest') &&
  PARENT.includes('notesObj.leave_history') &&
  PARENT.includes('notes: JSON.stringify(notesObj)'));
check('C no invented receipt numbers in parent/fees/index',
  !PARENT.includes('AH-REC-OFFICIAL') && !FEES.includes('AH-REC-OFFICIAL') && !INDEX.includes('AH-REC-OFFICIAL') &&
  !PARENT.includes('AH-REC-${') && !FEES.includes('AH-REC-${') && !INDEX.includes('AH-REC-${'));
check('C receipt-less records show a truthful label (parent template + table + modals)',
  PARENT.includes('>Not issued<') && (PARENT.match(/'Not issued'/g) || []).length >= 3,
  String((PARENT.match(/'Not issued'/g) || []).length));
check('C collections mapping no longer invents a number (null receiptNo)',
  PARENT.includes('receiptNo: fc.receipt_no || null'));
check('C worker release NOT bumped in this batch (batched deploy rule)',
  WORKER.includes("const WORKER_RELEASE = '2026-10-28-audit-p1'"));

const failed = results.filter((x) => !x.pass);
console.log('---');
console.log(`phase3-parent-batch: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
