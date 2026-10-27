// Unified Lesson History — shared reader unit tests (pure functions +
// getLessonHistory against a stub db client).
// Run from the repo root:  node test/lesson-history.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = fs.readFileSync(path.join(REPO_ROOT, 'js/lesson-history.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}

const sandbox = { console, URL, FormData, fetch: async () => { throw new Error('no fetch in unit tests'); } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC + '\nthis.__LH = LessonHistory;', sandbox);
const LH = sandbox.__LH;

if (!LH) { console.log('FAIL | LessonHistory module did not load'); process.exit(1); }

// --- 1. Normalization: full JSON payload -------------------------------
const full = LH.normalizeLessonRow({
  id: 'L1', schedule_id: 'SC1', student_id: 'ST1', teacher_id: 'T1',
  date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T10:00:00Z',
  lesson_notes: JSON.stringify({
    book_id: 'holy-quran-16-line', book_title: 'Holy Quran', para: 2, page: 14,
    line_range: 'Lines 1-5', status: 'Pass', remarks: 'Good recitation',
    additional_lesson: 'Namaz: Surah Fatiha', image_key: 'scoped-teacher-T1/img.png'
  })
}, 'Ustadh A');
check('full payload: book/para/page/line/result preserved', full.bookId === 'holy-quran-16-line' && full.para === 2 && full.page === 14 && full.lineRange === 'Lines 1-5' && full.result === 'Pass');
check('full payload: additional_lesson + image_key carried', full.additionalLesson === 'Namaz: Surah Fatiha' && full.imageKey === 'scoped-teacher-T1/img.png');
check('full payload: teacher name from caller map', full.teacherName === 'Ustadh A');
check('full payload: duration null without timestamps', full.durationMins === null && LH.formatActualDuration(full) === 'not recorded');

// --- 2. Missing optionals -> null, NEVER "Page 1" / fallback book -----
const sparse = LH.normalizeLessonRow({
  id: 'L2', schedule_id: 'SC2', student_id: 'ST1', date: '2026-10-21',
  status: 'Completed', lesson_notes: JSON.stringify({ book_title: 'Qaida', remarks: 'ok' })
});
check('sparse payload: page/para/bookId null (no Page 1)', sparse.page === null && sparse.para === null && sparse.bookId === null);
check('sparse payload: title is verbatim book_title', LH.entryTitle(sparse) === 'Qaida');

// --- 3. Legacy plain-text note -----------------------------------------
const plain = LH.normalizeLessonRow({
  id: 'L3', student_id: 'ST1', date: '2026-10-19', status: 'Completed',
  lesson_notes: '3-Day Trial Session 1/3 Logged'
});
check('plain-text note readable via fallback', plain.hasLesson === true && plain.remarks === '3-Day Trial Session 1/3 Logged' && plain.page === null);

// --- 4. Additional Course sentinel preserved, distinct from additional_lesson
const sentinel = LH.normalizeLessonRow({
  id: 'L4', schedule_id: 'SC3', student_id: 'ST1', date: '2026-10-22',
  status: 'Completed', lesson_notes: JSON.stringify({
    book_id: 'additional-course', book_title: 'Arabic Grammar', lesson_name: 'Past Tense',
    content_type: 'additional', page: null, additional_lesson: 'Duas: Morning'
  })
});
check('sentinel: isAdditionalCourse + lesson_name kept', sentinel.isAdditionalCourse === true && sentinel.lessonName === 'Past Tense');
check('sentinel: additional_lesson NOT conflated with lesson_name', sentinel.additionalLesson === 'Duas: Morning' && LH.entryTitle(sentinel) === 'Arabic Grammar — Past Tense');

// --- 5. Read-side dedupe -----------------------------------------------
const rows = [
  // Transition row (started, no lesson) + save row (completed + lesson), same class+date
  { id: 'R1', schedule_id: 'SC9', student_id: 'ST1', teacher_id: 'T1', date: '2026-10-20', status: 'Running', created_at: '2026-10-20T09:00:00Z', started_at: '2026-10-20T09:00:00Z', lesson_notes: '' },
  { id: 'R2', schedule_id: 'SC9', student_id: 'ST1', teacher_id: 'T1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T09:35:00Z', completed_at: '2026-10-20T09:35:00Z', lesson_notes: JSON.stringify({ book_title: 'Qaida', page: 5, remarks: 'done' }) },
  // Re-save of the same class (newer) wins the payload
  { id: 'R3', schedule_id: 'SC9', student_id: 'ST1', teacher_id: 'T1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T10:00:00Z', completed_at: '2026-10-20T10:00:00Z', lesson_notes: JSON.stringify({ book_title: 'Qaida', page: 6, remarks: 'corrected' }) },
  // Different schedule, same date: a genuinely different lesson, MUST survive
  { id: 'R4', schedule_id: 'SC10', student_id: 'ST1', teacher_id: 'T1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T11:00:00Z', lesson_notes: JSON.stringify({ book_title: 'Quran', page: 3 }) },
  // Schedule-less 360-form rows, same date: never deduped against each other
  { id: 'R5', student_id: 'ST1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T12:00:00Z', lesson_notes: JSON.stringify({ book_title: 'Surah Baqarah', remarks: 'a' }) },
  { id: 'R6', student_id: 'ST1', date: '2026-10-20', status: 'Completed', created_at: '2026-10-20T13:00:00Z', lesson_notes: JSON.stringify({ book_title: 'Surah Baqarah', remarks: 'b' }) }
];
const deduped = LH.dedupeLessonRows(rows);
check('dedupe: 6 rows -> 4 entries (group collapses, others kept)', deduped.length === 4, 'got ' + deduped.length);
const sc9 = deduped.find(e => e.scheduleId === 'SC9');
check('dedupe: latest created_at row supplies payload', sc9 && sc9.page === 6 && sc9.remarks === 'corrected');
check('dedupe: duration paired earliest-started -> latest-completed (60 min)', sc9 && sc9.durationMins === 60, 'got ' + (sc9 && sc9.durationMins));
check('dedupe: same-day different schedule kept', deduped.some(e => e.scheduleId === 'SC10'));
check('dedupe: schedule-less rows both kept', deduped.filter(e => !e.scheduleId).length === 2);
check('dedupe: order date DESC', deduped.every(e => e.date === '2026-10-20'));

// Duration edge: only started, no completed -> null, never invented
const onlyStarted = LH.dedupeLessonRows([
  { id: 'S1', schedule_id: 'SC11', student_id: 'ST1', date: '2026-10-21', status: 'Running', created_at: '2026-10-21T09:00:00Z', started_at: '2026-10-21T09:00:00Z', lesson_notes: '' }
]);
check('duration: started without completed -> not recorded', onlyStarted[0].durationMins === null && LH.formatActualDuration(onlyStarted[0]) === 'not recorded');

// --- 6. Date filter: exact stored-date match, all multiples -----------
const all = LH.dedupeLessonRows(rows);
check('date filter: exact match returns all same-day entries', LH.filterLessonEntries(all, '2026-10-20').length === 4);
check('date filter: other date returns none', LH.filterLessonEntries(all, '2026-10-21').length === 0);
check('date filter: null returns everything', LH.filterLessonEntries(all, null).length === 4);

// --- 7. getLessonHistory via stub db ------------------------------------
function stubDb(rowsOut) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { _table: table, _eq: null, _limit: null };
      const api = {
        select() { return api; },
        eq(col, val) { q._eq = [col, val]; return api; },
        order() { return api; },
        limit(n) { q._limit = n; calls.push({ table, eq: q._eq, limit: n }); return Promise.resolve({ data: rowsOut }); }
      };
      return api;
    }
  };
}
const stub = stubDb(rows);
const entries = await LH.getLessonHistory({ studentId: 'ST1', dbClient: stub });
check('getLessonHistory: queries attendance_logs by student_id', stub.calls.length === 1 && stub.calls[0].table === 'attendance_logs' && stub.calls[0].eq[0] === 'student_id' && stub.calls[0].eq[1] === 'ST1');
check('getLessonHistory: dedupes + date DESC', entries.length === 4);
const dated = await LH.getLessonHistory({ studentId: 'ST1', date: '2026-10-20', dbClient: stub });
check('getLessonHistory: date option filters', dated.length === 4);
let threw = false;
try { await LH.getLessonHistory({ dbClient: stub }); } catch (e) { threw = true; }
check('getLessonHistory: studentId required', threw);

const failed = results.filter(r => !r.pass).length;
console.log(`\nlesson-history: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
